import assert from "node:assert/strict";
import { test } from "node:test";
import { CONFIDENCE_THRESHOLD, improvePrompt, parseGrade, shouldEscalate, tokensIn } from "../src/router.ts";

const net = { online: true, deviceOnly: false };

test("the device's self-check decides when the cloud is needed", () => {
  assert.equal(shouldEscalate({ confidence: 90, needsCloud: false, reason: "" }, net), false);
  assert.equal(shouldEscalate({ confidence: CONFIDENCE_THRESHOLD - 1, needsCloud: false, reason: "" }, net), true);
  assert.equal(shouldEscalate({ confidence: 95, needsCloud: true, reason: "needs fresh facts" }, net), true);
  // Never when the cloud is off-limits.
  assert.equal(shouldEscalate({ confidence: 10, needsCloud: true, reason: "" }, { online: false, deviceOnly: false }), false);
  assert.equal(shouldEscalate({ confidence: 10, needsCloud: true, reason: "" }, { online: true, deviceOnly: true }), false);
});

test("grades are read safely, whatever the device returns", () => {
  assert.deepEqual(parseGrade('{"confidence": 42, "needs_cloud": true, "reason": "maths"}'), { confidence: 42, needsCloud: true, reason: "maths" });
  assert.equal(parseGrade('{"confidence": 250}').confidence, 100);
  assert.equal(parseGrade("not json").confidence, 50);
  assert.equal(parseGrade('{"confidence": "high"}').confidence, 50);
});

test("savings and the improve prompt", () => {
  assert.equal(tokensIn("abcdefgh"), 2);
  assert.match(improvePrompt("[EMAIL_1] draft"), /\[EMAIL_1\] draft/);
});
