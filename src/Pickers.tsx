import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconCheck, IconChevronDown } from "./Icons";

export interface Option<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

/** A small pop-up menu above the message box (like the desktop's Project and Auto pickers). */
export function Picker<T extends string>({
  icon,
  label,
  options,
  value,
  onPick,
  footer,
  title,
  compact = false,
}: {
  icon: ReactNode;
  label: string;
  options: Option<T>[];
  value: T | null;
  onPick: (v: T) => void;
  footer?: ReactNode;
  title?: string;
  /** Show only the icon on small screens. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("mousedown", away);
    addEventListener("keydown", esc);
    return () => {
      removeEventListener("mousedown", away);
      removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className={`picker ${compact ? "picker--compact" : ""}`} ref={root}>
      <button type="button" className="picker__btn" aria-haspopup="menu" aria-expanded={open} title={title} onClick={() => setOpen((v) => !v)}>
        {icon}
        <span className="picker__label">{label}</span>
        <IconChevronDown size={13} />
      </button>
      {open && (
        <div className="menu" role="menu">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="menuitemradio"
              aria-checked={o.value === value}
              className="menu__item"
              onClick={() => {
                onPick(o.value);
                setOpen(false);
              }}
            >
              <span className="menu__text">
                <span>{o.label}</span>
                {o.hint && <small>{o.hint}</small>}
              </span>
              {o.value === value && <IconCheck size={14} />}
            </button>
          ))}
          {footer && (
            <div className="menu__foot" onClick={() => setOpen(false)}>
              {footer}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
