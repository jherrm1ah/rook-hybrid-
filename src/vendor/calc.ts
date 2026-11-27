// From the ROOK desktop app (apps/desktop/src/lib/local/calc.ts): ROOK's on-device engine for instant answers.
/**
 * ROOK's calculation engine: arithmetic, percentages, unit conversions,
 * dates, statistics and loans with plain code, so "15% of 240" or
 * "days until 25 December" never needs an AI call. Every result is computed
 * (never guessed); anything it can't parse returns null and goes elsewhere.
 * Currency needs a rate: one the user gives, or it says so. Pure, unit-tested.
 */

export interface CalcResult {
  /** The answer, formatted ("36", "15.24 cm", "Tuesday, 25 Dec 2026"). */
  answer: string;
  /** How it was worked out, one line. */
  working: string;
}

/* ---------------- expressions ---------------- */

type Tok = { t: "num"; v: number } | { t: "op"; v: string } | { t: "lp" } | { t: "rp" } | { t: "fn"; v: string } | { t: "comma" };

const FNS: Record<string, (...a: number[]) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  round: (x, d = 0) => Math.round(x * 10 ** d) / 10 ** d,
  floor: Math.floor,
  ceil: Math.ceil,
  log: Math.log10,
  ln: Math.log,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  min: Math.min,
  max: Math.max,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

function tokenize(src: string): Tok[] | null {
  const s = src
    .toLowerCase()
    .replace(/×|\bx\b(?=\s*[\d(])/g, "*")
    .replace(/÷/g, "/")
    .replace(/−/g, "-")
    .replace(/\btimes\b|\bmultiplied by\b/g, "*")
    .replace(/\bdivided by\b|\bover\b/g, "/")
    .replace(/\bplus\b/g, "+")
    .replace(/\bminus\b/g, "-")
    .replace(/\bto the power of\b|\*\*/g, "^")
    .replace(/(\d),(?=\d{3}\b)/g, "$1"); // 1,250 → 1250
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const num = s.slice(i).match(/^(\d+(\.\d+)?|\.\d+)(e[+-]?\d+)?/);
    if (num) {
      let v = Number(num[0]);
      i += num[0].length;
      const suffix = s.slice(i).match(/^\s*(k|m|bn|million|billion|thousand)\b/);
      if (suffix) {
        v *= { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, bn: 1e9, billion: 1e9 }[suffix[1]!]!;
        i += suffix[0].length;
      }
      out.push({ t: "num", v });
      if (s[i] === "%") {
        out.push({ t: "op", v: "%" });
        i++;
      }
      continue;
    }
    const word = s.slice(i).match(/^[a-z]+/);
    if (word) {
      const w = word[0];
      if (FNS[w]) out.push({ t: "fn", v: w });
      else if (w in CONSTS) out.push({ t: "num", v: CONSTS[w]! });
      else return null;
      i += w.length;
      continue;
    }
    if ("+-*/^".includes(c)) out.push({ t: "op", v: c });
    else if (c === "(") out.push({ t: "lp" });
    else if (c === ")") out.push({ t: "rp" });
    else if (c === ",") out.push({ t: "comma" });
    else return null;
    i++;
  }
  return out;
}

/** Recursive-descent evaluation. "%" after a number means /100, except "a + b%" = a × (1 + b/100). */
export function evaluate(src: string): number | null {
  const maybe = tokenize(src);
  if (!maybe || !maybe.length) return null;
  const toks: Tok[] = maybe;
  let p = 0;
  const peek = () => toks[p];
  const fail = (): never => {
    throw new Error("parse");
  };
  function primary(): number {
    const t = toks[p++];
    if (!t) return fail();
    if (t.t === "num") {
      if (peek()?.t === "op" && (peek() as { v: string }).v === "%") {
        p++;
        return t.v / 100;
      }
      return t.v;
    }
    if (t.t === "op" && t.v === "-") return -primary();
    if (t.t === "op" && t.v === "+") return primary();
    if (t.t === "lp") {
      const v = additive();
      if (toks[p++]?.t !== "rp") fail();
      return v;
    }
    if (t.t === "fn") {
      if (toks[p++]?.t !== "lp") fail();
      const args = [additive()];
      while (peek()?.t === "comma") {
        p++;
        args.push(additive());
      }
      if (toks[p++]?.t !== "rp") fail();
      return FNS[t.v]!(...args);
    }
    return fail();
  }
  function power(): number {
    const base = primary();
    if (peek()?.t === "op" && (peek() as { v: string }).v === "^") {
      p++;
      return base ** power();
    }
    return base;
  }
  function multiplicative(): number {
    let v = power();
    for (;;) {
      const t = peek();
      if (t?.t === "op" && (t.v === "*" || t.v === "/")) {
        p++;
        const r = power();
        v = t.v === "*" ? v * r : v / r;
      } else if (t && (t.t === "lp" || t.t === "fn")) {
        v *= power(); // 2(3+4)
      } else return v;
    }
  }
  function additive(): number {
    let v = multiplicative();
    for (;;) {
      const t = peek();
      if (t?.t !== "op" || (t.v !== "+" && t.v !== "-")) return v;
      p++;
      // "200 + 15%" means 15% of 200.
      const next = toks[p];
      const after = toks[p + 1];
      if (next?.t === "num" && after?.t === "op" && after.v === "%" && toks[p + 2]?.t !== "op") {
        p += 2;
        v = t.v === "+" ? v * (1 + next.v / 100) : v * (1 - next.v / 100);
        continue;
      }
      const r = multiplicative();
      v = t.v === "+" ? v + r : v - r;
    }
  }
  try {
    const v = additive();
    if (p !== toks.length || !Number.isFinite(v)) return null;
    return Number(v.toPrecision(12)); // 229.99999999999997 → 230

  } catch {
    return null;
  }
}

export function fmt(n: number, maxFrac = 6): string {
  if (Math.abs(n) >= 1e15 || (Math.abs(n) < 1e-6 && n !== 0)) return n.toExponential(4);
  const rounded = Number(n.toFixed(maxFrac));
  return rounded.toLocaleString("en-US", { maximumFractionDigits: maxFrac });
}

/* ---------------- units ---------------- */

type Dim = "length" | "mass" | "volume" | "data" | "time" | "speed" | "area";
const UNITS: Record<string, [Dim, number, string]> = {};
const def = (dim: Dim, factor: number, label: string, ...names: string[]) => names.forEach((n) => (UNITS[n] = [dim, factor, label]));
// length (metres)
def("length", 1e-3, "mm", "mm", "millimeter", "millimeters", "millimetre", "millimetres");
def("length", 1e-2, "cm", "cm", "centimeter", "centimeters", "centimetre", "centimetres");
def("length", 1, "m", "m", "meter", "meters", "metre", "metres");
def("length", 1e3, "km", "km", "kilometer", "kilometers", "kilometre", "kilometres");
def("length", 0.0254, "in", "in", "inch", "inches", '"');
def("length", 0.3048, "ft", "ft", "foot", "feet", "'");
def("length", 0.9144, "yd", "yd", "yard", "yards");
def("length", 1609.344, "mi", "mi", "mile", "miles");
// mass (kg)
def("mass", 1e-3, "g", "g", "gram", "grams");
def("mass", 1, "kg", "kg", "kilo", "kilos", "kilogram", "kilograms");
def("mass", 0.45359237, "lb", "lb", "lbs", "pound", "pounds");
def("mass", 0.028349523125, "oz", "oz", "ounce", "ounces");
def("mass", 1000, "t", "tonne", "tonnes", "ton", "tons");
// volume (litres)
def("volume", 1e-3, "ml", "ml", "milliliter", "milliliters", "millilitre", "millilitres");
def("volume", 1, "L", "l", "liter", "liters", "litre", "litres");
def("volume", 3.785411784, "gal", "gal", "gallon", "gallons");
def("volume", 0.2365882365, "cups", "cup", "cups");
// data (bytes)
def("data", 1, "B", "b", "byte", "bytes");
def("data", 1e3, "KB", "kb", "kilobyte", "kilobytes");
def("data", 1e6, "MB", "mb", "megabyte", "megabytes");
def("data", 1e9, "GB", "gb", "gigabyte", "gigabytes");
def("data", 1e12, "TB", "tb", "terabyte", "terabytes");
def("data", 1024 ** 3, "GiB", "gib");
// time (seconds)
def("time", 1, "s", "s", "sec", "secs", "second", "seconds");
def("time", 60, "min", "min", "mins", "minute", "minutes");
def("time", 3600, "h", "h", "hr", "hrs", "hour", "hours");
def("time", 86400, "days", "day", "days");
def("time", 604800, "weeks", "week", "weeks");
// speed (m/s)
def("speed", 1, "m/s", "m/s");
def("speed", 1000 / 3600, "km/h", "km/h", "kph", "kmh");
def("speed", 1609.344 / 3600, "mph", "mph");
// area (m²)
def("area", 1, "m²", "m2", "sqm", "square meters", "square metres");
def("area", 0.09290304, "sq ft", "sq ft", "sqft", "square feet");
def("area", 4046.8564224, "acres", "acre", "acres");
def("area", 1e4, "ha", "ha", "hectare", "hectares");

const TEMP: Record<string, "c" | "f" | "k"> = { c: "c", "°c": "c", celsius: "c", centigrade: "c", f: "f", "°f": "f", fahrenheit: "f", k: "k", kelvin: "k" };

function convertUnits(t: string): CalcResult | null {
  const m = t.match(/^(?:convert\s+)?(-?[\d.,]+)\s*([a-z°'"/² ]+?)\s+(?:to|in|into|as)\s+([a-z°'"/² ]+)$/);
  if (!m) return null;
  const n = Number(m[1]!.replace(/,/g, ""));
  const from = m[2]!.trim();
  const to = m[3]!.trim();
  if (!Number.isFinite(n)) return null;
  if (TEMP[from] && TEMP[to]) {
    const c = TEMP[from] === "c" ? n : TEMP[from] === "f" ? ((n - 32) * 5) / 9 : n - 273.15;
    const v = TEMP[to] === "c" ? c : TEMP[to] === "f" ? (c * 9) / 5 + 32 : c + 273.15;
    const label = { c: "°C", f: "°F", k: "K" }[TEMP[to]!];
    return { answer: `${fmt(v, 2)} ${label}`, working: `${fmt(n)} ${{ c: "°C", f: "°F", k: "K" }[TEMP[from]!]} → ${label}` };
  }
  const a = UNITS[from];
  const b = UNITS[to];
  if (!a || !b || a[0] !== b[0]) return null;
  const v = (n * a[1]) / b[1];
  return { answer: `${fmt(v, 4)} ${b[2]}`, working: `${fmt(n)} ${a[2]} × ${fmt(a[1] / b[1], 8)} = ${fmt(v, 4)} ${b[2]}` };
}

/* ---------------- dates ---------------- */

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const DAY_MS = 86_400_000;

export function parseDate(s: string, now: number): Date | null {
  const t = s.trim().toLowerCase().replace(/(\d+)(st|nd|rd|th)\b/g, "$1");
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  if (t === "today" || t === "now") return today;
  if (t === "tomorrow") return new Date(today.getTime() + DAY_MS);
  if (t === "yesterday") return new Date(today.getTime() - DAY_MS);
  if (t === "christmas") return parseDate("25 december", now);
  if (t === "new year" || t === "new year's day") return parseDate("1 january", now);
  const iso = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const dm = t.match(/^(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?$/) ?? t.match(/^([a-z]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?$/);
  if (dm) {
    const [day, mon] = /^\d/.test(dm[1]!) ? [Number(dm[1]), dm[2]!] : [Number(dm[2]), dm[1]!];
    const mi = MONTHS.findIndex((x) => x.startsWith(mon.slice(0, 3)));
    if (mi < 0 || day < 1 || day > 31) return null;
    if (dm[3]) return new Date(Number(dm[3]), mi, day);
    const d = new Date(today.getFullYear(), mi, day);
    if (d < today) d.setFullYear(d.getFullYear() + 1); // the next one
    return d;
  }
  const slash = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) return new Date(Number(slash[3]), Number(slash[2]) - 1, Number(slash[1])); // day/month/year
  return null;
}

const longDate = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", year: "numeric" });

function dates(t: string, now: number): CalcResult | null {
  const until = t.match(/^(?:how many )?(days|weeks) (?:until|till|to|before) (.+)$/);
  if (until) {
    const d = parseDate(until[2]!, now);
    if (!d) return null;
    const today = parseDate("today", now)!;
    const days = Math.round((d.getTime() - today.getTime()) / DAY_MS);
    const n = until[1] === "weeks" ? days / 7 : days;
    return { answer: `${fmt(n, 1)} ${until[1]}`, working: `From today to ${longDate(d)}` };
  }
  const between = t.match(/^(?:how many )?(days|weeks) (?:between|from) (.+?) (?:and|to|until) (.+)$/);
  if (between) {
    const a = parseDate(between[2]!, now);
    const b = parseDate(between[3]!, now);
    if (!a || !b) return null;
    const days = Math.abs(Math.round((b.getTime() - a.getTime()) / DAY_MS));
    return { answer: `${fmt(between[1] === "weeks" ? days / 7 : days, 1)} ${between[1]}`, working: `${longDate(a)} → ${longDate(b)}` };
  }
  const offset = t.match(/^(?:what(?:'s| is| will be) (?:the )?(?:date|day) )?(\d+) (days?|weeks?|months?|years?) (from|after|before|ago)(?: (.+))?$/);
  if (offset) {
    const n = Number(offset[1]);
    const unit = offset[2]!.replace(/s$/, "");
    const sign = offset[3] === "before" || offset[3] === "ago" ? -1 : 1;
    const base = offset[4] ? parseDate(offset[4], now) : parseDate("today", now);
    if (!base) return null;
    const d = new Date(base);
    if (unit === "day") d.setDate(d.getDate() + sign * n);
    else if (unit === "week") d.setDate(d.getDate() + sign * 7 * n);
    else if (unit === "month") d.setMonth(d.getMonth() + sign * n);
    else d.setFullYear(d.getFullYear() + sign * n);
    return { answer: longDate(d), working: `${n} ${offset[2]} ${offset[3]} ${offset[4] ?? "today"}` };
  }
  const dow = t.match(/^what day (?:is|was|will be) (.+)$/);
  if (dow) {
    const d = parseDate(dow[1]!, now);
    return d ? { answer: longDate(d), working: dow[1]! } : null;
  }
  return null;
}

/* ---------------- money, stats ---------------- */

const num = (s: string) => Number(s.replace(/[,$€£₦]/g, "").replace(/k$/, "e3"));

function money(t: string): CalcResult | null {
  // Loan / mortgage: monthly payment.
  const loan = t.match(/^(?:monthly )?(?:payment|repayment|installment)s? (?:on|for) (?:a )?([\d.,]+k?) (?:loan )?at ([\d.]+)% (?:interest )?(?:for|over) (\d+) (years?|months?)$/);
  if (loan) {
    const P = num(loan[1]!);
    const r = Number(loan[2]) / 100 / 12;
    const n = Number(loan[3]) * (loan[4]!.startsWith("year") ? 12 : 1);
    const m = r === 0 ? P / n : (P * r) / (1 - (1 + r) ** -n);
    return { answer: `${fmt(m, 2)} a month`, working: `${fmt(P)} at ${loan[2]}% over ${n} months: total ${fmt(m * n, 2)}, interest ${fmt(m * n - P, 2)}` };
  }
  // Tip / discount / tax.
  const tip = t.match(/^(?:a )?([\d.]+)% (tip|discount|tax|vat|off) (?:on|of|for) ([\d.,]+)$/);
  if (tip) {
    const pct = Number(tip[1]) / 100;
    const base = num(tip[3]!);
    const part = base * pct;
    const total = tip[2] === "discount" || tip[2] === "off" ? base - part : base + part;
    return { answer: `${fmt(part, 2)} (total ${fmt(total, 2)})`, working: `${tip[1]}% of ${fmt(base)} = ${fmt(part, 2)}` };
  }
  // X is what percent of Y; percent change.
  const what = t.match(/^([\d.,]+) is what (?:percent|%) of ([\d.,]+)$/);
  if (what) {
    const v = (num(what[1]!) / num(what[2]!)) * 100;
    return { answer: `${fmt(v, 2)}%`, working: `${what[1]} ÷ ${what[2]} × 100` };
  }
  const change = t.match(/^(?:percent(?:age)? change|change) from ([\d.,]+) to ([\d.,]+)$/);
  if (change) {
    const a = num(change[1]!);
    const b = num(change[2]!);
    const v = ((b - a) / a) * 100;
    return { answer: `${v >= 0 ? "+" : ""}${fmt(v, 2)}%`, working: `(${fmt(b)} − ${fmt(a)}) ÷ ${fmt(a)} × 100` };
  }
  const of = t.match(/^([\d.]+)% of ([\d.,]+k?)$/);
  if (of) {
    const v = (Number(of[1]) / 100) * num(of[2]!);
    return { answer: fmt(v, 4), working: `${of[1]}% × ${of[2]}` };
  }
  // Ratios: split 1200 in the ratio 2:3
  const ratio = t.match(/^(?:split|divide) ([\d.,]+) (?:in(?:to)? (?:the )?ratio |by )([\d.:]+)$/);
  if (ratio) {
    const total = num(ratio[1]!);
    const parts = ratio[2]!.split(":").map(Number);
    const sum = parts.reduce((a, b) => a + b, 0);
    if (!sum || parts.some((x) => !Number.isFinite(x))) return null;
    return { answer: parts.map((x) => fmt((total * x) / sum, 2)).join(" : "), working: `${fmt(total)} in parts of ${ratio[2]}` };
  }
  // Currency: only with a rate the user gives.
  const fx = t.match(/^(?:convert )?([\d.,]+k?) ([a-z]{3}) (?:to|in|into) ([a-z]{3})(?: at (?:a rate of )?([\d.,]+))?$/);
  if (fx) {
    if (!fx[4]) return { answer: `ROOK needs an exchange rate for ${fx[2]!.toUpperCase()} → ${fx[3]!.toUpperCase()}. Say “convert ${fx[1]} ${fx[2]} to ${fx[3]} at <rate>”.`, working: "No live rates are fetched without your say-so." };
    const v = num(fx[1]!) * num(fx[4]);
    return { answer: `${fmt(v, 2)} ${fx[3]!.toUpperCase()}`, working: `${fx[1]} ${fx[2]!.toUpperCase()} × ${fx[4]} (the rate you gave)` };
  }
  return null;
}

function stats(t: string): CalcResult | null {
  const m = t.match(/^(average|mean|median|sum|total|max(?:imum)?|min(?:imum)?|range|standard deviation|std ?dev) (?:of )?([\d.,\s-]+(?:and [\d.-]+)?)$/);
  if (!m) return null;
  const xs = m[2]!
    .replace(/\band\b/g, " ")
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  if (xs.length < 2 || xs.some((x) => !Number.isFinite(x))) return null;
  const sum = xs.reduce((a, b) => a + b, 0);
  const mean = sum / xs.length;
  const sorted = [...xs].sort((a, b) => a - b);
  const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
  const sd = Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / xs.length);
  const k = m[1]!;
  const v = k === "average" || k === "mean" ? mean : k === "median" ? median : k === "sum" || k === "total" ? sum : k.startsWith("max") ? sorted.at(-1)! : k.startsWith("min") ? sorted[0]! : k === "range" ? sorted.at(-1)! - sorted[0]! : sd;
  return { answer: fmt(v, 4), working: `${k} of ${xs.length} numbers` };
}

/* ---------------- entry point ---------------- */

/** Answer a calculation, or null when this isn't one ROOK can do with certainty. */
export function calculate(text: string, now = Date.now()): CalcResult | null {
  let t = text.trim().toLowerCase().replace(/[?=]+$/, "").trim();
  t = t.replace(/^(what(?:'s| is)|calculate|compute|work out|how much is|evaluate|solve)\s+/, "").replace(/^the\s+/, "");
  if (!t) return null;
  const r = convertUnits(t) ?? dates(t, now) ?? money(t) ?? stats(t);
  if (r) return r;
  // A bare expression: must contain an operator or function, not just a number.
  if (!/[\d)]\s*[-+*/^x×÷%]|sqrt|\bplus\b|\bminus\b|\btimes\b|divided by|\bof\b/.test(t)) return null;
  const v = evaluate(t.replace(/(\d)\s*% of\s*/g, "$1% * "));
  return v === null ? null : { answer: fmt(v), working: text.trim().replace(/[?=]+$/, "") };
}
