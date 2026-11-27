# Devpost write-up: ROOK for Chrome

Copy each section into the matching box on Devpost.

---

## Project name

ROOK for Chrome

## Tagline (short)

Thinks on your device first. Calls the cloud only when it's unsure, and hides your personal details before it does.

---

## Inspiration

Most AI assistants send everything to the cloud: the names, emails and phone numbers of the people you work with, and every small question, even ones a model on your own computer could answer. For small businesses in places like Nigeria, that means paying for every request, needing a strong connection, and trusting a server with customers' private details.

We wanted an assistant that behaves like a careful person: handle what you can yourself, ask for help only when you're unsure, and never share more than you need to.

## What it does

ROOK for Chrome is an AI assistant that runs Gemini Nano inside Chrome and uses the cloud only when needed.

- **Device first.** Everyday requests are answered on the device by Gemini Nano: private, fast and free. Simple calculations are answered instantly without any AI.
- **Self-check.** After answering, Gemini Nano grades its own answer on the device. If it is confident, the cloud is never called. If it is unsure (fresh facts, expert topics, hard reasoning), ROOK asks the cloud model to improve the answer, and you can still see the device's first answer.
- **Privacy Shield.** Before anything goes to the cloud, ROOK replaces emails, phone numbers, card and account numbers on the device, and Gemini Nano finds people's names and addresses. The cloud sees placeholders like [NAME_1]; ROOK puts the real details back into the answer locally.
- **What the cloud saw.** Every cloud answer can show, side by side, what you wrote and exactly what the cloud received. Privacy you can check, not just a promise.
- **How.** Each answer shows the route it took: device, self-check score, shield, cloud, and how long each step took.
- **Offline.** If the connection drops, ROOK keeps answering on the device.
- **Research.** Questions that need the live web use the cloud model with Google Search grounding, with sources, and Gemini Nano writes a short summary card on the device.
- **Look.** Share a window and ROOK explains what's on it; a scan line shows exactly what it captured.
- **The living ROOK.** The ROOK bird moves the way ROOK is working (thinking, checking, guarding your details, drafting), so you always know what's happening without reading status text.
- **Speak instead of typing**, using Chrome's on-device speech recognition when it's available.
- **Saved chats, on this device only.** History never leaves the browser.
- Three modes: Auto, Private (never leaves the device) and Cloud.

## How we built it

- **Firebase AI Logic hybrid inference** (Firebase JS SDK, `firebase/ai`) with several models from one setup:
  - `PREFER_ON_DEVICE` for everyday answers, falling back to the cloud when Gemini Nano isn't available
  - `ONLY_ON_DEVICE` for Private mode, the self-check grader and the shield's name finder
  - `PREFER_IN_CLOUD` for long inputs and for improving answers the device wasn't sure about
  - the cloud model with Google Search grounding for research
- **Structured output on the device.** The self-check and the name finder use Gemini Nano with a JSON `responseConstraint`, so the device returns a reliable confidence score and lists of names.
- **`inferenceSource`** from the SDK tells us where each answer actually ran, so the badge is never a guess.
- **Firebase App Check** with reCAPTCHA Enterprise protects every call.
- React, TypeScript and Vite; hosted on GitHub Pages; tests with Node's test runner; GitHub Actions for checks and publishing.

## Challenges we ran into

- Deciding when a small model's answer is good enough. We made Gemini Nano grade itself with a strict rubric and a constrained JSON reply, and tuned the threshold so it escalates for fresh facts and expert topics but not for everyday writing.
- Keeping privacy intact during escalation: the device's draft answer also goes to the cloud for improvement, so the shield cleans it with the same placeholders as the question.
- Telling phone numbers apart from card numbers (we added a Luhn check).
- Handling the cloud failing gracefully: ROOK retries once, then keeps the on-device answer instead of showing an error.

## Accomplishments that we're proud of

- The "What the cloud saw" view: anyone can verify that their private details never left the device.
- An assistant that keeps working with no internet at all.
- Every answer is honest about where it ran and why.

## What we learned

Hybrid AI is not only "device or cloud". The most useful pattern is a conversation between them: the device drafts, judges itself, protects your data, and asks the cloud for help only when it's needed.

## What's next for ROOK for Chrome

- Learning from you: when you press Improve, ROOK adjusts how confident the device needs to be.
- Shield for documents and images, not just text.
- Bringing the same device-first approach to the ROOK desktop app.

## Built with

firebase, firebase-ai-logic, gemini-nano, gemini, chrome-built-in-ai, firebase-app-check, recaptcha-enterprise, google-search-grounding, react, typescript, vite, github-pages

## Links

- Try it: https://jherrm1ah.github.io/rook-hybrid-/
- Code: https://github.com/jherrm1ah/rook-hybrid-

## Note for judges

Best in desktop Chrome with Gemini Nano available. Without it, ROOK still works through the cloud. To check whether your Chrome has Gemini Nano, open chrome://on-device-internals.
