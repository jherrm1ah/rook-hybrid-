/**
 * Saved conversations, kept ONLY on this device (the browser's local storage):
 * nothing about your history is sent to the cloud. Like the Privacy Shield,
 * the real personal details stay here.
 *
 * Pure functions take a Storage-like object, so they're testable.
 */

export interface SavedMessage {
  id: string;
  role: "user" | "rook";
  text: string;
  image?: { mimeType: "image/jpeg" | "image/png"; data: string };
  route?: string;
  where?: string;
  reason?: string;
  shielded?: string;
  sources?: { title: string; uri: string }[];
  summary?: string;
  error?: string;
  ms?: number;
  trail?: string[];
  cloudSaw?: string;
  youWrote?: string;
  draft?: string;
  confidence?: number;
}

export interface Conversation {
  id: string;
  title: string;
  updatedAt: number;
  messages: SavedMessage[];
}

interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const KEY = "rook.chrome.history.v1";
const ON_KEY = "rook.chrome.history.on";
export const MAX_CONVERSATIONS = 50;
const MAX_MESSAGES = 200;
/** Pictures bigger than this aren't kept in history (they'd fill the browser's storage). */
const MAX_IMAGE_CHARS = 400_000;

export function titleFor(messages: SavedMessage[]): string {
  const first = messages.find((m) => m.role === "user" && m.text.trim());
  const text = first?.text.trim().replace(/^\/research\s*/i, "").replace(/\s+/g, " ") ?? (messages.some((m) => m.image) ? "Screen or image" : "New chat");
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

export function load(kv: KV): Conversation[] {
  try {
    const raw = kv.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as Conversation[]) : [];
    return Array.isArray(list) ? list.filter((c) => c && typeof c.id === "string" && Array.isArray(c.messages)) : [];
  } catch {
    return [];
  }
}

function write(kv: KV, list: Conversation[]): Conversation[] {
  let keep = list.slice(0, MAX_CONVERSATIONS);
  // If storage is full, drop the oldest conversations until it fits.
  while (keep.length) {
    try {
      kv.setItem(KEY, JSON.stringify(keep));
      return keep;
    } catch {
      keep = keep.slice(0, -1);
    }
  }
  kv.removeItem(KEY);
  return [];
}

/** Saves (or updates) one conversation, newest first. Messages still being written aren't saved. */
export function save(kv: KV, id: string, messages: SavedMessage[], now = Date.now()): Conversation[] {
  const clean = messages.slice(-MAX_MESSAGES).map((m) => {
    const { image, ...rest } = m;
    return image && image.data.length <= MAX_IMAGE_CHARS ? { ...rest, image } : rest;
  });
  const others = load(kv).filter((c) => c.id !== id);
  if (!clean.length) return write(kv, others);
  return write(kv, [{ id, title: titleFor(clean), updatedAt: now, messages: clean }, ...others]);
}

export function remove(kv: KV, id: string): Conversation[] {
  return write(kv, load(kv).filter((c) => c.id !== id));
}

export function clearAll(kv: KV): void {
  kv.removeItem(KEY);
}

export function isOn(kv: KV): boolean {
  return kv.getItem(ON_KEY) !== "off";
}

export function setOn(kv: KV, on: boolean): void {
  kv.setItem(ON_KEY, on ? "on" : "off");
  if (!on) clearAll(kv);
}

export function when(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
