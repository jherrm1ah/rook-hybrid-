import assert from "node:assert/strict";
import { test } from "node:test";
import { cardsFromAnswer, cardText } from "../src/cards.ts";

const answer = `### Overview
Mobile POS terminals are the easiest way to start.

### Key findings
- **Moniepoint** and OPay are popular.
- Bank POS support can be slow.

### Comparison
| Option | Fee |
|---|---|
| mPOS | 0.5% |
| QR | Free |

### Recommendations
1. Get two terminals.
2. Show your account number.`;

test("result cards come only from what the research answer contains", () => {
  const cards = cardsFromAnswer("m1", answer, [{ title: "cbn.gov.ng", uri: "https://x" }]);
  assert.deepEqual(cards.map((c) => c.kind), ["sources", "summary", "findings", "data", "steps"]);
  assert.equal(cards[1]!.items[0], "Mobile POS terminals are the easiest way to start.");
  assert.deepEqual(cards[2]!.items, ["Moniepoint and OPay are popular.", "Bank POS support can be slow."]);
  assert.deepEqual(cards[3]!.table, { head: ["Option", "Fee"], rows: [["mPOS", "0.5%"], ["QR", "Free"]] });
  assert.equal(cards[4]!.anchor, "Recommendations");
  assert.match(cardText(cards[4]!), /- Get two terminals\./);
  // A device summary wins over the overview, and plain answers make no cards.
  assert.equal(cardsFromAnswer("m2", answer, [], "• One\n• Two")[0]!.onDevice, true);
  assert.equal(cardsFromAnswer("m3", "Just a short answer.").length, 0);
});
