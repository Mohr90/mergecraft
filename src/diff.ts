// Diff-Ansicht: nebeneinander oder vereint, mit Zeilennummern und
// wortweiser Hervorhebung (wie im WebStorm-Diff).

import type { FileDiff, Highlights } from "./api";
import { el, esc, icon } from "./ui";
import { baseName, dirName } from "./merge";

export type DiffMode = "split" | "unified";

interface Segment {
  type: "equal" | "change";
  a: [number, number];
  b: [number, number];
}

const LIMIT = 6000;

function segments(diff: FileDiff, a: string[], b: string[]): Segment[] {
  const out: Segment[] = [];
  let ai = 0;
  let bi = 0;
  for (const blk of diff.blocks) {
    if (blk.a_start > ai || blk.b_start > bi) {
      out.push({ type: "equal", a: [ai, blk.a_start], b: [bi, blk.b_start] });
    }
    out.push({
      type: "change",
      a: [blk.a_start, blk.a_start + blk.a_len],
      b: [blk.b_start, blk.b_start + blk.b_len],
    });
    ai = blk.a_start + blk.a_len;
    bi = blk.b_start + blk.b_len;
  }
  if (ai < a.length || bi < b.length) {
    out.push({ type: "equal", a: [ai, a.length], b: [bi, b.length] });
  }
  return out;
}

export class DiffView {
  mode: DiffMode = "split";
  private diff!: FileDiff;
  private root: HTMLElement | null = null;

  constructor(private onClose: () => void) {}

  set(diff: FileDiff, mode: DiffMode = "split") {
    this.diff = diff;
    this.mode = mode;
    if (this.root) this.render();
  }

  mount(target: HTMLElement) {
    this.root = target;
    this.render();
  }

  private render() {
    const target = this.root;
    if (!target) return;
    const d = this.diff;
    const a = splitLines(d.a_text);
    const b = splitLines(d.b_text);
    const segs = segments(d, a, b);
    const added = d.blocks.reduce((n, x) => n + x.b_len, 0);
    const removed = d.blocks.reduce((n, x) => n + x.a_len, 0);

    target.innerHTML = "";
    const wrap = el("div", `diff diff-${this.mode}`);

    const head = el("div", "diff-head");
    head.innerHTML = `
      <div class="file"><span class="name">${esc(baseName(d.path))}</span>
        <span class="dir small muted">${esc(dirName(d.path))}</span></div>
      <span class="badge add">+${added}</span>
      <span class="badge del">−${removed}</span>
      <div class="segmented">
        <button data-mode="split" class="${this.mode === "split" ? "active" : ""}">Nebeneinander</button>
        <button data-mode="unified" class="${this.mode === "unified" ? "active" : ""}">Vereint</button>
      </div>
      <span class="right"></span>
      <button class="icon-btn" data-act="close" title="Schließen">${icon("close", 15)}</button>`;
    wrap.appendChild(head);

    const labels = el("div", "diff-labels");
    labels.innerHTML =
      this.mode === "split"
        ? `<div class="l">${esc(d.a_label)}${d.a_missing ? " (fehlt)" : ""}</div>
           <div class="l">${esc(d.b_label)}${d.b_missing ? " (fehlt)" : ""}</div>`
        : `<div class="l">${esc(d.a_label)} → ${esc(d.b_label)}</div>`;
    wrap.appendChild(labels);

    head.addEventListener("click", (e) => {
      const target2 = e.target as HTMLElement;
      const mode = target2.dataset.mode;
      if (mode === "split" || mode === "unified") {
        this.mode = mode;
        this.render();
      } else if (target2.closest('[data-act="close"]')) {
        this.onClose();
      }
    });

    if (d.binary) {
      wrap.appendChild(
        el("div", "banner warn", `${icon("warning", 14)}<span>Binärdatei – kein Textvergleich möglich.</span>`),
      );
      target.appendChild(wrap);
      return;
    }

    const body = el("div", "diff-body");
    let drawn = 0;
    for (const seg of segs) {
      if (drawn > LIMIT) break;
      const row = el("div", "dseg");
      if (this.mode === "split") {
        if (seg.type === "change") {
          row.appendChild(this.buildCol(a, seg.a, "del", d.highlight_a));
          row.appendChild(this.buildCol(b, seg.b, "add", d.highlight_b));
        } else {
          row.appendChild(this.buildCol(a, seg.a, "ctx", d.highlight_a));
          row.appendChild(this.buildCol(b, seg.b, "ctx", d.highlight_b));
        }
      } else if (seg.type === "equal") {
        // Im vereinten Modus die Seite zeigen, die noch Inhalt hat - sonst
        // würden Zeilen verschwinden, wenn eine Seite früher endet.
        const useA = seg.a[1] > seg.a[0];
        if (useA) row.appendChild(this.buildCol(a, seg.a, "ctx", d.highlight_a));
        else row.appendChild(this.buildCol(b, seg.b, "ctx", d.highlight_b));
      } else {
        row.appendChild(this.buildCol(a, seg.a, "del", d.highlight_a, true));
        row.appendChild(this.buildCol(b, seg.b, "add", d.highlight_b, true));
      }
      body.appendChild(row);
      drawn += Math.max(seg.a[1] - seg.a[0], seg.b[1] - seg.b[0]);
    }
    wrap.appendChild(body);
    if (drawn > LIMIT) {
      wrap.appendChild(
        el("div", "banner", `Sehr großer Vergleich – nach ${LIMIT} Zeilen abgeschnitten.`),
      );
    }



    target.appendChild(wrap);
  }

  private buildCol(
    lines: string[],
    range: [number, number],
    cls: string,
    highlights: Highlights,
    withMark = false,
  ): HTMLElement {
    const col = el("div", `dcol ${cls}`);
    const [s, e] = range;
    if (e <= s) {
      col.appendChild(el("div", "line line-empty"));
      return col;
    }
    for (let i = s; i < e; i++) {
      const row = el("div", "line");
      const spans = highlights[String(i)];
      const body = spans
        ? spans
            .map((sp) => (sp.changed ? `<span class="w">${esc(sp.text)}</span>` : esc(sp.text)))
            .join("")
        : esc(lines[i] ?? "");
      const mark = withMark ? (cls === "del" ? "−" : "+") : "";
      row.innerHTML = `<span class="ln">${i + 1}</span><span class="mark">${esc(mark)}</span><span class="txt">${body}</span>`;
      col.appendChild(row);
    }
    return col;
  }
}

export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (text.endsWith("\n")) lines.pop();
  return lines;
}
