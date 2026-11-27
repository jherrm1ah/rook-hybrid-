/**
 * Projects, kept on this device only: a name and notes (goals, decisions,
 * context) that ROOK reads with every question in that project.
 */
export interface Project {
  id: string;
  name: string;
  notes: string;
  createdAt: number;
}

interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const KEY = "rook.chrome.projects.v1";
const CURRENT = "rook.chrome.project.current";

export function load(kv: KV): Project[] {
  try {
    const list = JSON.parse(kv.getItem(KEY) ?? "[]") as Project[];
    return Array.isArray(list) ? list.filter((p) => p && typeof p.id === "string" && typeof p.name === "string") : [];
  } catch {
    return [];
  }
}

function write(kv: KV, list: Project[]): Project[] {
  try {
    kv.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage full or blocked: keep it for this visit */
  }
  return list;
}

export function create(kv: KV, name: string, now = Date.now()): { list: Project[]; project: Project } {
  const project = { id: Math.random().toString(36).slice(2, 10), name: name.trim().slice(0, 60), notes: "", createdAt: now };
  return { list: write(kv, [project, ...load(kv)]), project };
}

export function update(kv: KV, id: string, patch: Partial<Pick<Project, "name" | "notes">>): Project[] {
  return write(
    kv,
    load(kv).map((p) => (p.id === id ? { ...p, ...patch, name: (patch.name ?? p.name).slice(0, 60), notes: (patch.notes ?? p.notes).slice(0, 4000) } : p)),
  );
}

export function remove(kv: KV, id: string): Project[] {
  if (currentId(kv) === id) setCurrent(kv, null);
  return write(kv, load(kv).filter((p) => p.id !== id));
}

export function currentId(kv: KV): string | null {
  return kv.getItem(CURRENT);
}

export function setCurrent(kv: KV, id: string | null): void {
  if (id) kv.setItem(CURRENT, id);
  else kv.removeItem(CURRENT);
}

/** The project's context, put in front of the question (so the Privacy Shield cleans it too). */
export function withContext(project: Project | undefined, text: string): string {
  if (!project) return text;
  const notes = project.notes.trim();
  return `[Project: ${project.name}${notes ? `. Notes: ${notes}` : ""}]\n\n${text}`;
}
