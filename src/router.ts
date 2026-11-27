/**
 * ROOK's hybrid router: every request goes to the cheapest place that can do
 * it well, and says why.
 *
 *   instant  ROOK's own engine, no AI at all (maths, units, dates, money)
 *   device   Gemini Nano in Chrome, through Firebase AI Logic (private, free, offline)
 *   cloud    Gemini in the cloud, through Firebase AI Logic (long or hard work)
 *   research Gemini in the cloud with Google Search grounding, summarised back on device
 *
 * Pure functions only: no Firebase, no DOM, so the decision is testable.
 */
import { calculate } from "./vendor/calc.ts";

export type Route = "instant" | "device" | "cloud" | "research";

/** The user's choice in the mode switch. */
export type Mode = "auto" | "private" | "cloud";

export interface Decision {
  route: Route;
  /** Plain-words reason shown on the answer. */
  reason: string;
  /** Private mode: the request must never leave the device. */
  deviceOnly: boolean;
  /** For "instant": the answer itself. */
  answer?: string;
}

/** Gemini Nano's context is small; long inputs go to the cloud model. */
export const DEVICE_MAX_CHARS = 6000;

const RESEARCH = /^(\/research\b|research\b|look up\b|search (the web|online)\b)|\b(latest|today'?s|this week|news|current price|compare .+ (and|vs\.?|versus) )/i;

export function decide(text: string, opts: { mode: Mode; hasImage: boolean; deviceReady: boolean }): Decision {
  const t = text.trim();
  if (!opts.hasImage) {
    const calc = calculate(t);
    if (calc) return { route: "instant", reason: "Simple calculation → ROOK's own engine, no AI needed", deviceOnly: false, answer: calc.answer };
  }
  if (opts.mode === "private") {
    return { route: "device", reason: "Private mode → stays on this device", deviceOnly: true };
  }
  if (RESEARCH.test(t)) {
    return { route: "research", reason: "Needs fresh information from the web → cloud with Google Search", deviceOnly: false };
  }
  if (opts.mode === "cloud") {
    return { route: "cloud", reason: "You chose the cloud model", deviceOnly: false };
  }
  if (t.length > DEVICE_MAX_CHARS) {
    return { route: "cloud", reason: `Long input (${t.length.toLocaleString()} characters) → cloud model`, deviceOnly: false };
  }
  return {
    route: "device",
    reason: opts.deviceReady ? "Everyday request → on your device first" : "On-device model not ready → cloud fallback",
    deviceOnly: false,
  };
}

/** Strips a leading "/research" command from the prompt actually sent. */
export function promptFor(text: string): string {
  return text.replace(/^\/research\s*/i, "").trim();
}

/* ---------------- Self-check: the device grades its own answer ---------------- */

/** What Gemini Nano says about its own answer. */
export interface Grade {
  /** 0–100: how sure the device is that its answer is correct and complete. */
  confidence: number;
  /** The device itself says this needs a bigger model (fresh facts, deep expertise, long reasoning). */
  needsCloud: boolean;
  reason: string;
}

/** Below this, the cloud is asked to improve the device's answer. */
export const CONFIDENCE_THRESHOLD = 60;

/** Reads the device's grade, whatever shape it came back in; unreadable means "unsure". */
export function parseGrade(raw: string): Grade {
  try {
    const j = JSON.parse(raw) as { confidence?: unknown; needs_cloud?: unknown; reason?: unknown };
    const c = Number(j.confidence);
    return {
      confidence: Number.isFinite(c) ? Math.max(0, Math.min(100, Math.round(c))) : 50,
      needsCloud: j.needs_cloud === true,
      reason: typeof j.reason === "string" ? j.reason.slice(0, 160) : "",
    };
  } catch {
    return { confidence: 50, needsCloud: false, reason: "The device couldn't grade its answer." };
  }
}

/** Escalate when the device is unsure, unless the cloud is off-limits (private mode, offline). */
export function shouldEscalate(g: Grade, opts: { online: boolean; deviceOnly: boolean }): boolean {
  if (!opts.online || opts.deviceOnly) return false;
  return g.needsCloud || g.confidence < CONFIDENCE_THRESHOLD;
}

/** Rough tokens for a piece of text (about 4 characters per token), for the "kept on this device" counter. */
export const tokensIn = (text: string) => Math.ceil(text.length / 4);

/** The cloud's job when it's called in to improve the device's draft. */
export function improvePrompt(draft: string): string {
  return (
    `A small on-device model already drafted an answer to my last message:\n"""\n${draft.slice(0, 4000)}\n"""\n` +
    `It wasn't confident. Write the best answer yourself: keep what's right, fix anything wrong, fill gaps. Reply with the answer only.`
  );
}
