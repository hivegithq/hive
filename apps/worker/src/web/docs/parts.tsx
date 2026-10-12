import type { ReactNode } from "react";

export { Code } from "../ui/Code.tsx";

// The building blocks of a docs page, styled once here so pages read as plain content.

export const C = ({ children }: { children: ReactNode }) => <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[0.88em] text-wax">{children}</code>;

export const H2 = ({ id, children }: { id: string; children: ReactNode }) => (
	<h2 id={id} className="mt-12 mb-4 scroll-mt-24 font-display text-2xl font-semibold text-wax">
		<a href={`#${id}`} className="hover:text-honey">
			{children}
		</a>
	</h2>
);

export const P = ({ children }: { children: ReactNode }) => <p className="my-4 leading-relaxed text-kumo-default">{children}</p>;

export const A = ({ href, children }: { href: string; children: ReactNode }) => (
	<a href={href} className="text-honey underline decoration-honey/30 underline-offset-4 hover:decoration-honey" {...(href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}>
		{children}
	</a>
);

export const List = ({ children, ordered }: { children: ReactNode; ordered?: boolean }) =>
	ordered ? (
		<ol className="my-4 list-decimal space-y-2 pl-6 leading-relaxed marker:text-honey">{children}</ol>
	) : (
		<ul className="my-4 list-disc space-y-2 pl-6 leading-relaxed marker:text-honey/70">{children}</ul>
	);

export function Note({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
	return (
		<div className={`my-6 border-l-2 py-1 pl-4 text-[15px] leading-relaxed ${tone === "warn" ? "border-alarm text-kumo-default" : "border-honey text-kumo-default"}`}>{children}</div>
	);
}

export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
	return (
		<div className="my-6 overflow-x-auto ring-1 ring-comb-line">
			<table className="w-full text-left text-sm">
				<thead className="bg-comb/60 text-wax">
					<tr>
						{head.map((h) => (
							<th key={h} className="px-3 py-2 font-medium">
								{h}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((r, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: static rows
						<tr key={i} className="border-t border-comb-line align-top">
							{r.map((cell, j) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: static cells
								<td key={j} className="px-3 py-2 text-kumo-default">
									{cell}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

// The three ways to use Hive, side by side.
export function Paths() {
	const paths = [
		{ href: "/docs/demo", title: "Try the live demo", body: "Watch real agents on hivegit.dev. Nothing to install; read-only.", cost: "Free" },
		{ href: "/docs/local", title: "Run it locally", body: "Hive on your machine, with a local stand-in for Artifacts. Agents use Workers AI.", cost: "Free Cloudflare account" },
		{ href: "/docs/deploy", title: "Deploy your own", body: "One command puts Hive on your Cloudflare account, on workers.dev or your domain.", cost: "Workers Paid" },
	];
	return (
		<div className="my-8 grid gap-3 sm:grid-cols-3">
			{paths.map((p) => (
				<a key={p.href} href={p.href} className="cut-sm group block bg-comb/50 p-4 ring-1 ring-comb-line transition hover:ring-honey/50">
					<span className="block font-display text-lg font-semibold text-wax group-hover:text-honey">{p.title}</span>
					<span className="mt-1 block text-sm leading-relaxed text-kumo-subtle">{p.body}</span>
					<span className="mt-3 block text-xs text-honey/80">{p.cost}</span>
				</a>
			))}
		</div>
	);
}
