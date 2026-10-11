//! hive-merge: the semantic half of Hive's merge pipeline.
//!
//!   hive-merge index [--rev REV]                            symbol/reference graph as JSON
//!   hive-merge referential --base B --trunk T --change C    referential conflicts as JSON
//!
//! Runs inside a git checkout; reads files at a revision with `git cat-file --batch`.

use anyhow::Result;
use clap::{Parser, Subcommand};
use hive_merge::{index_at, referential};

#[derive(Parser)]
#[command(version, about)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Print the semantic index of a revision.
    Index {
        #[arg(long, default_value = "HEAD")]
        rev: String,
    },
    /// Print referential conflicts between a change and trunk since their common base.
    Referential {
        #[arg(long)]
        base: String,
        #[arg(long)]
        trunk: String,
        #[arg(long)]
        change: String,
        /// Accepted for symmetry with other tools; output is always JSON.
        #[arg(long)]
        json: bool,
    },
}

fn main() -> Result<()> {
    match Cli::parse().command {
        Command::Index { rev } => {
            println!("{}", serde_json::to_string(&index_at(&rev)?)?);
        }
        Command::Referential { base, trunk, change, .. } => {
            let conflicts = referential::detect(&index_at(&base)?, &index_at(&trunk)?, &index_at(&change)?);
            println!("{}", serde_json::to_string(&conflicts)?);
        }
    }
    Ok(())
}
