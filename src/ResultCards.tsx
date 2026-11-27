import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { cardsFromAnswer, cardText, type ResultCard } from "./cards";
import { IconBookmark, IconCheck, IconChevronDown, IconClose, IconCopy } from "./Icons";

/**
 * Research results emerging beside the report as small cards (as in the ROOK
 * desktop app), each tied back to the part of the report it came from by a
 * thin line. Built only from the answer itself: no AI, no network.
 * Wide screens: a rail beside the report. Narrow screens: a strip under it.
 */

const STAGGER_MS = 480;
const revealed = new Set<string>();
const dismissed = new Set<string>();

type Line = { key: string; d: string; dim: boolean };

function headingEl(answerId: string, anchor: string | null): HTMLElement | null {
  const root = document.getElementById(`ans-${answerId}`);
  if (!root) return null;
  if (!anchor) return (root.parentElement?.querySelector(".report") as HTMLElement | null) ?? root;
  return ([...root.querySelectorAll("h2, h3")] as HTMLElement[]).find((h) => h.textContent?.trim() === anchor) ?? null;
}

export function ResultCards({
  id,
  text,
  sources,
  summary,
  rail,
  scroller,
  stage,
  onSave,
  saveLabel,
}: {
  id: string;
  text: string;
  sources?: { title: string; uri: string }[] | undefined;
  summary?: string | undefined;
  /** Show as a rail beside the report (wide screens) rather than a strip under it. */
  rail: boolean;
  /** The scrolling thread (for the lines). */
  scroller?: RefObject<HTMLElement | null>;
  /** The element the lines are drawn in (holds both the thread and the rail). */
  stage?: RefObject<HTMLElement | null>;
  onSave?: ((title: string, text: string) => void) | undefined;
  saveLabel?: string | undefined;
}) {
  const all = useMemo(() => cardsFromAnswer(id, text, sources, summary), [id, text, sources, summary]);
  const [visible, setVisible] = useState<string[]>(() => all.filter((c) => revealed.has(c.key)).map((c) => c.key));
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<Record<string, "copied" | "saved">>({});
  const [gone, bump] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const cardEls = useRef(new Map<string, HTMLElement>());

  // Cards emerge one at a time.
  useEffect(() => {
    const next = all.find((c) => !visible.includes(c.key) && !dismissed.has(c.key));
    if (!next) return;
    const t = setTimeout(() => {
      revealed.add(next.key);
      setVisible((v) => [...v, next.key]);
    }, visible.length ? STAGGER_MS : 250);
    return () => clearTimeout(t);
  }, [all, visible]);

  const shown = useMemo(() => all.filter((c) => visible.includes(c.key) && !dismissed.has(c.key)), [all, visible, gone]); // eslint-disable-line react-hooks/exhaustive-deps
  const lastLines = useRef("");

  // Thin lines from each card back to its section of the report.
  const draw = useCallback(() => {
    const box = stage?.current?.getBoundingClientRect();
    const set = (l: Line[]) => {
      const sig = JSON.stringify(l);
      if (sig === lastLines.current) return;
      lastLines.current = sig;
      setLines(l);
    };
    if (!rail || !box) return set([]);
    const out: Line[] = [];
    for (const c of shown) {
      const card = cardEls.current.get(c.key);
      const head = headingEl(id, c.anchor);
      if (!card || !head) continue;
      const cr = card.getBoundingClientRect();
      const hr = head.getBoundingClientRect();
      const article = head.closest("article")?.getBoundingClientRect();
      const x1 = (article?.right ?? hr.right) - box.left - 2;
      const yRaw = hr.top + Math.min(hr.height, 24) / 2 - box.top;
      const y1 = Math.max(8, Math.min(box.height - 8, yRaw));
      const x2 = cr.left - box.left;
      const y2 = cr.top + 22 - box.top;
      if (y2 < 0 || y2 > box.height) continue;
      const mx = (x1 + x2) / 2;
      out.push({ key: c.key, d: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`, dim: yRaw < 0 || yRaw > box.height });
    }
    set(out);
  }, [rail, shown, id, stage]);

  useLayoutEffect(() => {
    draw();
  }, [draw, open]);
  useEffect(() => {
    if (!rail) return;
    let raf = 0;
    const later = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    };
    const s = scroller?.current;
    s?.addEventListener("scroll", later, { passive: true });
    addEventListener("resize", later);
    const railEl = cardEls.current.values().next().value?.parentElement;
    railEl?.addEventListener("scroll", later, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      s?.removeEventListener("scroll", later);
      removeEventListener("resize", later);
      railEl?.removeEventListener("scroll", later);
    };
  }, [rail, draw, scroller, shown.length]);

  if (!all.length) return null;

  const goTo = (c: ResultCard) => headingEl(id, c.anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const flag = (k: string, v: "copied" | "saved") => {
    setDone((d) => ({ ...d, [k]: v }));
    setTimeout(() => setDone((d) => Object.fromEntries(Object.entries(d).filter(([x]) => x !== k))), 1500);
  };

  const cards = shown.map((c) => {
    const expanded = open.has(c.key);
    const preview = c.kind === "summary" ? 3 : c.kind === "sources" ? 4 : 3;
    const items = expanded ? c.items : c.items.slice(0, preview);
    const srcs = expanded ? c.sources : c.sources?.slice(0, preview);
    const rows = expanded ? c.table?.rows : c.table?.rows.slice(0, 3);
    const more = c.items.length > preview || (c.sources?.length ?? 0) > preview || (c.table?.rows.length ?? 0) > 3;
    return (
      <section
        key={c.key}
        ref={(el) => {
          if (el) cardEls.current.set(c.key, el);
          else cardEls.current.delete(c.key);
        }}
        className={`rc rc--${c.kind}`}
        aria-label={c.title}
      >
        <header className="rc__head">
          <h4>
            {c.title}
            {c.onDevice && <span className="rc__where">on your device</span>}
          </h4>
          <button
            className="rc__x"
            aria-label={`Close ${c.title}`}
            onClick={() => {
              dismissed.add(c.key);
              bump((n) => n + 1);
            }}
          >
            <IconClose size={12} />
          </button>
        </header>
        {srcs && (
          <ol className="rc__sources">
            {srcs.map((s, i) => (
              <li key={s.uri}>
                <span className="rc__n">{i + 1}</span>
                <a href={s.uri} target="_blank" rel="noreferrer noopener">
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        )}
        {c.kind === "summary" && c.items.length === 1 ? (
          <p className={`rc__text ${expanded ? "" : "rc__text--clamp"}`}>{c.items[0]}</p>
        ) : (
          items.length > 0 && (
            <ul className="rc__items">
              {items.map((it, i) => (
                <li key={i}>{it}</li>
              ))}
            </ul>
          )
        )}
        {c.table && rows && (
          <div className="rc__table">
            <table>
              <thead>
                <tr>
                  {c.table.head.map((h, i) => (
                    <th key={i}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((v, j) => (
                      <td key={j}>{v}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <footer className="rc__foot">
          {(more || (c.kind === "summary" && c.items.length === 1 && c.items[0]!.length > 160)) && (
            <button className="rc__btn" onClick={() => setOpen((s) => (s.has(c.key) ? (s.delete(c.key), new Set(s)) : new Set(s).add(c.key)))}>
              <IconChevronDown size={12} className={expanded ? "rc__flip" : ""} /> {expanded ? "Less" : "More"}
            </button>
          )}
          <span className="rc__spacer" />
          <button className="rc__btn" onClick={() => goTo(c)}>
            Open in report
          </button>
          <button className="rc__btn" aria-label="Copy" onClick={() => void navigator.clipboard?.writeText(cardText(c)).then(() => flag(c.key, "copied"))}>
            {done[c.key] === "copied" ? <IconCheck size={13} /> : <IconCopy size={13} />}
          </button>
          {onSave && (
            <button
              className="rc__btn"
              aria-label={saveLabel ?? "Save"}
              title={saveLabel ?? "Save"}
              onClick={() => {
                onSave(c.title, cardText(c));
                flag(c.key, "saved");
              }}
            >
              {done[c.key] === "saved" ? <IconCheck size={13} /> : <IconBookmark size={13} />}
            </button>
          )}
        </footer>
      </section>
    );
  });

  return rail ? (
    <>
      <svg className="rc-lines" aria-hidden="true">
        {lines.map((l) => (
          <g key={l.key} className={l.dim ? "rc-line rc-line--dim" : "rc-line"}>
            <path d={l.d} />
            <circle r="3" cx={l.d.split(" ")[1]} cy={l.d.split(" ")[2]} />
          </g>
        ))}
      </svg>
      <aside className="rc-rail" aria-label="Result cards">
        {cards}
      </aside>
    </>
  ) : (
    <div className="rc-strip" aria-label="Result cards">
      {cards}
    </div>
  );
}
