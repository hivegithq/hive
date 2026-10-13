import { Files } from "@cloudflare/sandbox";

// Which repos a container may reach, and how. Enforced by the Outbound entrypoint,
// which also injects short-lived Artifacts tokens so credentials never enter the container.
export interface OutboundPolicy {
	// First match wins. A trailing "*" matches any suffix ("shop.*" covers every fork of shop).
	// Interception is registered once per container, so a policy must not need to change later.
	repos: { name: string; scope: "read" | "write" }[];
	hosts: string[]; // extra hosts allowed straight through, e.g. the npm registry
	// One GitHub repository this sandbox may read and push, with the repository's stored token added
	// by the gateway (looked up from Hive repo `hive`'s coordinator at request time).
	github?: { owner: string; repo: string; hive: string };
	// The shared dependency cache (cache.hive.internal), limited to keys under this prefix.
	cache?: { prefix: string };
	// Credentials for one allowed host's git traffic (a private import), added by the gateway. Held
	// only in memory, for the life of this container.
	sourceAuth?: { host: string; authorization: string };
}

export type Instance = "lite" | "standard-1" | "standard-2" | "standard-3" | "standard-4";

export interface RunResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

// HTTPS interception re-signs traffic with Cloudflare's container CA; tools must trust it.
const CA = "/etc/cloudflare/certs/cloudflare-containers-ca.crt";
const TRUST_ENV = { NODE_EXTRA_CA_CERTS: CA, GIT_SSL_CAINFO: CA, CURL_CA_BUNDLE: CA, SSL_CERT_FILE: CA };

// A Durable Object's attached container, started on demand with outbound traffic routed through policy.
export class Box {
	private readonly ctx: DurableObjectState;
	private readonly outbound: (policy: OutboundPolicy) => Fetcher;
	private readonly instance: Instance;
	constructor(ctx: DurableObjectState, outbound: (policy: OutboundPolicy) => Fetcher, instance: Instance = "standard-1") {
		this.ctx = ctx;
		this.outbound = outbound;
		this.instance = instance;
	}

	private get container(): Container {
		const c = this.ctx.container;
		if (!c) throw new Error("this Durable Object has no container configured");
		return c;
	}

	// The policy a running container was set up with (in memory: unknown after a restart, which
	// costs one container restart, the price of never running with a stale policy).
	private policyKey: string | null = null;

	// Returns true when it had to (re)start the container, so callers know to set it up again.
	async ensure(policy: OutboundPolicy): Promise<boolean> {
		const c = this.container;
		const key = JSON.stringify(policy);
		if (c.running && this.policyKey !== key) {
			await c.destroy().catch(() => {});
			for (let i = 0; i < 300 && c.running; i++) await new Promise((r) => setTimeout(r, 200));
			// Never carry on in the old container: it has the wrong policy (or instance size).
			if (c.running) throw new Error("container did not stop for a restart; retry");
		}
		if (this.policyKey === key && c.running) return false;
		this.policyKey = key;
		if (!c.running) {
			c.start({ image: c.images.sandbox, enableInternet: false, instance: this.instance });
		}
		await this.waitUntilReady(c);
		const gateway = this.outbound(policy);
		await c.interceptAllOutboundHttp(gateway);
		await c.interceptOutboundHttps("*", gateway);
		await c.setInactivityTimeout(20 * 60 * 1000);
		return true;
	}

	// Stop the container and forget its policy (and any credentials in it).
	async stop() {
		this.policyKey = null;
		await this.container.destroy().catch(() => {});
	}

	// start() returns before the container can run commands; wait for a trivial exec to succeed.
	private async waitUntilReady(c: Container, timeoutMs = 90_000) {
		const deadline = Date.now() + timeoutMs;
		let lastError: unknown;
		while (Date.now() < deadline) {
			try {
				if (c.running) {
					const probe = await c.exec(["true"]);
					if ((await probe.exitCode) === 0) return;
				}
			} catch (err) {
				lastError = err;
			}
			await new Promise((r) => setTimeout(r, 500));
		}
		throw new Error(`container did not become ready within ${timeoutMs / 1000}s: ${lastError}`);
	}

	async run(command: string, opts: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {}): Promise<RunResult> {
		const signal = AbortSignal.timeout(opts.timeoutMs ?? 5 * 60 * 1000);
		const proc = await this.container.exec(["bash", "-lc", command], {
			cwd: opts.cwd ?? "/workspace",
			env: { ...TRUST_ENV, GIT_TERMINAL_PROMPT: "0", ...opts.env },
			signal,
		});
		const out = await proc.output();
		const text = new TextDecoder();
		return { exitCode: out.exitCode, stdout: text.decode(out.stdout), stderr: text.decode(out.stderr) };
	}

	files() {
		return new Files(this.container);
	}
}

// Shell-quote one argument.
export const sh = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;
