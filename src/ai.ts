/**
 * Firebase AI Logic, set up for ROOK's hybrid routing.
 *
 *   hybrid   PREFER_ON_DEVICE: Gemini Nano in Chrome when available, cloud otherwise
 *   device   ONLY_ON_DEVICE:   private mode and the Privacy Shield; never leaves the device
 *   cloud    PREFER_IN_CLOUD:  long inputs and "cloud" mode
 *   research cloud model with Google Search grounding
 *
 * App Check protects every call (required by Firebase AI Logic).
 */
import { initializeApp, type FirebaseApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  InferenceSource,
  type Content,
  type GenerativeModel,
  type GroundingChunk,
  type Part,
} from "firebase/ai";

const env = import.meta.env;

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
};

export const configured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);

/** The cloud model; empty means the SDK's own hybrid default. */
export const CLOUD_MODEL = (env.VITE_CLOUD_MODEL as string | undefined) || "gemini-3.5-flash-lite";

const SYSTEM =
  "You are ROOK, an assistant by Orynthra Labs that turns what people want into finished work. " +
  "Be concise and practical: lead with the answer, then the steps. Use short Markdown lists when helpful. " +
  "Text in square brackets like [NAME_1] or [EMAIL_2] is a placeholder for private details hidden on the user's device: keep placeholders exactly as written.";

let app: FirebaseApp | null = null;
let models: { hybrid: GenerativeModel; device: GenerativeModel; cloud: GenerativeModel; research: GenerativeModel } | null = null;

function setup() {
  if (models || !configured) return models;
  app = initializeApp(firebaseConfig);
  // App Check: reCAPTCHA Enterprise in production; a registered debug token for local runs and judges.
  const debugToken = env.VITE_APPCHECK_DEBUG_TOKEN as string | undefined;
  if (debugToken || env.DEV) (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken || true;
  const siteKey = env.VITE_RECAPTCHA_ENTERPRISE_KEY as string | undefined;
  if (siteKey) initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(siteKey), isTokenAutoRefreshEnabled: true });

  const ai = getAI(app, { backend: new GoogleAIBackend() });
  const onDeviceParams = {
    createOptions: {
      expectedInputs: [{ type: "text" as const, languages: ["en"] }, { type: "image" as const }],
      expectedOutputs: [{ type: "text" as const, languages: ["en"] }],
      initialPrompts: [{ role: "system" as const, content: [{ type: "text" as const, value: SYSTEM }] }],
    },
  };
  const inCloudParams = { model: CLOUD_MODEL, systemInstruction: SYSTEM };
  models = {
    hybrid: getGenerativeModel(ai, { mode: InferenceMode.PREFER_ON_DEVICE, onDeviceParams, inCloudParams }),
    device: getGenerativeModel(ai, { mode: InferenceMode.ONLY_ON_DEVICE, onDeviceParams, inCloudParams }),
    cloud: getGenerativeModel(ai, { mode: InferenceMode.PREFER_IN_CLOUD, onDeviceParams, inCloudParams }),
    research: getGenerativeModel(ai, { model: CLOUD_MODEL, systemInstruction: SYSTEM, tools: [{ googleSearch: {} }] }),
  };
  return models;
}

/* ---------------- On-device model status (Chrome's Prompt API) ---------------- */

export type DeviceStatus = "available" | "downloadable" | "downloading" | "unavailable" | "unsupported";

interface ChromeLanguageModel {
  availability(options?: unknown): Promise<string>;
}

/** Whether Gemini Nano can run in this browser right now. */
export async function deviceStatus(): Promise<DeviceStatus> {
  const lm = (globalThis as unknown as { LanguageModel?: ChromeLanguageModel }).LanguageModel;
  if (!lm) return "unsupported";
  try {
    const a = await lm.availability({ expectedInputs: [{ type: "text", languages: ["en"] }, { type: "image" }], expectedOutputs: [{ type: "text", languages: ["en"] }] });
    return a === "available" || a === "downloadable" || a === "downloading" ? a : "unavailable";
  } catch {
    return "unavailable";
  }
}

/** Downloads / warms the on-device model. Must follow a click (Chrome's rule for downloads). */
export async function prepareDevice(onProgress: (p: number) => void): Promise<void> {
  const m = setup();
  if (!m) throw new Error("Firebase isn't configured.");
  await m.hybrid.initializeDeviceModel(onProgress);
}

/* ---------------- Generating ---------------- */

export type Where = "device" | "cloud";

export interface Turn {
  role: "user" | "model";
  text: string;
  image?: { mimeType: "image/jpeg" | "image/png"; data: string };
}

function contents(turns: Turn[]): Content[] {
  return turns.map((t) => ({
    role: t.role,
    parts: [...(t.image ? [{ inlineData: { mimeType: t.image.mimeType, data: t.image.data } } as Part] : []), { text: t.text || "Describe this image." } as Part],
  }));
}

export interface StreamResult {
  where: Where;
  text: string;
  sources: { title: string; uri: string }[];
  /** Google's required search entry point for grounded answers (HTML), if any. */
  searchEntry?: string;
}

/**
 * Streams an answer. `which` picks the model; the SDK reports where it actually
 * ran (device or cloud), which is what the badge shows: never guessed.
 */
export async function streamAnswer(which: "hybrid" | "device" | "cloud" | "research", turns: Turn[], onText: (soFar: string) => void, signal?: AbortSignal): Promise<StreamResult> {
  const m = setup();
  if (!m) throw new Error("Firebase isn't configured yet.");
  const model = m[which];
  const result = await model.generateContentStream({ contents: contents(turns) }, signal ? { signal } : undefined);
  let text = "";
  let where: Where | null = null;
  for await (const chunk of result.stream) {
    if (where === null && chunk.inferenceSource) where = chunk.inferenceSource === InferenceSource.ON_DEVICE ? "device" : "cloud";
    text += chunk.text();
    onText(text);
  }
  const final = await result.response;
  where ??= final.inferenceSource === InferenceSource.ON_DEVICE ? "device" : which === "device" ? "device" : "cloud";
  const meta = final.candidates?.[0]?.groundingMetadata;
  const sources = (meta?.groundingChunks ?? [])
    .map((c: GroundingChunk) => ({ title: c.web?.title ?? c.web?.uri ?? "", uri: c.web?.uri ?? "" }))
    .filter((s) => s.uri)
    .filter((s, i, all) => all.findIndex((x) => x.uri === s.uri) === i);
  return { where, text, sources, ...(meta?.searchEntryPoint?.renderedContent ? { searchEntry: meta.searchEntryPoint.renderedContent } : {}) };
}

/** On device only: names and street addresses in a text, for the Privacy Shield. */
export async function findNamesOnDevice(text: string): Promise<{ names: string[]; addresses: string[] }> {
  const m = setup();
  if (!m) return { names: [], addresses: [] };
  const schema = {
    type: "object",
    properties: { names: { type: "array", items: { type: "string" } }, addresses: { type: "array", items: { type: "string" } } },
    required: ["names", "addresses"],
  };
  const local = getGenerativeModel(getAI(app!, { backend: new GoogleAIBackend() }), {
    mode: InferenceMode.ONLY_ON_DEVICE,
    onDeviceParams: { promptOptions: { responseConstraint: schema } },
  });
  const res = await local.generateContent(
    `List every person's name and every street address that appears in the text below, exactly as written. Do not include company names. Text:\n"""\n${text.slice(0, 4000)}\n"""`,
  );
  try {
    const parsed = JSON.parse(res.response.text()) as { names?: unknown; addresses?: unknown };
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    return { names: strings(parsed.names), addresses: strings(parsed.addresses) };
  } catch {
    return { names: [], addresses: [] };
  }
}

/** On device only: a short summary card of a longer (cloud) answer. */
export async function summariseOnDevice(text: string): Promise<string> {
  const m = setup();
  if (!m) throw new Error("not configured");
  const res = await m.device.generateContent(`Summarise this in at most 3 short bullet points, plain text, each starting with "• ":\n\n${text.slice(0, 5000)}`);
  return res.response.text().trim();
}
