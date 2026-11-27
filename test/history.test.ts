import assert from "node:assert/strict";
import { test } from "node:test";
import * as h from "../src/history.ts";

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}
const msg = (role: "user" | "rook", text: string, extra = {}) => ({ id: Math.random().toString(36), role, text, ...extra });

test("chats are saved on the device, newest first, and can be reopened and deleted", () => {
  const kv = memory();
  h.save(kv, "a", [msg("user", "/research Paystack vs Flutterwave fees"), msg("rook", "…")], 1000);
  h.save(kv, "b", [msg("user", "15% of 84,500"), msg("rook", "12,675")], 2000);
  let list = h.load(kv);
  assert.deepEqual(list.map((c) => c.id), ["b", "a"]);
  assert.equal(list[1]!.title, "Paystack vs Flutterwave fees", "the /research command isn't part of the title");
  h.save(kv, "a", [msg("user", "/research Paystack vs Flutterwave fees"), msg("rook", "…"), msg("user", "and for Kenya?")], 3000);
  list = h.load(kv);
  assert.deepEqual(list.map((c) => c.id), ["a", "b"], "updating a chat moves it to the top, without duplicating it");
  assert.equal(list[0]!.messages.length, 3);
  assert.deepEqual(h.remove(kv, "a").map((c) => c.id), ["b"]);
  h.clearAll(kv);
  assert.deepEqual(h.load(kv), []);
});

test("turning saving off deletes what was saved; big pictures aren't kept", () => {
  const kv = memory();
  h.save(kv, "a", [msg("user", "hi", { image: { mimeType: "image/jpeg", data: "x".repeat(500_000) } }), msg("rook", "hello")]);
  assert.equal(h.load(kv)[0]!.messages[0]!.image, undefined);
  assert.equal(h.load(kv)[0]!.title, "hi");
  assert.equal(h.isOn(kv), true);
  h.setOn(kv, false);
  assert.equal(h.isOn(kv), false);
  assert.deepEqual(h.load(kv), []);
});

test("broken or missing storage never breaks ROOK", () => {
  const kv = memory();
  kv.setItem("rook.chrome.history.v1", "{not json");
  assert.deepEqual(h.load(kv), []);
  assert.equal(h.titleFor([msg("user", "x".repeat(100))]).length, 58);
  assert.equal(h.when(Date.now() - 3 * 60_000), "3 min ago");
});
