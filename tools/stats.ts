// Poll a repo's load-test stats until nothing is in flight.  node tools/stats.ts <repo> [host] [maxMinutes]
const [repo = "load", host = "http://localhost:5173", maxMin = "20"] = process.argv.slice(2);
const deadline = Date.now() + Number(maxMin) * 60_000;
let quietRounds = 0;
while (Date.now() < deadline) {
	try {
		const s = await (await fetch(`${host}/api/repos/${repo}/stats`)).json();
		if (s.changes) {
			const inFlight = ["drafting", "submitted", "converging"].reduce((n, k) => n + (s.changes[k] ?? 0), 0);
			console.log(new Date().toISOString().slice(11, 19), JSON.stringify(s.changes), `landed/min=${s.landedPerMinute}`, `batches=${s.batches.count}(avg ${s.batches.avgSize})`, `mirrors=${s.mirrors}`);
			quietRounds = inFlight === 0 ? quietRounds + 1 : 0;
			if (quietRounds >= 2) {
				console.log(JSON.stringify(s, null, 2));
				process.exit(0);
			}
		}
	} catch (err) {
		console.log("poll error", String(err).slice(0, 80));
	}
	await new Promise((r) => setTimeout(r, 15_000));
}
console.log("timed out");
