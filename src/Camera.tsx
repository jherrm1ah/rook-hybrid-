import { useEffect, useRef, useState } from "react";
import { IconCamera, IconClose } from "./Icons";

/** Scan: the camera, one photo, nothing recorded. Chrome asks for permission first. */
export function Camera({ onShot, onClose }: { onShot: (img: { mimeType: "image/jpeg"; data: string }) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: facing, width: { ideal: 1600 } }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play();
        }
      })
      .catch((e: Error) => setError(e.name === "NotAllowedError" ? "Camera access was blocked. Allow it in Chrome's address bar to scan." : "No camera was found on this device."));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [facing]);

  const shoot = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const scale = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    onShot({ mimeType: "image/jpeg", data: c.toDataURL("image/jpeg", 0.85).split(",")[1] ?? "" });
  };

  return (
    <div className="scrim" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="camera" role="dialog" aria-modal="true" aria-label="Scan with your camera">
        <button className="camera__close" aria-label="Close" onClick={onClose}>
          <IconClose size={16} />
        </button>
        {error ? <p className="camera__error">{error}</p> : <video ref={video} className="camera__view" playsInline muted />}
        <div className="camera__row">
          <button className="ghost" onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}>
            Switch camera
          </button>
          <button className="camera__shoot" aria-label="Take photo" disabled={Boolean(error)} onClick={shoot}>
            <IconCamera size={22} />
          </button>
          <span className="camera__note">One photo. Nothing is recorded.</span>
        </div>
      </div>
    </div>
  );
}
