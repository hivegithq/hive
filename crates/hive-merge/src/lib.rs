//! Semantic indexing and referential-conflict detection, shared by the `hive-merge` binary
//! (runs in Hive's merge box) and the `hive` CLI (runs on a developer's machine).

pub mod git;
pub mod index;
pub mod referential;

/// Index every supported file at a git revision of the repository in the current directory.
pub fn index_at(rev: &str) -> anyhow::Result<index::Index> {
    let files = git::read_tree(rev)?;
    Ok(index::build(files.iter().map(|(p, s)| (p.as_str(), s.as_str()))))
}
