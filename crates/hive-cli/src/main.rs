//! `hive`: join a Hive swarm from any git checkout.
//!
//!   hive status                         who is working on what
//!   hive goal "Free shipping" -d …      create a goal (optionally --assign or --race models)
//!   hive claim <goal> --name me         fork trunk for yourself and clone it
//!   hive intent --from-diff -m "…"      declare the symbols your working tree changes
//!   hive submit -m "why"                commit with Hive trailers, push, enter the queue
//!   hive show [change]                  evidence, review and decision for a change
//!
//! Configure with HIVE_URL (default http://localhost:5173) and HIVE_REPO or --repo.

use anyhow::{Context, Result, bail};
use clap::{Parser, Subcommand};
use hive_merge::{index_at, referential};
use serde_json::{Value, json};
use std::process::Command as Proc;

#[derive(Parser)]
#[command(name = "hive", version, about = "Join a Hive swarm from any git checkout")]
struct Cli {
    #[arg(long, env = "HIVE_URL", default_value = "http://localhost:5173", global = true)]
    url: String,
    #[arg(long, env = "HIVE_REPO", global = true)]
    repo: Option<String>,
    #[command(subcommand)]
    command: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Show goals, changes in flight, live intents and the convergence queue.
    Status,
    /// Create a goal.
    Goal {
        title: String,
        #[arg(short, long, default_value = "")]
        description: String,
        /// Hand it to a built-in agent (optionally naming the model).
        #[arg(long, num_args = 0..=1, default_missing_value = "")]
        assign: Option<String>,
        /// Race several built-in agents: comma-separated model ids.
        #[arg(long, value_delimiter = ',')]
        race: Vec<String>,
    },
    /// Claim a goal: Hive forks trunk for you and this clones your fork.
    Claim {
        goal: String,
        #[arg(long, env = "HIVE_AGENT")]
        name: String,
    },
    /// Declare what you are changing. With --from-diff, symbols come from your working tree.
    Intent {
        #[arg(short, long)]
        message: String,
        #[arg(long)]
        from_diff: bool,
        /// Extra symbols as path#Name.
        #[arg(long)]
        symbol: Vec<String>,
    },
    /// Commit everything with Hive trailers, push to your fork, and submit.
    Submit {
        #[arg(short, long)]
        message: String,
    },
    /// Evidence, review and decisions for a change (defaults to this checkout's change).
    Show { change: Option<String> },
}

struct Api {
    base: String,
}

impl Api {
    fn get(&self, path: &str) -> Result<Value> {
        let mut res = ureq::get(&format!("{}{}", self.base, path)).call().with_context(|| format!("GET {path}"))?;
        Ok(res.body_mut().read_json()?)
    }
    fn post(&self, path: &str, body: Value) -> Result<Value> {
        let mut res = ureq::post(&format!("{}{}", self.base, path)).send_json(body).with_context(|| format!("POST {path}"))?;
        Ok(res.body_mut().read_json()?)
    }
}

fn git(args: &[&str]) -> Result<String> {
    let out = Proc::new("git").args(args).output().context("running git")?;
    if !out.status.success() {
        bail!("git {}: {}", args.join(" "), String::from_utf8_lossy(&out.stderr).trim());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// The change this checkout belongs to, recorded by `hive claim` in git config.
fn local_change() -> Result<(String, String, String)> {
    let get = |k: &str| git(&["config", "--get", &format!("hive.{k}")]);
    Ok((get("repo").context("not a Hive checkout: run `hive claim` first")?, get("change")?, get("goal")?))
}

fn repo_or_local(cli_repo: &Option<String>) -> Result<String> {
    match cli_repo {
        Some(r) => Ok(r.clone()),
        None => local_change().map(|(r, _, _)| r).context("pass --repo or set HIVE_REPO"),
    }
}

/// Symbols changed between trunk and the working tree, found with hive-merge's tree-sitter index.
/// The working tree is snapshotted with `git stash create`, which makes a commit without touching it.
fn symbols_from_diff() -> Result<Vec<Value>> {
    git(&["fetch", "-q", "trunk", "main"])?;
    let snapshot = git(&["stash", "create"])?;
    let head = if snapshot.is_empty() { "HEAD".to_string() } else { snapshot };
    let base = git(&["merge-base", &head, "trunk/main"])?;
    let changed = referential::changed(&index_at(&base)?, &index_at(&head)?);
    Ok(changed.into_iter().map(|s| json!({ "path": s.path, "name": s.name })).collect())
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let api = Api { base: cli.url.trim_end_matches('/').to_string() };

    match cli.command {
        Cmd::Status => {
            let repo = repo_or_local(&cli.repo)?;
            let s = api.get(&format!("/api/repos/{repo}"))?;
            println!("{repo}");
            for c in s["changes"].as_array().into_iter().flatten().filter(|c| c["status"] != "archived") {
                println!("  {:<14} {:<11} {:<24} {}", c["id"].as_str().unwrap_or(""), c["status"].as_str().unwrap_or(""), c["agentId"].as_str().unwrap_or(""), c["model"].as_str().unwrap_or(""));
            }
            for i in s["intents"].as_array().into_iter().flatten() {
                let symbols: Vec<String> = i["symbols"].as_array().into_iter().flatten().map(|s| format!("{}#{}", s["path"].as_str().unwrap_or(""), s["name"].as_str().unwrap_or(""))).collect();
                println!("  intent {}: {} [{}]", i["changeId"].as_str().unwrap_or(""), i["summary"].as_str().unwrap_or(""), symbols.join(", "));
            }
        }
        Cmd::Goal { title, description, assign, race } => {
            let repo = repo_or_local(&cli.repo)?;
            let goal = api.post(&format!("/api/repos/{repo}/goals"), json!({ "title": title, "description": description }))?;
            let id = goal["id"].as_str().unwrap_or_default();
            println!("goal {id}");
            if !race.is_empty() {
                let r = api.post(&format!("/api/repos/{repo}/goals/{id}/race"), json!({ "models": race }))?;
                println!("race {} with {} agents", r["group"].as_str().unwrap_or(""), race.len());
            } else if let Some(model) = assign {
                let body = if model.is_empty() { json!({}) } else { json!({ "model": model }) };
                let c = api.post(&format!("/api/repos/{repo}/goals/{id}/assign"), body)?;
                println!("assigned {} ({})", c["id"].as_str().unwrap_or(""), c["model"].as_str().unwrap_or(""));
            }
        }
        Cmd::Claim { goal, name } => {
            let repo = cli.repo.clone().context("pass --repo or set HIVE_REPO")?;
            let r = api.post(&format!("/api/repos/{repo}/goals/{goal}/claim"), json!({ "agentName": name }))?;
            let change = r["changeId"].as_str().context("no change id in response")?;
            let clone = r["cloneRemote"].as_str().context("no clone remote")?;
            git(&["clone", "-q", clone, change])?;
            let dir = std::path::Path::new(change);
            let in_dir = |args: &[&str]| -> Result<String> {
                let out = Proc::new("git").current_dir(dir).args(args).output()?;
                if !out.status.success() {
                    bail!("git {}: {}", args.join(" "), String::from_utf8_lossy(&out.stderr));
                }
                Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
            };
            in_dir(&["remote", "add", "trunk", r["trunkRemote"].as_str().unwrap_or_default()])?;
            in_dir(&["config", "hive.repo", &repo])?;
            in_dir(&["config", "hive.change", change])?;
            in_dir(&["config", "hive.goal", &goal])?;
            in_dir(&["config", "hive.agent", &name])?;
            println!("claimed {goal} as {change}; your fork is in ./{change}");
            println!("next: cd {change}, edit, `hive intent --from-diff -m …`, then `hive submit -m …`");
        }
        Cmd::Intent { message, from_diff, symbol } => {
            let (repo, change, _) = local_change()?;
            let mut symbols = if from_diff { symbols_from_diff()? } else { vec![] };
            for s in symbol {
                let (path, name) = s.split_once('#').context("--symbol must be path#Name")?;
                symbols.push(json!({ "path": path, "name": name }));
            }
            let paths: Vec<String> = git(&["diff", "--name-only", "trunk/main"]).unwrap_or_default().lines().map(String::from).collect();
            let r = api.post(&format!("/api/repos/{repo}/changes/{change}/intent"), json!({ "summary": message, "paths": paths, "symbols": symbols }))?;
            println!("declared {} symbol(s)", symbols.len());
            match r["overlaps"].as_array() {
                Some(o) if !o.is_empty() => {
                    for x in o {
                        println!("  {} overlap with {}: {}", x["level"].as_str().unwrap_or(""), x["otherAgentId"].as_str().unwrap_or(""), x["otherSummary"].as_str().unwrap_or(""));
                    }
                    if let Some(a) = r["advice"].as_object() {
                        println!("  advice: {}", a.get("action").and_then(|v| v.as_str()).unwrap_or(""));
                    }
                }
                _ => println!("  no overlaps"),
            }
        }
        Cmd::Submit { message } => {
            let (repo, change, goal) = local_change()?;
            let agent = git(&["config", "--get", "hive.agent"]).unwrap_or_default();
            git(&["add", "-A"])?;
            let msg = format!("{}\n\nHive-Change-Id: {change}\nHive-Goal: {goal}\nHive-Agent: {agent}\nHive-Model: human-or-cli\n", message.trim());
            if git(&["diff", "--cached", "--quiet"]).is_err() {
                git(&["commit", "-q", "-m", &msg])?;
            }
            git(&["push", "-q", "--force", "origin", "HEAD:main"])?;
            let r = api.post(&format!("/api/repos/{repo}/changes/{change}/submit"), json!({}))?;
            println!("{change} is {}", r["status"].as_str().unwrap_or("submitted"));
        }
        Cmd::Show { change } => {
            let (repo, change) = match change {
                Some(c) => (repo_or_local(&cli.repo)?, c),
                None => {
                    let (r, c, _) = local_change()?;
                    (r, c)
                }
            };
            let d = api.get(&format!("/api/repos/{repo}/changes/{change}"))?;
            println!("{change}: {}", d["change"]["status"].as_str().unwrap_or(""));
            for e in d["evidence"].as_array().into_iter().flatten() {
                println!("  {} {}", if e["ok"].as_bool() == Some(true) { "pass" } else { "FAIL" }, e["command"].as_str().unwrap_or(""));
            }
            if let Some(v) = d["evaluations"].as_array().and_then(|a| a.last()) {
                println!("  review {:.2}: {}", v["score"].as_f64().unwrap_or(0.0), v["summary"].as_str().unwrap_or(""));
            }
            if let Some(dec) = d["decisions"].as_array().and_then(|a| a.last()) {
                println!("  decision: {} ({:.0}%) by {}", dec["outcome"].as_str().unwrap_or(""), dec["confidence"].as_f64().unwrap_or(0.0) * 100.0, dec["decidedBy"].as_str().unwrap_or(""));
                println!("  {}", dec["rationale"].as_str().unwrap_or(""));
            }
        }
    }
    Ok(())
}
