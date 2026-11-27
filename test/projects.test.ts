import assert from "node:assert/strict";
import { test } from "node:test";
import * as projects from "../src/projects.ts";

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

test("projects are kept on the device and add their notes to questions", () => {
  const kv = mem();
  const { project } = projects.create(kv, "  Shop invoices ");
  assert.equal(project.name, "Shop invoices");
  projects.update(kv, project.id, { notes: "Prices in naira. Friendly tone." });
  projects.setCurrent(kv, project.id);
  const p = projects.load(kv)[0];
  assert.equal(projects.withContext(p, "Draft a reminder"), "[Project: Shop invoices. Notes: Prices in naira. Friendly tone.]\n\nDraft a reminder");
  assert.equal(projects.withContext(undefined, "hi"), "hi");
  projects.remove(kv, project.id);
  assert.equal(projects.load(kv).length, 0);
  assert.equal(projects.currentId(kv), null);
});
