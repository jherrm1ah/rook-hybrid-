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
