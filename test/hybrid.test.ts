import assert from "node:assert/strict";
import { test } from "node:test";
import { decide, promptFor } from "../src/router.ts";
import { describeCounts, shieldFound, shieldPatterns, unshield } from "../src/shield.ts";

const auto = { mode: "auto" as const, hasImage: false, deviceReady: true };

test("the router picks the cheapest place that can do the job", () => {
  const calc = decide("15% of 84,500", auto);
  assert.equal(calc.route, "instant");
  assert.ok(calc.answer && calc.answer.length > 0);
  assert.equal(decide("Rewrite this to sound friendlier", auto).route, "device");
  assert.equal(decide("/research latest Firebase news", auto).route, "research");
  assert.equal(decide("compare Paystack and Flutterwave fees", auto).route, "research");
  assert.equal(decide("x".repeat(7000), auto).route, "cloud");
  assert.equal(decide("hello", { ...auto, mode: "cloud" }).route, "cloud");
  const priv = decide("/research latest news", { ...auto, mode: "private" });
  assert.equal(priv.route, "device");
  assert.ok(priv.deviceOnly, "private mode never leaves the device, even for research");
  assert.match(decide("hi", { ...auto, deviceReady: false }).reason, /cloud fallback/);
  assert.equal(decide("15% of 200", { ...auto, hasImage: true }).route, "device", "an image always needs a model");
  assert.equal(promptFor("/research best laptops"), "best laptops");
});

test("the shield hides personal details and puts them back", () => {
  const s = shieldPatterns("Email tolu.adeyemi@gmail.com or call +234 803 123 4567, account 0123456789, card 4111 1111 1111 1111.");
  assert.doesNotMatch(s.text, /tolu\.adeyemi|803 123|0123456789|4111/);
  assert.match(s.text, /\[EMAIL_1\]/);
  assert.match(s.text, /\[PHONE_1\]/);
  assert.match(s.text, /\[ACCOUNT_1\]/);
  assert.match(s.text, /\[CARD_1\]/);
  const named = shieldFound(s, { names: ["Tolu Adeyemi", "Tolu", "Nobody Here"], addresses: [] });
  assert.equal(named.vault.size, 4, "names not in the text are ignored");
  const withName = shieldFound(shieldPatterns("Hi Tolu Adeyemi, meet at 12 Ahmadu Bello Way."), { names: ["Tolu Adeyemi"], addresses: ["12 Ahmadu Bello Way"] });
  assert.equal(withName.text, "Hi [NAME_1], meet at [ADDRESS_1].");
  assert.equal(unshield("Dear [NAME_1], see you at [ADDRESS_1].", withName.vault), "Dear Tolu Adeyemi, see you at 12 Ahmadu Bello Way.");
  assert.equal(describeCounts(s.counts), "1 email, 1 card number, 1 phone number, 1 account number");
});

test("the same value gets the same placeholder across turns", () => {
  const a = shieldPatterns("write to ada@x.com");
  const b = shieldPatterns("and cc ada@x.com and bob@y.org", a);
  assert.equal(b.text, "and cc [EMAIL_1] and [EMAIL_2]");
});
