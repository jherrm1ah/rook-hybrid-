import { useState } from "react";
import { IconClose, IconTrash } from "./Icons";
import type { Project } from "./projects";

/** Projects: a name and notes ROOK reads with every question in that project. Kept on this device. */
export function ProjectsPanel({
  projects,
  current,
  onCreate,
  onPick,
  onUpdate,
  onDelete,
  onClose,
}: {
  projects: Project[];
  current: string | null;
  onCreate: (name: string) => void;
  onPick: (id: string | null) => void;
  onUpdate: (id: string, patch: { name?: string; notes?: string }) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const open = projects.find((p) => p.id === current);
  return (
    <div className="history-anchor">
      <aside className="history" aria-label="Projects">
        <div className="history__head">
          <h2>Projects</h2>
          <button className="history__close" aria-label="Close" onClick={onClose}>
            <IconClose size={15} />
          </button>
        </div>
        <p className="history__note">ROOK reads a project's notes with every question in it. Saved only on this device.</p>
        <form
          className="projects__new"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            onCreate(name);
            setName("");
          }}
        >
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New project, e.g. Shop invoices" aria-label="New project name" maxLength={60} />
          <button className="primary" disabled={!name.trim()}>
            Add
          </button>
        </form>
        {projects.length > 0 && (
          <ul className="history__list">
            <li className={current === null ? "current" : ""}>
              <button className="history__item" onClick={() => onPick(null)}>
                <span className="history__title">No project</span>
              </button>
            </li>
            {projects.map((p) => (
              <li key={p.id} className={p.id === current ? "current" : ""}>
                <button className="history__item" onClick={() => onPick(p.id)}>
                  <span className="history__title">{p.name}</span>
                  <span className="history__meta">{p.notes.trim() ? `${p.notes.trim().slice(0, 50)}${p.notes.length > 50 ? "…" : ""}` : "No notes yet"}</span>
                </button>
                <button className="history__del" aria-label={`Delete project “${p.name}”`} title="Delete" onClick={() => confirm(`Delete the project “${p.name}”?`) && onDelete(p.id)}>
                  <IconTrash size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {open && (
          <label className="projects__notes">
            <span>Notes for {open.name}</span>
            <textarea
              defaultValue={open.notes}
              key={open.id}
              rows={4}
              placeholder="Goals, decisions, who it's for, how you like things written…"
              onBlur={(e) => onUpdate(open.id, { notes: e.target.value })}
            />
          </label>
        )}
      </aside>
    </div>
  );
}
