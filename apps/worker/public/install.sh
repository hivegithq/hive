#!/bin/sh
# Install the hive CLI: curl -fsSL https://hivegit.dev/install.sh | sh
#
# Downloads the latest release for this machine from GitHub, checks its SHA-256, and installs
# `hive` to ~/.local/bin. Set HIVE_INSTALL_DIR to install elsewhere, HIVE_VERSION (e.g. v1.2.0)
# for a specific release. Source: https://github.com/hivegithq/hive
set -eu

REPO="hivegithq/hive"
DIR="${HIVE_INSTALL_DIR:-$HOME/.local/bin}"

say() { printf '%s\n' "$*"; }
die() { printf 'hive install: %s\n' "$*" >&2; exit 1; }

case "$(uname -s)" in
  Darwin) os="apple-darwin" ;;
  Linux) os="unknown-linux-musl" ;;
  *) die "no prebuilt hive for $(uname -s). Build it with Rust: cargo install --git https://github.com/$REPO hive-cli" ;;
esac
case "$(uname -m)" in
  arm64 | aarch64) arch="aarch64" ;;
  x86_64 | amd64) arch="x86_64" ;;
  *) die "no prebuilt hive for $(uname -m). Build it with Rust: cargo install --git https://github.com/$REPO hive-cli" ;;
esac
target="$arch-$os"

if [ -n "${HIVE_VERSION:-}" ]; then
  base="https://github.com/$REPO/releases/download/$HIVE_VERSION"
else
  base="https://github.com/$REPO/releases/latest/download"
fi

if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -qO "$2" "$1"; }
else
  die "needs curl or wget"
fi
if command -v sha256sum >/dev/null 2>&1; then
  sha() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
  sha() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
  die "needs sha256sum or shasum to verify the download"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

say "Downloading hive for $target"
fetch "$base/hive-$target.tar.gz" "$tmp/hive.tar.gz" || die "download failed: $base/hive-$target.tar.gz"
fetch "$base/hive-$target.tar.gz.sha256" "$tmp/hive.sha256" || die "checksum download failed"
want="$(cut -d' ' -f1 <"$tmp/hive.sha256")"
got="$(sha "$tmp/hive.tar.gz")"
[ "$want" = "$got" ] || die "checksum mismatch (expected $want, got $got); not installing"

tar -xzf "$tmp/hive.tar.gz" -C "$tmp"
mkdir -p "$DIR"
install -m 755 "$tmp/hive" "$DIR/hive" 2>/dev/null || { cp "$tmp/hive" "$DIR/hive" && chmod 755 "$DIR/hive"; }
say "Installed $("$DIR/hive" --version) to $DIR/hive"

case ":$PATH:" in
  *":$DIR:"*) ;;
  *) say "" ; say "$DIR isn't on your PATH. Add it, for example:" ; say "  echo 'export PATH=\"$DIR:\$PATH\"' >> ~/.$(basename "${SHELL:-sh}")rc" ;;
esac
say ""
say "Next: export HIVE_URL=https://hivegit.dev HIVE_REPO=<repo> HIVE_TOKEN=<token>, then run: hive status"
say "Docs: https://hivegit.dev/docs/agents"
