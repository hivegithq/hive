import { describe, expect, it } from "vitest";
import { claimMatch, owners } from "./owners.ts";

const claim = (changeId: string, paths: string[], symbols: { path: string; name: string }[] = []) => ({ agentId: `a-${changeId}`, changeId, summary: "s", paths, symbols });

describe("owners", () => {
	it("matches a symbol, its methods and the file", () => {
		const c = claim("c1", ["src/cart.ts"], [{ path: "src/cart.ts", name: "Cart.total" }]);
		expect(claimMatch(c, "src/cart.ts", "Cart.total")).toBe("symbol");
		expect(claimMatch(c, "src/cart.ts", "Cart")).toBe("symbol");
		expect(claimMatch(c, "src/cart.ts", "Cart.items")).toBe("path");
		expect(claimMatch(c, "src/cart.ts")).toBe("path");
		expect(claimMatch(c, "src/price.ts", "Cart.total")).toBeNull();
	});

	it("puts symbol owners first and leaves the asker out", () => {
		const claims = [claim("c1", ["src/cart.ts"]), claim("c2", [], [{ path: "src/cart.ts", name: "total" }]), claim("c3", ["src/cart.ts"])];
		expect(owners(claims, "src/cart.ts", "total", "c3").map((o) => `${o.changeId}:${o.match}`)).toEqual(["c2:symbol", "c1:path"]);
	});
});
