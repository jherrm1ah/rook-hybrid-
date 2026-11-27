import { useEffect, useRef, useState, type PointerEvent } from "react";
import { IconCheck, IconRegion } from "./Icons";

export type Rect = { x: number; y: number; w: number; h: number };

/**
 * Select region (from the desktop app): drag a box over the screenshot just
 * taken. Cropping happens on this device; only the selected part is used.
 */
export function CropModal({ image, onCancel, onDone }: { image: { mimeType: string; data: string }; onCancel: () => void; onDone: (rect: Rect) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const valid = Boolean(rect && rect.w > 0.01 && rect.h > 0.01);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter" && rect && valid) onDone(rect);
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [rect, valid, onCancel, onDone]);

  const point = (e: PointerEvent) => {
    const b = box.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), y: Math.min(1, Math.max(0, (e.clientY - b.top) / b.height)) };
  };

  return (
    <div className="scrim scrim--crop" role="dialog" aria-modal="true" aria-label="Select a region">
      <div className="crop">
        <header className="crop__head">
          <IconRegion size={16} />
          <span>Drag to select the part of the screen to ask about</span>
        </header>
        <div className="crop__area">
          <div
            ref={box}
            className={`crop__stage ${rect ? "crop__stage--sel" : ""}`}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              const p = point(e);
              start.current = p;
              setRect({ x: p.x, y: p.y, w: 0, h: 0 });
            }}
            onPointerMove={(e) => {
              if (!start.current) return;
              const p = point(e);
              const s = start.current;
              setRect({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
            }}
            onPointerUp={() => (start.current = null)}
          >
            <img src={`data:${image.mimeType};base64,${image.data}`} alt="Your screen" draggable={false} />
            {rect && <div className="crop__sel" style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }} />}
          </div>
        </div>
        <footer className="crop__foot">
          <button className="ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="ghost" onClick={() => onDone({ x: 0, y: 0, w: 1, h: 1 })}>
            Use whole screen
          </button>
          <button className="primary" disabled={!valid} onClick={() => rect && valid && onDone(rect)}>
            <IconCheck size={15} /> Use selection
          </button>
        </footer>
      </div>
    </div>
  );
}

/** Crops an image on the device to a fraction-based rectangle. */
export async function crop(image: { mimeType: string; data: string }, r: Rect): Promise<{ mimeType: "image/jpeg"; data: string }> {
  const img = new Image();
  img.src = `data:${image.mimeType};base64,${image.data}`;
  await img.decode();
  const sx = Math.round(r.x * img.naturalWidth);
  const sy = Math.round(r.y * img.naturalHeight);
  const sw = Math.max(1, Math.round(r.w * img.naturalWidth));
  const sh = Math.max(1, Math.round(r.h * img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = sw;
  c.height = sh;
  c.getContext("2d")!.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return { mimeType: "image/jpeg", data: c.toDataURL("image/jpeg", 0.88).split(",")[1] ?? "" };
}
