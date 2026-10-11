// Stream a Hive repo's coordinator events as one line each.  node tools/watch.ts [repo] [host]
const repo = process.argv[2] ?? "shop";
const host = process.argv[3] ?? "localhost:5173";
const short = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n)}…` : s).replaceAll("\n", " ");
let first = true;
function connect() {
	const ws = new WebSocket(`ws://${host}/agents/coordinator/${repo}`);
	ws.onopen = () => first && console.log(`watching ${repo}`);
	// The dev server reloads the Worker on code changes; reconnect quietly.
	ws.onclose = () => setTimeout(connect, 1000);
	ws.onmessage = onMessage;
}
connect();

function onMessage(m: MessageEvent) {
	let e: any;
	try {
		e = JSON.parse(String(m.data));
	} catch {
		return;
	}
	switch (e.type) {
		case "snapshot":
			if (!first) return;
			first = false;
			return console.log(`snapshot: ${e.snapshot.changes.length} changes, ${e.snapshot.intents.length} intents`);
		case "change": return console.log(`change ${e.change.id} → ${e.change.status}${e.change.attempts > 1 ? ` (attempt ${e.change.attempts})` : ""}`);
		case "goal": return console.log(`goal ${e.goal.id} ${e.goal.status}: ${e.goal.title}`);
		case "intent": return console.log(`intent ${e.intent.changeId}: ${short(e.intent.summary)} [${e.intent.symbols.map((s: any) => s.name).join(", ")}] overlaps=${e.overlaps.map((o: any) => o.level).join(",") || "none"}`);
		case "evidence": return console.log(`evidence ${e.evidence.changeId} ${e.evidence.kind} ${e.evidence.ok ? "ok" : "FAIL"}: ${e.evidence.command}`);
		case "evaluation": return console.log(`review ${e.evaluation.changeId} score=${e.evaluation.score.toFixed(2)}: ${short(e.evaluation.summary)}`);
		case "decision": return console.log(`decision ${e.decision.changeId} ${e.decision.outcome} conf=${e.decision.confidence.toFixed(2)} by ${e.decision.decidedBy}: ${short(e.decision.rationale)}`);
		case "trunk": return console.log(`trunk → ${e.commit.slice(0, 8)} (${e.changeId ?? "external"})`);
		case "log": return console.log(`log ${e.agentId}: ${short(e.text)}`);
		case "message": return console.log(`msg ${e.from} → ${e.to}: ${short(e.text)}`);
	}
}
