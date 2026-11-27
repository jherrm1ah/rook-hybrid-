/**
 * Float: ROOK in a small always-on-top window (Chrome's Document
 * Picture-in-Picture), so it stays beside whatever app you're using.
 * The whole app moves into the floating window and comes back when it closes.
 */

interface PipApi {
  requestWindow(options: { width: number; height: number }): Promise<Window>;
}

const api = (): PipApi | undefined => (globalThis as unknown as { documentPictureInPicture?: PipApi }).documentPictureInPicture;

export const canFloat = () => Boolean(api());

let current: Window | null = null;

/** The document ROOK is showing in right now (the floating window's, while floating). */
export function activeDocument(): Document {
  return current?.document ?? document;
}

export async function float(onBack: () => void): Promise<boolean> {
  const pipApi = api();
  const root = document.getElementById("root");
  if (!pipApi || !root) return false;
  const pip = await pipApi.requestWindow({ width: 420, height: 680 });
  // Same look: copy the page's styles.
  for (const sheet of [...document.styleSheets]) {
    try {
      const style = pip.document.createElement("style");
      style.textContent = [...sheet.cssRules].map((r) => r.cssText).join("\n");
      pip.document.head.append(style);
    } catch {
      if (sheet.href) {
        const link = pip.document.createElement("link");
        link.rel = "stylesheet";
        link.href = sheet.href;
        pip.document.head.append(link);
      }
    }
  }
  pip.document.title = "ROOK";
  pip.document.documentElement.lang = document.documentElement.lang;

  // A note in the page while ROOK floats.
  const note = document.createElement("div");
  note.className = "floating-note";
  note.innerHTML = `<p><strong>ROOK is floating.</strong> It stays on top of your other apps.</p>`;
  const back = document.createElement("button");
  back.textContent = "Bring ROOK back here";
  back.onclick = () => pip.close();
  note.append(back);

  const parent = root.parentElement!;
  const next = root.nextSibling;
  parent.insertBefore(note, root);
  pip.document.body.append(root);
  current = pip;
  pip.addEventListener("pagehide", () => {
    current = null;
    parent.insertBefore(root, next);
    note.remove();
    onBack();
  });
  return true;
}

export function unfloat(): void {
  current?.close();
}
