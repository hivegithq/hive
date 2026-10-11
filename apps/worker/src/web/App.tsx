import { type ComponentType, lazy, Suspense } from "react";

// A route's code, loaded on demand. After a deploy, a page loaded earlier asks for chunks that no
// longer exist: reload once to pick up the new build (a session flag stops a reload loop).
// biome-ignore lint/suspicious/noExplicitAny: props differ per route
function route<T extends ComponentType<any>>(load: () => Promise<T>) {
	return lazy(async () => {
		try {
			const component = await load();
			try {
				sessionStorage.removeItem("hive-reloaded");
			} catch {}
			return { default: component };
		} catch (err) {
			let reloaded = false;
			try {
				reloaded = sessionStorage.getItem("hive-reloaded") === "1";
				sessionStorage.setItem("hive-reloaded", "1");
			} catch {}
			if (!reloaded) {
				location.reload();
				return new Promise<never>(() => {});
			}
			throw err;
		}
	});
}

// "/" explains Hive and shows its numbers; "/r/<repo>" is that repository's live hive. Each route
// loads only its own code.
const Dashboard = route(() => import("./dashboard/Dashboard.tsx").then((m) => m.Dashboard));
const Landing = route(() => import("./landing/Landing.tsx").then((m) => m.Landing));

export function App() {
	const repo = location.pathname.match(/^\/r\/([^/]+)/)?.[1];
	return <Suspense fallback={<div className="min-h-screen bg-night" />}>{repo ? <Dashboard repo={decodeURIComponent(repo)} /> : <Landing />}</Suspense>;
}
