// Kleine Helfer: Icons, Formatierung, Toasts, Dialoge, Fuzzy-Suche.

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const ICONS: Record<string, string> = {
  logo: '<path d="M4 2v8a3 3 0 0 0 3 3h5"/><circle cx="4" cy="2.5" r="1.6"/><circle cx="12" cy="13" r="1.6"/><path d="M12 2.5v4.2A3 3 0 0 1 9 9.5H7.5"/>',
  changes: '<path d="M4 2.5h5l3 3V13.5H4z"/><path d="M6.5 8.5h4M6.5 11h2.5"/>',
  branch: '<circle cx="5" cy="3.5" r="1.7"/><circle cx="5" cy="12.5" r="1.7"/><circle cx="11.5" cy="6.5" r="1.7"/><path d="M5 5.2v5.6M5 8.5h3a3.5 3.5 0 0 0 3.5-2"/>',
  history: '<circle cx="8" cy="8" r="6"/><path d="M8 4.6V8l2.6 1.6"/>',
  console: '<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M5 6.5l2 1.8-2 1.8M8.5 10.5h3"/>',
  refresh: '<path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.6 2.6v3.2h-3.2"/>',
  fetch: '<path d="M5 10.5a3.2 3.2 0 0 1-.4-6.4 4.2 4.2 0 0 1 8-.6A2.9 2.9 0 0 1 12.3 10.5"/><path d="M8 7.6v6"/><path d="M5.9 11.4L8 13.5l2.1-2.1"/>',
  pull: '<path d="M8 2.5v7"/><path d="M5.2 6.8L8 9.6l2.8-2.8"/><path d="M3 11.5v1.2a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1.2"/>',
  push: '<path d="M8 13.5v-7"/><path d="M5.2 9.2L8 6.4l2.8 2.8"/><path d="M3 4.5V3.3a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v1.2"/>',
  merge: '<circle cx="5" cy="12.5" r="1.7"/><circle cx="11" cy="12.5" r="1.7"/><circle cx="8" cy="3.5" r="1.7"/><path d="M8 5.2v2.3a5 5 0 0 1-3 4.6M8 7.5a5 5 0 0 1 3 4.6"/>',
  plus: '<path d="M8 3.5v9M3.5 8h9"/>',
  check: '<path d="M3.5 8.5l3 3 6-7"/>',
  chevron: '<path d="M4 6.5L8 10.5l4-4"/>',
  right: '<path d="M6.5 4L10.5 8l-4 4"/>',
  search: '<circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2L14 14"/>',
  folder: '<path d="M2.5 4.5a1 1 0 0 1 1-1h3l1.5 1.6h4.5a1 1 0 0 1 1 1v6.4a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z"/>',
  close: '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>',
  left: '<path d="M4 8h8M8.5 4.5L5 8l3.5 3.5"/>',
  both: '<path d="M8 3v10"/><path d="M5.5 5.5L3 8l2.5 2.5M10.5 5.5L13 8l-2.5 2.5"/>',
  undo: '<path d="M3.5 8.5h5.2a3 3 0 1 1 0 6H6"/><path d="M6 5.5L3 8.5l3 3"/>',
  wand: '<path d="M3 13l6.5-6.5"/><path d="M10 3.2l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6L7.7 5.5l1.6-.7z"/>',
  warning: '<path d="M8 2.8l5.5 10H2.5z"/><path d="M8 6.5v3.2M8 11.4v.1"/>',
  file: '<path d="M4 2.5h5l3 3v8H4z"/>',
  trash: '<path d="M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.7 8.5h4.6l.7-8.5"/>',
  pencil: '<path d="M11.2 2.8l2 2-7 7-2.6.6.6-2.6z"/>',
  tag: '<path d="M8.5 2.5H13v4.5l-6 6-4.5-4.5z"/><circle cx="10.6" cy="5" r=".9"/>',
  drag: '<circle cx="6" cy="4" r="1"/><circle cx="10" cy="4" r="1"/><circle cx="6" cy="8" r="1"/><circle cx="10" cy="8" r="1"/><circle cx="6" cy="12" r="1"/><circle cx="10" cy="12" r="1"/>',
  compare: '<path d="M5 3v10M11 3v10"/><path d="M3 6.5h4M9 6.5h4"/>',
  clipboard: '<rect x="4" y="3" width="8" height="11" rx="1.2"/><path d="M6.5 3V2h3v1"/>',
};

export function icon(name: keyof typeof ICONS | string, size = 16): string {
  const path = ICONS[name] ?? ICONS.file;
  return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  html?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

/** "vor 3 Std." / "gestern" / Datum */
export function relTime(ts: number): string {
  if (!ts) return "";
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return "gerade";
  if (diff < 3600) return `vor ${Math.floor(diff / 60)} Min.`;
  if (diff < 86400) return `vor ${Math.floor(diff / 3600)} Std.`;
  if (diff < 172800) return "gestern";
  if (diff < 2592000) return `vor ${Math.floor(diff / 86400)} Tagen`;
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export function absTime(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function splitPath(p: string): { dir: string; base: string } {
  const i = p.lastIndexOf("/");
  return i < 0 ? { dir: "", base: p } : { dir: p.slice(0, i + 1), base: p.slice(i + 1) };
}

/** Reihenfolge-Unabhängige Teilübereinstimmung für die Branch-Suche. */
export function fuzzy(needleRaw: string, haystack: string): { score: number; hits: number[] } | null {
  const needle = needleRaw.toLowerCase();
  const hay = haystack.toLowerCase();
  if (!needle) return { score: 0, hits: [] };
  const hits: number[] = [];
  let hi = 0;
  let score = 0;
  let streak = 0;
  for (const ch of needle) {
    const found = hay.indexOf(ch, hi);
    if (found < 0) return null;
    if (found === hi) {
      streak += 1;
      score += 2 + streak;
    } else {
      streak = 0;
      score += 1;
    }
    if (found === 0 || "/-_.".includes(hay[found - 1])) score += 3;
    hits.push(found);
    hi = found + 1;
  }
  score -= haystack.length * 0.02;
  return { score, hits };
}

export function markHits(text: string, hits: number[]): string {
  if (!hits.length) return esc(text);
  const set = new Set(hits);
  let out = "";
  for (let i = 0; i < text.length; i++) {
    out += set.has(i) ? `<span class="hit">${esc(text[i])}</span>` : esc(text[i]);
  }
  return out;
}

// ------------------------------------------------------------------ Toasts

export function toast(message: string, kind: "ok" | "err" | "info" = "ok", ms?: number) {
  const host = document.querySelector(".toasts");
  if (!host) return;
  const node = el("div", `toast ${kind === "ok" ? "" : kind}`, esc(message));
  host.appendChild(node);
  const life = ms ?? (kind === "err" ? 9000 : 4500);
  setTimeout(() => node.remove(), life);
}

// ------------------------------------------------------------------ Dialoge

interface ModalButton<T> {
  label: string;
  value: T;
  primary?: boolean;
}

export function modal<T>(
  title: string,
  detail: string,
  buttons: ModalButton<T>[],
): Promise<T | null> {
  return new Promise((resolve) => {
    const host = document.querySelector(".modal-host") as HTMLElement;
    if (!host) return resolve(null);
    host.innerHTML = `
      <div class="modal-back">
        <div class="modal">
          <h3>${esc(title)}</h3>
          ${detail ? `<div class="detail">${esc(detail)}</div>` : ""}
          <div class="actions">
            ${buttons
              .map(
                (b, i) =>
                  `<button class="btn ${b.primary ? "primary" : ""}" data-i="${i}">${esc(b.label)}</button>`,
              )
              .join("")}
          </div>
        </div>
      </div>`;
    const finish = (v: T | null) => {
      host.innerHTML = "";
      resolve(v);
    };
    host.addEventListener("click", (e) => {
      const raw = (e.target as HTMLElement).dataset.i;
      if (raw === undefined) return;
      finish(buttons[Number(raw)].value);
    });
    host.querySelector(".modal-back")?.addEventListener("click", (e) => {
      if (e.target === host.querySelector(".modal-back")) finish(null);
    });
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape") finish(null);
      },
      { once: true },
    );
  });
}

export function confirmDialog(title: string, detail = "", okLabel = "Ok"): Promise<boolean> {
  return modal(title, detail, [
    { label: "Abbrechen", value: false },
    { label: okLabel, value: true, primary: true },
  ]).then((v) => v === true);
}

export function askText(
  title: string,
  label: string,
  initial = "",
  okLabel = "Ok",
): Promise<string | null> {
  return new Promise((resolve) => {
    const host = document.querySelector(".modal-host") as HTMLElement;
    if (!host) return resolve(null);
    host.innerHTML = `
      <div class="modal-back">
        <div class="modal">
          <h3>${esc(title)}</h3>
          <div class="detail">${esc(label)}</div>
          <input type="text" class="m-input" value="${esc(initial)}" />
          <div class="actions">
            <button class="btn" data-v="cancel">Abbrechen</button>
            <button class="btn primary" data-v="ok">${esc(okLabel)}</button>
          </div>
        </div>
      </div>`;
    const input = host.querySelector("input") as HTMLInputElement;
    input.focus();
    input.select();
    const finish = (v: string | null) => {
      host.innerHTML = "";
      resolve(v);
    };
    host.addEventListener("click", (e) => {
      const v = (e.target as HTMLElement).dataset.v;
      if (v === "ok") finish(input.value.trim() || null);
      else if (v === "cancel") finish(null);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") finish(input.value.trim() || null);
      if (e.key === "Escape") finish(null);
    });
  });
}
