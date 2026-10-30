// Panels: Änderungen, Branch-Liste, Historie, Konsole.

import type {
  BranchInfo,
  CommitInfo,
  CommandResult,
  FileChange,
  RepoSnapshot,
  RepoStatus,
} from "./api";
import { baseName, dirName } from "./merge";
import { absTime, el, esc, icon, relTime, splitPath } from "./ui";

export interface PanelCtx {
  snapshot(): RepoSnapshot | null;
  status(): RepoStatus | null;
  branches(): BranchInfo[];
  history(): CommitInfo[];
  selectedCommit(): string | null;
  commitFiles(): FileChange[];
  logLines(): string[];
  openMerge(path: string): void;
  openWorkingDiff(path: string): void;
  openCommitDiff(hash: string, path: string): void;
  selectCommit(hash: string): void;
  openBranchMenu(anchor: HTMLElement): void;
  checkout(b: BranchInfo): void;
  merge(b: BranchInfo): void;
  rename(b: BranchInfo): void;
  remove(b: BranchInfo): void;
  newFrom(b: BranchInfo | null): void;
  run(label: string, fn: () => Promise<CommandResult>): void;
  runMerge(label: string, fn: () => Promise<any>): void;
  commit(message: string, amend: boolean, sign: boolean, all: boolean): void;
  stage(paths: string[]): void;
  unstage(paths: string[]): void;
  discard(paths: string[]): void;
  resolveSide(path: string, side: "ours" | "theirs"): void;
  rawGit(cmd: string): void;
  rawCommand(args: string[]): Promise<CommandResult>;
  /** Anker für das Branch-Popover (Branch-Chip in der Kopfzeile) */
  searchAnchor(): HTMLElement | null;
  mergeNoFF(): boolean;
  setMergeNoFF(v: boolean): void;
}

const STATUS_LETTER: Record<string, string> = {
  conflicted: "!",
  staged: "S",
  modified: "M",
  untracked: "?",
  deleted: "D",
  renamed: "R",
};

function fileRow(
  entry: { path: string; state: string; conflict_code?: string | null; orig_path?: string | null },
  actions: { act: string; label: string; title: string; danger?: boolean; primary?: boolean }[],
): string {
  const { dir, base } = splitPath(entry.path);
  return `
    <div class="row" data-path="${esc(entry.path)}">
      <span class="status ${entry.state}" title="${esc(entry.conflict_code ?? entry.state)}">${
        esc(entry.conflict_code ?? STATUS_LETTER[entry.state] ?? "?")
      }</span>
      <span class="fpath" title="${esc(entry.path)}"><span class="dir">${esc(dir)}</span><b>${esc(base)}</b></span>
      ${
        entry.orig_path
          ? `<span class="chip">aus ${esc(entry.orig_path)}</span>`
          : ""
      }
      <span class="actions">
        ${actions
          .map(
            (a) =>
              `<button class="mini${a.danger ? " danger" : ""}${a.primary ? " primary" : ""}" data-row-act="${a.act}" title="${esc(a.title)}">${esc(a.label)}</button>`,
          )
          .join("")}
      </span>
    </div>`;
}

export function renderChanges(ctx: PanelCtx): HTMLElement {
  const st = ctx.status();
  const wrap = el("div", "panel-pad");
  if (!st) {
    wrap.appendChild(el("div", "empty", `${icon("changes", 26)}<b>Kein Repository geöffnet</b>`));
    return wrap;
  }
  const mergingBanner = st.merging
    ? `<div class="banner error">${icon("merge", 15)}
        <b>Merge läuft.</b> ${st.conflicts.length} Datei(en) mit Konflikten.
        <span class="right"><button class="btn" data-top-act="merge-abort">Merge abbrechen</button>
        ${
          st.conflicts.length === 0
            ? `<button class="btn primary" data-top-act="merge-continue">Merge abschließen</button>`
            : `<button class="btn primary" data-top-act="resolve-first">Konflikte lösen</button>`
        }</span></div>`
    : "";
  if (mergingBanner) wrap.insertAdjacentHTML("beforeend", mergingBanner);

  const section = (
    title: string,
    entries: RepoStatus["all"],
    rows: string,
    batch: { act: string; label: string } | null,
  ) => {
    if (!entries.length) return "";
    return `
      <section class="section">
        <header><h3>${title}</h3><span class="count">${entries.length}</span>
          ${batch ? `<span class="right row-actions-gap"><button class="mini" data-top-act="${batch.act}">${batch.label}</button></span>` : ""}
        </header>
        <div class="rows">${rows}</div>
      </section>`;
  };

  const conflictRows = st.conflicts
    .map((e) =>
      fileRow(e, [
        { act: "merge", label: "auflösen", title: "Merge-Editor öffnen", primary: true },
        { act: "take-ours", label: "lokal", title: "Komplett die lokale Fassung nehmen" },
        { act: "take-theirs", label: "eingehend", title: "Komplett die eingehende Fassung nehmen" },
      ]),
    )
    .join("");
  const stagedRows = st.staged
    .map((e) =>
      fileRow(e, [
        { act: "diff", label: "Diff", title: "Gegen HEAD vergleichen" },
        { act: "unstage", label: "unstagen", title: "Zurück in die Arbeitskopie" },
      ]),
    )
    .join("");
  const changedRows = st.changed
    .map((e) =>
      fileRow(e, [
        { act: "diff", label: "Diff", title: "Gegen HEAD vergleichen" },
        { act: "stage", label: "stagen", title: "Zum Commit vormerken" },
        { act: "discard", label: "verwerfen", title: "Änderungen verwerfen", danger: true },
      ]),
    )
    .join("");
  const untrackedRows = st.untracked
    .map((e) =>
      fileRow(e, [
        { act: "stage", label: "stagen", title: "Zum Commit vormerken" },
        { act: "discard", label: "löschen", title: "Datei löschen", danger: true },
      ]),
    )
    .join("");

  wrap.insertAdjacentHTML(
    "beforeend",
    `
    ${section("Konflikte", st.conflicts, conflictRows, null)}
    ${section("Gestaged", st.staged, stagedRows, { act: "unstage-all", label: "alle unstagen" })}
    ${section("Änderungen", st.changed, changedRows, { act: "stage-all", label: "alle stagen" })}
    ${section("Unversioniert", st.untracked, untrackedRows, { act: "stage-all", label: "alle stagen" })}
    ${
      st.all.length === 0
        ? `<div class="empty">${icon("check", 26)}<b>Arbeitskopie ist sauber</b><div class="small">Keine Änderungen, keine Konflikte.</div></div>`
        : ""
    }`,
  );

  // Commit-Box
  const box = el("section", "commit-box");
  box.innerHTML = `
    <textarea class="commit-msg" placeholder="Commit-Nachricht …" rows="3"></textarea>
    <div class="line2">
      <span class="right row-actions-gap">
        <button class="mini" data-top-act="last-message">Letzte Nachricht</button>
      </span>
      <label class="switch"><input type="checkbox" class="opt-all"> alle Änderungen (git commit -a)</label>
      <label class="switch"><input type="checkbox" class="opt-amend"> amend</label>
      <label class="switch"><input type="checkbox" class="opt-sign"> signieren (-S)</label>
      <span class="right row-actions-gap">
        <span class="muted small">${st.staged.length} Datei(en) bereit</span>
        <button class="btn primary" data-top-act="commit" title="Strg+Enter">${icon("check", 14)} Commit
          <span class="kbd">Strg+↵</span></button>
      </span>
    </div>`;
  wrap.appendChild(box);

  // Doppelklick öffnet die Datei: Konflikt -> Merge-Editor, sonst Diff
  wrap.addEventListener("dblclick", (e) => {
    const row = (e.target as HTMLElement).closest(".row") as HTMLElement | null;
    const path = row?.dataset.path;
    if (!path) return;
    const entry = st.conflicts
      .concat(st.staged, st.changed, st.untracked)
      .find((x) => x.path === path);
    if (!entry) return;
    if (entry.state === "conflicted") ctx.openMerge(path);
    else if (entry.state !== "untracked") ctx.openWorkingDiff(path);
  });

  wrap.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const rowAct = (target.closest("[data-row-act]") as HTMLElement | null)?.dataset.rowAct;
    const path = (target.closest(".row") as HTMLElement | null)?.dataset.path;
    if (rowAct && path) {
      switch (rowAct) {
        case "merge":
          return ctx.openMerge(path);
        case "diff":
          return ctx.openWorkingDiff(path);
        case "stage":
          return ctx.stage([path]);
        case "unstage":
          return ctx.unstage([path]);
        case "discard":
          return ctx.discard([path]);
        case "take-ours":
          return ctx.resolveSide(path, "ours");
        case "take-theirs":
          return ctx.resolveSide(path, "theirs");
      }
      return;
    }
    const top = (target.closest("[data-top-act]") as HTMLElement | null)?.dataset.topAct;
    if (!top) return;
    switch (top) {
      case "stage-all":
        return ctx.stage(st.untracked.concat(st.changed).map((x) => x.path));
      case "unstage-all":
        return ctx.unstage(st.staged.map((x) => x.path));
      case "last-message": {
        const subjects = ctx
          .history()
          .slice(0, 10)
          .map((c) => c.subject);
        if (!subjects.length) return;
        const box2 = box.querySelector(".commit-msg") as HTMLTextAreaElement;
        box2.value = subjects[0];
        const menu = el("div", "popover");
        menu.style.width = "380px";
        const rect = (target as HTMLElement).getBoundingClientRect();
        menu.style.left = `${Math.max(8, rect.left - 240)}px`;
        menu.style.top = `${rect.bottom + 6}px`;
        menu.innerHTML = `<div class="group-title">Letzte Commit-Nachrichten</div><div class="list">${subjects
          .map(
            (s, i) =>
              `<div class="pop-item" data-msg="${i}"><span class="bsub" style="flex:1">${esc(s)}</span></div>`,
          )
          .join("")}</div>`;
        document.body.appendChild(menu);
        const close = () => menu.remove();
        setTimeout(() => document.addEventListener("mousedown", close, { once: true }), 0);
        menu.addEventListener("click", (ev) => {
          const idx = (ev.target as HTMLElement).closest("[data-msg]")?.getAttribute("data-msg");
          if (idx === null || idx === undefined) return;
          box2.value = subjects[Number(idx)];
          close();
        });
        return;
      }
      case "commit": {
        const msg = (box.querySelector(".commit-msg") as HTMLTextAreaElement).value;
        const all = (box.querySelector(".opt-all") as HTMLInputElement).checked;
        const amend = (box.querySelector(".opt-amend") as HTMLInputElement).checked;
        const sign = (box.querySelector(".opt-sign") as HTMLInputElement).checked;
        return ctx.commit(msg, amend, sign, all);
      }
      case "merge-abort":
        return ctx.run("Merge abbrechen", () => ctx.rawCommand(["merge", "--abort"]));
      case "merge-continue":
        return ctx.run("Merge abschließen", () => ctx.rawCommand(["commit", "--no-edit"]));
      case "resolve-first": {
        const first = ctx.status()?.conflicts[0];
        if (first) ctx.openMerge(first.path);
        return;
      }
    }
  });
  return wrap;
}

export function renderBranches(ctx: PanelCtx): HTMLElement {
  const wrap = el("div", "panel-pad");
  const all = ctx.branches();
  const local = all.filter((b) => !b.is_remote);
  const remote = all.filter((b) => b.is_remote);
  wrap.insertAdjacentHTML(
    "beforeend",
    `
    <div class="section">
      <header style="margin-bottom:12px">
        <h2>Branches</h2><span class="count">${all.length}</span>
        <span class="right row-actions-gap">
          <label class="switch"><input type="checkbox" class="opt-noff" ${ctx.mergeNoFF() ? "checked" : ""}>
            Merge immer als Merge-Commit (--no-ff)</label>
          <button class="btn" data-branch-act="search">${icon("search", 14)} Suchen &amp; wechseln</button>
          <button class="btn primary" data-branch-act="create">${icon("plus", 14)} Neuer Branch</button>
        </span>
      </header>
      <div class="rows">
        ${local
          .map((b) =>
            branchRow(b, ctx.snapshot()?.head_branch === b.name),
          )
          .join("")}
      </div>
    </div>
    <div class="section">
      <header><h3>Remote</h3><span class="count">${remote.length}</span></header>
      <div class="rows">${remote.map((b) => branchRow(b, false)).join("")}</div>
    </div>`,
  );
  const noff = wrap.querySelector(".opt-noff") as HTMLInputElement;
  noff?.addEventListener("change", () => ctx.setMergeNoFF(noff.checked));
  wrap.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const act = (target.closest("[data-branch-act]") as HTMLElement | null)?.dataset.branchAct;
    if (act === "create") return ctx.newFrom(null);
    if (act === "search") {
      const anchor = ctx.searchAnchor();
      if (anchor) ctx.openBranchMenu(anchor);
      return;
    }
    const rowAct = (target.closest("[data-b-act]") as HTMLElement | null)?.dataset.bAct;
    const name = (target.closest(".branch-row") as HTMLElement | null)?.dataset.name;
    if (!rowAct || !name) return;
    const branch = all.find((b) => b.name === name);
    if (!branch) return;
    switch (rowAct) {
      case "checkout":
        return ctx.checkout(branch);
      case "merge":
        return ctx.merge(branch);
      case "rename":
        return ctx.rename(branch);
      case "delete":
      case "delete-remote":
        return ctx.remove(branch);
      case "newfrom":
        return ctx.newFrom(branch);
    }
  });
  return wrap;
}

function branchRow(b: BranchInfo, isCurrent: boolean): string {
  const ab = [
    b.ahead ? `<span class="up">↑${b.ahead}</span>` : "",
    b.behind ? `<span class="down">↓${b.behind}</span>` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `
    <div class="branch-row${isCurrent ? " current" : ""}" data-name="${esc(b.name)}" data-remote="${b.is_remote}">
      <span class="dot${isCurrent ? " on" : ""}"></span>
      <span class="bname">${esc(b.name)}</span>
      ${b.upstream ? `<span class="chip mono">→ ${esc(b.upstream)}</span>` : ""}
      ${ab ? `<span class="ab-count">${ab}</span>` : ""}
      <span class="bsub" title="${esc(b.subject)}">${esc(b.subject)}</span>
      <span class="bdate nowrap" title="${esc(absTime(b.timestamp))}">${esc(b.short_hash)} · ${esc(
        relTime(b.timestamp),
      )}</span>
      <span class="actions">
        ${
          isCurrent
            ? `<span class="chip head">aktuell</span>`
            : `<button class="mini" data-b-act="checkout">wechseln</button>
               <button class="mini primary" data-b-act="merge" title="In den aktuellen Branch mergen">mergen</button>`
        }
        <button class="mini" data-b-act="newfrom" title="Neuen Branch hier starten">${icon("plus", 12)}</button>
        ${
          b.is_remote
            ? `<button class="mini danger" data-b-act="delete-remote" title="Remote-Branch löschen">${icon("trash", 12)}</button>`
            : isCurrent
              ? ""
              : `<button class="mini" data-b-act="rename" title="Umbenennen">${icon("pencil", 12)}</button>
                 <button class="mini danger" data-b-act="delete" title="Löschen">${icon("trash", 12)}</button>`
        }
      </span>
    </div>`;
}

export function renderHistory(ctx: PanelCtx): HTMLElement {
  const wrap = el("div", "panel-pad");
  const commits = ctx.history();
  const selected = ctx.selectedCommit();
  const files = ctx.commitFiles();
  const sel = commits.find((c) => c.hash === selected);
  wrap.innerHTML = `
    <div class="hist" style="height:calc(100vh - 120px)">
      <div class="hist-list">
        ${
          commits.length
            ? commits.map((c) => commitRow(c, selected === c.hash)).join("")
            : `<div class="empty">${icon("history", 26)}<b>Keine Commits</b></div>`
        }
      </div>
      <div class="hist-side">
        ${
          sel
            ? `<div class="commit-head">
                 <div class="subj">${esc(sel.subject)}</div>
                 <div class="meta">${esc(sel.hash.slice(0, 12))} · ${esc(sel.author)} · ${esc(
                   absTime(sel.timestamp),
                 )}</div>
               </div>`
            : `<div class="empty">${icon("history", 22)}<b>Commit auswählen</b><div class="small">um die geänderten Dateien zu sehen</div></div>`
        }
        ${
          sel && files.length
            ? `<div class="rows">${files
                .map(
                  (f) => `
              <div class="row" data-path="${esc(f.path)}">
                <span class="status ${f.status.startsWith("D") ? "changed" : "staged"}">${esc(f.status.trim())}</span>
                <span class="fpath"><span class="dir">${esc(dirName(f.path))}</span><b>${esc(
                  baseName(f.path),
                )}</b></span>
                <span class="actions"><button class="mini" data-file-act="diff">Diff</button></span>
              </div>`,
                )
                .join("")}</div>`
            : ""
        }
      </div>
    </div>`;
  wrap.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const row = target.closest(".commit-row") as HTMLElement | null;
    if (row?.dataset.hash) return ctx.selectCommit(row.dataset.hash);
    const fileDiff = (target.closest("[data-file-act]") as HTMLElement | null)?.dataset.fileAct;
    const path = (target.closest(".row") as HTMLElement | null)?.dataset.path;
    if (fileDiff === "diff" && path && selected) ctx.openCommitDiff(selected, path);
  });
  return wrap;
}

function commitRow(c: CommitInfo, selected: boolean): string {
  const merge = c.parents.length > 1;
  const isHead = c.refs.some((r) => r.includes("HEAD"));
  const dotColor = isHead ? "var(--green)" : merge ? "var(--violet)" : "var(--fg-3)";
  return `
    <div class="commit-row${selected ? " selected" : ""}" data-hash="${esc(c.hash)}">
      <span class="graph">
        <svg width="22" height="20" viewBox="0 0 22 20">
          <line x1="11" y1="0" x2="11" y2="20" stroke="var(--line)" stroke-width="1.5"/>
          ${
            merge
              ? `<path d="M11 10 L19 3" stroke="var(--violet)" stroke-width="1.3" fill="none" opacity=".7"/>`
              : ""
          }
          <circle cx="11" cy="10" r="${isHead ? 4.5 : 3.6}" fill="${dotColor}"/>
        </svg>
      </span>
      <span class="chash">${esc(c.short_hash)}</span>
      <span class="csubject">${esc(c.subject)}</span>
      <span class="crefs">${c.refs
        .map((r) => {
          const kind = r.includes("HEAD")
            ? "head"
            : r.startsWith("tag:")
              ? "tag"
              : r.includes("/")
                ? "remote"
                : "local";
          return `<span class="chip ${kind}">${esc(r.replace("tag: ", ""))}</span>`;
        })
        .join("")}</span>
      <span class="cauthor">${esc(c.author)}</span>
      <span class="cdate" title="${esc(absTime(c.timestamp))}">${esc(relTime(c.timestamp))}</span>
    </div>`;
}

export function renderConsole(ctx: PanelCtx): HTMLElement {
  const wrap = el("div", "console");
  const log = ctx.logLines();
  wrap.innerHTML = `
    <div class="log">${
      log.length
        ? log
            .map((l) =>
              l.startsWith("$ ")
                ? `<span class="cmd">${esc(l)}</span>`
                : esc(l),
            )
            .join("\n\n")
        : "Bereit. Befehle ohne führendes »git« eingeben, z. B. »status --short«."
    }</div>
    <div class="input">
      <span class="prompt">git</span>
      <input type="text" placeholder="status --short" autocomplete="off" />
      <button class="btn" data-con-act="run">Ausführen</button>
    </div>`;
  const input = wrap.querySelector("input") as HTMLInputElement;
  const run = () => {
    const value = input.value.trim();
    if (!value) return;
    input.value = "";
    ctx.rawGit(value);
  };
  (wrap.querySelector('[data-con-act="run"]') as HTMLElement).addEventListener("click", run);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") run();
  });
  return wrap;
}
