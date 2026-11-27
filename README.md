# ROOK for Chrome: thinks on your device first

**#BuildHybridAI 2026 entry.** ROOK is an AI assistant by Orynthra Labs that turns what you want into finished work.
ROOK for Chrome answers on your own computer with **Gemini Nano** whenever it can, reaches for **Gemini in the
cloud** only when a task needs it, and **hides your personal details on the device** before anything goes to the cloud.
All AI runs through **Firebase AI Logic** hybrid inference.

## How the hybrid works

Every request is routed to the cheapest place that can do it well, and each answer shows where it ran
(the badge comes from the SDK's `inferenceSource`, never guessed):

| Route | When | How |
|---|---|---|
| ◆ **Instant**: no AI | Maths, percentages, units, dates, money | ROOK's own on-device engine (`calculate`, shared with the ROOK desktop app) |
| ⚡ **On your device** | Everyday requests, rewriting, explaining a shared screen | `getGenerativeModel(ai, { mode: InferenceMode.PREFER_ON_DEVICE, … })`: Gemini Nano via Chrome's Prompt API; falls back to the cloud automatically |
| 🔒 **Private mode** | You choose "Private" | `InferenceMode.ONLY_ON_DEVICE`: never leaves the device, works offline |
| ☁ **Cloud** | Long inputs (> 6,000 characters) or you choose "Cloud" | `InferenceMode.PREFER_IN_CLOUD` |
| ☁ **Research** | "latest…", "compare … vs …", `/research …` | Cloud Gemini with **Google Search grounding**; sources shown as cards; then **Gemini Nano writes the summary card on the device** |

### Privacy Shield (hybrid in both directions)

Before any request that may reach the cloud, ROOK:

1. Swaps emails, phone numbers, card numbers (Luhn-checked), bank account numbers and IBANs for placeholders
   such as `[EMAIL_1]`: instantly, with patterns.
2. Asks **Gemini Nano, on the device** (`ONLY_ON_DEVICE` with a JSON `responseConstraint`) to find people's
   names and street addresses, and swaps those too.
3. Sends only the placeholders to the cloud, then **puts the real details back into the answer on the device**.

The cloud model writes "Dear [NAME_1]…"; you read "Dear Tolu…". The answer card says what was hidden.

## Features

- **Self-check (the device grades itself)**: in Auto, Gemini Nano answers, then scores its own answer (0–100, a constrained JSON reply, on the device). Sure enough → done, no cloud call. Unsure → the Privacy Shield cleans the question *and* the draft, and the cloud model improves it. The device's first answer stays one tap away. There is also a manual **☁ Ask the cloud to improve this** button.
- **👁 What the cloud saw**: every cloud answer opens a side-by-side X-ray: what you wrote vs. exactly what the cloud received, with the shield's placeholders highlighted.
- **Route trail + savings meter**: each answer shows the path it took (⚡ Nano 84 ms → 🔍 34% sure → 🛡 hid 1 email → ☁ improved 1.1 s). The footer counts cloud calls avoided and roughly how many tokens never left the device.
- **Offline mode**: lose your connection and ROOK keeps thinking on the device ("You're offline. Still thinking on your device").

- Chat with streaming answers, multi-turn context (last 8 turns).
- **Look at my screen**: share a screen or window (Chrome asks first); ROOK takes one picture and explains it.
  Images are sent as JPEG, which Gemini Nano accepts on the device.
- Paste or attach images.
- Mode switch: **Auto / Private / Cloud**; **Shield on/off**.
- On-device model status, with a one-click **Get on-device model** download (`initializeDeviceModel` with progress).
- **Saved chats, on this device only**: History panel (open, delete, delete all), New chat, and an on/off switch.
  Chats live in the browser's storage; nothing about your history is sent to the cloud.
- Session counter: how many answers were instant, on-device or in the cloud, and how many details stayed private.
- **App Check** (reCAPTCHA Enterprise; debug tokens for local testing) on every call.

## Run it

```bash
npm install
npm run dev        # http://localhost:5180 (uses the rook-hybrid Firebase project in .env.development)
```

To use your own Firebase project, put its web app config in `.env.local` (see `.env.example`).

Firebase console setup:
1. Create a project → **AI Services → AI Logic → Get started** → Gemini Developer API.
2. **Project settings → Your apps → Web**: copy the config into `.env`.
3. **App Check**: register the web app with reCAPTCHA Enterprise (put the site key in `.env`). For local testing,
   add a debug token under **App Check → Manage debug tokens** and set `VITE_APPCHECK_DEBUG_TOKEN`.

On-device inference needs a desktop Chrome with built-in AI (Gemini Nano) available. Check
`chrome://on-device-internals`. In other browsers ROOK uses the cloud for everything except instant answers,
and says so in the top bar.

Live: **https://jherrm1ah.github.io/rook-hybrid-/** (GitHub Pages, published on every push to `main`).
Firebase Hosting is also configured (`firebase.json`): `npm run build && npx firebase-tools deploy --only hosting`.

## Tests

```bash
npm test
```

Covers the router (which route, and why) and the Privacy Shield (hiding, consistent placeholders across turns,
putting details back).

## Code map

- `src/router.ts`: the routing decision (pure, tested)
- `src/shield.ts`: Privacy Shield patterns, placeholders and restore (pure, tested)
- `src/ai.ts`: Firebase app, App Check, and the four Firebase AI Logic models (hybrid / device / cloud / research)
- `src/history.ts`: saved chats on the device (pure, tested)
- `src/App.tsx`: the interface
- `src/vendor/`: shared with the ROOK desktop app (its instant on-device calculator and the ROOK symbol)

ROOK for Chrome is the web member of the ROOK family; the ROOK desktop app (Windows/Linux) shares its
local-first design: answer locally when possible, use the cloud only when needed.
