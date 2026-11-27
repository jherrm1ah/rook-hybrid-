/**
 * Speak instead of typing: Chrome's speech recognition, on the device when
 * Chrome can (processLocally), otherwise Chrome's own speech service.
 */
type Rec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  processLocally?: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
};
type RecCtor = (new () => Rec) & { available?: (o: unknown) => Promise<string> };

const ctor = (): RecCtor | undefined => {
  const g = globalThis as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
  return g.SpeechRecognition ?? g.webkitSpeechRecognition;
};

export const canListen = () => Boolean(ctor());

/** Starts listening; calls onText with everything heard so far. Returns a stop function. */
export async function listen(onText: (text: string) => void, onEnd: (error?: string) => void): Promise<() => void> {
  const C = ctor();
  if (!C) throw new Error("This browser can't listen.");
  const rec = new C();
  rec.lang = navigator.language || "en-US";
  rec.interimResults = true;
  rec.continuous = true;
  try {
    if (C.available && (await C.available({ langs: [rec.lang], processLocally: true })) === "available") rec.processLocally = true;
  } catch {
    /* on-device speech isn't offered here */
  }
  rec.onresult = (e) => {
    let text = "";
    for (let i = 0; i < e.results.length; i++) text += e.results[i]![0]!.transcript;
    onText(text.trim());
  };
  rec.onerror = (e) => onEnd(e.error === "not-allowed" ? "Microphone access was blocked." : e.error === "no-speech" ? undefined : e.error);
  rec.onend = () => onEnd();
  rec.start();
  return () => rec.stop();
}
