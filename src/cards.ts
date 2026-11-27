/**
 * Result cards for research answers (as in the ROOK desktop app): small cards
 * that emerge beside the report, built only from what the answer already
 * contains. No AI and no network.
 */

export type CardKind = "sources" | "summary" | "findings" | "data" | "steps";

export interface ResultCard {
  key: string;
  kind: CardKind;
  title: string;
  /** The report heading this card comes from (for "Open in report" and its connecting line). */
  anchor: string | null;
  items: string[];
  sources?: { title: string; uri: string }[];
  table?: { head: string[]; rows: string[][] };
  /** Written by Gemini Nano on the device. */
  onDevice?: boolean;
}

export const CARD_ORDER: CardKind[] = ["sources", "summary", "findings", "data", "steps"];

interface Section {
  title: string;
  body: string[];
}

function sections(text: string): Section[] {
  const out: Section[] = [];
  let cur: Section | null = null;
  for (const line of text.split("\n")) {
    const h = line.match(/^#{1,4}\s+(.+)$/);
    if (h) {
      cur = { title: h[1]!.replace(/[*_`]/g, "").trim(), body: [] };
      out.push(cur);
    } else if (cur) cur.body.push(line);
  }
  return out;
}

const plain = (s: string) => s.replace(/\*\*|__|`/g, "").replace(/\[(.+?)\]\((.+?)\)/g, "$1").trim();
const listItems = (body: string[]) => body.filter((l) => /^\s*([-*•]|\d+\.)\s+/.test(l)).map((l) => plain(l.replace(/^\s*([-*•]|\d+\.)\s+/, "")));
const paragraph = (body: string[]) => plain(body.filter((l) => l.trim() && !/^\s*([-*•|]|\d+\.)/.test(l)).join(" "));

function table(body: string[]): ResultCard["table"] {
  const rows = body.filter((l) => /^\s*\|.*\|\s*$/.test(l));
  if (rows.length < 3) return undefined;
  const cells = (r: string) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => plain(c));
  return { head: cells(rows[0]!), rows: rows.slice(2).map(cells) };
}

const find = (all: Section[], re: RegExp) => all.find((s) => re.test(s.title));

export function cardsFromAnswer(id: string, text: string, sources: { title: string; uri: string }[] = [], deviceSummary?: string): ResultCard[] {
  const all = sections(text);
  const cards: ResultCard[] = [];
  const key = (k: CardKind) => `${id}:${k}`;
  if (sources.length) cards.push({ key: key("sources"), kind: "sources", title: `${sources.length} source${sources.length === 1 ? "" : "s"}`, anchor: null, items: [], sources });

  const overview = find(all, /overview|summary|in short|answer/i);
  const summaryText = deviceSummary?.trim() || (overview ? paragraph(overview.body) : "");
  if (summaryText)
    cards.push({
      key: key("summary"),
      kind: "summary",
      title: "Summary",
      anchor: overview?.title ?? null,
      items: deviceSummary ? deviceSummary.split("\n").map((l) => l.replace(/^\s*[•\-*]\s*/, "").trim()).filter(Boolean) : [summaryText],
      ...(deviceSummary ? { onDevice: true } : {}),
    });

  const findings = find(all, /finding|key points|highlights/i);
  const fItems = findings ? listItems(findings.body) : [];
  if (fItems.length) cards.push({ key: key("findings"), kind: "findings", title: "Findings", anchor: findings!.title, items: fItems });

  const tableSection = all.find((s) => table(s.body));
  const t = tableSection ? table(tableSection.body) : undefined;
  if (t && tableSection) cards.push({ key: key("data"), kind: "data", title: "Data", anchor: tableSection.title, items: [], table: t });

  const steps = find(all, /recommend|next step|action|what to do/i);
  const sItems = steps ? listItems(steps.body) : [];
  if (sItems.length) cards.push({ key: key("steps"), kind: "steps", title: "Next steps", anchor: steps!.title, items: sItems });

  return cards.sort((a, b) => CARD_ORDER.indexOf(a.kind) - CARD_ORDER.indexOf(b.kind));
}

/** Plain text of a card, for Copy and Save. */
export function cardText(card: ResultCard): string {
  const lines = [card.title, ""];
  if (card.table) {
    lines.push(`| ${card.table.head.join(" | ")} |`, `|${card.table.head.map(() => "---").join("|")}|`);
    for (const r of card.table.rows) lines.push(`| ${r.join(" | ")} |`);
  }
  for (const it of card.items) lines.push(card.kind === "summary" && card.items.length === 1 ? it : `- ${it}`);
  (card.sources ?? []).forEach((s, i) => lines.push(`${i + 1}. ${s.title} — ${s.uri}`));
  return lines.join("\n").trim();
}
