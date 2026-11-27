import { useCallback, useEffect, useRef, useState } from "react";
import { CLOUD_MODEL, configured, deviceStatus, findNamesOnDevice, followUpsOnDevice, gradeOnDevice, prepareDevice, streamAnswer, summariseOnDevice, type DeviceStatus, type Turn, type Where } from "./ai";
import { Markdown } from "./Markdown";
import { decide, improvePrompt, parseGrade, promptFor, shouldEscalate, tokensIn, type Grade, type Mode, type Route } from "./router";
import { describeCounts, shieldFound, shieldPatterns, unshield, type Shielded } from "./shield";
import * as history from "./history";
import { ROOK_SYMBOL } from "./vendor/symbol.ts";
import { LookFlash, RookBird, RookLabel } from "./rook/RookBird";
import { Onboarding, onboarded } from "./Onboarding";
import { IconArrowUp, IconCapture, IconExpand, IconMinus, IconShrink, IconCheck, IconCopy, IconEdit, IconExternal, IconFolder, IconGlobe, IconHistory, IconLive, IconMic, IconPlus, IconShield, IconSpark, IconStop, IconZap } from "./Icons";
import { Home, type Example } from "./Home";
import { Camera } from "./Camera";
import { CropModal, crop } from "./CropModal";
import { LookMenu, type LookKind } from "./LookMenu";
import { Picker } from "./Pickers";
import { ProjectsPanel } from "./ProjectsPanel";
import { ResultCards } from "./ResultCards";
import { canFloat, float, floatWindow, resizeFloat, unfloat } from "./float";
import { FloatOrb } from "./FloatOrb";
import * as projects from "./projects";
import { canListen, listen } from "./voice";

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
  /** What ROOK is doing right now (drives the living bird while it works). */
  stage?: Stage;
  /** Short label shown instead of a long prompt (e.g. a voice note), with the full text one tap away. */
  label?: string;
  /** Follow-up questions, suggested on the device. */
  followups?: string[];
}

type Stage = "looking" | "thinking" | "drafting" | "checking" | "guarding" | "seeking" | "gathering";
const VERB: Record<Stage, string> = { looking: "Looking", thinking: "Thinking", drafting: "Drafting", checking: "Checking", guarding: "Guarding", seeking: "Seeking", gathering: "Gathering" };

const uid = () => Math.random().toString(36).slice(2, 10);
const fmtMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);

const EXAMPLES: Example[] = [
  { label: "Work out 15% of 84,500", prompt: "15% of 84,500", hint: "Instant. No AI needed.", icon: <IconZap size={16} /> },
  { label: "Make a message friendlier", prompt: "Rewrite this to sound friendlier: send me the invoice today", hint: "Answered on your device", icon: <IconEdit size={16} /> },
  {
    label: "Draft a reply about VAT",
    prompt: "Tolu Adeyemi (tolu.adeyemi@gmail.com) asks what VAT rate to charge on invoices in Nigeria. Draft my reply.",
    hint: "The device is unsure, so the cloud improves it. Then tap What the cloud saw.",
    icon: <IconShield size={16} />,
  },
  { label: "Research Firebase hybrid AI", prompt: "/research latest Firebase AI Logic hybrid inference features", hint: "Cloud with Google Search", icon: <IconGlobe size={16} /> },
];

const RESEARCH_FORMAT = "\n\nFormat the answer in Markdown with these headings: ### Overview, ### Key findings, ### Comparison (only if it helps), ### Recommendations.";
const FOLLOW_HINT = "\n\n(I'm sharing my screen with you. Tell me exactly what to click or type, step by step; I'll do it myself.)";
const RECORD_PROMPT =
  "Here is the transcript of a voice note or meeting I recorded. Turn it into clear notes: a two-line summary, the key points, and action items (with who and when, if mentioned).\n\nTranscript:\n";

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
async function captureScreen(surface?: "monitor" | "window" | "browser"): Promise<Turn["image"]> {
  // Chrome's own picker still decides; this only pre-selects the right tab of it.
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: (surface ? { displaySurface: surface } : true) as MediaTrackConstraints, audio: false });
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
  const [flash, setFlash] = useState<Turn["image"]>();
  const [tour, setTour] = useState(() => !onboarded());
  const [web, setWeb] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const stopListening = useRef<(() => void) | null>(null);
  const [imageLabel, setImageLabel] = useState("");
  const attach = (img: Turn["image"], label = "Image") => {
    setImage(img);
    setImageLabel(label);
    setFlash(img);
  };
  // Look, as on the desktop: full screen, a window, or a region you drag. ROOK IS CATCHING while it captures.
  const [lookMenu, setLookMenu] = useState<null | "home" | "composer">(null);
  const [catching, setCatching] = useState(false);
  const [cropping, setCropping] = useState<Turn["image"]>();
  const lookPrompt = () => setInput((t) => t || "Explain what's on my screen and what I should do next.");
  const look = (kind: LookKind | "tab" = "screen") => {
    setLookMenu(null);
    setCatching(true);
    void captureScreen(kind === "window" ? "window" : kind === "tab" ? "browser" : "monitor")
      .then((img) => {
        if (kind === "region") return setCropping(img);
        attach(img, kind === "window" ? "Window" : kind === "tab" ? "Page" : "Screen");
        lookPrompt();
      })
      .catch(() => undefined)
      .finally(() => setCatching(false));
  };
  const mic = async () => {
    if (listening) {
      stopListening.current?.();
      return;
    }
    const before = input ? `${input.trimEnd()} ` : "";
    try {
      setListening(true);
      stopListening.current = await listen(
        (heard) => setInput(before + heard),
        (err) => {
          setListening(false);
          stopListening.current = null;
          if (err) alert(err);
        },
      );
    } catch (e) {
      setListening(false);
      alert((e as Error).message);
    }
  };
  // Projects (on this device only)
  const kv = typeof localStorage !== "undefined" ? localStorage : null;
  const [projectList, setProjectList] = useState<projects.Project[]>(() => (kv ? projects.load(kv) : []));
  const [projectId, setProjectId] = useState<string | null>(() => (kv ? projects.currentId(kv) : null));
  const [projPanel, setProjPanel] = useState(false);
  const project = projectList.find((p) => p.id === projectId);
  const pickProject = (id: string | null) => {
    setProjectId(id);
    if (store) projects.setCurrent(store, id);
  };
  // Scan
  const [camera, setCamera] = useState(false);
  // Follow: a shared screen ROOK looks at with each question
  const [follow, setFollow] = useState<MediaStream | null>(null);
  const followVideo = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (followVideo.current && follow) {
      followVideo.current.srcObject = follow;
      void followVideo.current.play().catch(() => undefined);
    }
  }, [follow]);
  const stopFollow = () => {
    follow?.getTracks().forEach((t) => t.stop());
    setFollow(null);
  };
  const startFollow = async () => {
    if (follow) return stopFollow();
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      s.getVideoTracks()[0]?.addEventListener("ended", () => setFollow(null));
      setFollow(s);
      setInput((t) => t || "What should I do next here?");
      textarea.current?.focus();
    } catch {
      /* the user cancelled the share */
    }
  };
  const frame = (): Turn["image"] | undefined => {
    const v = followVideo.current;
    return v && v.videoWidth ? toJpeg(v, v.videoWidth, v.videoHeight) : undefined;
  };
  // Record: speech to text on the device when Chrome can, then ROOK writes the notes
  const [rec, setRec] = useState<{ started: number; text: string } | null>(null);
  const recText = useRef("");
  const recWant = useRef(false);
  const recLive = useRef(false);
  const recStop = useRef<(() => void) | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [rec]);
  const finishRec = (started: number) => {
    if (!recLive.current) return;
    recLive.current = false;
    recWant.current = false;
    setRec(null);
    const text = recText.current.trim();
    if (!text) return alert("ROOK didn't hear anything. Check the microphone and try again.");
    const secs = Math.round((Date.now() - started) / 1000);
    void sendRef.current(`${RECORD_PROMPT}"""\n${text}\n"""`, { label: `Voice note · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}` });
  };
  const runRec = async (started: number) => {
    const base = recText.current ? `${recText.current} ` : "";
    try {
      recStop.current = await listen(
        (heard) => {
          recText.current = (base + heard).trim();
          setRec({ started, text: recText.current });
        },
        (err) => {
          if (err) {
            recWant.current = false;
            alert(err);
          }
          // Chrome stops listening after long pauses: carry on until the user presses Stop.
          if (recWant.current) void runRec(started);
          else finishRec(started);
        },
      );
    } catch (e) {
      recWant.current = false;
      finishRec(started);
      alert((e as Error).message);
    }
  };
  const toggleRecord = () => {
    if (rec) {
      recWant.current = false;
      recStop.current?.();
      return;
    }
    if (!canListen()) return alert("This browser can't record speech. Try Chrome on a computer.");
    stopListening.current?.();
    const started = Date.now();
    recText.current = "";
    recWant.current = true;
    recLive.current = true;
    setRec({ started, text: "" });
    void runRec(started);
  };
  const textarea = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [floating, setFloating] = useState(false);
  // Float: ROOK as an icon on top of every tab and app; tap it to open the full mini ROOK.
  const ORB = { width: 200, height: 236 };
  const FULL = { width: 420, height: 680 };
  const [orb, setOrb] = useState(false);
  const [news, setNews] = useState(false);
  const toggleFloat = () => {
    if (floating) return unfloat();
    setPanel(false);
    setProjPanel(false);
    void float(() => {
      setFloating(false);
      setOrb(false);
      setNews(false);
    }, ORB)
      .then((ok) => {
        if (!ok) return;
        setFloating(true);
        setOrb(true);
      })
      .catch(() => undefined);
  };
  const openFull = () => {
    resizeFloat(FULL.width, FULL.height);
    setOrb(false);
    setNews(false);
  };
  const toOrb = () => {
    resizeFloat(ORB.width, ORB.height);
    setOrb(true);
  };
  // If the floating window is resized by hand, follow it.
  useEffect(() => {
    const w = floating ? floatWindow() : null;
    if (!w) return;
    const on = () => setOrb(w.innerWidth < 300);
    w.addEventListener("resize", on);
    return () => w.removeEventListener("resize", on);
  }, [floating]);
  const [wide, setWide] = useState(() => typeof matchMedia !== "undefined" && matchMedia("(min-width: 1100px)").matches);
  useEffect(() => {
    const q = matchMedia("(min-width: 1100px)");
    const on = () => setWide(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  /** Follow-up questions, written on the device (free) for the latest answer. */
  const addFollowUps = (id: string, question: string, answer: string) => {
    if (status !== "available" || !answer.trim()) return;
    void followUpsOnDevice(question, answer)
      .then((followups) => followups.length && patch(id, { followups }))
      .catch(() => undefined);
  };
  const copy = (m: Msg) =>
    void navigator.clipboard?.writeText(m.text).then(() => {
      setCopied(m.id);
      setTimeout(() => setCopied((c) => (c === m.id ? null : c)), 1500);
    });
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
    patch(replyId, { pending: true, stage: shieldOn ? "guarding" : "seeking" });
    const sh = await shieldTurns(turns, deviceReady, draft);
    const sent: Turn[] = [...sh.turns, { role: "user", text: improvePrompt(sh.extra ?? draft) }];
    const steps = [...trail, ...(sh.hidden ? [`Shield hid ${sh.what}`] : []), "Cloud improving…"];
    if (sh.hidden) setStats((st) => ({ ...st, hidden: st.hidden + sh.hidden }));
    patch(replyId, {
      draft,
      text: "",
      pending: true,
      reason: why,
      stage: "seeking",
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
      const onText = (soFar: string) => patch(replyId, { text: unshield(soFar, sh.vault), stage: "drafting" });
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
      addFollowUps(replyId, turns.filter((t) => t.role === "user").at(-1)?.text ?? "", unshield(res.text, sh.vault));
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
    async (raw?: string, opts?: { label?: string }) => {
      stopListening.current?.();
      let text = (raw ?? input).trim();
      const pic = image ?? (follow ? frame() : undefined);
      if ((!text && !pic) || busy) return;
      if (web && raw === undefined && text && !/^\/research\b/i.test(text)) text = `/research ${text}`;
      const deviceReady = status === "available";
      const d = decide(text, { mode, hasImage: Boolean(pic), deviceReady });
      // Offline: nothing can reach the cloud, so ROOK keeps thinking on the device.
      if (!online && d.route !== "instant" && !d.deviceOnly) {
        d.deviceOnly = true;
        d.route = "device";
        d.reason = "You're offline → answering on your device";
      }
      const user: Msg = { id: uid(), role: "user", text, ...(pic ? { image: pic } : {}), ...(opts?.label ? { label: opts.label } : {}) };
      const reply: Msg = { id: uid(), role: "rook", text: "", route: d.route, reason: d.reason, pending: true, stage: pic ? "looking" : "thinking" };
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
      // The latest question carries the project's notes, the research format and the Follow hint.
      const last = turns.at(-1)!;
      last.text = projects.withContext(project, last.text) + (d.route === "research" ? RESEARCH_FORMAT : "") + (follow && pic ? FOLLOW_HINT : "");

      // Self-check: in Auto, the device answers, grades itself, and calls in the cloud only when unsure.
      const selfCheck = mode === "auto" && d.route === "device" && !d.deviceOnly && deviceReady && online;
      if (selfCheck || d.deviceOnly) {
        const ctrl = new AbortController();
        abort.current = ctrl;
        setBusy(true);
        let draft = "";
        let trail: string[] = [];
        try {
          const res = await streamAnswer("device", turns, (soFar) => patch(reply.id, { text: soFar, stage: "drafting" }), ctrl.signal);
          draft = res.text;
          const nanoMs = performance.now() - started;
          trail = [`Gemini Nano answered · ${fmtMs(nanoMs)}`];
          if (!selfCheck) {
            trail.push(online ? "Private: never left this device" : "Offline: never left this device");
            patch(reply.id, { text: draft, where: "device", pending: false, ms: Math.round(nanoMs), trail });
            setStats((s) => ({ ...s, device: s.device + 1, avoided: s.avoided + 1, tokensKept: s.tokensKept + tokensIn(text + draft) }));
            addFollowUps(reply.id, text, draft);
            return;
          }
          patch(reply.id, { text: draft, stage: "checking", trail: [...trail, "Checking its own answer…"] });
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
          addFollowUps(reply.id, text, draft);
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
      if (shieldOn && !pic) patch(reply.id, { stage: "guarding" });
      const sh = await shieldTurns(turns, deviceReady);
      const vault = sh.vault;
      if (sh.hidden) setStats((st) => ({ ...st, hidden: st.hidden + sh.hidden }));
      const steps: string[] = [...(sh.hidden ? [`Shield hid ${sh.what}`] : [])];
      patch(reply.id, {
        ...(sh.note ? { shielded: sh.note } : {}),
        youWrote: promptFor(text),
        cloudSaw: sh.turns.at(-1)?.text ?? "",
        stage: pic ? "looking" : d.route === "research" ? "gathering" : "seeking",
      });

      const which = d.route === "research" ? "research" : d.route === "cloud" ? "cloud" : "hybrid";
      const ctrl = new AbortController();
      abort.current = ctrl;
      setBusy(true);
      try {
        const onText = (soFar: string) => patch(reply.id, { text: unshield(soFar, vault), stage: "drafting" });
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
        addFollowUps(reply.id, text, final);
      } catch (e) {
        if (ctrl.signal.aborted) patch(reply.id, { pending: false, error: "Stopped." });
        else patch(reply.id, { pending: false, error: friendly(e) });
      } finally {
        setBusy(false);
        abort.current = null;
      }
    },
    [input, image, busy, status, mode, msgs, shieldOn, online, web, follow, project], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Result cards: for the latest research-style answer (a report with sections).
  const cardMsg = [...msgs].reverse().find((m) => m.role === "rook" && !m.pending && !m.error && (m.route === "research" || (m.text.match(/^#{1,4}\s/gm)?.length ?? 0) >= 3));
  const railOn = Boolean(cardMsg) && wide && !floating;
  const saveCard = project
    ? (title: string, text: string) => {
        if (!kv) return;
        const notes = `${project.notes.trim()}\n\n${title}:\n${text}`.trim();
        setProjectList(projects.update(kv, project.id, { notes }));
      }
    : undefined;
  const lastDone = useRef<string | null>(null);
  useEffect(() => {
    const last = msgs.at(-1);
    if (!last || last.role !== "rook" || last.pending || last.id === lastDone.current) return;
    lastDone.current = last.id;
    if (orb) setNews(true);
  }, [msgs, orb]);
  const sendRef = useRef(send);
  sendRef.current = send;

  if (!configured) return <Setup />;

  if (floating && orb) {
    const working = msgs.find((m) => m.pending);
    const stage = working ? (working.stage ?? "thinking") : null;
    return (
      <FloatOrb
        behavior={stage ?? (news ? "returning" : "watching")}
        verb={stage ? VERB[stage] : undefined}
        news={news}
        onOpen={openFull}
        onLook={() => {
          openFull();
          look("tab");
        }}
      />
    );
  }

  return (
    <div className={`shell ${railOn ? "shell--cards" : ""}`}>
      <header className="bar">
        <button className="brand" onClick={newChat} title="Home">
          <Mark size={24} />
          <span className="brand__word">ROOK</span>
        </button>
        {camera ? (
          <span className="chip chip--rec" role="status">
            <span className="chip__dot" /> Camera on
          </span>
        ) : rec ? (
          <span className="chip chip--rec" role="status">
            <span className="chip__dot" /> Recording
          </span>
        ) : follow ? (
          <span className="chip chip--ok" role="status">
            <span className="chip__dot" /> Following
          </span>
        ) : (
          <DeviceChip status={status} progress={progress} onPrepare={() => void prepare()} />
        )}
        <nav className="bar__icons" aria-label="ROOK">
          <button className="ibtn" onClick={newChat} title="New chat" aria-label="New chat">
            <IconPlus size={18} />
          </button>
          <button className={`ibtn ${projPanel ? "on" : ""}`} aria-expanded={projPanel} onClick={() => (setProjPanel((v) => !v), setPanel(false))} title="Projects" aria-label="Projects">
            <IconFolder size={18} />
          </button>
          <button className={`ibtn ${panel ? "on" : ""}`} aria-expanded={panel} onClick={() => (setPanel((v) => !v), setProjPanel(false))} title="Your saved chats (on this device only)" aria-label="History">
            <IconHistory size={18} />
            {saved.length > 0 && <span className="ibtn__count">{saved.length}</span>}
          </button>
          {floating && (
            <button className="ibtn" onClick={toOrb} title="Shrink ROOK to a floating icon" aria-label="Shrink to icon">
              <IconMinus size={18} />
            </button>
          )}
          {canFloat() && (
            <button
              className={`ibtn ${floating ? "on" : ""}`}
              onClick={toggleFloat}
              title={floating ? "Put ROOK back in the page" : "Float: ROOK stays on top as an icon while you use other tabs and apps"}
              aria-label={floating ? "Stop floating" : "Float"}
            >
              {floating ? <IconShrink size={17} /> : <IconExpand size={17} />}
            </button>
          )}
          <span className="bar__sep" />
          <button
            className={`ibtn ibtn--shield ${shieldOn ? "on" : ""}`}
            aria-pressed={shieldOn}
            onClick={() => setShieldOn((v) => !v)}
            title={shieldOn ? "Privacy Shield on: personal details are hidden before anything reaches the cloud" : "Privacy Shield off"}
            aria-label="Privacy Shield"
          >
            <IconShield size={18} />
          </button>
        </nav>
      </header>

      {projPanel && (
        <ProjectsPanel
          projects={projectList}
          current={projectId}
          onClose={() => setProjPanel(false)}
          onPick={pickProject}
          onCreate={(name) => {
            if (!store) return;
            const r = projects.create(store, name);
            setProjectList(r.list);
            pickProject(r.project.id);
          }}
          onUpdate={(id, patch) => store && setProjectList(projects.update(store, id, patch))}
          onDelete={(id) => {
            if (!store) return;
            setProjectList(projects.remove(store, id));
            if (projectId === id) setProjectId(null);
          }}
        />
      )}

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

      <div className="stage" ref={stageRef}>
      <main className="workspace" ref={scroller}>
        {msgs.length === 0 ? (
          <Home
            project={project?.name}
            recording={Boolean(rec)}
            following={Boolean(follow)}
            examples={EXAMPLES}
            onAsk={() => textarea.current?.focus()}
            onLook={() => setLookMenu((m) => (m === "home" ? null : "home"))}
            lookMenu={lookMenu === "home" ? <LookMenu onPick={look} onClose={() => setLookMenu(null)} /> : null}
            catching={catching}
            onScan={() => setCamera(true)}
            onRecord={toggleRecord}
            onFollow={() => void startFollow()}
            onExample={(e) => void send(e.prompt)}
          />
        ) : (
          <div className="thread">
            {msgs.map((m, i) =>
              m.role === "user" ? (
                <div key={m.id} className="msg msg--user">
                  {m.image && (
                    <div className={`msg__img-wrap ${msgs[i + 1]?.pending ? "msg__img-wrap--scan" : ""}`}>
                      <img className="msg__img" src={`data:${m.image.mimeType};base64,${m.image.data}`} alt="Shared screen" />
                    </div>
                  )}
                  {m.label ? (
                    <details className="bubble bubble--label">
                      <summary>
                        <IconMic size={14} /> {m.label}
                      </summary>
                      <p>{m.text.replace(RECORD_PROMPT, "").replace(/^"""\n|\n"""$/g, "")}</p>
                    </details>
                  ) : (
                    m.text && <div className="bubble">{m.text.replace(/^\/research\s*/i, "")}</div>
                  )}
                </div>
              ) : (
                <article key={m.id} className={`msg msg--rook ${m.pending ? "msg--pending" : ""}`}>
                  <div className="msg__head">
                    {m.pending ? <RookBird behavior={m.stage ?? "thinking"} size={30} showAura /> : <Mark size={20} />}
                    {m.pending && <RookLabel verb={VERB[m.stage ?? "thinking"]} />}
                    {m.pending ? null : m.where ? (
                      <span title={m.reason}>
                        <Badge where={m.where} route={m.route} />
                      </span>
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
                  {!m.pending && <ReportTabs id={m.id} text={m.text} />}
                  <div id={`ans-${m.id}`}>{(!m.error || m.text) && <Markdown text={m.text || (m.pending ? "…" : "")} />}</div>
                  {!m.pending && m.text ? (
                    <div className="msg__tools">
                      <button className="link" onClick={() => copy(m)} aria-label="Copy answer">
                        {copied === m.id ? <IconCheck size={14} /> : <IconCopy size={14} />} {copied === m.id ? "Copied" : "Copy"}
                      </button>
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
                  {(!wide || floating) && cardMsg?.id === m.id && (
                    <ResultCards id={m.id} text={m.text} sources={m.sources} summary={m.summary} rail={false} onSave={saveCard} saveLabel={project ? `Save to ${project.name}` : undefined} />
                  )}
                  {m.summary && (
                    <section className="report">
                      <h4 className="report__label">
                        Summary <span className="report__where">written on your device</span>
                      </h4>
                      <p className="report__summary">{m.summary}</p>
                    </section>
                  )}
                  {m.sources && m.sources.length > 0 && (
                    <section className="report">
                      <h4 className="report__label">Sources</h4>
                      <ol className="sources">
                        {m.sources.slice(0, 8).map((src, n) => (
                          <li key={src.uri}>
                            <a className="source" href={src.uri} target="_blank" rel="noreferrer noopener">
                              <span className="source__n">{n + 1}</span>
                              <span className="source__text">
                                <span className="source__title">{src.title}</span>
                                <span className="source__host">{host(src)}</span>
                              </span>
                              <IconExternal size={15} />
                            </a>
                          </li>
                        ))}
                      </ol>
                    </section>
                  )}
                  {!m.pending && m.followups && m.followups.length > 0 && (
                    <section className="report">
                      <h4 className="report__label">
                        Follow-up questions <span className="report__where">suggested on your device</span>
                      </h4>
                      <div className="followups">
                        {m.followups.map((q) => (
                          <button key={q} className="followup" disabled={busy} onClick={() => void send(q)}>
                            {q}
                          </button>
                        ))}
                      </div>
                    </section>
                  )}
                  {m.searchEntry && <iframe className="searchentry" title="Google Search suggestions" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={m.searchEntry} />}
                </article>
              ),
            )}
            <div ref={bottom} />
          </div>
        )}
      </main>
      {railOn && cardMsg && (
        <ResultCards
          key={cardMsg.id}
          id={cardMsg.id}
          text={cardMsg.text}
          sources={cardMsg.sources}
          summary={cardMsg.summary}
          rail
          scroller={scroller}
          stage={stageRef}
          onSave={saveCard}
          saveLabel={project ? `Save to ${project.name}` : undefined}
        />
      )}
      </div>

      <footer className="dock">
        {(stats.avoided > 0 || stats.hidden > 0) && (
          <div className="stats" aria-label="This session" title={`${stats.instant} instant · ${stats.device} on device · ${stats.cloud} cloud · ≈${stats.tokensKept.toLocaleString()} tokens kept on this device`}>
            {stats.avoided > 0 && <span className="stats__saved">{stats.avoided} answered without the cloud</span>}
            {stats.hidden > 0 && <span>{stats.hidden} detail{stats.hidden === 1 ? "" : "s"} kept private</span>}
          </div>
        )}
        {follow && (
          <div className="live live--follow" role="status">
            <video ref={followVideo} muted playsInline className="live__video" />
            <span className="live__text">
              <strong>Following your screen.</strong> ROOK looks at it with each question and tells you what to do.
            </span>
            <button type="button" className="live__stop" onClick={stopFollow}>
              End
            </button>
          </div>
        )}
        {rec && (
          <div className="live live--rec" role="status">
            <span className="live__dot" />
            <span className="live__time">
              {Math.floor((now - rec.started) / 60000)}:{String(Math.floor(((now - rec.started) / 1000) % 60)).padStart(2, "0")}
            </span>
            <span className="live__text">{rec.text ? `…${rec.text.slice(-90)}` : "Listening. Speak normally; ROOK writes the notes when you stop."}</span>
            <button type="button" className="live__stop" onClick={toggleRecord}>
              Stop
            </button>
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
              {imageLabel && <span className="attach__label">{imageLabel}</span>}
              <button type="button" aria-label="Remove image" onClick={() => setImage(undefined)}>
                ×
              </button>
            </div>
          )}
          <textarea
            ref={textarea}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={follow ? "Ask about what's on your screen…" : mode === "private" ? "Ask privately: stays on this device…" : web ? "What should ROOK research?" : "Ask anything…"}
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
                void fileToJpeg(f).then((img) => attach(img, "Image"));
              }
            }}
          />
          <div className="composer__row">
            <div className="lookwrap">
              <button
                type="button"
                className={`iconbtn ${lookMenu === "composer" ? "on" : ""}`}
                title="Look: your screen, a window, or a region"
                aria-label="Look"
                aria-haspopup="menu"
                aria-expanded={lookMenu === "composer"}
                onClick={() => setLookMenu((m) => (m === "composer" ? null : "composer"))}
              >
                <IconCapture size={17} />
              </button>
              {lookMenu === "composer" && <LookMenu up onPick={look} onClose={() => setLookMenu(null)} />}
            </div>
            <button type="button" className="iconbtn" title="Add a picture" aria-label="Add a picture" onClick={() => fileInput.current?.click()}>
              <IconPlus size={17} />
            </button>
            <button type="button" className={`iconbtn ${web ? "on" : ""}`} aria-pressed={web} title={web ? "Web research: on" : "Research on the web"} aria-label="Web research" onClick={() => setWeb((v) => !v)}>
              <IconGlobe size={17} />
            </button>
            <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && void fileToJpeg(e.target.files[0]).then((img) => attach(img, "Image"))} />
            <Picker
              icon={<IconFolder size={15} />}
              label={project?.name ?? "No project"}
              title={project ? `Project: ${project.name}` : "Project"}
              compact
              value={projectId ?? ""}
              options={[{ value: "", label: "No project" }, ...projectList.map((p) => ({ value: p.id, label: p.name }))]}
              onPick={(v) => pickProject(v || null)}
              footer={
                <button type="button" className="menu__item" onClick={() => setProjPanel(true)}>
                  New or edit projects…
                </button>
              }
            />
            <span className="spacer" />
            <Picker
              icon={<IconSpark size={15} />}
              label={mode === "auto" ? "Auto" : mode === "private" ? "Private" : "Cloud"}
              title="Where ROOK thinks"
              value={mode}
              options={[
                { value: "auto", label: "Auto", hint: "Device first, cloud when it isn't sure" },
                { value: "private", label: "Private", hint: "Never leaves this device" },
                { value: "cloud", label: "Cloud", hint: "Always the cloud model" },
              ]}
              onPick={setMode}
            />
            {canListen() && (
              <button type="button" className={`mic ${listening ? "mic--on" : ""}`} aria-pressed={listening} disabled={Boolean(rec)} title={listening ? "Stop listening" : "Speak instead of typing"} onClick={() => void mic()}>
                {listening ? <IconStop size={16} /> : <IconMic size={17} />}
              </button>
            )}
            {busy ? (
              <button type="button" className="send send--stop" aria-label="Stop" onClick={() => abort.current?.abort()}>
                <IconStop size={16} />
              </button>
            ) : (
              <button type="submit" className="send" aria-label="Send" disabled={!input.trim() && !image && !follow}>
                <IconArrowUp size={18} />
              </button>
            )}
          </div>
        </form>
      </footer>
      {camera && (
        <Camera
          onClose={() => setCamera(false)}
          onShot={(img) => {
            setCamera(false);
            attach(img, "Photo");
            setInput((t) => t || "What is this? Tell me what I should know or do.");
            textarea.current?.focus();
          }}
        />
      )}
      {flash && <LookFlash image={flash} onDone={() => setFlash(undefined)} />}
      {tour && <Onboarding onLook={() => look("screen")} onDone={() => setTour(false)} />}
      {cropping && (
        <CropModal
          image={cropping}
          onCancel={() => setCropping(undefined)}
          onDone={(r) => {
            const img = cropping;
            setCropping(undefined);
            void crop(img, r).then((part) => {
              attach(part, r.w >= 0.99 && r.h >= 0.99 ? "Screen" : "Region");
              lookPrompt();
            });
          }}
        />
      )}
    </div>
  );
}

function DeviceChip({ status, progress, onPrepare }: { status: DeviceStatus; progress: number | null; onPrepare: () => void }) {
  if (progress !== null) return <span className="chip chip--busy">Getting Gemini Nano… {Math.round(progress * 100)}%</span>;
  if (status === "available")
    return (
      <span className="chip chip--ok" title="Gemini Nano is ready: ROOK answers on this device first">
        <span className="chip__dot" /> Nano ready
      </span>
    );
  if (status === "downloadable" || status === "downloading")
    return (
      <button className="chip chip--action" onClick={onPrepare} title="Download Chrome's on-device model (Gemini Nano)">
        Get Gemini Nano
      </button>
    );
  return (
    <span className="chip chip--off" title="This browser has no on-device model (Gemini Nano). ROOK uses the cloud for everything except instant answers.">
      Cloud only
    </span>
  );
}

/** Research reports: jump to a section. */
function ReportTabs({ id, text }: { id: string; text: string }) {
  const heads = [...text.matchAll(/^#{1,4}\s+(.+)$/gm)].map((h) => h[1]!.replace(/[*_`]/g, "").trim()).slice(0, 6);
  if (heads.length < 3) return null;
  const go = (h: string) => {
    const el = [...(document.getElementById(`ans-${id}`)?.querySelectorAll("h2, h3") ?? [])].find((x) => x.textContent?.trim() === h);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <nav className="rtabs" aria-label="Report sections">
      {heads.map((h) => (
        <button key={h} type="button" className="rtab" onClick={() => go(h)}>
          {h}
        </button>
      ))}
    </nav>
  );
}

function host(s: { title: string; uri: string }): string {
  // Grounded links are redirects; the title is usually the site's domain.
  try {
    const h = new URL(s.uri).hostname.replace(/^www\./, "");
    return h.includes("vertexaisearch") || h.includes("google") ? s.title : h;
  } catch {
    return s.title;
  }
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
