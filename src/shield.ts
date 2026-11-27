/**
 * Privacy Shield: before anything goes to the cloud, personal details are
 * swapped for placeholders ON THE DEVICE, and put back into the cloud's answer
 * on the device. The cloud only ever sees "[EMAIL_1]", never the address.
 *
 * Two layers:
 *   1. Patterns (always, instant): emails, phone numbers, card numbers,
 *      bank account numbers, IBANs.
 *   2. Gemini Nano (when it's ready): people's names and street addresses,
 *      which patterns can't catch. See ai.ts → findNamesOnDevice.
 *
 * Pure functions here; the on-device step is passed in.
 */

export type Kind = "EMAIL" | "PHONE" | "CARD" | "ACCOUNT" | "IBAN" | "NAME" | "ADDRESS";

export interface Shielded {
  /** The text that's safe to send. */
  text: string;
  /** placeholder → original, kept only on the device. */
  vault: Map<string, string>;
  counts: Partial<Record<Kind, number>>;
}

const PATTERNS: [Kind, RegExp][] = [
  ["EMAIL", /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi],
  ["IBAN", /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,4})?\b/g],
  ["CARD", /\b(?:\d[ -]?){12,18}\d\b/g],
  // International or local phone numbers: +234 803 123 4567, 0803-123-4567, (555) 123-4567
  ["PHONE", /(?:\+\d{1,3}[\s-]?)?(?:\(\d{2,4}\)[\s-]?|\b0?\d{2,4}[\s-])\d{3,4}[\s-]?\d{3,4}\b/g],
  // Bank account numbers (10-digit NUBAN and similar)
  ["ACCOUNT", /\b\d{10}\b/g],
];

function swap(text: string, original: string, kind: Kind, vault: Map<string, string>, counts: Shielded["counts"]): string {
  if (!original.trim()) return text;
  // The same value always gets the same placeholder.
  for (const [ph, val] of vault) if (val === original) return text.split(original).join(ph);
  const n = (counts[kind] ?? 0) + 1;
  counts[kind] = n;
  const ph = `[${kind}_${n}]`;
  vault.set(ph, original);
  return text.split(original).join(ph);
}

function luhn(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Layer 1: pattern-based, instant, always on. */
export function shieldPatterns(input: string, start?: Shielded): Shielded {
  const vault = start?.vault ?? new Map<string, string>();
  const counts = start?.counts ?? {};
  let text = input;
  for (const [kind, re] of PATTERNS) {
    const found = new Set(text.match(re) ?? []);
    for (const m of found) {
      if (/^\[[A-Z]+_\d+\]$/.test(m)) continue;
      // Card numbers: 13–19 digits that pass the Luhn check (so phone numbers aren't mistaken for cards).
      if (kind === "CARD" && !luhn(m.replace(/\D/g, ""))) continue;
      text = swap(text, m, kind, vault, counts);
    }
  }
  return { text, vault, counts };
}

/** Layer 2: names and addresses found by the on-device model. */
export function shieldFound(s: Shielded, found: { names: string[]; addresses: string[] }): Shielded {
  let text = s.text;
  const counts = { ...s.counts };
  // Longest first, so "Tolu Adeyemi" is replaced before "Tolu".
  const items: [Kind, string][] = [
    ...found.addresses.map((a) => ["ADDRESS", a] as [Kind, string]),
    ...found.names.map((n) => ["NAME", n] as [Kind, string]),
  ].sort((a, b) => b[1].length - a[1].length);
  for (const [kind, value] of items) {
    const v = value.trim();
    if (v.length < 2 || !text.includes(v)) continue; // only what's really in the text
    text = swap(text, v, kind, s.vault, counts);
  }
  return { text, vault: s.vault, counts };
}

/** Puts the originals back into the cloud's answer, on the device. */
export function unshield(answer: string, vault: Map<string, string>): string {
  let out = answer;
  for (const [ph, val] of vault) out = out.split(ph).join(val);
  return out;
}

export function describeCounts(counts: Shielded["counts"]): string {
  const label: Record<Kind, [string, string]> = {
    EMAIL: ["email", "emails"],
    PHONE: ["phone number", "phone numbers"],
    CARD: ["card number", "card numbers"],
    ACCOUNT: ["account number", "account numbers"],
    IBAN: ["IBAN", "IBANs"],
    NAME: ["name", "names"],
    ADDRESS: ["address", "addresses"],
  };
  return (Object.entries(counts) as [Kind, number][])
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${label[k][n === 1 ? 0 : 1]}`)
    .join(", ");
}
