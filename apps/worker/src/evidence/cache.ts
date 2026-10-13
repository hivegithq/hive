// A dependency cache shared by every box that checks a repository: after a setup step runs, what it
// installed is archived to R2 (through the egress gateway at cache.hive.internal); a fresh box with
// the same lockfiles restores it instead of installing again.

export const CACHE_HOST = "http://cache.hive.internal";

// Where a setup step's results live. Repo-local paths are relative to the checkout (agents and
// merge boxes check out at different places); absolute paths are shell expressions.
export interface CacheSpec {
	local: string[];
	absolute: string[];
}

const PART = "50m"; // archives are split so no single upload is large
const MAX_BYTES = 2_000_000_000;

// Shell functions the setup script uses. $1 = URL prefix for this step's archives.
export const CACHE_FUNCTIONS = `
hive_cache_get() { # url base -> restores the archive at url into base, or fails
  curl -sf "$1/manifest" -o /tmp/hive-cache-n || return 1
  n=$(cat /tmp/hive-cache-n); [ "$n" -gt 0 ] 2>/dev/null || return 1
  mkdir -p "$2"
  (i=0; while [ $i -lt $n ]; do curl -sf "$1/part$i" || exit 1; i=$((i+1)); done) | tar -xzf - -C "$2"
}
hive_cache_put() { # url base paths... -> archives the paths (relative to base) that exist
  url="$1"; base="$2"; shift 2
  set -- $(cd "$base" 2>/dev/null && for p in "$@"; do [ -e "$p" ] && printf '%s\\n' "$p"; done)
  [ $# -eq 0 ] && return 0
  rm -f /tmp/hive-cache-part.*
  tar -czf - -C "$base" "$@" 2>/dev/null | split -b ${PART} - /tmp/hive-cache-part.
  size=$(cat /tmp/hive-cache-part.* | wc -c)
  [ "$size" -gt ${MAX_BYTES} ] && { rm -f /tmp/hive-cache-part.*; return 0; }
  i=0; for f in /tmp/hive-cache-part.*; do curl -sf -X PUT --data-binary @"$f" "$url/part$i" || return 1; i=$((i+1)); done
  printf '%s' "$i" | curl -sf -X PUT --data-binary @- "$url/manifest"
  rm -f /tmp/hive-cache-part.*
}
`;

// The commands around one setup step: restore, else run and save. Prints CACHE=hit|saved|off and
// SECONDS=n on success; on failure, the tail of the install log.
export function setupScript(opts: { key: string; command: string; prefix: string | null; spec: CacheSpec | null; pre?: string }): string {
	return `${opts.pre ? `${opts.pre} >/dev/null 2>&1 || true\n` : ""}${setupBody(opts)}`;
}

function setupBody(opts: { key: string; command: string; prefix: string | null; spec: CacheSpec | null }): string {
	const marker = `/tmp/hive-setup-${opts.key}`;
	const run = `t0=$(date +%s); (${opts.command}) > /tmp/hive-setup.log 2>&1 || { tail -c 6000 /tmp/hive-setup.log; exit 1; }; touch ${marker}`;
	if (!opts.prefix || !opts.spec || (opts.spec.local.length === 0 && opts.spec.absolute.length === 0)) {
		return `[ -f ${marker} ] && { echo CACHE=box; exit 0; }; ${run}; echo CACHE=off; echo SECONDS=$(( $(date +%s) - t0 ))`;
	}
	const url = `${CACHE_HOST}/${opts.prefix}${opts.key}`;
	const abs = opts.spec.absolute.map((p) => `"$(echo ${p})"`).join(" ");
	const local = opts.spec.local.map((p) => `'${p}'`).join(" ");
	return `[ -f ${marker} ] && { echo CACHE=box; exit 0; }
${CACHE_FUNCTIONS}
t0=$(date +%s)
if ${local ? `hive_cache_get ${url}/local "$PWD" 2>/dev/null` : "true"} && ${abs ? `hive_cache_get ${url}/abs / 2>/dev/null` : "true"}; then
  touch ${marker}; echo CACHE=hit; echo SECONDS=$(( $(date +%s) - t0 )); exit 0
fi
${run}
secs=$(( $(date +%s) - t0 ))
saved=saved
${local ? `hive_cache_put ${url}/local "$PWD" ${local} || saved=off` : ""}
${abs ? `abs=""; for p in ${abs}; do abs="$abs \${p#/}"; done; hive_cache_put ${url}/abs / $abs || saved=off` : ""}
echo CACHE=$saved; echo SECONDS=$secs`;
}

export function parseSetupResult(stdout: string): { cache: "box" | "hit" | "saved" | "off"; seconds: number | null } {
	const cache = (/CACHE=(box|hit|saved|off)/.exec(stdout)?.[1] ?? "off") as "box" | "hit" | "saved" | "off";
	const s = /SECONDS=(\d+)/.exec(stdout)?.[1];
	return { cache, seconds: s ? Number(s) : null };
}
