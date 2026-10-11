//! Semantic index: symbol definitions and the references between them, built from tree-sitter ASTs.
//!
//! Symbols are named the way agents declare intents: `parsePrice`, `Cart.total`, `Server.handle`.
//! References are resolved by simple name across the repo, which is approximate but cheap and
//! good enough to flag "your change touches something my change calls".

use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::hash::{DefaultHasher, Hash, Hasher};
use tree_sitter::{Language, Node, Parser};

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct SymbolRef {
    pub path: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Symbol {
    pub path: String,
    pub name: String,
    pub kind: &'static str,
    /// Hash of the definition's text with whitespace collapsed; used to tell whether it changed.
    #[serde(skip)]
    pub body_hash: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Reference {
    pub from: SymbolRef,
    pub to: SymbolRef,
}

#[derive(Debug, Default, Serialize)]
pub struct Index {
    pub symbols: Vec<Symbol>,
    pub refs: Vec<Reference>,
}

impl Index {
    pub fn key(s: &Symbol) -> SymbolRef {
        SymbolRef { path: s.path.clone(), name: s.name.clone() }
    }

    pub fn hashes(&self) -> HashMap<SymbolRef, u64> {
        self.symbols.iter().map(|s| (Self::key(s), s.body_hash)).collect()
    }

    pub fn ref_set(&self) -> BTreeSet<(SymbolRef, SymbolRef)> {
        self.refs.iter().map(|r| (r.from.clone(), r.to.clone())).collect()
    }
}

#[derive(Clone, Copy)]
enum Lang {
    TypeScript,
    Tsx,
    JavaScript,
    Rust,
    Python,
}

impl Lang {
    fn for_path(path: &str) -> Option<Lang> {
        let ext = path.rsplit('.').next()?;
        Some(match ext {
            "ts" | "mts" | "cts" => Lang::TypeScript,
            "tsx" => Lang::Tsx,
            "js" | "mjs" | "cjs" | "jsx" => Lang::JavaScript,
            "rs" => Lang::Rust,
            "py" => Lang::Python,
            _ => return None,
        })
    }

    fn language(self) -> Language {
        match self {
            Lang::TypeScript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            Lang::Tsx => tree_sitter_typescript::LANGUAGE_TSX.into(),
            Lang::JavaScript => tree_sitter_javascript::LANGUAGE.into(),
            Lang::Rust => tree_sitter_rust::LANGUAGE.into(),
            Lang::Python => tree_sitter_python::LANGUAGE.into(),
        }
    }

    /// Node kinds that define a named symbol, and the kind label we report.
    fn definition(self, kind: &str) -> Option<&'static str> {
        match self {
            Lang::TypeScript | Lang::Tsx | Lang::JavaScript => match kind {
                "function_declaration" | "generator_function_declaration" => Some("function"),
                "class_declaration" | "abstract_class_declaration" => Some("class"),
                "method_definition" | "method_signature" => Some("method"),
                "interface_declaration" => Some("interface"),
                "type_alias_declaration" => Some("type"),
                "enum_declaration" => Some("enum"),
                "variable_declarator" => Some("const"),
                _ => None,
            },
            Lang::Rust => match kind {
                "function_item" | "function_signature_item" => Some("function"),
                "struct_item" => Some("struct"),
                "enum_item" => Some("enum"),
                "trait_item" => Some("trait"),
                "type_item" => Some("type"),
                "const_item" | "static_item" => Some("const"),
                _ => None,
            },
            Lang::Python => match kind {
                "function_definition" => Some("function"),
                "class_definition" => Some("class"),
                _ => None,
            },
        }
    }

    /// Nodes whose name qualifies the definitions inside them (`Class.method`).
    fn container_name<'a>(self, node: Node<'a>, src: &'a [u8]) -> Option<&'a str> {
        let field = match (self, node.kind()) {
            (Lang::Rust, "impl_item") => "type",
            (Lang::Rust, "trait_item") => "name",
            (Lang::Python, "class_definition") => "name",
            (_, "class_declaration" | "abstract_class_declaration" | "interface_declaration") => "name",
            _ => return None,
        };
        node.child_by_field_name(field)?.utf8_text(src).ok()
    }

    fn is_identifier(kind: &str) -> bool {
        matches!(
            kind,
            "identifier" | "type_identifier" | "property_identifier" | "field_identifier" | "shorthand_property_identifier"
        )
    }
}

struct Def {
    key: SymbolRef,
    start: usize,
    end: usize,
}

/// Index one file. Returns its symbols and the raw (unresolved) names each symbol mentions.
fn index_file(path: &str, src: &str) -> Option<(Vec<Symbol>, Vec<(SymbolRef, String)>)> {
    let lang = Lang::for_path(path)?;
    let mut parser = Parser::new();
    parser.set_language(&lang.language()).ok()?;
    let tree = parser.parse(src, None)?;
    let bytes = src.as_bytes();

    let mut symbols = Vec::new();
    let mut defs: Vec<Def> = Vec::new();
    let mut mentions = Vec::new();
    walk(lang, tree.root_node(), bytes, path, &mut Vec::new(), &mut symbols, &mut defs);

    // A container (class, impl, trait) shouldn't count as changed just because one of its members
    // did: members are symbols of their own. Re-hash containers with nested definitions cut out.
    for i in 0..symbols.len() {
        let inner: Vec<(usize, usize)> = defs
            .iter()
            .enumerate()
            .filter(|(j, d)| *j != i && d.start >= defs[i].start && d.end <= defs[i].end)
            .map(|(_, d)| (d.start, d.end))
            .collect();
        if !inner.is_empty() {
            symbols[i].body_hash = hash_excluding(&src[defs[i].start..defs[i].end], defs[i].start, &inner);
        }
    }

    // Attribute every identifier to the innermost definition that contains it.
    let mut stack = vec![tree.root_node()];
    while let Some(node) = stack.pop() {
        if Lang::is_identifier(node.kind()) {
            let at = node.start_byte();
            if let Some(owner) = defs.iter().filter(|d| d.start <= at && at < d.end).min_by_key(|d| d.end - d.start) {
                if let Ok(text) = node.utf8_text(bytes) {
                    mentions.push((owner.key.clone(), text.to_string()));
                }
            }
        }
        let mut cursor = node.walk();
        stack.extend(node.children(&mut cursor));
    }
    Some((symbols, mentions))
}

fn walk<'a>(
    lang: Lang,
    node: Node<'a>,
    src: &'a [u8],
    path: &str,
    scope: &mut Vec<String>,
    symbols: &mut Vec<Symbol>,
    defs: &mut Vec<Def>,
) {
    let mut pushed = false;
    if let Some(kind) = lang.definition(node.kind()) {
        // Only top-level or container-level variables count as symbols, not locals inside functions.
        let is_local_var = node.kind() == "variable_declarator" && inside_function(node);
        if let Some(name) = (!is_local_var).then(|| def_name(node, src)).flatten() {
            let qualified = if scope.is_empty() { name.to_string() } else { format!("{}.{}", scope.join("."), name) };
            let key = SymbolRef { path: path.to_string(), name: qualified.clone() };
            symbols.push(Symbol { path: path.to_string(), name: qualified, kind, body_hash: hash_text(node, src) });
            defs.push(Def { key, start: node.start_byte(), end: node.end_byte() });
        }
    }
    if let Some(container) = lang.container_name(node, src) {
        scope.push(container.to_string());
        pushed = true;
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        walk(lang, child, src, path, scope, symbols, defs);
    }
    if pushed {
        scope.pop();
    }
}

fn def_name<'a>(node: Node<'a>, src: &'a [u8]) -> Option<&'a str> {
    let name = node.child_by_field_name("name")?;
    // Destructuring patterns (`const { a, b } = …`) have no single name.
    if !Lang::is_identifier(name.kind()) {
        return None;
    }
    name.utf8_text(src).ok()
}

fn inside_function(node: Node) -> bool {
    let mut cur = node.parent();
    while let Some(n) = cur {
        if matches!(
            n.kind(),
            "function_declaration" | "function_expression" | "arrow_function" | "method_definition" | "function" | "generator_function_declaration"
        ) {
            return true;
        }
        cur = n.parent();
    }
    false
}

fn hash_excluding(text: &str, offset: usize, holes: &[(usize, usize)]) -> u64 {
    let mut h = DefaultHasher::new();
    let mut kept = String::with_capacity(text.len());
    for (i, ch) in text.char_indices() {
        let at = offset + i;
        if !holes.iter().any(|&(s, e)| at >= s && at < e) {
            kept.push(ch);
        }
    }
    for token in kept.split_whitespace() {
        token.hash(&mut h);
    }
    h.finish()
}

fn hash_text(node: Node, src: &[u8]) -> u64 {
    let text = node.utf8_text(src).unwrap_or_default();
    let mut h = DefaultHasher::new();
    for token in text.split_whitespace() {
        token.hash(&mut h);
    }
    h.finish()
}

/// Build an index from (path, source) pairs.
pub fn build<'a>(files: impl IntoIterator<Item = (&'a str, &'a str)>) -> Index {
    let mut index = Index::default();
    let mut mentions = Vec::new();
    for (path, src) in files {
        if let Some((symbols, m)) = index_file(path, src) {
            index.symbols.extend(symbols);
            mentions.extend(m);
        }
    }

    // Resolve a mentioned name to symbols whose last segment matches. Ambiguous names
    // (defined in many places, like `get` or `id`) are skipped rather than guessed.
    let mut by_simple: BTreeMap<&str, Vec<SymbolRef>> = BTreeMap::new();
    for s in &index.symbols {
        let simple = s.name.rsplit('.').next().unwrap_or(&s.name);
        by_simple.entry(simple).or_default().push(Index::key(s));
    }
    let mut refs = BTreeSet::new();
    for (from, name) in mentions {
        let Some(targets) = by_simple.get(name.as_str()) else { continue };
        if targets.len() > 3 {
            continue;
        }
        for to in targets {
            if *to != from && !to.name.starts_with(&format!("{}.", from.name)) && !from.name.starts_with(&format!("{}.", to.name)) {
                refs.insert(Reference { from: from.clone(), to: to.clone() });
            }
        }
    }
    index.refs = refs.into_iter().collect();
    index
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(index: &Index) -> Vec<String> {
        index.symbols.iter().map(|s| format!("{}#{}", s.path, s.name)).collect()
    }

    #[test]
    fn indexes_typescript_symbols_and_methods() {
        let src = r#"
            export function parsePrice(s: string) { return Number(s); }
            export class Cart {
                items: number[] = [];
                total() { return this.items.reduce((a, b) => a + b, 0); }
            }
            export const formatTotal = (c: Cart) => `$${c.total()}`;
            function helper() { const local = 1; return local; }
        "#;
        let index = build([("src/cart.ts", src)]);
        let n = names(&index);
        for want in ["src/cart.ts#parsePrice", "src/cart.ts#Cart", "src/cart.ts#Cart.total", "src/cart.ts#formatTotal", "src/cart.ts#helper"] {
            assert!(n.contains(&want.to_string()), "missing {want} in {n:?}");
        }
        assert!(!n.iter().any(|s| s.ends_with("#local")), "locals are not symbols: {n:?}");
    }

    #[test]
    fn resolves_cross_file_references() {
        let cart = "export class Cart { total() { return 1; } }";
        let checkout = "import { Cart } from './cart'; export function checkout(c: Cart) { return c.total(); }";
        let index = build([("src/cart.ts", cart), ("src/checkout.ts", checkout)]);
        let has = |from: &str, to: &str| index.refs.iter().any(|r| r.from.name == from && r.to.name == to);
        assert!(has("checkout", "Cart.total"), "checkout should reference Cart.total: {:?}", index.refs);
        assert!(has("checkout", "Cart"));
    }

    #[test]
    fn indexes_rust_and_python() {
        let rs = "struct Cart; impl Cart { fn total(&self) -> u32 { price() } } fn price() -> u32 { 1 }";
        let py = "class Cart:\n    def total(self):\n        return price()\n\ndef price():\n    return 1\n";
        let index = build([("src/lib.rs", rs), ("app.py", py)]);
        let n = names(&index);
        assert!(n.contains(&"src/lib.rs#Cart.total".to_string()), "{n:?}");
        assert!(n.contains(&"app.py#Cart.total".to_string()), "{n:?}");
        assert!(index.refs.iter().any(|r| r.from.path == "app.py" && r.from.name == "Cart.total" && r.to.name == "price"));
    }

    #[test]
    fn adding_a_method_does_not_change_the_class_hash() {
        let before = build([("cart.ts", "export class Cart { items = 0; total() { return 1; } }")]);
        let after = build([("cart.ts", "export class Cart { items = 0; total() { return 1; } setQuantity(n: number) { this.items = n; } }")]);
        let class = |idx: &Index| idx.symbols.iter().find(|s| s.name == "Cart").unwrap().body_hash;
        assert_eq!(class(&before), class(&after));
        // A new field is a real change to the class itself.
        let field = build([("cart.ts", "export class Cart { items = 0; discount = 0; total() { return 1; } }")]);
        assert_ne!(class(&before), class(&field));
    }

    #[test]
    fn body_hash_ignores_whitespace_but_not_code() {
        let a = build([("a.ts", "function f() { return 1; }")]);
        let b = build([("a.ts", "function f() {\n  return 1;\n}")]);
        let c = build([("a.ts", "function f() { return 2; }")]);
        assert_eq!(a.symbols[0].body_hash, b.symbols[0].body_hash);
        assert_ne!(a.symbols[0].body_hash, c.symbols[0].body_hash);
    }
}
