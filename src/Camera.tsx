import { useEffect, useRef, useState } from "react";
import { IconCamera, IconClose } from "./Icons";

/**
 * Scan, as in the ROOK desktop app: a viewfinder with corner marks and a
 * scan line, a flash when you take the photo, then ROOK reads it.
 * One photo, nothing recorded. Chrome asks for permission first.
 */
export function Camera({ onShot, onClose }: { onShot: (img: { mimeType: "image/jpeg"; data: string }) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [ready, setReady] = useState(false);
  const [flash, setFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    setReady(false);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser can't use a camera.");
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: facing, width: { ideal: 1600 } }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        setError(null);
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play().then(() => setReady(true));
        }
      })
      .catch((e: Error) => setError(e.name === "NotAllowedError" ? "Camera access was blocked. Allow it from the icon in Chrome's address bar, then try again." : "No camera was found on this device."));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [facing]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [onClose]);

  const shoot = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const scale = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    const data = c.toDataURL("image/jpeg", 0.85).split(",")[1] ?? "";
    setFlash(true);
    setTimeout(() => onShot({ mimeType: "image/jpeg", data }), 200);
  };

  return (
    <div className="scrim" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="camera" role="dialog" aria-modal="true" aria-label="Scan with your camera">
        <header className="camera__head">
          <span className="camera__title">
            <span className="camera__dot" aria-hidden="true" /> Scan
          </span>
          <button className="camera__close" aria-label="Close camera" onClick={onClose}>
            <IconClose size={16} />
          </button>
        </header>
        <div className={`viewfinder ${flash ? "viewfinder--flash" : ""} ${ready ? "viewfinder--live" : ""}`}>
          <video ref={video} playsInline muted />
          {!ready && !error && <div className="viewfinder__msg">Starting camera…</div>}
          {error && <div className="viewfinder__msg viewfinder__msg--error">{error}</div>}
          <span className="viewfinder__line" aria-hidden="true" />
          <span className="viewfinder__corner viewfinder__corner--tl" />
          <span className="viewfinder__corner viewfinder__corner--tr" />
          <span className="viewfinder__corner viewfinder__corner--bl" />
          <span className="viewfinder__corner viewfinder__corner--br" />
        </div>
        <p className="camera__hint">Point at a document, receipt, note, product or diagram.</p>
        <div className="camera__row">
          <button className="camera__switch" onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}>
            Switch camera
          </button>
          <button className="shutter" aria-label="Take photo" disabled={!ready || flash} onClick={shoot}>
            <IconCamera size={22} />
          </button>
          <span className="camera__note">One photo. Nothing is recorded.</span>
        </div>
      </div>
    </div>
  );
}
