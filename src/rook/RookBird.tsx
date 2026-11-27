import { useEffect, useRef, useState } from "react";
import { ROOK_SYMBOL } from "../vendor/symbol.ts";
import { aura, keyframes, poseFor, type BehaviorId } from "./motion";

/*
 * The living rook, from the ROOK desktop app: the ROOK symbol, articulated
 * into wings and body, moves the way ROOK is working (cocks its head while
 * looking, spreads its wings while guarding your details, writes while
 * drafting). Changing behaviour blends smoothly; the aura cross-fades.
 */

const BLEND_MS = 420;
const BLEND = "cubic-bezier(0.22, 1, 0.36, 1)";
const TILE_SCALE = 0.62;
const TILE = 100 / TILE_SCALE;
const TILE_OFF = (TILE - 100) / 2;

const still = () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

function morph(el: Element | null, frames: Keyframe[], period: number, holder: { current: Animation[] }, frozen: boolean, iterations = Infinity) {
  if (!el || typeof (el as HTMLElement).animate !== "function") return;
  const from = getComputedStyle(el).transform;
  const first = frames[0]!.transform as string;
  const blend = (el as HTMLElement).animate([{ transform: from && from !== "none" ? from : first }, { transform: first }], { duration: BLEND_MS, easing: BLEND, fill: "forwards" });
  holder.current.push(blend);
  if (frozen) return;
  blend.finished
    .then(() => {
      if (!holder.current.includes(blend)) return;
      const loop = (el as HTMLElement).animate(frames, { duration: period, iterations, ...(Number.isFinite(iterations) ? { fill: "forwards" as const } : {}) });
      holder.current.push(loop);
      blend.cancel();
    })
    .catch(() => undefined);
}

let clipSeq = 0;

export function RookBird({ behavior: id, size, showAura }: { behavior: BehaviorId; size: number; showAura?: boolean }) {
  const body = useRef<SVGGElement>(null);
  const left = useRef<SVGGElement>(null);
  const right = useRef<SVGGElement>(null);
  const running = useRef<Animation[]>([]);
  const [clip] = useState(() => `rb${++clipSeq}`);
  const [auras, setAuras] = useState<{ key: string; id: string; leaving: boolean }[]>([]);
  const pose = poseFor(id);
  const withAura = showAura ?? size >= 40;

  useEffect(() => {
    const k = keyframes(pose);
    const old = running.current;
    running.current = [];
    const times = id === "resting" ? 2 : Infinity;
    morph(body.current, k.body, pose.period, running, still(), times);
    morph(left.current, k.left, pose.period, running, still(), times);
    morph(right.current, k.right, pose.period, running, still(), times);
    requestAnimationFrame(() => old.forEach((a) => a.cancel()));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => running.current.forEach((a) => a.cancel()), []);

  useEffect(() => {
    if (!withAura) return;
    setAuras((list) => [...list.filter((a) => !a.leaving && a.id !== pose.aura).map((a) => ({ ...a, leaving: true })), { key: `${id}-${Date.now()}`, id: pose.aura, leaving: false }]);
    const t = setTimeout(() => setAuras((list) => list.filter((a) => !a.leaving)), 380);
    return () => clearTimeout(t);
  }, [pose.aura, withAura]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <svg className={`rook rook--${id}`} width={size} height={size} viewBox={`${-TILE_OFF} ${-TILE_OFF} ${TILE} ${TILE}`} aria-hidden="true">
      <defs>
        <clipPath id={`${clip}-l`}>
          <rect x="-10" y="-10" width="47.4" height="120" />
        </clipPath>
        <clipPath id={`${clip}-c`}>
          <rect x="36.6" y="-10" width="31.8" height="120" />
        </clipPath>
        <clipPath id={`${clip}-r`}>
          <rect x="68" y="-10" width="42" height="120" />
        </clipPath>
      </defs>
      <rect className="rook__tile" x={-TILE_OFF} y={-TILE_OFF} width={TILE} height={TILE} rx={24 / TILE_SCALE} />
      {withAura && (
        <g className="rook__auras">
          {auras.map((a) => (
            <g key={a.key} className={`aura aura--${a.id} ${a.leaving ? "aura--out" : "aura--in"}`}>
              {aura(a.id)}
            </g>
          ))}
        </g>
      )}
      <g ref={body} className="rook__body">
        <g ref={left} className="rook__wing rook__wing--l">
          <path className="rook__symbol" d={ROOK_SYMBOL} clipPath={`url(#${clip}-l)`} />
        </g>
        <path className="rook__symbol" d={ROOK_SYMBOL} clipPath={`url(#${clip}-c)`} />
        <g ref={right} className="rook__wing rook__wing--r">
          <path className="rook__symbol" d={ROOK_SYMBOL} clipPath={`url(#${clip}-r)`} />
        </g>
      </g>
    </svg>
  );
}

/** "ROOK IS CHECKING": the verb slides in as the work changes. */
export function RookLabel({ verb }: { verb: string }) {
  const word = verb.toUpperCase();
  const [leaving, setLeaving] = useState<string | null>(null);
  const shown = useRef(word);
  useEffect(() => {
    if (shown.current === word) return;
    setLeaving(shown.current);
    shown.current = word;
    const t = setTimeout(() => setLeaving(null), 320);
    return () => clearTimeout(t);
  }, [word]);
  return (
    <span className="rooklabel" role="status" aria-label={`ROOK is ${verb.toLowerCase()}`}>
      <span className="rooklabel__who" aria-hidden="true">
        ROOK IS
      </span>
      <span className="rooklabel__verb" aria-hidden="true">
        {leaving && (
          <span key={`out-${leaving}`} className="rooklabel__word rooklabel__word--out">
            {leaving}
          </span>
        )}
        <span key={word} className="rooklabel__word rooklabel__word--in">
          {word}
        </span>
      </span>
    </span>
  );
}

/** The Look moment: the captured screen fills the view, a line scans down it, then it settles. */
export function LookFlash({ image, onDone }: { image: { mimeType: string; data: string }; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, still() ? 0 : 1150);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="lookflash" aria-hidden="true">
      <div className="lookflash__frame">
        <img src={`data:${image.mimeType};base64,${image.data}`} alt="" />
        <span className="lookflash__band" />
        <span className="lookflash__line" />
      </div>
      <span className="lookflash__label">Looking</span>
    </div>
  );
}
