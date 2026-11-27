import { useCallback, useEffect, useRef, useState } from "react";
import { CLOUD_MODEL, configured, deviceStatus, findNamesOnDevice, prepareDevice, streamAnswer, summariseOnDevice, type DeviceStatus, type Turn, type Where } from "./ai";
import { Markdown } from "./Markdown";
import { decide, promptFor, type Mode, type Route } from "./router";
import { describeCounts, shieldFound, shieldPatterns, unshield, type Shielded } from "./shield";
import { ROOK_SYMBOL } from "./vendor/symbol.ts";

interface Msg {
  id: string;
  role: "user" | "rook";
  text: string;
  image?: Turn["image"];
  route?: Route;
  where?: Where | "instant";
  reason?: string;
  shielded?: string;
  sources?: { title: string; uri: string }[];
  searchEntry?: string;
  summary?: string;
  summaryWhere?: Where;
  pending?: boolean;
  error?: string;
  ms?: number;
}

const uid = () => Math.random().toString(36).slice(2, 10);

const EXAMPLES = [
  { label: "15% of 84,500", hint: "Instant · no AI" },
  { label: "Rewrite this to sound friendlier: send me the invoice today", hint: "On your device" },
  { label: "Draft a reply to tolu.adeyemi@gmail.com confirming 40 units, call me on 0803 123 4567", hint: "Shielded if it goes to the cloud" },
  { label: "/research latest Firebase AI Logic hybrid inference features", hint: "Cloud + Google Search" },
];

function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 160 160" aria-hidden="true">
      <rect width="160" height="160" rx="38" fill="var(--ink)" />
      <g transform="translate(31 31) scale(0.98)">
        <path fill="#fff" d={ROOK_SYMBOL} />
      </g>
    </svg>
  );
}

function Badge({ where, route }: { where: Msg["where"]; route?: Route | undefined }) {
  if (where === "instant") return <span className="badge badge--instant">◆ Instant · no AI</span>;
  if (where === "device") return <span className="badge badge--device">⚡ On your device · Gemini Nano</span>;
  if (where === "cloud") return <span className="badge badge--cloud">☁ Cloud · {CLOUD_MODEL}{route === "research" ? " + Google Search" : ""}</span>;
  return null;
}

/** One frame of a screen the user picks to share (Chrome asks them first). */
async function captureScreen(): Promise<Turn["image"]> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  try {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    await new Promise((r) => setTimeout(r, 300));
    return toJpeg(video, video.videoWidth, video.videoHeight);
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

function toJpeg(src: CanvasImageSource, w: number, h: number): Turn["image"] {
  const scale = Math.min(1, 1280 / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext("2d")!.drawImage(src, 0, 0, canvas.width, canvas.height);
  return { mimeType: "image/jpeg", data: canvas.toDataURL("image/jpeg", 0.82).split(",")[1] ?? "" };
}

async function fileToJpeg(file: File): Promise<Turn["image"]> {
  const bmp = await createImageBitmap(file);
  return toJpeg(bmp, bmp.width, bmp.height);
}

export function App() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [image, setImage] = useState<Turn["image"]>();
  const [mode, setMode] = useState<Mode>("auto");
  const [shieldOn, setShieldOn] = useState(true);
  const [status, setStatus] = useState<DeviceStatus>("unsupported");
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState({ instant: 0, device: 0, cloud: 0, hidden: 0 });
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void deviceStatus().then(setStatus);
  }, []);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs]);

  const patch = (id: string, p: Partial<Msg>) => setMsgs((list) => list.map((m) => (m.id === id ? { ...m, ...p } : m)));

  const prepare = async () => {
    setProgress(0);
    try {
      await prepareDevice((p) => setProgress(p));
      setStatus(await deviceStatus());
    } catch (e) {
      alert(`The on-device model couldn't be prepared: ${(e as Error).message}`);
    } finally {
      setProgress(null);
    }
  };

  const send = useCallback(
    async (raw?: string) => {
      const text = (raw ?? input).trim();
      if ((!text && !image) || busy) return;
      const deviceReady = status === "available";
      const d = decide(text, { mode, hasImage: Boolean(image), deviceReady });
      const user: Msg = { id: uid(), role: "user", text, ...(image ? { image } : {}) };
      const reply: Msg = { id: uid(), role: "rook", text: "", route: d.route, reason: d.reason, pending: true };
      setMsgs((list) => [...list, user, reply]);
      setInput("");
      setImage(undefined);
      const started = performance.now();

      if (d.route === "instant") {
        patch(reply.id, { text: d.answer ?? "", where: "instant", pending: false, ms: Math.round(performance.now() - started) });
        setStats((s) => ({ ...s, instant: s.instant + 1 }));
        return;
      }
      if (d.deviceOnly && !deviceReady) {
        patch(reply.id, {
          pending: false,
          error:
            status === "unsupported"
              ? "Private mode needs Chrome's on-device model (Gemini Nano), which this browser doesn't have. Nothing was sent anywhere."
              : "Private mode needs the on-device model. Tap “Get on-device model” above first. Nothing was sent anywhere.",
        });
        return;
      }

      // The conversation so far (last 8 turns), with this message last.
      const history: Turn[] = [...msgs, user]
        .filter((m) => !m.error && !m.pending && (m.text || m.image))
        .slice(-8)
        .map((m) => ({ role: m.role === "user" ? "user" : "model", text: m.role === "user" ? promptFor(m.text) : m.text, ...(m.image ? { image: m.image } : {}) }));

      // Privacy Shield: anything that may reach the cloud is cleaned on the device first.
      const mayGoToCloud = d.route === "cloud" || d.route === "research" || (d.route === "device" && !d.deviceOnly && !deviceReady);
      let vault: Shielded["vault"] = new Map();
      let shieldNote: string | undefined;
      if (shieldOn && mayGoToCloud) {
        let s: Shielded | undefined;
        for (const t of history) {
          if (t.role !== "user") continue;
          s = shieldPatterns(t.text, s);
          if (deviceReady) {
            try {
              s = shieldFound(s, await findNamesOnDevice(s.text));
            } catch {
              /* names are a bonus; patterns already ran */
            }
          }
          t.text = s.text;
        }
        if (s) {
          vault = s.vault;
          const what = describeCounts(s.counts);
          if (what) {
            shieldNote = `Hid ${what} on your device before the cloud saw it, and put them back here.`;
            setStats((st) => ({ ...st, hidden: st.hidden + s!.vault.size }));
          }
        }
      }
      if (shieldNote) patch(reply.id, { shielded: shieldNote });

      const which = d.route === "research" ? "research" : d.route === "cloud" ? "cloud" : d.deviceOnly ? "device" : "hybrid";
      const ctrl = new AbortController();
      abort.current = ctrl;
      setBusy(true);
      try {
        const onText = (soFar: string) => patch(reply.id, { text: unshield(soFar, vault) });
        let res;
        try {
          res = await streamAnswer(which, history, onText, ctrl.signal);
        } catch (e) {
          // Live web search unavailable (e.g. no Google Search quota on the free plan): answer from the cloud model, and say so.
          if (which !== "research" || ctrl.signal.aborted) throw e;
          patch(reply.id, { route: "cloud", reason: "Live web search isn't available right now → cloud model without search (no sources)" });
          res = await streamAnswer("cloud", history, onText, ctrl.signal);
        }
        const final = unshield(res.text, vault);
        patch(reply.id, {
          text: final,
          where: res.where,
          pending: false,
          ms: Math.round(performance.now() - started),
          ...(res.sources.length ? { sources: res.sources } : {}),
          ...(res.searchEntry ? { searchEntry: res.searchEntry } : {}),
        });
        setStats((s) => ({ ...s, [res.where]: s[res.where] + 1 }));
        // Research: the cloud did the searching; the device writes the short summary card.
        if (d.route === "research" && deviceReady && final.length > 400) {
          try {
            const summary = await summariseOnDevice(final);
            patch(reply.id, { summary, summaryWhere: "device" });
            setStats((s) => ({ ...s, device: s.device + 1 }));
          } catch {
            /* the full answer is already there */
          }
        }
      } catch (e) {
        if (ctrl.signal.aborted) patch(reply.id, { pending: false, error: "Stopped." });
        else patch(reply.id, { pending: false, error: friendly(e) });
      } finally {
        setBusy(false);
        abort.current = null;
      }
    },
    [input, image, busy, status, mode, msgs, shieldOn],
  );

  if (!configured) return <Setup />;

  return (
    <div className="shell">
      <header className="bar">
        <div className="brand">
          <Mark size={26} />
          <span className="brand__word">ROOK</span>
          <span className="brand__sub">for Chrome</span>
        </div>
        <div className="bar__right">
          <DeviceChip status={status} progress={progress} onPrepare={() => void prepare()} />
          <div className="seg" role="radiogroup" aria-label="Where ROOK thinks">
            {(
              [
                ["auto", "Auto", "Device first, cloud when needed"],
                ["private", "Private", "Never leaves this device"],
                ["cloud", "Cloud", "Always the cloud model"],
              ] as const
            ).map(([v, label, title]) => (
              <button key={v} role="radio" aria-checked={mode === v} className={mode === v ? "on" : ""} title={title} onClick={() => setMode(v)}>
                {label}
              </button>
            ))}
          </div>
          <button className={`shieldbtn ${shieldOn ? "on" : ""}`} aria-pressed={shieldOn} onClick={() => setShieldOn((v) => !v)} title="Hide personal details on the device before anything goes to the cloud">
            🛡 Shield {shieldOn ? "on" : "off"}
          </button>
        </div>
      </header>

      <main className="workspace">
        {msgs.length === 0 ? (
          <section className="hero">
            <Mark size={56} />
            <h1>Thinks on your device first.</h1>
            <p>
              ROOK answers on your computer with <strong>Gemini Nano</strong> whenever it can: private, instant and free. It reaches for the <strong>cloud</strong> only when a task needs
              it, and hides your personal details before it does.
            </p>
            <div className="examples">
              {EXAMPLES.map((e) => (
                <button key={e.label} className="example" onClick={() => void send(e.label)}>
                  <span>{e.label}</span>
                  <small>{e.hint}</small>
                </button>
              ))}
            </div>
          </section>
        ) : (
          <div className="thread">
            {msgs.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="msg msg--user">
                  {m.image && <img className="msg__img" src={`data:${m.image.mimeType};base64,${m.image.data}`} alt="Shared screen" />}
                  {m.text && <div className="bubble">{m.text}</div>}
                </div>
              ) : (
                <article key={m.id} className={`msg msg--rook ${m.pending ? "msg--pending" : ""}`}>
                  <div className="msg__head">
                    <Mark size={20} />
                    {m.where ? <Badge where={m.where} route={m.route} /> : <span className="badge badge--wait">Thinking…</span>}
                    {m.ms != null && <span className="msg__ms">{m.ms < 1000 ? `${m.ms} ms` : `${(m.ms / 1000).toFixed(1)} s`}</span>}
                  </div>
                  {m.reason && <p className="msg__why">{m.reason}</p>}
                  {m.shielded && <p className="msg__shield">🛡 {m.shielded}</p>}
                  {m.error ? <p className="msg__error">{m.error}</p> : <Markdown text={m.text || (m.pending ? "…" : "")} />}
                  {(m.summary || m.sources) && (
                    <div className="cards">
                      {m.summary && (
                        <section className="rcard">
                          <h4>Summary <span className="rcard__where">⚡ on your device</span></h4>
                          <p className="rcard__summary">{m.summary}</p>
                        </section>
                      )}
                      {m.sources && (
                        <section className="rcard">
                          <h4>{m.sources.length} sources <span className="rcard__where">☁ Google Search</span></h4>
                          <ul>
                            {m.sources.slice(0, 6).map((s) => (
                              <li key={s.uri}>
                                <a href={s.uri} target="_blank" rel="noreferrer noopener">
                                  {s.title}
                                </a>
                              </li>
                            ))}
                          </ul>
                        </section>
                      )}
                    </div>
                  )}
                  {m.searchEntry && <iframe className="searchentry" title="Google Search suggestions" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={m.searchEntry} />}
                </article>
              ),
            )}
            <div ref={bottom} />
          </div>
        )}
      </main>

      <footer className="dock">
        <div className="stats" aria-label="This session">
          <span>◆ {stats.instant} instant</span>
          <span>⚡ {stats.device} on device</span>
          <span>☁ {stats.cloud} cloud</span>
          <span>🛡 {stats.hidden} details kept private</span>
        </div>
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          {image && (
            <div className="attach">
              <img src={`data:${image.mimeType};base64,${image.data}`} alt="" />
              <button type="button" aria-label="Remove image" onClick={() => setImage(undefined)}>
                ×
              </button>
            </div>
          )}
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={mode === "private" ? "Ask privately: stays on this device…" : "Ask anything, or share your screen…"}
            rows={1}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            onPaste={(e) => {
              const f = [...e.clipboardData.files].find((x) => x.type.startsWith("image/"));
              if (f) {
                e.preventDefault();
                void fileToJpeg(f).then(setImage);
              }
            }}
          />
          <div className="composer__row">
            <button
              type="button"
              className="tool"
              title="Share a screen or window: ROOK takes one picture of it"
              onClick={() =>
                void captureScreen()
                  .then((img) => {
                    setImage(img);
                    if (!input) setInput("Explain what's on my screen and what I should do next.");
                  })
                  .catch(() => undefined)
              }
            >
              ◉ Look at my screen
            </button>
            <button type="button" className="tool" onClick={() => fileInput.current?.click()}>
              ＋ Image
            </button>
            <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && void fileToJpeg(e.target.files[0]).then(setImage)} />
            <span className="spacer" />
            {busy ? (
              <button type="button" className="send send--stop" onClick={() => abort.current?.abort()}>
                Stop
              </button>
            ) : (
              <button type="submit" className="send" disabled={!input.trim() && !image}>
                Send
              </button>
            )}
          </div>
        </form>
      </footer>
    </div>
  );
}

function DeviceChip({ status, progress, onPrepare }: { status: DeviceStatus; progress: number | null; onPrepare: () => void }) {
  if (progress !== null) return <span className="chip chip--busy">Downloading on-device model… {Math.round(progress * 100)}%</span>;
  if (status === "available") return <span className="chip chip--ok">⚡ On-device model ready</span>;
  if (status === "downloadable" || status === "downloading")
    return (
      <button className="chip chip--action" onClick={onPrepare}>
        ⤓ Get on-device model
      </button>
    );
  return (
    <span className="chip chip--off" title="This browser has no on-device model (Gemini Nano). ROOK uses the cloud for everything except instant answers.">
      Cloud only on this browser
    </span>
  );
}

function friendly(e: unknown): string {
  const msg = (e as Error)?.message ?? String(e);
  if (/app.?check/i.test(msg)) return "Firebase App Check blocked the request. If you're testing, register this browser's debug token in the Firebase console.";
  if (/quota|\b429\b|rate.?limit|RESOURCE_EXHAUSTED/i.test(msg)) return "The cloud model is busy (rate limit). Try again in a moment.";
  if (/api.?key|\b40[03]\b|PERMISSION_DENIED|not been used in project|is disabled/i.test(msg))
    return "Firebase refused the request. Check that AI Logic (Gemini Developer API) is enabled for this project and the web app's config is right.";
  if (/API_NOT_ENABLED|not available in this environment/i.test(msg)) return "The on-device model isn't available in this browser. Switch to Auto or Cloud.";
  if (/network|fetch/i.test(msg)) return "Couldn't reach the cloud. If this keeps happening, check your connection, or use Private mode, which works offline.";
  return `Something went wrong: ${msg.slice(0, 200)}`;
}

function Setup() {
  return (
    <div className="setup">
      <Mark size={56} />
      <h1>ROOK for Chrome</h1>
      <p>Firebase isn't configured yet. Copy <code>.env.example</code> to <code>.env</code>, fill in your Firebase web app's config, and restart.</p>
    </div>
  );
}
