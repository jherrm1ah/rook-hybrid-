import type { ReactNode } from "react";
export type BehaviorId = string;

/*
 * The rook's motion library: one posture-and-rhythm per behaviour.
 *
 * The bird is the ROOK symbol exactly as drawn, articulated in three parts
 * (left wing, body, right wing) so it can lift, fold and beat its wings,
 * tilt, peck, crouch and glide. At rest every part is at zero and the symbol
 * is untouched. Coordinates are the symbol's own 100×100 box.
 *
 * Body frames are [offset, x, y, rotate°, scale]; wing frames are
 * [offset, degrees] (positive lifts the wing tip, mirrored for the right;
 * the wings shear from the joint, so the symbol never breaks).
 * Add a behaviour's pose and aura here with registerPose / registerAura.
 */

export type BodyFrame = [offset: number, x: number, y: number, r: number, s: number];
export type WingFrame = [offset: number, deg: number];

export interface Pose {
  /** One cycle of the rhythm, in ms. */
  period: number;
  easing?: string;
  body: BodyFrame[];
  wings: WingFrame[];
  /** The aura drawn around the bird (see AURAS). */
  aura: string;
}

const SMOOTH = "cubic-bezier(0.45, 0, 0.55, 1)";
const SNAP = "cubic-bezier(0.2, 0.9, 0.3, 1)";

const POSES: Record<string, Pose> = {
  resting: { period: 5200, body: [[0, 0, 0, 0, 1], [0.5, 0, -0.6, 0, 1.012], [1, 0, 0, 0, 1]], wings: [[0, -3], [0.5, -1.5], [1, -3]], aura: "none" },
  rooking: {
    period: 2600,
    body: [[0, 0, 0, 0, 1], [0.38, 0, -5, -6, 1], [0.72, 0, 2.5, 2.5, 1], [1, 0, 0, 0, 1]],
    wings: [[0, 0], [0.38, 6], [0.72, -4], [1, 0]],
    aura: "none",
  },
  thinking: { period: 3400, body: [[0, 0, 0, 0, 1], [0.5, 0, -3, -3, 1], [1, 0, 0, 0, 1]], wings: [[0, 1], [0.5, 4], [1, 1]], aura: "orbit" },
  looking: {
    period: 3200,
    body: [[0, 0, 0, 0, 1], [0.15, -1, 0, -7, 1], [0.45, -1, 0, -7, 1], [0.6, 1, 0, 6, 1], [0.9, 1, 0, 6, 1], [1, 0, 0, 0, 1]],
    wings: [[0, -1], [1, -1]],
    aura: "scan",
  },
  checking: {
    period: 1800,
    easing: SNAP,
    body: [[0, 0, 0, 0, 1], [0.12, 0, 2.5, 3, 1], [0.24, 0, 0, 0, 1], [0.36, 0, 2.5, 3, 1], [0.5, 0, 0, 0, 1], [1, 0, 0, 0, 1]],
    wings: [[0, -1], [1, -1]],
    aura: "check",
  },
  seeking: { period: 2400, body: [[0, -3, 1, -4, 1], [0.5, 3, 1, 4, 1], [1, -3, 1, -4, 1]], wings: [[0, 2], [0.25, 5], [0.5, 2], [0.75, 5], [1, 2]], aura: "sweep" },
  hunting: { period: 1400, body: [[0, -4, 3, -5, 0.97], [0.5, 4, 3, 5, 0.97], [1, -4, 3, -5, 0.97]], wings: [[0, -6], [1, -6]], aura: "target" },
  waiting: {
    period: 4200,
    body: [[0, 0, 0, 0, 1], [0.7, 0, 0, 0, 1], [0.78, 0, 0, -5, 1], [0.9, 0, 0, -5, 1], [1, 0, 0, 0, 1]],
    wings: [[0, -4], [1, -4]],
    aura: "pulse",
  },
  drafting: {
    period: 1200,
    body: [[0, 0, 0, 0, 1], [0.2, 1, 2, 4, 1], [0.35, 1.5, 0, 0, 1], [0.55, 2.5, 2, 4, 1], [0.7, 3, 0, 0, 1], [1, 0, 0, 0, 1]],
    wings: [[0, 0], [1, 0]],
    aura: "write",
  },
  executing: {
    period: 900,
    easing: SNAP,
    body: [[0, 0, 0, 0, 1], [0.3, 0, -3, -2, 1.02], [0.6, 0, 1, 1, 1], [1, 0, 0, 0, 1]],
    wings: [[0, 0], [0.3, 14], [0.6, -6], [1, 0]],
    aura: "dash",
  },
  catching: {
    period: 1100,
    easing: SNAP,
    body: [[0, 0, 0, 0, 1], [0.25, 0, -4, -4, 1.03], [0.4, 0, 1.5, 3, 0.98], [0.6, 0, 0, 0, 1], [1, 0, 0, 0, 1]],
    wings: [[0, 0], [0.25, 10], [0.4, -8], [0.6, 0], [1, 0]],
    aura: "catch",
  },
  grinding: { period: 650, body: [[0, 0, 0, 0, 1], [0.4, 0, 2.5, 5, 1], [1, 0, 0, 0, 1]], wings: [[0, -2], [1, -2]], aura: "grind" },
  making: { period: 1600, body: [[0, 0, 1, 0, 1], [0.5, 0, -2.5, 0, 1.02], [1, 0, 1, 0, 1]], wings: [[0, -2], [0.5, 12], [1, -2]], aura: "spark" },
  fixing: {
    period: 2000,
    body: [[0, 0, 0, 0, 1], [0.2, 0, 0, -3, 1], [0.3, 0, 0, -3, 1], [0.45, 0, 0, 2, 1], [0.55, 0, 0, 2, 1], [0.7, 0, 0, 0, 1], [1, 0, 0, 0, 1]],
    wings: [[0, -2], [0.45, 2], [1, -2]],
    aura: "mend",
  },
  reading: { period: 2800, body: [[0, -3, 1.5, 2, 1], [0.85, 3, 1.5, 2, 1], [1, -3, 1.5, 2, 1]], wings: [[0, -3], [1, -3]], aura: "lines" },
  watching: { period: 4800, body: [[0, 0, 0, 0, 1], [0.5, 0, -1.5, 0, 1], [1, 0, 0, 0, 1]], wings: [[0, 1], [0.5, 3], [1, 1]], aura: "watch" },
  learning: {
    period: 2200,
    body: [[0, 0, 0, 0, 1], [0.2, 0, 2, 4, 1], [0.4, 0, -2, -2, 1.01], [0.7, 0, 0, 0, 1], [1, 0, 0, 0, 1]],
    wings: [[0, 0], [0.4, 6], [0.7, 0], [1, 0]],
    aura: "stack",
  },
  sorting: {
    period: 1600,
    body: [[0, -3, 0, -2, 1], [0.15, -3, -2, -2, 1], [0.3, -3, 0, -2, 1], [0.5, 3, 0, 2, 1], [0.65, 3, -2, 2, 1], [0.8, 3, 0, 2, 1], [1, -3, 0, -2, 1]],
    wings: [[0, 0], [1, 0]],
    aura: "sort",
  },
  gathering: {
    period: 3000,
    body: [[0, 3, 0, 0, 1], [0.25, 0, -2, -3, 1], [0.5, -3, 0, 0, 1], [0.75, 0, 2, 3, 1], [1, 3, 0, 0, 1]],
    wings: [[0, 2], [0.5, 6], [1, 2]],
    aura: "gather",
  },
  guarding: { period: 3600, body: [[0, 0, -1, 0, 1.02], [0.5, 0, -1.8, 0, 1.03], [1, 0, -1, 0, 1.02]], wings: [[0, 10], [0.5, 12], [1, 10]], aura: "shield" },
  following: { period: 3200, body: [[0, -2.5, 0, -2, 1], [0.5, 2.5, -1, 2, 1], [1, -2.5, 0, -2, 1]], wings: [[0, 2], [0.5, 5], [1, 2]], aura: "trail" },
  returning: {
    period: 1600,
    easing: SNAP,
    body: [[0, 0, -2, -3, 0.96], [0.5, 0, 1, 1, 1.03], [1, 0, 0, 0, 1]],
    wings: [[0, 8], [0.5, -3], [1, 0]],
    aura: "return",
  },
  discovering: {
    period: 1300,
    easing: SNAP,
    body: [[0, 0, 0, 0, 1], [0.2, 0, -4, -3, 1.04], [0.35, 0, -4, 3, 1.04], [0.6, 0, 0, 0, 1], [1, 0, 0, 0, 1]],
    wings: [[0, 0], [0.15, 12], [0.3, 0], [0.45, 12], [0.6, 0], [1, 0]],
    aura: "burst",
  },
  building: {
    period: 1500,
    body: [[0, 0, 0, 0, 1], [0.25, 0, -2.5, 0, 1], [0.5, 0, 1.5, 3, 1], [0.75, 0, -1, 0, 1], [1, 0, 0, 0, 1]],
    wings: [[0, 0], [0.25, 8], [0.5, -3], [0.75, 6], [1, 0]],
    aura: "blocks",
  },
};

export function registerPose(id: BehaviorId, pose: Pose): void {
  POSES[id] = pose;
}

export function poseFor(id: BehaviorId): Pose {
  return POSES[id] ?? POSES.rooking!;
}

export const bodyTransform = ([, x, y, r, s]: BodyFrame) => `translate(${x}px, ${y}px) rotate(${r}deg) scale(${s})`;
/**
 * Wings bend by shearing from the joint (skewY about the seam): the edge at
 * the joint never moves, so the symbol stays whole while the tips lift and fall.
 */
export const wingTransform = (deg: number) => `skewY(${deg}deg)`;

export function keyframes(pose: Pose): { body: Keyframe[]; left: Keyframe[]; right: Keyframe[] } {
  const ease = pose.easing ?? SMOOTH;
  return {
    body: pose.body.map((f) => ({ offset: f[0], transform: bodyTransform(f), easing: ease })),
    left: pose.wings.map(([o, d]) => ({ offset: o, transform: wingTransform(d), easing: ease })),
    right: pose.wings.map(([o, d]) => ({ offset: o, transform: wingTransform(-d), easing: ease })),
  };
}

/*
 * Auras: quiet marks around the bird that show what it is working on
 * (a scanning arc while Looking, a line being written while Drafting…).
 * Drawn in the symbol's coordinates with currentColor; animated in CSS.
 */
const dot = (cx: number, cy: number, i = 0, r = 2.2) => <circle key={`${cx}-${cy}-${i}`} className={`aura__dot aura__dot--${i}`} cx={cx} cy={cy} r={r} />;

const AURAS: Record<string, () => ReactNode> = {
  none: () => null,
  orbit: () => <g className="aura__spin">{dot(50, 4)}</g>,
  scan: () => <path className="aura__stroke aura__scan" d="M 26 14 A 32 32 0 0 1 74 14" />,
  check: () => <path className="aura__stroke aura__draw" d="M 42 91 L 48 97 L 60 85" />,
  sweep: () => <path className="aura__stroke aura__sweep" d="M 50 50 L 50 2" />,
  target: () => (
    <g>
      <circle className="aura__stroke aura__ring" cx="57" cy="27" r="9" />
      <circle className="aura__stroke aura__ring aura__ring--late" cx="57" cy="27" r="9" />
    </g>
  ),
  pulse: () => dot(50, 93, 0, 2.6),
  write: () => <path className="aura__stroke aura__draw aura__draw--loop" d="M 30 93 C 38 90, 44 96, 52 93 S 64 90, 70 93" />,
  dash: () => <path className="aura__stroke aura__dash" d="M 34 93 L 50 93" />,
  catch: () => [dot(8, 20, 0), dot(92, 20, 1), dot(50, 99, 2)],
  grind: () => <circle className="aura__stroke aura__dashed aura__spin" cx="50" cy="50" r="47" />,
  spark: () => (
    <g className="aura__rays">
      {[0, 60, 120, 180, 240, 300].map((a) => (
        <path key={a} className="aura__stroke" d="M 50 8 L 50 2" transform={`rotate(${a} 50 50)`} />
      ))}
    </g>
  ),
  burst: () => (
    <g className="aura__rays aura__rays--burst">
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <path key={a} className="aura__stroke" d="M 50 10 L 50 3" transform={`rotate(${a} 50 50)`} />
      ))}
    </g>
  ),
  mend: () => (
    <g>
      <path className="aura__stroke aura__mend aura__mend--l" d="M 34 92 Q 42 98 49 92" />
      <path className="aura__stroke aura__mend aura__mend--r" d="M 51 92 Q 58 98 66 92" />
    </g>
  ),
  lines: () => (
    <g>
      <path className="aura__stroke aura__line aura__line--0" d="M 32 88 L 68 88" />
      <path className="aura__stroke aura__line aura__line--1" d="M 32 93 L 68 93" />
      <path className="aura__stroke aura__line aura__line--2" d="M 32 98 L 56 98" />
    </g>
  ),
  watch: () => <path className="aura__stroke aura__breathe" d="M 14 18 A 44 44 0 0 1 86 18" />,
  stack: () => [dot(93, 78, 0, 2), dot(93, 70, 1, 2), dot(93, 62, 2, 2)],
  sort: () => <g className="aura__sort">{[dot(40, 94, 0, 2), dot(50, 94, 1, 2), dot(60, 94, 2, 2)]}</g>,
  gather: () => [dot(4, 6, 0, 2), dot(96, 6, 1, 2), dot(4, 96, 2, 2), dot(96, 96, 3, 2)],
  shield: () => <path className="aura__stroke aura__breathe" d="M 16 86 Q 50 102 84 86" />,
  trail: () => [dot(-2, 54, 0, 1.6), dot(-9, 56, 1, 1.3), dot(-15, 58, 2, 1)],
  return: () => <path className="aura__stroke aura__draw" d="M 96 14 Q 98 50 62 60" />,
  blocks: () => (
    <g className="aura__blocks">
      <rect className="aura__block aura__block--0" x="40" y="92" width="8" height="5" rx="1" />
      <rect className="aura__block aura__block--1" x="52" y="92" width="8" height="5" rx="1" />
      <rect className="aura__block aura__block--2" x="46" y="85" width="8" height="5" rx="1" />
    </g>
  ),
};

export function registerAura(id: string, render: () => ReactNode): void {
  AURAS[id] = render;
}

export function aura(id: string): ReactNode {
  return (AURAS[id] ?? AURAS.none!)();
}
