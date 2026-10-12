//! `hive`: run a Hive from the terminal, or join its swarm from any git checkout.
//!
//!   hive login --url https://hivegit.dev --repo shop < .hive-token    save where and who you are
//!   hive status                          goals, changes in flight, intents, the queue
//!   hive watch                           follow changes and goals as they move
//!   hive import https://github.com/o/r   bring a repository in (then: hive checks)
//!   hive goal "Free shipping" -d …       create a goal and put agents on it:
//!        --assign [model]                  one built-in agent
//!        --race kimi,deepseek              a race between models
//!        --plan --models kimi,deepseek     a planner splits it; sub-goals take the models in turn
//!   hive land <change> / hive send-back <change> -m why    decide a change that needs you
//!   hive checks / hive settings           what Hive runs here, and how it lands
//!   hive cost / hive budget <goal> 5      what the work cost; cap a goal's spend
//!   hive issues import [owner/repo]       open GitHub issues as goals (--assign kimi --budget 1)
//!   hive claim <goal> / intent / submit   do the work yourself, in your own fork
//!
//! Where and who: flags, then HIVE_URL / HIVE_REPO / HIVE_TOKEN, then `hive login`'s config file.

use anyhow::{Context, Result, bail};
use clap::{Parser, Subcommand};
use hive_merge::{index_at, referential};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::io::{IsTerminal, Read};
use std::path::PathBuf;
use std::process::Command as Proc;
use std::time::Duration;

#[derive(Parser)]
#[command(name = "hive", version, about = "Run a Hive from the terminal, or join its swarm from any git checkout")]
struct Cli {
    /// Hive's address, e.g. https://hivegit.dev (default: from `hive login`, else http://localhost:5173).
    #[arg(long, env = "HIVE_URL", global = true)]
    url: Option<String>,
    #[arg(long, env = "HIVE_REPO", global = true)]
    repo: Option<String>,
    /// The deployment's access token (needed for anything that changes something).
    #[arg(long, env = "HIVE_TOKEN", global = true, hide_env_values = true)]
    token: Option<String>,
    #[command(subcommand)]
    command: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Save the Hive URL, access token and default repo (token from --token or stdin).
    Login,
    /// Show goals, changes in flight, live intents and the convergence queue.
    Status,
    /// Follow a repo: print every change and goal as its status moves. Ctrl-C to stop.
    Watch {
        /// Seconds between looks.
        #[arg(long, default_value_t = 3)]
        every: u64,
    },
    /// Models you can name, with their short names; --stats for how each did on this repo.
    Models {
        #[arg(long)]
        stats: bool,
    },
    /// Create an empty repo (trunk and ledger) and make it the default.
    Init { name: String },
    /// Import a repository from GitHub or any https git server.
    Import {
        url: String,
        /// Name in Hive (default: taken from the URL).
        #[arg(long)]
        name: Option<String>,
        #[arg(long)]
        branch: Option<String>,
        /// Read token for a private repository; used for this clone only.
        #[arg(long)]
        source_token: Option<String>,
    },
    /// GitHub issues as goals.
    Issues {
        #[command(subcommand)]
        action: IssuesCmd,
    },
    /// Create a goal, and optionally put agents on it.
    Goal {
        title: String,
        #[arg(short, long, default_value = "")]
        description: String,
        /// Hand it to one built-in agent (optionally naming the model).
        #[arg(long, num_args = 0..=1, default_missing_value = "")]
        assign: Option<String>,
        /// Race models on it: comma-separated, e.g. kimi,deepseek,gpt-oss.
        #[arg(long, value_delimiter = ',')]
        race: Vec<String>,
        /// Plan it first: a planner splits it into sub-goals for many agents.
        #[arg(long)]
        plan: bool,
        /// With --plan: the agents' models, used in turn.
        #[arg(long, value_delimiter = ',')]
        models: Vec<String>,
        /// With --plan: the planner model (default GLM 5.3).
        #[arg(long)]
        planner: Option<String>,
        /// With --plan: agents at once.
        #[arg(long)]
        parallel: Option<u32>,
        /// Stop its agents once the goal (with its sub-goals) has spent this many USD.
        #[arg(long)]
        budget: Option<f64>,
    },
    /// What the work cost: by model, by purpose, by goal (or one change with --change).
    Cost {
        #[arg(long)]
        change: Option<String>,
    },
    /// Set or clear a goal's budget in USD (`none` clears it).
    Budget { goal: String, usd: String },
    /// Start one built-in agent on an existing goal.
    Assign {
        goal: String,
        #[arg(long)]
        model: Option<String>,
    },
    /// Race models on an existing goal.
    Race {
        goal: String,
        #[arg(long, value_delimiter = ',', required = true)]
        models: Vec<String>,
    },
    /// Plan an existing goal into sub-goals for many agents.
    Plan {
        goal: String,
        #[arg(long, value_delimiter = ',')]
        models: Vec<String>,
        #[arg(long)]
        planner: Option<String>,
        #[arg(long)]
        parallel: Option<u32>,
    },
    /// Land a change that needs a person (its checks still run first).
    Land {
        change: String,
        #[arg(short, long)]
        message: Option<String>,
    },
    /// Send a change back to its agent with a note.
    SendBack {
        change: String,
        #[arg(short, long)]
        message: String,
    },
    /// Pick a race's winner instead of waiting for Clef.
    Winner { change: String },
    /// Restart a built-in agent on its change.
    Restart { change: String },
    /// Archive a change and release its intent.
    Abandon { change: String },
    /// Run the repo's checks on trunk (or --plan: only show what would run).
    Checks {
        #[arg(long)]
        plan: bool,
    },
    /// Show or change how this repo lands changes.
    Settings {
        /// Scan every batch for new secrets, vulnerable dependencies and risky code: on|off.
        #[arg(long)]
        security: Option<String>,
        /// Who lands changes: clef (checks plus a model review) or evidence (checks alone).
        #[arg(long)]
        decider: Option<String>,
        /// Changes per batch, 1-256.
        #[arg(long)]
        batch: Option<u32>,
        /// Default budget per goal in USD (`none` for no limit).
        #[arg(long)]
        budget: Option<String>,
    },
    /// Clone trunk (or --ledger) with ordinary git, using a one-hour URL.
    Clone {
        #[arg(long)]
        ledger: bool,
        #[arg(long)]
        write: bool,
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

#[derive(Subcommand)]
enum IssuesCmd {
    /// One goal per open issue (skips ones already imported). Source defaults to where the repo was imported from.
    Import {
        /// owner/repo or a GitHub URL.
        source: Option<String>,
        /// Only issues with all of these labels.
        #[arg(long, value_delimiter = ',')]
        label: Vec<String>,
        /// Skip issues with any of these labels (e.g. upstream,wontfix).
        #[arg(long, value_delimiter = ',')]
        exclude_label: Vec<String>,
        #[arg(long, default_value_t = 50)]
        limit: u32,
        /// GitHub token for private repositories or rate limits; used once, not stored.
        #[arg(long, env = "GITHUB_TOKEN", hide_env_values = true)]
        github_token: Option<String>,
        /// Start a built-in agent on each new goal (optionally naming the model).
        #[arg(long, num_args = 0..=1, default_missing_value = "")]
        assign: Option<String>,
        /// With --assign: a USD budget for each goal.
        #[arg(long)]
        budget: Option<f64>,
    },
}

// Workers AI models agents can use, with the short names the CLI accepts.
const MODELS: &[(&str, &str)] = &[
    ("kimi", "@cf/moonshotai/kimi-k2.7-code"),
    ("glm", "@cf/zai-org/glm-5.3"),
    ("deepseek", "@cf/deepseek-ai/deepseek-v4-pro-0813"),
    ("gpt-oss", "@cf/openai/gpt-oss-120b"),
    ("qwen", "@cf/qwen/qwen3.8-27b"),
    ("nemotron", "@cf/nvidia/nemotron-3-120b-a12b"),
];

fn model_id(name: &str) -> String {
    MODELS.iter().find(|(short, _)| *short == name).map(|(_, id)| id.to_string()).unwrap_or_else(|| name.to_string())
}
fn model_ids(names: &[String]) -> Vec<String> {
    names.iter().map(|n| model_id(n.trim())).collect()
}

// ── Config: what `hive login` saves ─────────────────────────────────────────

fn config_path() -> PathBuf {
    let base = std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".config"));
    base.join("hive").join("config.json")
}

fn read_config() -> Value {
    std::fs::read_to_string(config_path()).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_else(|| json!({}))
}

fn write_config(config: &Value) -> Result<()> {
    let path = config_path();
    std::fs::create_dir_all(path.parent().unwrap())?;
    std::fs::write(&path, serde_json::to_string_pretty(config)? + "\n")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

struct Api {
    agent: ureq::Agent,
    base: String,
    token: Option<String>,
}

impl Api {
    fn new(base: String, token: Option<String>) -> Self {
        let agent = ureq::Agent::config_builder().http_status_as_error(false).timeout_global(Some(Duration::from_secs(600))).build().into();
        Api { agent, base, token }
    }
    fn finish(path: &str, mut res: ureq::http::Response<ureq::Body>) -> Result<Value> {
        let status = res.status().as_u16();
        let text = res.body_mut().read_to_string().unwrap_or_default();
        let body: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
        if status >= 400 {
            let reason = body["error"].as_str().map(String::from).unwrap_or_else(|| text.chars().take(300).collect());
            if status == 401 {
                bail!("{reason}\nSet the access token with `hive login` (or HIVE_TOKEN).");
            }
            bail!("{path}: {status} {reason}");
        }
        Ok(body)
    }
    fn get(&self, path: &str) -> Result<Value> {
        let res = self.agent.get(&format!("{}{}", self.base, path)).call().with_context(|| format!("couldn't reach {}", self.base))?;
        Self::finish(path, res)
    }
    fn post(&self, path: &str, body: Value) -> Result<Value> {
        let mut req = self.agent.post(&format!("{}{}", self.base, path));
        if let Some(t) = &self.token {
            req = req.header("authorization", &format!("Bearer {t}"));
        }
        let res = req.send_json(body).with_context(|| format!("couldn't reach {}", self.base))?;
        Self::finish(path, res)
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

fn s(v: &Value) -> &str {
    v.as_str().unwrap_or("")
}

fn plan_body(models: &[String], planner: &Option<String>, parallel: Option<u32>) -> Value {
    let mut body = json!({});
    if !models.is_empty() {
        body["agentModels"] = json!(model_ids(models));
    }
    if let Some(p) = planner {
        body["model"] = json!(model_id(p));
    }
    if let Some(n) = parallel {
        body["maxParallel"] = json!(n);
    }
    body
}

fn print_plan(r: &Value) {
    let models: Vec<&str> = r["agentModels"].as_array().into_iter().flatten().map(s).collect();
    println!("planning with {}; agents: {} ({} at once)", s(&r["model"]), models.join(", "), r["maxParallel"]);
    println!("follow it with `hive watch`");
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let config = read_config();
    let url = cli.url.clone().or_else(|| config["url"].as_str().map(String::from)).unwrap_or_else(|| "http://localhost:5173".into());
    let token = cli.token.clone().or_else(|| config["token"].as_str().map(String::from));
    let default_repo = cli.repo.clone().or_else(|| config["repo"].as_str().map(String::from));
    let api = Api::new(url.trim_end_matches('/').to_string(), token.clone());
    // A repo is needed: a flag, HIVE_REPO, this checkout's (from `hive claim`), or the login default.
    let repo = || -> Result<String> {
        if let Some(r) = &cli.repo {
            return Ok(r.clone());
        }
        if let Ok((r, _, _)) = local_change() {
            return Ok(r);
        }
        default_repo.clone().context("which repo? pass --repo, set HIVE_REPO, or `hive login --repo <name>`")
    };

    match cli.command {
        Cmd::Login => {
            let mut token = cli.token.clone();
            if token.is_none() && !std::io::stdin().is_terminal() {
                let mut buf = String::new();
                std::io::stdin().read_to_string(&mut buf)?;
                token = Some(buf.trim().to_string()).filter(|t| !t.is_empty());
            }
            let mut next = config.clone();
            next["url"] = json!(url);
            if let Some(t) = &token {
                next["token"] = json!(t);
            }
            if let Some(r) = &cli.repo {
                next["repo"] = json!(r);
            }
            // Check the token really works: a write the server rejects without one, made harmless.
            if let Some(t) = next["token"].as_str() {
                let check = Api::new(url.trim_end_matches('/').to_string(), Some(t.to_string()));
                match check.post("/api/repos/import", json!({})) {
                    Err(e) if e.to_string().contains("access token") => bail!("{url} didn't accept that token"),
                    _ => {}
                }
            }
            write_config(&next)?;
            println!("saved to {}", config_path().display());
            println!("  url   {}", s(&next["url"]));
            println!("  token {}", if next["token"].is_string() { "set (checked)" } else { "not set: reads only" });
            println!("  repo  {}", next["repo"].as_str().unwrap_or("not set (pass --repo once to save one)"));
        }
        Cmd::Status => {
            let repo = repo()?;
            let snap = api.get(&format!("/api/repos/{repo}"))?;
            println!("{repo} at {url}");
            let goals: Vec<&Value> = snap["goals"].as_array().into_iter().flatten().filter(|g| g["parentId"].is_null()).collect();
            if !goals.is_empty() {
                println!("goals");
                for g in goals.iter().rev().take(15) {
                    let subs = snap["goals"].as_array().into_iter().flatten().filter(|c| c["parentId"] == g["id"]).count();
                    let extra = if subs > 0 { format!("  ({subs} sub-goals)") } else { String::new() };
                    println!("  {:<14} {:<12} {}{extra}", s(&g["id"]), s(&g["status"]), s(&g["title"]));
                }
            }
            let live: Vec<&Value> = snap["changes"].as_array().into_iter().flatten().filter(|c| !["archived", "landed"].contains(&s(&c["status"]))).collect();
            let landed = snap["changes"].as_array().into_iter().flatten().filter(|c| c["status"] == "landed").count();
            println!("changes  {} in flight, {landed} landed", live.len());
            for c in live.iter().take(40) {
                println!("  {:<14} {:<11} {:<24} {}", s(&c["id"]), s(&c["status"]), s(&c["agentId"]), s(&c["model"]));
            }
            for i in snap["intents"].as_array().into_iter().flatten().take(20) {
                let symbols: Vec<String> = i["symbols"].as_array().into_iter().flatten().map(|x| format!("{}#{}", s(&x["path"]), s(&x["name"]))).collect();
                println!("  intent {}: {} [{}]", s(&i["changeId"]), s(&i["summary"]), symbols.join(", "));
            }
        }
        Cmd::Watch { every } => {
            let repo = repo()?;
            println!("watching {repo} at {url} (Ctrl-C to stop)");
            let mut seen: HashMap<String, String> = HashMap::new();
            let mut first = true;
            loop {
                match api.get(&format!("/api/repos/{repo}")) {
                    Ok(snap) => {
                        let time = chrono_now();
                        for g in snap["goals"].as_array().into_iter().flatten() {
                            let key = format!("goal {}", s(&g["id"]));
                            if seen.get(&key).map(String::as_str) != Some(s(&g["status"])) {
                                if !first {
                                    println!("{time}  goal   {:<14} {:<12} {}", s(&g["id"]), s(&g["status"]), s(&g["title"]));
                                }
                                seen.insert(key, s(&g["status"]).to_string());
                            }
                        }
                        for c in snap["changes"].as_array().into_iter().flatten() {
                            let key = format!("change {}", s(&c["id"]));
                            if seen.get(&key).map(String::as_str) != Some(s(&c["status"])) {
                                if !first {
                                    println!("{time}  change {:<14} {:<12} {} ({})", s(&c["id"]), s(&c["status"]), s(&c["agentId"]), s(&c["model"]));
                                }
                                seen.insert(key, s(&c["status"]).to_string());
                            }
                        }
                        if first {
                            let n = snap["changes"].as_array().map_or(0, |a| a.len());
                            println!("{time}  {n} changes so far; printing what moves from here");
                            first = false;
                        }
                    }
                    Err(e) => eprintln!("{e}"),
                }
                std::thread::sleep(Duration::from_secs(every.max(1)));
            }
        }
        Cmd::Models { stats: true } => {
            let repo = repo()?;
            let list = api.get(&format!("/api/repos/{repo}/models"))?;
            println!("{repo}: how each model did");
            println!("  {:<40} {:>7} {:>7} {:>6} {:>7} {:>9} {:>10} {:>10}", "model", "started", "landed", "rate", "sent bk", "escalated", "median", "$/landed");
            for m in list.as_array().into_iter().flatten() {
                let median = m["medianMinutesToLand"].as_f64().map(|v| format!("{v:.0} min")).unwrap_or_else(|| "-".into());
                let per = m["costPerLanded"].as_f64().map(money).unwrap_or_else(|| "-".into());
                println!(
                    "  {:<40} {:>7} {:>7} {:>5.0}% {:>7} {:>9} {:>10} {:>10}",
                    s(&m["model"]),
                    m["started"].as_u64().unwrap_or(0),
                    m["landed"].as_u64().unwrap_or(0),
                    m["landingRate"].as_f64().unwrap_or(0.0) * 100.0,
                    m["bounces"].as_u64().unwrap_or(0),
                    m["escalations"].as_u64().unwrap_or(0),
                    median,
                    per
                );
            }
        }
        Cmd::Models { stats: false } => {
            for (short, id) in MODELS {
                println!("  {short:<10} {id}");
            }
            println!("Any Workers AI model id works too.");
        }
        Cmd::Init { name } => {
            api.post("/api/repos", json!({ "name": name }))?;
            let mut next = config.clone();
            next["repo"] = json!(name);
            write_config(&next)?;
            println!("created {name} (now the default repo). Push code to it: `hive clone --write`, or use `hive import`.");
        }
        Cmd::Import { url: source, name, branch, source_token } => {
            println!("importing {source} (full history; large repositories take a while)");
            let r = api.post("/api/repos/import", json!({ "url": source, "name": name, "branch": branch, "token": source_token }))?;
            let name = s(&r["name"]).to_string();
            let mut next = config.clone();
            next["repo"] = json!(name);
            write_config(&next)?;
            println!("imported as {name}: {} commits, {} files, trunk at {}", r["commits"], r["files"], &s(&r["head"]).chars().take(8).collect::<String>());
            println!("now the default repo. Next: `hive checks` to see Hive can build and test it.");
        }
        Cmd::Goal { title, description, assign, race, plan, models, planner, parallel, budget } => {
            let repo = repo()?;
            let mut body = json!({ "title": title, "description": description });
            if let Some(b) = budget {
                body["budget"] = json!(b);
            }
            let goal = api.post(&format!("/api/repos/{repo}/goals"), body)?;
            let id = s(&goal["id"]).to_string();
            println!("goal {id}");
            if plan {
                let r = api.post(&format!("/api/repos/{repo}/goals/{id}/plan"), plan_body(&models, &planner, parallel))?;
                print_plan(&r);
            } else if !race.is_empty() {
                let r = api.post(&format!("/api/repos/{repo}/goals/{id}/race"), json!({ "models": model_ids(&race) }))?;
                println!("race {} with {} models", s(&r["group"]), race.len());
            } else if let Some(model) = assign {
                let body = if model.is_empty() { json!({}) } else { json!({ "model": model_id(&model) }) };
                let c = api.post(&format!("/api/repos/{repo}/goals/{id}/assign"), body)?;
                println!("agent started on {} ({})", s(&c["id"]), s(&c["model"]));
            } else {
                println!("no agents yet: `hive assign {id}`, `hive race {id} --models …`, `hive plan {id}`, or `hive claim {id}` to do it yourself");
            }
        }
        Cmd::Issues { action: IssuesCmd::Import { source, label, exclude_label, limit, github_token, assign, budget } } => {
            let repo = repo()?;
            let r = api.post(
                &format!("/api/repos/{repo}/issues/import"),
                json!({ "source": source, "labels": if label.is_empty() { Value::Null } else { json!(label) }, "excludeLabels": exclude_label, "limit": limit, "token": github_token }),
            )?;
            let created = r["created"].as_array().cloned().unwrap_or_default();
            println!("{}: {} open, {} already imported, {} new goal(s)", s(&r["source"]), r["open"], r["alreadyImported"], created.len());
            for g in &created {
                let id = s(&g["goalId"]);
                print!("  {id:<14} {:<22} {}", s(&g["ref"]), s(&g["title"]));
                if let Some(model) = &assign {
                    if let Some(b) = budget {
                        api.post(&format!("/api/repos/{repo}/goals/{id}/budget"), json!({ "budget": b }))?;
                    }
                    let body = if model.is_empty() { json!({}) } else { json!({ "model": model_id(model) }) };
                    match api.post(&format!("/api/repos/{repo}/goals/{id}/assign"), body) {
                        Ok(c) => print!("  → {}", s(&c["id"])),
                        Err(e) => print!("  (agent didn't start: {e})"),
                    }
                }
                println!();
            }
        }
        Cmd::Cost { change } => {
            let repo = repo()?;
            if let Some(change) = change {
                let d = api.get(&format!("/api/repos/{repo}/changes/{change}"))?;
                println!("{change}: {}", money(d["cost"]["total"].as_f64().unwrap_or(0.0)));
                for p in d["cost"]["parts"].as_array().into_iter().flatten() {
                    let what = if p["seconds"].as_f64().unwrap_or(0.0) > 0.0 {
                        format!("{:.0} min", p["seconds"].as_f64().unwrap_or(0.0) / 60.0)
                    } else {
                        format!("{} in, {} out", p["inputTokens"], p["outputTokens"])
                    };
                    println!("  {:<10} {:<42} {:<22} {}", s(&p["purpose"]), s(&p["model"]), what, money(p["cost"].as_f64().unwrap_or(0.0)));
                }
                return Ok(());
            }
            let c = api.get(&format!("/api/repos/{repo}/costs"))?;
            println!("{repo}: {} spent{}", money(c["total"].as_f64().unwrap_or(0.0)), c["goalBudget"].as_f64().map(|b| format!(" (default budget {} per goal)", money(b))).unwrap_or_default());
            println!("by model");
            for m in c["byModel"].as_array().into_iter().flatten() {
                println!("  {:<44} {:>8} calls  {}", s(&m["model"]), m["calls"], money(m["cost"].as_f64().unwrap_or(0.0)));
            }
            println!("by purpose");
            for (k, v) in c["byPurpose"].as_object().into_iter().flatten() {
                println!("  {k:<12} {}", money(v.as_f64().unwrap_or(0.0)));
            }
            let snap = api.get(&format!("/api/repos/{repo}"))?;
            let titles: HashMap<String, String> = snap["goals"].as_array().into_iter().flatten().map(|g| (s(&g["id"]).to_string(), s(&g["title"]).to_string())).collect();
            let mut goals: Vec<(&String, &Value)> = c["byGoal"].as_object().into_iter().flatten().collect();
            goals.sort_by(|a, b| b.1["cost"].as_f64().partial_cmp(&a.1["cost"].as_f64()).unwrap_or(std::cmp::Ordering::Equal));
            if !goals.is_empty() {
                println!("by goal (with sub-goals)");
            }
            for (id, g) in goals.iter().take(20) {
                let budget = g["budget"].as_f64().map(|b| format!(" of {}", money(b))).unwrap_or_default();
                println!("  {id:<14} {:>8}{budget}  {}", money(g["cost"].as_f64().unwrap_or(0.0)), titles.get(*id).map(String::as_str).unwrap_or(""));
            }
        }
        Cmd::Budget { goal, usd } => {
            let repo = repo()?;
            let budget = if usd == "none" { Value::Null } else { json!(usd.trim_start_matches('$').parse::<f64>().context("budget must be a number of USD, or `none`")?) };
            let r = api.post(&format!("/api/repos/{repo}/goals/{goal}/budget"), json!({ "budget": budget }))?;
            println!("{goal}: budget {}, spent {}", r["budget"].as_f64().map(money).unwrap_or_else(|| "none".into()), money(r["spent"].as_f64().unwrap_or(0.0)));
        }
        Cmd::Assign { goal, model } => {
            let repo = repo()?;
            let body = model.map(|m| json!({ "model": model_id(&m) })).unwrap_or_else(|| json!({}));
            let c = api.post(&format!("/api/repos/{repo}/goals/{goal}/assign"), body)?;
            println!("agent started on {} ({})", s(&c["id"]), s(&c["model"]));
        }
        Cmd::Race { goal, models } => {
            let repo = repo()?;
            let r = api.post(&format!("/api/repos/{repo}/goals/{goal}/race"), json!({ "models": model_ids(&models) }))?;
            println!("race {} with {} models", s(&r["group"]), models.len());
        }
        Cmd::Plan { goal, models, planner, parallel } => {
            let repo = repo()?;
            let r = api.post(&format!("/api/repos/{repo}/goals/{goal}/plan"), plan_body(&models, &planner, parallel))?;
            print_plan(&r);
        }
        Cmd::Land { change, message } => {
            let repo = repo()?;
            api.post(&format!("/api/repos/{repo}/changes/{change}/decision"), json!({ "outcome": "land", "by": "human:cli", "note": message }))?;
            println!("{change}: landing (its checks run first)");
        }
        Cmd::SendBack { change, message } => {
            let repo = repo()?;
            api.post(&format!("/api/repos/{repo}/changes/{change}/decision"), json!({ "outcome": "bounce", "by": "human:cli", "note": message }))?;
            println!("{change}: sent back");
        }
        Cmd::Winner { change } => {
            let repo = repo()?;
            let d = api.get(&format!("/api/repos/{repo}/changes/{change}"))?;
            let group = d["change"]["race"]["group"].as_str().context("that change isn't in a race")?;
            api.post(&format!("/api/repos/{repo}/races/{group}/winner"), json!({ "changeId": change, "by": "human:cli" }))?;
            println!("{change} wins race {group}");
        }
        Cmd::Restart { change } => {
            let repo = repo()?;
            api.post(&format!("/api/repos/{repo}/changes/{change}/restart"), json!({}))?;
            println!("{change}: agent restarted");
        }
        Cmd::Abandon { change } => {
            let repo = repo()?;
            api.post(&format!("/api/repos/{repo}/changes/{change}/abandon"), json!({ "by": "human:cli" }))?;
            println!("{change}: archived, intent released");
        }
        Cmd::Checks { plan } => {
            let repo = repo()?;
            let p = if plan { api.get(&format!("/api/repos/{repo}/checks/plan"))? } else { Value::Null };
            let (p, runs) = if plan {
                (p, None)
            } else {
                println!("running {repo}'s checks on trunk in a merge box (a minute or two)");
                let r = api.post(&format!("/api/repos/{repo}/checks"), json!({}))?;
                println!("at {} in {}s", &s(&r["commit"]).chars().take(8).collect::<String>(), r["ms"].as_f64().unwrap_or(0.0) as u64 / 1000);
                (r["plan"].clone(), r["runs"].as_array().cloned())
            };
            let langs: Vec<&str> = p["languages"].as_array().into_iter().flatten().map(s).collect();
            println!("from {} ({}){}", s(&p["source"]), langs.join(", "), if p["security"] == true { ", security scan on" } else { "" });
            for x in p["setup"].as_array().into_iter().flatten() {
                println!("  setup     {}", s(&x["command"]));
            }
            match runs {
                Some(runs) => {
                    for r in &runs {
                        println!("  {} {:<9} {}", if r["ok"] == true { "pass" } else { "FAIL" }, s(&r["kind"]), s(&r["command"]));
                        if r["ok"] != true {
                            let out = s(&r["output"]);
                            for line in out.lines().rev().take(12).collect::<Vec<_>>().into_iter().rev() {
                                println!("       {line}");
                            }
                        }
                    }
                    if runs.iter().any(|r| r["ok"] != true) {
                        std::process::exit(1);
                    }
                }
                None => {
                    for x in p["checks"].as_array().into_iter().flatten() {
                        println!("  {:<9} {}", s(&x["kind"]), s(&x["command"]));
                    }
                }
            }
            for problem in p["problems"].as_array().into_iter().flatten() {
                println!("  problem: {}", s(problem));
            }
        }
        Cmd::Settings { security, decider, batch, budget } => {
            let repo = repo()?;
            let mut patch = json!({});
            if let Some(v) = security {
                patch["security"] = json!(matches!(v.as_str(), "on" | "true" | "yes" | "1"));
            }
            if let Some(v) = decider {
                patch["decider"] = json!(v);
            }
            if let Some(v) = batch {
                patch["batchMax"] = json!(v);
            }
            if let Some(v) = budget {
                patch["goalBudget"] = if v == "none" { Value::Null } else { json!(v.trim_start_matches('$').parse::<f64>().context("budget must be a number of USD, or `none`")?) };
            }
            let st = if patch.as_object().is_some_and(|o| o.is_empty()) {
                api.get(&format!("/api/repos/{repo}/settings"))?
            } else {
                api.post(&format!("/api/repos/{repo}/settings"), patch)?
            };
            println!("{repo}");
            println!("  security  {}", if st["security"] == true { "on" } else { "off" });
            println!("  decider   {}", s(&st["decider"]));
            println!("  batch     {}", st["batchMax"]);
            println!("  budget    {}", st["goalBudget"].as_f64().map(|b| format!("{} per goal", money(b))).unwrap_or_else(|| "no limit".into()));
        }
        Cmd::Clone { ledger, write } => {
            let repo = repo()?;
            let name = if ledger { format!("{repo}.hive") } else { repo.clone() };
            let r = api.post(&format!("/api/repos/{repo}/clone"), json!({ "target": name, "scope": if write { "write" } else { "read" } }))?;
            let command = s(&r["command"]).to_string();
            let args: Vec<&str> = command.split_whitespace().skip(1).collect();
            let status = Proc::new("git").args(&args).status().context("running git")?;
            if !status.success() {
                bail!("git clone failed");
            }
            println!("cloned into ./{name} (the URL works for an hour)");
        }
        Cmd::Claim { goal, name } => {
            let repo = repo()?;
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
            for sym in symbol {
                let (path, name) = sym.split_once('#').context("--symbol must be path#Name")?;
                symbols.push(json!({ "path": path, "name": name }));
            }
            let paths: Vec<String> = git(&["diff", "--name-only", "trunk/main"]).unwrap_or_default().lines().map(String::from).collect();
            let r = api.post(&format!("/api/repos/{repo}/changes/{change}/intent"), json!({ "summary": message, "paths": paths, "symbols": symbols }))?;
            println!("declared {} symbol(s)", symbols.len());
            match r["overlaps"].as_array() {
                Some(o) if !o.is_empty() => {
                    for x in o {
                        println!("  {} overlap with {}: {}", s(&x["level"]), s(&x["otherAgentId"]), s(&x["otherSummary"]));
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
            let issue = api.get(&format!("/api/repos/{repo}/changes/{change}")).ok().and_then(|d| d["issue"]["ref"].as_str().map(|r| format!("Hive-Issue: {r}\n"))).unwrap_or_default();
            let msg = format!("{}\n\nHive-Change-Id: {change}\nHive-Goal: {goal}\nHive-Agent: {agent}\nHive-Model: human-or-cli\n{issue}", message.trim());
            if git(&["diff", "--cached", "--quiet"]).is_err() {
                git(&["commit", "-q", "-m", &msg])?;
            }
            git(&["push", "-q", "--force", "origin", "HEAD:main"])?;
            // The diff goes along, so the dashboard shows it before the merge box checks the change.
            let base = git(&["merge-base", "trunk/main", "HEAD"]).unwrap_or_default();
            let head = git(&["rev-parse", "HEAD"])?;
            let body = match (base.is_empty(), git(&["diff", &base, "HEAD"])) {
                (false, Ok(diff)) => json!({ "base": base, "head": head, "diff": diff.chars().take(400_000).collect::<String>() }),
                _ => json!({}),
            };
            let r = api.post(&format!("/api/repos/{repo}/changes/{change}/submit"), body)?;
            println!("{change} is {}", r["status"].as_str().unwrap_or("submitted"));
        }
        Cmd::Show { change } => {
            let (repo, change) = match change {
                Some(c) => (repo()?, c),
                None => {
                    let (r, c, _) = local_change()?;
                    (r, c)
                }
            };
            let d = api.get(&format!("/api/repos/{repo}/changes/{change}"))?;
            println!("{change}: {}  ({})", s(&d["change"]["status"]), s(&d["goal"]["title"]));
            for e in d["evidence"].as_array().into_iter().flatten() {
                println!("  {} {}", if e["ok"].as_bool() == Some(true) { "pass" } else { "FAIL" }, s(&e["command"]));
            }
            if let Some(v) = d["evaluations"].as_array().and_then(|a| a.last()) {
                println!("  review {:.2}: {}", v["score"].as_f64().unwrap_or(0.0), s(&v["summary"]));
            }
            if let Some(dec) = d["decisions"].as_array().and_then(|a| a.last()) {
                println!("  decision: {} ({:.0}%) by {}", s(&dec["outcome"]), dec["confidence"].as_f64().unwrap_or(0.0) * 100.0, s(&dec["decidedBy"]));
                println!("  {}", s(&dec["rationale"]));
            }
        }
    }
    Ok(())
}

fn money(n: f64) -> String {
    if n == 0.0 {
        "$0".into()
    } else if n < 0.01 {
        "<$0.01".into()
    } else {
        format!("${n:.2}")
    }
}

/// HH:MM:SS, local time, without a date-time dependency.
fn chrono_now() -> String {
    let out = Proc::new("date").arg("+%H:%M:%S").output();
    out.map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default()
}
