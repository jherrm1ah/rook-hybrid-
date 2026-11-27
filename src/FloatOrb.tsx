import { IconCapture, IconExpand } from "./Icons";
import { RookBird, RookLabel } from "./rook/RookBird";

/**
 * ROOK as a floating icon (in the always-on-top window): the living bird,
 * one-tap Look at whatever you're viewing, and tap to open the full ROOK.
 */
export function FloatOrb({
  behavior,
  verb,
  news,
  onOpen,
  onLook,
}: {
  behavior: string;
  /** What ROOK is doing right now, if it's working. */
  verb?: string | undefined;
  /** An answer arrived while ROOK was small. */
  news: boolean;
  onOpen: () => void;
  onLook: () => void;
}) {
  return (
    <div className="orb">
      <button className="orb__bird" onClick={onOpen} title="Open ROOK" aria-label="Open ROOK">
        <RookBird behavior={behavior} size={72} showAura />
        {news && <span className="orb__news" aria-label="New answer" />}
      </button>
      <div className="orb__status">{verb ? <RookLabel verb={verb} /> : <span className="orb__hint">{news ? "Answer ready" : "Tap to ask"}</span>}</div>
      <div className="orb__row">
        <button className="orb__btn" onClick={onLook} title="Look at the page or app you're on" aria-label="Look">
          <IconCapture size={16} />
          <span>Look</span>
        </button>
        <button className="orb__btn orb__btn--icon" onClick={onOpen} title="Open ROOK" aria-label="Open">
          <IconExpand size={15} />
        </button>
      </div>
    </div>
  );
}
