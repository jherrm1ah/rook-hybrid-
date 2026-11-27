import type { CSSProperties, ReactNode } from "react";
import { IconCamera, IconCapture, IconChevronRight, IconLive, IconMic, IconSpark } from "./Icons";
import { RookBird, RookLabel } from "./rook/RookBird";

function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export interface Example {
  label: string;
  prompt: string;
  hint: string;
  icon: ReactNode;
}

/** The home screen, as in the ROOK desktop app: the black card, the action tiles, and things to try. */
export function Home({
  project,
  recording,
  following,
  examples,
  onAsk,
  onLook,
  onScan,
  onRecord,
  onFollow,
  onExample,
  lookMenu,
  catching,
}: {
  lookMenu: ReactNode;
  catching: boolean;
  project?: string | undefined;
  recording: boolean;
  following: boolean;
  examples: Example[];
  onAsk: () => void;
  onLook: () => void;
  onScan: () => void;
  onRecord: () => void;
  onFollow: () => void;
  onExample: (e: Example) => void;
}) {
  const i = (n: number) => ({ "--i": n }) as CSSProperties;
  return (
    <div className="home">
      <header className="hero spring">
        <div className="hero__rook">
          <RookBird behavior={catching ? "catching" : "watching"} size={44} showAura={false} />
          {catching && <RookLabel verb="Catching" />}
        </div>
        <p className="hero__eyebrow">
          {greeting()}
          {project ? ` · ${project}` : ""}
        </p>
        <h1 className="hero__title">What should ROOK get done?</h1>
        <p className="hero__sub">ROOK thinks on your device first with Gemini Nano. It asks the cloud only when it isn't sure, and hides your details before it does.</p>
      </header>

      <div className="bento" role="group" aria-label="Actions">
        <button className="tile tile--ask spring" style={i(1)} onClick={onAsk}>
          <span className="tile__icon">
            <IconSpark size={22} />
          </span>
          <span className="tile__body">
            <span className="tile__label">Ask</span>
            <span className="tile__hint">Questions, writing, code, anything</span>
          </span>
        </button>
        <div className="tile-wrap spring" style={i(2)}>
          <button className={`tile ${lookMenu ? "tile--open" : ""}`} aria-haspopup="menu" aria-expanded={Boolean(lookMenu)} onClick={onLook}>
            <span className="tile__icon">
              <IconCapture size={18} />
            </span>
            <span className="tile__body">
              <span className="tile__label">Look</span>
              <span className="tile__hint">Screen, window, region</span>
            </span>
          </button>
          {lookMenu}
        </div>
        <button className="tile spring" style={i(3)} onClick={onScan}>
          <span className="tile__icon">
            <IconCamera size={18} />
          </span>
          <span className="tile__body">
            <span className="tile__label">Scan</span>
            <span className="tile__hint">Camera</span>
          </span>
        </button>
        <button className={`tile spring ${recording ? "tile--on" : ""}`} style={i(4)} onClick={onRecord}>
          <span className="tile__icon">
            <IconMic size={18} />
          </span>
          <span className="tile__body">
            <span className="tile__label">{recording ? "Stop" : "Record"}</span>
            <span className="tile__hint">{recording ? "Listening…" : "Voice notes & meetings"}</span>
          </span>
        </button>
        <button className={`tile spring ${following ? "tile--on" : ""}`} style={i(5)} onClick={onFollow}>
          <span className="tile__icon">
            <IconLive size={18} />
          </span>
          <span className="tile__body">
            <span className="tile__label">{following ? "End" : "Follow"}</span>
            <span className="tile__hint">{following ? "Watching your screen" : "Guides you on screen"}</span>
          </span>
        </button>
      </div>

      <section className="block spring" style={i(6)}>
        <h2 className="section-label">Try</h2>
        <ol className="numbered">
          {examples.map((e, n) => (
            <li key={e.label}>
              <button className="numbered__item" onClick={() => onExample(e)} title={e.prompt}>
                <span className="numbered__n">{String(n + 1).padStart(2, "0")}</span>
                <span className="numbered__text">
                  <span className="numbered__label">{e.label}</span>
                  <span className="numbered__hint">{e.hint}</span>
                </span>
                <span className="numbered__icon">{e.icon}</span>
                <IconChevronRight size={15} className="numbered__chev" />
              </button>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
