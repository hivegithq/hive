import { ArrowLeftIcon, ArrowRightIcon, GithubLogoIcon, ListIcon, XIcon } from "@phosphor-icons/react";
import { type MouseEvent, useEffect, useState } from "react";
import { Wordmark } from "../ui/Logo.tsx";
import { VERSION } from "../version.ts";
import { PAGES } from "./pages.tsx";
import { GITHUB } from "../links.ts";

const GROUPS = ["Start", "Use", "Reference"] as const;
const slugOf = (path: string) => path.replace(/^\/docs\/?/, "").replace(/\/$/, "");

// hivegit.dev/docs: a sidebar of pages and one page at a time. Links between pages change the URL
// without reloading; the back button works.
export function Docs() {
	const [slug, setSlug] = useState(() => slugOf(location.pathname));
	const [menu, setMenu] = useState(false);
	const index = Math.max(
		0,
		PAGES.findIndex((p) => p.slug === slug),
	);
	const page = PAGES[index];
	const known = PAGES.some((p) => p.slug === slug);

	useEffect(() => {
		const onPop = () => setSlug(slugOf(location.pathname));
		window.addEventListener("popstate", onPop);
		return () => window.removeEventListener("popstate", onPop);
	}, []);

	useEffect(() => {
		document.title = page.slug ? `${page.title} · Hive docs` : "Hive docs";
		if (!location.hash) window.scrollTo(0, 0);
		else document.getElementById(location.hash.slice(1))?.scrollIntoView();
	}, [page]);

	// Follow /docs links in place; everything else navigates normally.
	const onClick = (e: MouseEvent) => {
		const a = (e.target as HTMLElement).closest("a");
		if (!a || a.target || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
		const url = new URL(a.href, location.href);
		if (url.origin !== location.origin || !url.pathname.startsWith("/docs")) return;
		const next = slugOf(url.pathname);
		if (next === slug && url.hash) return;
		e.preventDefault();
		history.pushState(null, "", url.pathname + url.hash);
		setSlug(next);
		setMenu(false);
	};

	const nav = (
		<nav aria-label="Docs" className="space-y-7">
			{GROUPS.map((g) => (
				<div key={g}>
					<p className="mb-2 font-display text-xs font-semibold tracking-wide text-honey/80">{g}</p>
					<ul className="space-y-0.5">
						{PAGES.filter((p) => p.group === g).map((p) => (
							<li key={p.slug}>
								<a
									href={`/docs${p.slug ? `/${p.slug}` : ""}`}
									aria-current={p === page ? "page" : undefined}
									className={`-ml-3 block border-l-2 py-1.5 pl-3 text-[15px] transition-colors ${
										p === page ? "border-honey text-wax" : "border-transparent text-kumo-subtle hover:border-comb-line hover:text-wax"
									}`}
								>
									{p.title}
								</a>
							</li>
						))}
					</ul>
				</div>
			))}
		</nav>
	);

	const prev = PAGES[index - 1];
	const next = PAGES[index + 1];

	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: delegated link handling; links stay keyboard-accessible
		<div className="min-h-screen bg-night text-kumo-default" onClick={onClick}>
			<header className="sticky top-0 z-30 border-b border-white/5 bg-night/80 backdrop-blur-md">
				<div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-8">
					<Wordmark />
					<a href="/docs" className="font-display text-sm font-semibold text-kumo-subtle hover:text-wax">
						Docs
					</a>
					<div className="ml-auto flex items-center gap-5 text-sm text-kumo-subtle">
						<a href="/r/scale2k" className="hidden hover:text-wax sm:block">
							Live demo
						</a>
						<a href={GITHUB} aria-label="Source on GitHub" className="hover:text-wax">
							<GithubLogoIcon size={22} />
						</a>
						<button type="button" className="text-wax lg:hidden" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-label="Docs menu">
							{menu ? <XIcon size={22} /> : <ListIcon size={22} />}
						</button>
					</div>
				</div>
			</header>

			{menu && <div className="fixed inset-x-0 top-16 bottom-0 z-20 overflow-y-auto border-t border-white/5 bg-night px-6 py-6 lg:hidden">{nav}</div>}

			<div className="mx-auto flex max-w-6xl gap-12 px-4 sm:px-8">
				<aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-52 shrink-0 overflow-y-auto py-10 lg:block">{nav}</aside>
				<main className="min-w-0 max-w-[46rem] flex-1 pb-24 pt-10 lg:pt-14">
					{!known && <p className="mb-6 text-sm text-alarm">There's no docs page at {location.pathname}. Here's the start instead.</p>}
					<h1 className="font-display text-4xl font-bold leading-tight text-wax sm:text-5xl">{page.title}</h1>
					<p className="mt-4 text-lg leading-relaxed text-kumo-subtle">{page.summary}</p>
					<div className="mt-6">{page.body()}</div>

					<div className="mt-16 grid gap-3 border-t border-white/5 pt-8 sm:grid-cols-2">
						{prev ? (
							<a href={`/docs${prev.slug ? `/${prev.slug}` : ""}`} className="cut-sm group bg-comb/40 p-4 ring-1 ring-comb-line hover:ring-honey/50">
								<span className="flex items-center gap-1.5 text-xs text-kumo-subtle">
									<ArrowLeftIcon size={12} /> Previous
								</span>
								<span className="mt-1 block font-display font-semibold text-wax group-hover:text-honey">{prev.title}</span>
							</a>
						) : (
							<span />
						)}
						{next && (
							<a href={`/docs/${next.slug}`} className="cut-sm group bg-comb/40 p-4 text-right ring-1 ring-comb-line hover:ring-honey/50">
								<span className="flex items-center justify-end gap-1.5 text-xs text-kumo-subtle">
									Next <ArrowRightIcon size={12} />
								</span>
								<span className="mt-1 block font-display font-semibold text-wax group-hover:text-honey">{next.title}</span>
							</a>
						)}
					</div>
					<p className="mt-10 text-sm text-kumo-subtle">
						Hive v{VERSION}. Something unclear or wrong?{" "}
						<a href={`${GITHUB}/issues/new`} className="text-kumo-default underline-offset-4 hover:text-honey hover:underline">
							Open an issue
						</a>{" "}
						or{" "}
						<a href={`${GITHUB}/edit/main/apps/worker/src/web/docs/pages.tsx`} className="text-kumo-default underline-offset-4 hover:text-honey hover:underline">
							edit this page
						</a>
						.
					</p>
				</main>
			</div>
		</div>
	);
}
