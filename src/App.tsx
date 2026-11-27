import { useCallback, useEffect, useRef, useState } from "react";
import { CLOUD_MODEL, configured, deviceStatus, findNamesOnDevice, gradeOnDevice, prepareDevice, streamAnswer, summariseOnDevice, type DeviceStatus, type Turn, type Where } from "./ai";
import { Markdown } from "./Markdown";
import { decide, improvePrompt, parseGrade, promptFor, shouldEscalate, tokensIn, type Grade, type Mode, type Route } from "./router";
import { describeCounts, shieldFound, shieldPatterns, unshield, type Shielded } from "./shield";
import * as history from "./history";
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
  /** Every step this answer took: where it ran, how long, what the shield did. */
  trail?: string[];
  /** Exactly what the cloud received (after the shield), and what you wrote. */
  cloudSaw?: string;
  youWrote?: string;
  /** The device's first answer, when the cloud was asked to improve it. */
  draft?: string;
  confidence?: number;
  /** A short, quiet remark (not an error). */
  note?: string;
}

const uid = () => Math.random().toString(36).slice(2, 10);
const fmtMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);

const EXAMPLES = [
  { label: "15% of 84,500", hint: "Instant. No AI needed." },
  { label: "Rewrite this to sound friendlier: send me the invoice today", hint: "Answered on your device" },
  {
    label: "Tolu Adeyemi (tolu.adeyemi@gmail.com) asks what VAT rate to charge on invoices in Nigeria. Draft my reply.",
    hint: "Device unsure, cloud improves it. Then tap What the cloud saw.",
  },
  { label: "/research latest Firebase AI Logic hybrid inference features", hint: "Cloud with Google Search" },
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
  if (where === "instant") return <span className="badge badge--instant">Instant · no AI</span>;
  if (where === "device") return <span className="badge badge--device">On your device · Gemini Nano</span>;
  if (where === "cloud") return <span className="badge badge--cloud">Cloud · {CLOUD_MODEL}{route === "research" ? " + Google Search" : ""}</span>;
  return null;
}

/** Marks the shield's placeholders in what the cloud received. */
function highlight(text: string) {
  return text.split(/(\[[A-Z]+_\d+\])/).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
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
  const [stats, setStats] = useState({ instant: 0, device: 0, cloud: 0, hidden: 0, avoided: 0, tokensKept: 0 });
  // Offline: ROOK keeps thinking on the device.
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    addEventListener("online", up);
    addEventListener("offline", down);
    return () => {
      removeEventListener("online", up);
      removeEventListener("offline", down);
    };
  }, []);
  /** What each device answer was asked, so "improve in the cloud" can resend it (shielded). */
  const asked = useRef(new Map<string, { turns: Turn[]; question: string }>());
  const [xray, setXray] = useState<Record<string, boolean>>({});
  const [how, setHow] = useState<Record<string, boolean>>({});
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Saved conversations: on this device only (browser storage), never sent anywhere.
  const store = typeof localStorage !== "undefined" ? localStorage : null;
  const [convId, setConvId] = useState(uid);
  const [saved, setSaved] = useState<history.Conversation[]>(() => (store ? history.load(store) : []));
  const [historyOn, setHistoryOn] = useState(() => (store ? history.isOn(store) : false));
  const [panel, setPanel] = useState(false);

  useEffect(() => {
    void deviceStatus().then(setStatus);
  }, []);
  // Save the conversation whenever an answer has finished (not while it's still being written).
  useEffect(() => {
    if (!store || !historyOn || msgs.some((m) => m.pending)) return;
    if (!msgs.length) return;
    // Only when something changed: just opening an old chat doesn't move it to the top.
    const before = history.load(store).find((c) => c.id === convId);
    if (before && before.messages.length === msgs.length && before.messages.at(-1)?.text === msgs.at(-1)?.text) return;
    setSaved(history.save(store, convId, msgs as history.SavedMessage[]));
  }, [msgs, convId, historyOn]); // eslint-disable-line react-hooks/exhaustive-deps

  const newChat = () => {
    abort.current?.abort();
    setMsgs([]);
    setConvId(uid());
    setInput("");
    setImage(undefined);
    setPanel(false);
  };
  const openChat = (c: history.Conversation) => {
    abort.current?.abort();
    setMsgs(c.messages.map((m) => ({ ...m, pending: false })) as Msg[]);
    setConvId(c.id);
    setPanel(false);
  };
  const deleteChat = (id: string) => {
    if (!store) return;
    setSaved(history.remove(store, id));
    if (id === convId) {
      // The open chat was deleted: start fresh, but keep the panel open.
      abort.current?.abort();
      setMsgs([]);
      setConvId(uid());
    }
  };
  const toggleHistory = () => {
    if (!store) return;
    const next = !historyOn;
    if (!next && !confirm("Stop saving chats? This also deletes the chats saved on this device.")) return;
    history.setOn(store, next);
    setHistoryOn(next);
    if (!next) setSaved([]);
    else setSaved(history.save(store, convId, msgs as history.SavedMessage[]));
  };
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

  /**
   * Privacy Shield over the user's turns, on the device, before anything reaches the cloud.
   * `extra` (e.g. the device's draft) is cleaned with the same placeholders.
   */
  const shieldTurns = async (turns: Turn[], deviceReady: boolean, extra?: string) => {
    const out = turns.map((t) => ({ ...t }));
    let s: Shielded | undefined;
    if (shieldOn) {
      for (const t of out) {
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
    }
    let cleanExtra = extra;
    if (extra != null && shieldOn) {
      for (const [ph, val] of s?.vault ?? []) cleanExtra = cleanExtra!.split(val).join(ph);
      s = shieldPatterns(cleanExtra!, s);
      cleanExtra = s.text;
    }
    const what = s ? describeCounts(s.counts) : "";
    return {
      turns: out,
      extra: cleanExtra,
      vault: s?.vault ?? new Map<string, string>(),
      hidden: s?.vault.size ?? 0,
      note: what ? `Hid ${what} on your device before the cloud saw it, and put them back here.` : undefined,
      what,
    };
  };

  /** The cloud improves an answer the device wasn't sure about (shielded first). */
  const escalate = async (replyId: string, turns: Turn[], draft: string, trail: string[], started: number, why: string) => {
    const deviceReady = status === "available";
    const sh = await shieldTurns(turns, deviceReady, draft);
    const sent: Turn[] = [...sh.turns, { role: "user", text: improvePrompt(sh.extra ?? draft) }];
    const steps = [...trail, ...(sh.hidden ? [`Shield hid ${sh.what}`] : []), "Cloud improving…"];
    if (sh.hidden) setStats((st) => ({ ...st, hidden: st.hidden + sh.hidden }));
    patch(replyId, {
      draft,
      text: "",
      pending: true,
      reason: why,
      trail: steps,
      youWrote: turns.filter((t) => t.role === "user").at(-1)?.text ?? "",
      cloudSaw: sent.filter((t) => t.role === "user").slice(-2).map((t) => t.text).join("\n\n"),
      ...(sh.note ? { shielded: sh.note } : {}),
    });
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy(true);
    const t0 = performance.now();
    try {
      const onText = (soFar: string) => patch(replyId, { text: unshield(soFar, sh.vault) });
      let res;
      try {
        res = await streamAnswer("cloud", sent, onText, ctrl.signal);
      } catch (e) {
        if (ctrl.signal.aborted) throw e;
        res = await streamAnswer("cloud", sent, onText, ctrl.signal); // one retry: cloud hiccups are usually brief
      }
      patch(replyId, {
        text: unshield(res.text, sh.vault),
        where: res.where,
        pending: false,
        ms: Math.round(performance.now() - started),
        trail: [...steps.slice(0, -1), `Cloud improved · ${fmtMs(performance.now() - t0)}`],
      });
      setStats((s) => ({ ...s, [res.where]: s[res.where] + 1 }));
    } catch (e) {
      // The draft is still good to read: show it rather than an empty error.
      patch(replyId, {
        text: draft,
        where: "device",
        pending: false,
        trail: [...steps.slice(0, -1), "Cloud unavailable → kept the device's answer"],
        note: ctrl.signal.aborted ? undefined : "The cloud didn't respond, so this is the on-device answer.",
      });
      console.warn("Cloud improve failed:", e);
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  /** "Ask the cloud to improve this": the same path the self-check takes, on request. */
  const improve = async (m: Msg) => {
    const ctx = asked.current.get(m.id);
    if (!ctx || busy || !online) return;
    setStats((s) => ({ ...s, avoided: Math.max(0, s.avoided - 1), tokensKept: Math.max(0, s.tokensKept - tokensIn(ctx.question + m.text)) }));
    await escalate(m.id, ctx.turns, m.text, m.trail ?? [], performance.now(), "You asked the cloud to improve the on-device answer");
  };

  const send = useCallback(
    async (raw?: string) => {
      const text = (raw ?? input).trim();
      if ((!text && !image) || busy) return;
      const deviceReady = status === "available";
      const d = decide(text, { mode, hasImage: Boolean(image), deviceReady });
      // Offline: nothing can reach the cloud, so ROOK keeps thinking on the device.
      if (!online && d.route !== "instant" && !d.deviceOnly) {
        d.deviceOnly = true;
        d.route = "device";
        d.reason = "You're offline → answering on your device";
      }
      const user: Msg = { id: uid(), role: "user", text, ...(image ? { image } : {}) };
      const reply: Msg = { id: uid(), role: "rook", text: "", route: d.route, reason: d.reason, pending: true };
      setMsgs((list) => [...list, user, reply]);
      setInput("");
      setImage(undefined);
      const started = performance.now();

      if (d.route === "instant") {
        const ms = Math.round(performance.now() - started);
        patch(reply.id, { text: d.answer ?? "", where: "instant", pending: false, ms, trail: [`Calculated in the browser · ${fmtMs(ms)}`, "No AI needed"] });
        setStats((s) => ({ ...s, instant: s.instant + 1, avoided: s.avoided + 1, tokensKept: s.tokensKept + tokensIn(text + (d.answer ?? "")) }));
        return;
      }
      if (d.deviceOnly && !deviceReady) {
        patch(reply.id, {
          pending: false,
          error: !online
            ? "You're offline, and this browser doesn't have the on-device model (Gemini Nano) to keep thinking without internet. Calculations still work. Reconnect to use the cloud."
            : status === "unsupported"
              ? "Private mode needs Chrome's on-device model (Gemini Nano), which this browser doesn't have. Nothing was sent anywhere."
              : "Private mode needs the on-device model. Tap “Get on-device model” above first. Nothing was sent anywhere.",
        });
        return;
      }

      // The conversation so far (last 8 turns), with this message last.
      const turns: Turn[] = [...msgs, user]
        .filter((m) => !m.error && !m.pending && (m.text || m.image))
        .slice(-8)
        .map((m) => ({ role: m.role === "user" ? "user" : "model", text: m.role === "user" ? promptFor(m.text) : m.text, ...(m.image ? { image: m.image } : {}) }));

      // Self-check: in Auto, the device answers, grades itself, and calls in the cloud only when unsure.
      const selfCheck = mode === "auto" && d.route === "device" && !d.deviceOnly && deviceReady && online;
      if (selfCheck || d.deviceOnly) {
        const ctrl = new AbortController();
        abort.current = ctrl;
        setBusy(true);
        let draft = "";
        let trail: string[] = [];
        try {
          const res = await streamAnswer("device", turns, (soFar) => patch(reply.id, { text: soFar }), ctrl.signal);
          draft = res.text;
          const nanoMs = performance.now() - started;
          trail = [`Gemini Nano answered · ${fmtMs(nanoMs)}`];
          if (!selfCheck) {
            trail.push(online ? "Private: never left this device" : "Offline: never left this device");
            patch(reply.id, { text: draft, where: "device", pending: false, ms: Math.round(nanoMs), trail });
            setStats((s) => ({ ...s, device: s.device + 1, avoided: s.avoided + 1, tokensKept: s.tokensKept + tokensIn(text + draft) }));
            return;
          }
          patch(reply.id, { text: draft, where: "device", trail: [...trail, "Checking its own answer…"] });
          let grade: Grade;
          try {
            grade = parseGrade(await gradeOnDevice(text, draft));
          } catch {
            grade = { confidence: 70, needsCloud: false, reason: "" };
          }
          trail.push(`Self-check: ${grade.confidence}% sure${grade.reason ? ` (${grade.reason})` : ""}`);
          asked.current.set(reply.id, { turns, question: text });
          if (shouldEscalate(grade, { online, deviceOnly: false })) {
            setBusy(false);
            abort.current = null;
            await escalate(reply.id, turns, draft, trail, started, `The device was only ${grade.confidence}% sure → asked the cloud to improve it`);
            return;
          }
          trail.push("Good enough: the cloud wasn't needed");
          patch(reply.id, { text: draft, where: "device", pending: false, ms: Math.round(performance.now() - started), trail, confidence: grade.confidence });
          setStats((s) => ({ ...s, device: s.device + 1, avoided: s.avoided + 1, tokensKept: s.tokensKept + tokensIn(text + draft) }));
        } catch (e) {
          if (ctrl.signal.aborted) patch(reply.id, { pending: false, error: "Stopped.", ...(draft ? { text: draft } : {}) });
          else patch(reply.id, { pending: false, error: friendly(e) });
        } finally {
          if (abort.current === ctrl) {
            setBusy(false);
            abort.current = null;
          }
        }
        return;
      }

      // Privacy Shield: anything that may reach the cloud is cleaned on the device first.
      const sh = await shieldTurns(turns, deviceReady);
      const vault = sh.vault;
      if (sh.hidden) setStats((st) => ({ ...st, hidden: st.hidden + sh.hidden }));
      const steps: string[] = [...(sh.hidden ? [`Shield hid ${sh.what}`] : [])];
      patch(reply.id, {
        ...(sh.note ? { shielded: sh.note } : {}),
        youWrote: promptFor(text),
        cloudSaw: sh.turns.at(-1)?.text ?? "",
      });

      const which = d.route === "research" ? "research" : d.route === "cloud" ? "cloud" : "hybrid";
      const ctrl = new AbortController();
      abort.current = ctrl;
      setBusy(true);
      try {
        const onText = (soFar: string) => patch(reply.id, { text: unshield(soFar, vault) });
        let res;
        try {
          res = await streamAnswer(which, sh.turns, onText, ctrl.signal);
        } catch (e) {
          // Live web search unavailable (e.g. no Google Search quota on the free plan): answer from the cloud model, and say so.
          if (which !== "research" || ctrl.signal.aborted) throw e;
          patch(reply.id, { route: "cloud", reason: "Live web search isn't available right now → cloud model without search (no sources)" });
          res = await streamAnswer("cloud", sh.turns, onText, ctrl.signal);
        }
        const final = unshield(res.text, vault);
        const ms = performance.now() - started;
        steps.push(
          res.where === "device"
            ? `Gemini Nano answered · ${fmtMs(ms)}`
            : `${res.sources.length ? `Cloud + Google Search (${res.sources.length} sources)` : "Cloud"} · ${fmtMs(ms)}`,
        );
        patch(reply.id, {
          text: final,
          where: res.where,
          pending: false,
          ms: Math.round(ms),
          trail: steps,
          ...(res.where === "device" ? { cloudSaw: undefined, youWrote: undefined } : {}),
          ...(res.sources.length ? { sources: res.sources } : {}),
          ...(res.searchEntry ? { searchEntry: res.searchEntry } : {}),
        });
        setStats((s) => ({
          ...s,
          [res.where]: s[res.where] + 1,
          ...(res.where === "device" ? { avoided: s.avoided + 1, tokensKept: s.tokensKept + tokensIn(text + final) } : {}),
        }));
        // Research: the cloud did the searching; the device writes the short summary card.
        if (d.route === "research" && deviceReady && final.length > 400) {
          try {
            const summary = await summariseOnDevice(final);
            patch(reply.id, { summary, summaryWhere: "device", trail: [...steps, "Summary card written on your device"] });
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
    [input, image, busy, status, mode, msgs, shieldOn, online], // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (!configured) return <Setup />;

  return (
    <div className="shell">
      <header className="bar">
        <button className="brand" onClick={newChat} title="New chat">
          <Mark size={26} />
          <span className="brand__word">ROOK</span>
          <span className="brand__sub">for Chrome</span>
        </button>
        <button className="barbtn" onClick={newChat} title="Start a new chat">
          New
        </button>
        <button className={`barbtn ${panel ? "on" : ""}`} aria-expanded={panel} onClick={() => setPanel((v) => !v)} title="Your saved chats (kept on this device only)">
          History{saved.length ? ` · ${saved.length}` : ""}
        </button>
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
            Shield {shieldOn ? "on" : "off"}
          </button>
        </div>
      </header>

      {panel && (
        <div className="history-anchor">
        <aside className="history" aria-label="Saved chats">
          <div className="history__head">
            <h2>Your chats</h2>
            <button className="history__close" aria-label="Close" onClick={() => setPanel(false)}>
              ×
            </button>
          </div>
          <p className="history__note">Saved only on this device. Never sent to the cloud.</p>
          {!historyOn ? (
            <p className="history__empty">Saving is off. Turn it on to keep your chats here.</p>
          ) : saved.length === 0 ? (
            <p className="history__empty">No saved chats yet. Ask ROOK something and it appears here.</p>
          ) : (
            <ul className="history__list">
              {saved.map((c) => (
                <li key={c.id} className={c.id === convId ? "current" : ""}>
                  <button className="history__item" onClick={() => openChat(c)}>
                    <span className="history__title">{c.title}</span>
                    <span className="history__meta">
                      {history.when(c.updatedAt)} · {c.messages.filter((m) => m.role === "user").length} question{c.messages.filter((m) => m.role === "user").length === 1 ? "" : "s"}
                    </span>
                  </button>
                  <button className="history__del" aria-label={`Delete “${c.title}”`} title="Delete" onClick={() => deleteChat(c.id)}>
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="history__foot">
            <label className="history__toggle">
              <input type="checkbox" checked={historyOn} onChange={toggleHistory} /> Save chats on this device
            </label>
            {historyOn && saved.length > 0 && (
              <button
                className="history__clear"
                onClick={() => {
                  if (store && confirm("Delete all saved chats on this device?")) {
                    history.clearAll(store);
                    setSaved([]);
                  }
                }}
              >
                Delete all
              </button>
            )}
          </div>
        </aside>
        </div>
      )}

      {!online && (
        <div className="offline" role="status">
          You're offline. {status === "available" ? "Still thinking on your device with Gemini Nano." : "Calculations still work; answers need the on-device model or a connection."}
        </div>
      )}

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
            <p className="hero__tip">Try turning off your Wi-Fi: ROOK keeps answering on your device.</p>
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
                    {m.where ? (
                      <span title={m.reason}>
                        <Badge where={m.where} route={m.route} />
                      </span>
                    ) : m.pending ? (
                      <span className="badge badge--wait">Thinking…</span>
                    ) : null}
                    {m.shielded && (
                      <span className="badge badge--shield" title={m.shielded}>
                        Protected
                      </span>
                    )}
                    {m.ms != null && <span className="msg__ms">{m.ms < 1000 ? `${m.ms} ms` : `${(m.ms / 1000).toFixed(1)} s`}</span>}
                  </div>
                  {m.error && <p className="msg__error">{m.error}</p>}
                  {m.note && <p className="msg__note">{m.note}</p>}
                  {(!m.error || m.text) && <Markdown text={m.text || (m.pending ? "…" : "")} />}
                  {!m.pending && (m.trail?.length || m.cloudSaw != null || (m.where === "device" && asked.current.has(m.id))) ? (
                    <div className="msg__tools">
                      {m.trail && m.trail.length > 0 && (
                        <button className={`link ${how[m.id] ? "on" : ""}`} aria-expanded={Boolean(how[m.id])} onClick={() => setHow((x) => ({ ...x, [m.id]: !x[m.id] }))}>
                          How
                        </button>
                      )}
                      {m.cloudSaw != null && (
                        <button className={`link ${xray[m.id] ? "on" : ""}`} aria-expanded={Boolean(xray[m.id])} onClick={() => setXray((x) => ({ ...x, [m.id]: !x[m.id] }))}>
                          What the cloud saw
                        </button>
                      )}
                      {m.where === "device" && !m.draft && asked.current.has(m.id) && (
                        <button className="link" disabled={busy || !online} onClick={() => void improve(m)} title={online ? "Ask the cloud for a better answer (personal details are hidden first)" : "You're offline"}>
                          Improve
                        </button>
                      )}
                    </div>
                  ) : null}
                  {how[m.id] && m.trail && (
                    <div className="how">
                      <ol className="trail" aria-label="How ROOK answered">
                        {m.trail.map((step, i) => (
                          <li key={i}>{step}</li>
                        ))}
                      </ol>
                      {m.draft && (
                        <details className="draft">
                          <summary>The device's first answer</summary>
                          <Markdown text={m.draft} />
                        </details>
                      )}
                    </div>
                  )}
                  {m.cloudSaw != null && xray[m.id] && (
                    <div className="xray">
                      <section>
                        <h4>You wrote</h4>
                        <pre>{m.youWrote}</pre>
                      </section>
                      <section>
                        <h4>The cloud received</h4>
                        <pre>{highlight(m.cloudSaw)}</pre>
                      </section>
                      <p className="xray__note">Your real details never left this device.</p>
                    </div>
                  )}
                  {(m.summary || m.sources) && (
                    <div className="cards">
                      {m.summary && (
                        <section className="rcard">
                          <h4>Summary <span className="rcard__where">on your device</span></h4>
                          <p className="rcard__summary">{m.summary}</p>
                        </section>
                      )}
                      {m.sources && (
                        <section className="rcard">
                          <h4>{m.sources.length} sources <span className="rcard__where">Google Search</span></h4>
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
        {(stats.avoided > 0 || stats.hidden > 0) && (
          <div className="stats" aria-label="This session" title={`${stats.instant} instant · ${stats.device} on device · ${stats.cloud} cloud · ≈${stats.tokensKept.toLocaleString()} tokens kept on this device`}>
            {stats.avoided > 0 && <span className="stats__saved">{stats.avoided} answered without the cloud</span>}
            {stats.hidden > 0 && <span>{stats.hidden} detail{stats.hidden === 1 ? "" : "s"} kept private</span>}
          </div>
        )}
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
              Look at my screen
            </button>
            <button type="button" className="tool" onClick={() => fileInput.current?.click()}>
              Image
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
  if (status === "available") return <span className="chip chip--ok">On-device model ready</span>;
  if (status === "downloadable" || status === "downloading")
    return (
      <button className="chip chip--action" onClick={onPrepare}>
        Get on-device model
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
