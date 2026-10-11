# Hive sandbox: the workspace for coding agents and the merge box.
# git + mergiraf (structural merge) + difftastic (structural diff) + hive-merge (referential conflicts),
# the toolchains evidence runs on (Node, Rust, Go, Python), and the security scanners
# (gitleaks, osv-scanner, Semgrep with its default rules baked in, so scans need no rule download).
# sandbox-shim is a linux/amd64 binary, so the whole image is amd64.

FROM --platform=linux/amd64 rust:1.96-trixie AS tools
RUN cargo install --locked mergiraf difftastic
WORKDIR /src
COPY Cargo.toml Cargo.lock* ./
COPY crates ./crates
RUN cargo build --release -p hive-merge

FROM --platform=linux/amd64 golang:1.27.2-trixie AS go

FROM --platform=linux/amd64 node:24-trixie-slim
RUN apt-get update \
	&& apt-get install -y --no-install-recommends git ca-certificates ripgrep curl build-essential pkg-config libssl-dev python3 python3-venv python3-pip \
	&& rm -rf /var/lib/apt/lists/*

# Rust (the same toolchain the tools stage built with) and Go.
COPY --from=tools /usr/local/rustup /usr/local/rustup
COPY --from=tools /usr/local/cargo /usr/local/cargo
COPY --from=go /usr/local/go /usr/local/go
# Package managers go out through an intercepting egress proxy: one connection at a time (no HTTP/2
# multiplexing), bounded timeouts, retries.
ENV RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/usr/local/cargo GOPATH=/root/go GOTOOLCHAIN=local \
	CARGO_HTTP_MULTIPLEXING=false CARGO_HTTP_TIMEOUT=60 CARGO_NET_RETRY=4 PIP_DEFAULT_TIMEOUT=60 PIP_RETRIES=4 \
	PATH=/usr/local/cargo/bin:/usr/local/go/bin:/root/go/bin:$PATH
# Commands run in login shells (bash -lc), and Debian's /etc/profile resets PATH: restore it there too.
RUN printf 'export RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/usr/local/cargo GOPATH=/root/go GOTOOLCHAIN=local\nexport CARGO_HTTP_MULTIPLEXING=false CARGO_HTTP_TIMEOUT=60 CARGO_NET_RETRY=4 PIP_DEFAULT_TIMEOUT=60 PIP_RETRIES=4\nexport PATH=/usr/local/cargo/bin:/usr/local/go/bin:/root/go/bin:$PATH\n' > /etc/profile.d/hive-toolchains.sh

# Security scanners.
RUN curl -fsSL https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz | tar -xz -C /usr/local/bin gitleaks \
	&& curl -fsSL -o /usr/local/bin/osv-scanner https://github.com/google/osv-scanner/releases/download/v2.6.0/osv-scanner_linux_amd64 \
	&& chmod +x /usr/local/bin/osv-scanner \
	&& python3 -m venv /opt/semgrep \
	&& /opt/semgrep/bin/pip install --no-cache-dir -q semgrep==1.180.0 \
	&& ln -s /opt/semgrep/bin/semgrep /usr/local/bin/semgrep \
	&& mkdir -p /opt/hive \
	&& curl -fsSL -o /opt/hive/semgrep-default.yml https://semgrep.dev/c/p/default

COPY --from=docker.io/cloudflare/sandbox:1.0.0 /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim
COPY --from=tools /usr/local/cargo/bin/mergiraf /usr/local/cargo/bin/difft /usr/local/bin/
COPY --from=tools /src/target/release/hive-merge /usr/local/bin/hive-merge

# mergiraf as the merge driver for every file type it understands; git falls back to line merges otherwise.
RUN git config --system merge.mergiraf.name mergiraf \
	&& git config --system merge.mergiraf.driver 'mergiraf merge --git %O %A %B -s %S -x %X -y %Y -p %P -l %L' \
	&& printf '* merge=mergiraf\n' > /etc/gitattributes \
	&& git config --system core.attributesFile /etc/gitattributes \
	&& git config --system init.defaultBranch main \
	&& git config --system user.name "Hive" \
	&& git config --system user.email "hive@agents.local"

RUN mkdir -p /workspace
WORKDIR /workspace
CMD ["sleep", "infinity"]
