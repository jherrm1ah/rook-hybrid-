import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { activeDocument } from "./float";
import { IconRegion, IconScreen, IconWindow } from "./Icons";

export type LookKind = "screen" | "window" | "region";

/** Look's choices, as on the desktop: full screen, a window, or a region you drag. */
export function LookMenu({ up = false, onPick, onClose }: { up?: boolean; onPick: (k: LookKind) => void; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => !root.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const doc = activeDocument();
    const t = setTimeout(() => doc.addEventListener("mousedown", away));
    doc.addEventListener("keydown", esc);
    return () => {
      clearTimeout(t);
      doc.removeEventListener("mousedown", away);
      doc.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  const item = (k: LookKind, icon: ReactNode, label: string, hint: string) => (
    <button type="button" role="menuitem" className="lookmenu__item" onClick={() => onPick(k)}>
      {icon}
      <span>
        <strong>{label}</strong>
        <small>{hint}</small>
      </span>
    </button>
  );
  // On phones it's a sheet at the bottom of the screen (outside any animated parent).
  const view = activeDocument().defaultView ?? window;
  const sheet = view.matchMedia("(max-width: 640px)").matches;
  const menu = (
    <div ref={root} className={`lookmenu ${up ? "lookmenu--up" : ""} ${sheet ? "lookmenu--sheet" : ""}`} role="menu" aria-label="Look at">
      {item("screen", <IconScreen size={17} />, "Full screen", "Everything on this display")}
      {item("window", <IconWindow size={17} />, "A window or tab", "The app or page you choose")}
      {item("region", <IconRegion size={17} />, "Select region", "Drag to choose an area")}
    </div>
  );
  return sheet ? createPortal(<div className="lookmenu-scrim">{menu}</div>, activeDocument().body) : menu;
}
