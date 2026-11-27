import { useEffect, useRef, useState } from "react";
import { IconCapture, IconShield } from "./Icons";
import { RookBird } from "./rook/RookBird";

const KEY = "rook.chrome.onboarded.v1";
const STEPS = 3;

export function onboarded(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return true;
  }
}

/** First run, from the ROOK desktop app: what ROOK is, how Look works, and how your details stay yours. */
export function Onboarding({ onLook, onDone }: { onLook: () => void; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const primary = useRef<HTMLButtonElement>(null);
  const finish = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* private window: show again next time */
    }
    onDone();
  };
  const next = () => setStep((s) => Math.min(s + 1, STEPS - 1));

  useEffect(() => primary.current?.focus(), [step]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && finish();
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="scrim" role="presentation">
      <div className="onboard" role="dialog" aria-modal="true" aria-labelledby="onboard-title">
        <button className="onboard__skip" onClick={finish}>
          Skip
        </button>
        <div className="onboard__art" key={step}>
          {step === 0 && <RookBird behavior="rooking" size={76} />}
          {step === 1 && (
            <span className="onboard__icon">
              <IconCapture size={30} />
            </span>
          )}
          {step === 2 && (
            <span className="onboard__icon onboard__icon--teal">
              <IconShield size={30} />
            </span>
          )}
        </div>

        <div className="onboard__body" key={`b${step}`}>
          {step === 0 && (
            <>
              <h2 id="onboard-title">Meet ROOK</h2>
              <p>An AI assistant that thinks on your device first. Gemini Nano answers right here in Chrome: private, instant and free. ROOK asks the cloud only when it isn't sure.</p>
            </>
          )}
          {step === 1 && (
            <>
              <h2 id="onboard-title">Let ROOK look</h2>
              <p>Tap Look and share a window, so you can just ask “what's wrong here?”</p>
              <ul className="onboard__promises">
                <li>
                  <IconShield size={15} /> Only when you ask. Chrome asks you first.
                </li>
                <li>
                  <IconShield size={15} /> One picture, never a recording.
                </li>
                <li>
                  <IconShield size={15} /> Read on your device whenever it can be.
                </li>
              </ul>
            </>
          )}
          {step === 2 && (
            <>
              <h2 id="onboard-title">Your details stay yours</h2>
              <ul className="onboard__promises">
                <li>
                  <IconShield size={15} /> Names, emails and numbers are hidden before anything reaches the cloud.
                </li>
                <li>
                  <IconShield size={15} /> Tap “What the cloud saw” to check, on any answer.
                </li>
                <li>
                  <IconShield size={15} /> No internet? ROOK keeps answering on your device.
                </li>
              </ul>
            </>
          )}
        </div>

        <footer className="onboard__foot">
          <div className="onboard__dots" aria-label={`Step ${step + 1} of ${STEPS}`}>
            {Array.from({ length: STEPS }, (_, i) => (
              <span key={i} className={i === step ? "on" : i < step ? "past" : ""} />
            ))}
          </div>
          <div className="onboard__actions">
            {step === 0 && (
              <button ref={primary} className="primary" onClick={next}>
                Get started
              </button>
            )}
            {step === 1 && (
              <>
                <button className="ghost" onClick={next}>
                  Later
                </button>
                <button
                  ref={primary}
                  className="primary"
                  onClick={() => {
                    finish();
                    onLook();
                  }}
                >
                  Try Look now
                </button>
              </>
            )}
            {step === 2 && (
              <button ref={primary} className="primary" onClick={finish}>
                Start
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
