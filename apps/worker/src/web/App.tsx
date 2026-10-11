import { lazy, Suspense } from "react";

// "/" explains Hive and shows its numbers; "/r/<repo>" is that repository's live hive. Each route
// loads only its own code.
const Dashboard = lazy(() => import("./dashboard/Dashboard.tsx").then((m) => ({ default: m.Dashboard })));
const Landing = lazy(() => import("./landing/Landing.tsx").then((m) => ({ default: m.Landing })));

export function App() {
	const repo = location.pathname.match(/^\/r\/([^/]+)/)?.[1];
	return <Suspense fallback={<div className="min-h-screen bg-night" />}>{repo ? <Dashboard repo={decodeURIComponent(repo)} /> : <Landing />}</Suspense>;
}
