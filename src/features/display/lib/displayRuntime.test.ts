import {
	clearDisplay,
	getActiveDisplay,
	startDisplay,
	subscribeDisplay,
	validateDisplayPayload,
} from "@/features/display/lib/displayRuntime";
import fs from "node:fs";
import path from "node:path";

describe("Display runtime", () => {
	afterEach(() => {
		const active = getActiveDisplay();
		if (active) clearDisplay(active.token);
	});

	it("validates all effects, exact fields, and duration bounds", () => {
		for (const effect of ["fireworks", "snowfall", "nationalDay"] as const) {
			expect(validateDisplayPayload({ kind: "effect", effect })).toEqual({
				ok: true,
				value: { kind: "effect", effect, durationMs: 8_000 },
			});
		}
		for (const payload of [
			{ kind: "effect", effect: "fireworks", durationMs: 999 },
			{ kind: "effect", effect: "fireworks", durationMs: 30_001 },
			{ kind: "effect", effect: "fireworks", durationMs: 1_000.5 },
			{ kind: "effect", effect: "fireworks", extra: true },
		]) {
			expect(validateDisplayPayload(payload).ok).toBe(false);
		}
	});

	it("replaces one active effect and ignores stale cleanup", () => {
		const listener = jest.fn();
		const unsubscribe = subscribeDisplay(listener);
		const first = startDisplay({ kind: "effect", effect: "fireworks", durationMs: 8_000 });
		const second = startDisplay({ kind: "effect", effect: "snowfall", durationMs: 4_000 });
		expect(second.token).toBeGreaterThan(first.token);
		expect(getActiveDisplay()).toEqual(second);
		clearDisplay(first.token);
		expect(getActiveDisplay()).toEqual(second);
		clearDisplay(second.token);
		expect(getActiveDisplay()).toBeNull();
		expect(listener).toHaveBeenCalledTimes(3);
		unsubscribe();
	});

	it("wires reduced-motion rendering and complete animation cleanup", () => {
		const component = fs.readFileSync(
			path.join(process.cwd(), "src/features/display/components/DisplayOverlay.tsx"),
			"utf8",
		);
		expect(component).toMatch(/prefers-reduced-motion: reduce/u);
		expect(component).toMatch(/window\.cancelAnimationFrame\(animationFrame\)/u);
		expect(component).toMatch(/window\.removeEventListener\("resize", resize\)/u);
		expect(component).toMatch(/window\.clearTimeout\(timer\)/u);
		expect(component).toMatch(/drawStar/u);
		expect(component).toMatch(/bezierCurveTo/u);
	});
});
