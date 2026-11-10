import { t, h, m, localizeText } from "./i18n";
// Diff-Ansicht: nebeneinander oder vereint, mit Zeilennummern und
// wortweiser Hervorhebung (wie im WebStorm-Diff).

import type { FileDiff, Highlights, HunkSet } from "./api";
import { el, esc, icon } from "./ui";
import { SyntaxDocument } from "./syntax";
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
  private builtinLabels=false;
  private hunks: {set:HunkSet; area:string; apply:(index:number)=>Promise<void>} | null = null;
  private syntaxA!:SyntaxDocument;
  private syntaxB!:SyntaxDocument;
  private renderA:string[]=[];
  private root: HTMLElement | null = null;

  constructor(private onClose: () => void) {}

  set(diff: FileDiff, mode: DiffMode = "split", builtinLabels=false) {
    this.diff = diff;
    this.hunks = null;
    this.syntaxA=new SyntaxDocument(diff.path,diff.a_text);
    this.syntaxB=new SyntaxDocument(diff.path,diff.b_text);
    this.builtinLabels=builtinLabels;
    this.mode = mode;
    if (this.root) this.render();
  }

  setHunks(set:HunkSet, area:string, apply:(index:number)=>Promise<void>) {
    this.hunks={set,area,apply};
    if(set.blocks.length)this.diff={...this.diff,blocks:set.blocks};
    if(this.root)this.render();
  }

  mount(target: HTMLElement) {
    this.root = target;
    this.render();
  }

  relocalize(): void {
    const body=this.root?.querySelector('.diff-body');
    const top=body?.scrollTop??0,left=body?.scrollLeft??0;
    this.render();
    const next=this.root?.querySelector('.diff-body');
    if(next){next.scrollTop=top;next.scrollLeft=left;}
  }

  private render() {
    const target = this.root;
    if (!target) return;
    const d = this.diff;
    const a = splitLines(d.a_text);
    this.renderA=a;
    const b = splitLines(d.b_text);
    const segs = segments(d, a, b);
    const added = d.blocks.reduce((n, x) => n + x.b_len, 0);
    const removed = d.blocks.reduce((n, x) => n + x.a_len, 0);

    target.innerHTML = "";
    const wrap = el("div", `diff diff-${this.mode}`);

    const head = el("div", "diff-head");
    head.innerHTML = h`
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
        ? `<div class="l">${esc(this.builtinLabels ? localizeText(d.a_label) : d.a_label)}${d.a_missing ? t(" (fehlt)") : ""}</div>
           <div class="l">${esc(this.builtinLabels ? localizeText(d.b_label) : d.b_label)}${d.b_missing ? t(" (fehlt)") : ""}</div>`
        : `<div class="l">${esc(this.builtinLabels ? localizeText(d.a_label) : d.a_label)} → ${esc(this.builtinLabels ? localizeText(d.b_label) : d.b_label)}</div>`;
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
        el("div", "banner warn", h`${icon("warning", 14)}<span>Binärdatei – kein Textvergleich möglich.</span>`),
      );
      target.appendChild(wrap);
      return;
    }

    if(this.hunks?.set.reason)wrap.appendChild(el('p','hunk-note small muted',esc(localizeText(this.hunks.set.reason))));
    const body = el("div", "diff-body");
    let drawn = 0;
    for (const seg of segs) {
      if (drawn > LIMIT) break;
      if(seg.type==='change' && this.hunks && !this.hunks.set.reason) {
        const index=this.diff.blocks.findIndex(b=>b.a_start===seg.a[0]&&b.b_start===seg.b[0]);
        if(index>=0) {
          const strip=el('div','hunk-action');
          strip.innerHTML=`<span>${esc(m`Block ${index+1} · Zeile ${seg.b[0]+1}`)}</span><button class="btn" data-hunk="${index}">${icon(this.hunks.area==='staged'?'undo':'check',14)} ${this.hunks.area==='staged'?t('Block herausnehmen'):t('Block vormerken')}</button>`;
          strip.querySelector('button')!.addEventListener('click',async()=>{
            const scroll=body.scrollTop;
            wrap.querySelectorAll<HTMLButtonElement>('[data-hunk]').forEach(b=>b.disabled=true);
            try{await this.hunks!.apply(index);}finally{if(this.root){const next=this.root.querySelector('.diff-body');if(next)next.scrollTop=scroll;}wrap.querySelectorAll<HTMLButtonElement>('[data-hunk]').forEach(b=>b.disabled=false);}
          });
          body.appendChild(strip);
        }
      }
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
        el("div", "banner", m`Sehr großer Vergleich – nach ${LIMIT} Zeilen abgeschnitten.`),
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
      const syntax=lines===this.renderA?this.syntaxA:this.syntaxB;
      const body=syntax.line(i,lines[i]??"",spans);
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
