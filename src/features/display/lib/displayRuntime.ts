import { t } from "@/shared/i18n";

export const DISPLAY_DEFAULT_DURATION_MS = 8_000;
export const DISPLAY_MIN_DURATION_MS = 1_000;
export const DISPLAY_MAX_DURATION_MS = 30_000;

export type DisplayEffect = "fireworks" | "snowfall" | "nationalDay";

export type DisplayPayload = {
	kind: "effect";
	effect: DisplayEffect;
	durationMs: number;
};

export type ActiveDisplay = DisplayPayload & { token: number };

export type DisplayValidationResult =
	| { ok: true; value: DisplayPayload }
	| { ok: false; message: string };

const DISPLAY_KEYS = new Set(["kind", "effect", "durationMs"]);
const DISPLAY_EFFECTS = new Set<DisplayEffect>([
	"fireworks",
	"snowfall",
	"nationalDay",
]);

let activeDisplay: ActiveDisplay | null = null;
let nextToken = 1;
const listeners = new Set<() => void>();

function emitDisplayChange(): void {
	for (const listener of listeners) listener();
}

export function validateDisplayPayload(
	payload: Record<string, unknown>,
): DisplayValidationResult {
	const unsupported = Object.keys(payload).filter((key) => !DISPLAY_KEYS.has(key));
	if (unsupported.length > 0) {
		return { ok: false, message: t("display.error.unexpectedFields", { fields: unsupported.join(", ") }) };
	}
	if (payload.kind !== "effect") {
		return { ok: false, message: t("display.error.invalidKind") };
	}
	if (
		typeof payload.effect !== "string" ||
		!DISPLAY_EFFECTS.has(payload.effect as DisplayEffect)
	) {
		return { ok: false, message: t("display.error.invalidEffect") };
	}
	const durationMs = payload.durationMs === undefined
		? DISPLAY_DEFAULT_DURATION_MS
		: payload.durationMs;
	if (
		typeof durationMs !== "number" ||
		!Number.isInteger(durationMs) ||
		durationMs < DISPLAY_MIN_DURATION_MS ||
		durationMs > DISPLAY_MAX_DURATION_MS
	) {
		return {
			ok: false,
			message: t("display.error.invalidDuration", {
				min: DISPLAY_MIN_DURATION_MS,
				max: DISPLAY_MAX_DURATION_MS,
			}),
		};
	}
	return {
		ok: true,
		value: {
			kind: "effect",
			effect: payload.effect as DisplayEffect,
			durationMs,
		},
	};
}

export function startDisplay(payload: DisplayPayload): ActiveDisplay {
	activeDisplay = { ...payload, token: nextToken };
	nextToken += 1;
	emitDisplayChange();
	return activeDisplay;
}

export function clearDisplay(token: number): void {
	if (activeDisplay?.token !== token) return;
	activeDisplay = null;
	emitDisplayChange();
}

export function getActiveDisplay(): ActiveDisplay | null {
	return activeDisplay;
}

export function subscribeDisplay(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}
