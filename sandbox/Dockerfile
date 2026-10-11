# Hive sandbox: the workspace for coding agents and the merge box.
# git + mergiraf (structural merge) + difftastic (structural diff) + hive-merge (referential conflicts) + node.
# sandbox-shim is a linux/amd64 binary, so the whole image is amd64.

FROM --platform=linux/amd64 rust:1.96-trixie AS tools
RUN cargo install --locked mergiraf difftastic
WORKDIR /src
COPY Cargo.toml Cargo.lock* ./
COPY crates ./crates
RUN cargo build --release -p hive-merge

FROM --platform=linux/amd64 node:24-trixie-slim
RUN apt-get update \
	&& apt-get install -y --no-install-recommends git ca-certificates ripgrep curl \
	&& rm -rf /var/lib/apt/lists/*
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
