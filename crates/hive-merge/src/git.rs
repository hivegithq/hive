//! Read every indexable file at a revision in one `git cat-file --batch` round trip.

use anyhow::{Context, Result, bail};
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Command, Stdio};

const EXTENSIONS: &[&str] = &["ts", "mts", "cts", "tsx", "js", "mjs", "cjs", "jsx", "rs", "py"];
const MAX_FILE_BYTES: usize = 512 * 1024;

pub fn read_tree(rev: &str) -> Result<Vec<(String, String)>> {
    let listing = Command::new("git").args(["ls-tree", "-r", "-l", rev]).output().context("git ls-tree")?;
    if !listing.status.success() {
        bail!("git ls-tree {rev}: {}", String::from_utf8_lossy(&listing.stderr));
    }

    // "<mode> blob <sha> <size>\t<path>"
    let mut wanted = Vec::new();
    for line in String::from_utf8_lossy(&listing.stdout).lines() {
        let Some((meta, path)) = line.split_once('\t') else { continue };
        let parts: Vec<&str> = meta.split_whitespace().collect();
        if parts.len() < 4 || parts[1] != "blob" {
            continue;
        }
        let ext = path.rsplit('.').next().unwrap_or("");
        let size: usize = parts[3].parse().unwrap_or(usize::MAX);
        if EXTENSIONS.contains(&ext) && size <= MAX_FILE_BYTES && !path.contains("node_modules/") && !path.ends_with(".d.ts") {
            wanted.push((parts[2].to_string(), path.to_string()));
        }
    }

    let mut child = Command::new("git").args(["cat-file", "--batch"]).stdin(Stdio::piped()).stdout(Stdio::piped()).spawn()?;
    let mut stdin = child.stdin.take().context("stdin")?;
    let shas: String = wanted.iter().map(|(sha, _)| format!("{sha}\n")).collect();
    let writer = std::thread::spawn(move || stdin.write_all(shas.as_bytes()));

    let mut out = BufReader::new(child.stdout.take().context("stdout")?);
    let mut files = Vec::with_capacity(wanted.len());
    for (_, path) in &wanted {
        let mut header = String::new();
        out.read_line(&mut header)?;
        let size: usize = header.split_whitespace().nth(2).context("cat-file header")?.parse()?;
        let mut buf = vec![0; size + 1]; // content + trailing newline
        out.read_exact(&mut buf)?;
        buf.truncate(size);
        if let Ok(text) = String::from_utf8(buf) {
            files.push((path.clone(), text));
        }
    }
    writer.join().expect("writer thread")?;
    child.wait()?;
    Ok(files)
}
