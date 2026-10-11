//! Referential conflicts (vai's third level): two changes that merge cleanly line-by-line and
//! structurally, but where one modifies a symbol the other's modified code calls.

use crate::index::{Index, SymbolRef};
use serde::Serialize;
use std::collections::BTreeSet;

#[derive(Debug, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub struct Conflict {
    /// Symbol this change modified.
    pub changed: String,
    /// Symbol on the other side that is coupled to it.
    pub affected: String,
    pub direction: Direction,
}

#[derive(Debug, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "kebab-case")]
pub enum Direction {
    /// Trunk modified code that calls something this change modified.
    TrunkUsesChange,
    /// This change modified code that calls something trunk modified.
    ChangeUsesTrunk,
}

/// Symbols added or modified between `base` and `side`.
pub fn changed(base: &Index, side: &Index) -> BTreeSet<SymbolRef> {
    let before = base.hashes();
    side.hashes()
        .into_iter()
        .filter(|(k, h)| before.get(k) != Some(h))
        .map(|(k, _)| k)
        .collect()
}

pub fn detect(base: &Index, trunk: &Index, change: &Index) -> Vec<Conflict> {
    let on_trunk = changed(base, trunk);
    let on_change = changed(base, change);
    let trunk_refs = trunk.ref_set();
    let change_refs = change.ref_set();
    let label = |s: &SymbolRef| format!("{}#{}", s.path, s.name);

    let mut out = BTreeSet::new();
    for x in &on_change {
        for y in &on_trunk {
            // Same symbol on both sides is a structural conflict; mergiraf owns that case.
            if x == y {
                continue;
            }
            if trunk_refs.contains(&(y.clone(), x.clone())) {
                out.insert(Conflict { changed: label(x), affected: label(y), direction: Direction::TrunkUsesChange });
            }
            if change_refs.contains(&(x.clone(), y.clone())) {
                out.insert(Conflict { changed: label(x), affected: label(y), direction: Direction::ChangeUsesTrunk });
            }
        }
    }
    out.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::index::build;

    const CART: &str = "export function price(n: number) { return n * 100; }";
    const CHECKOUT: &str = "export function checkout(n: number) { return price(n); }";

    #[test]
    fn flags_trunk_caller_of_changed_symbol() {
        let base = build([("cart.ts", CART), ("checkout.ts", CHECKOUT)]);
        // This change alters price's contract (cents → dollars)…
        let change = build([("cart.ts", "export function price(n: number) { return n; }"), ("checkout.ts", CHECKOUT)]);
        // …while trunk, concurrently, edited checkout which calls price.
        let trunk = build([("cart.ts", CART), ("checkout.ts", "export function checkout(n: number) { return price(n) + 5; }")]);
        let conflicts = detect(&base, &trunk, &change);
        assert_eq!(
            conflicts,
            vec![Conflict { changed: "cart.ts#price".into(), affected: "checkout.ts#checkout".into(), direction: Direction::TrunkUsesChange }]
        );
    }

    #[test]
    fn adding_a_method_to_a_class_is_not_a_conflict_for_its_callers() {
        let cart = "export class Cart { total() { return 1; } }";
        let checkout = "export function checkout(c: Cart) { return c.total(); }";
        let base = build([("cart.ts", cart), ("checkout.ts", checkout)]);
        let trunk = build([("cart.ts", "export class Cart { total() { return 1; } setQuantity() {} }"), ("checkout.ts", checkout)]);
        let change = build([("cart.ts", cart), ("checkout.ts", "export function checkout(c: Cart) { return c.total() + 5; }")]);
        assert!(detect(&base, &trunk, &change).is_empty(), "{:?}", detect(&base, &trunk, &change));
    }

    #[test]
    fn independent_changes_do_not_conflict() {
        let base = build([("a.ts", "export function a() { return 1; }"), ("b.ts", "export function b() { return 2; }")]);
        let trunk = build([("a.ts", "export function a() { return 10; }"), ("b.ts", "export function b() { return 2; }")]);
        let change = build([("a.ts", "export function a() { return 1; }"), ("b.ts", "export function b() { return 20; }")]);
        assert!(detect(&base, &trunk, &change).is_empty());
    }
}
