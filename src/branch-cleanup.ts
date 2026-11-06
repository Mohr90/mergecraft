import {api, type BranchInfo} from "./api";
import {h, m, t} from "./i18n";
import {el, esc, showDialog} from "./ui";

export interface CleanupBranch {
  branch: BranchInfo;
  ownCommits: boolean;
  protected: boolean;
}

/** Read a fresh inventory, including branches checked out in other worktrees. */
export async function cleanupInventory(head: string): Promise<CleanupBranch[]> {
  const branches = await api.branches();
  const worktrees = await api.gitRaw(["worktree", "list", "--porcelain", "-z"]);
  if (!worktrees.ok) throw new Error(worktrees.stderr || worktrees.stdout);
  const occupied = new Set(worktrees.stdout.split("\0")
    .filter(field => field.startsWith("branch ")).map(field => field.slice(7)));
  const rows: CleanupBranch[] = [];
  for (const branch of branches.filter(branch => !branch.is_remote)) {
    const protectedBranch = branch.is_current || occupied.has(branch.full_name);
    if (protectedBranch) {
      rows.push({branch, ownCommits:false, protected:true});
      continue;
    }
    const result = await api.gitRaw(["merge-base", "--is-ancestor", branch.full_name, head]);
    if (!result.ok && result.code !== 1) throw new Error(result.stderr || result.stdout);
    rows.push({branch, ownCommits:result.code === 1, protected:false});
  }
  return rows;
}

export function chooseBranchCleanup(rows: CleanupBranch[]): Promise<CleanupBranch[] | null> {
  return new Promise(resolve => {
    const view = showDialog(h`<h2 id="dialog-title">Lokale Branches aufräumen</h2>
      <p class="detail">Wähle die lokalen Branches, die du löschen möchtest. Branches mit eigenen Commits werden vor dem Löschen nochmals bestätigt.</p>
      <label class="cleanup-all"><input type="checkbox" data-cleanup-all> Alle löschbaren Branches auswählen</label>
      <div class="rollback-files">${rows.map((row,index) => `<label><input type="checkbox" data-cleanup-index="${index}" ${row.protected ? "disabled" : ""}><span class="mono">${esc(row.branch.name)}</span><span class="chip">${esc(t(row.protected ? "In einem Worktree geöffnet" : row.ownCommits ? "Eigene Commits" : "Im aktuellen Stand enthalten"))}</span></label>`).join("")}</div>
      <p class="cleanup-count" role="status"></p>
      <div class="actions"><button class="btn" data-cleanup-cancel>Abbrechen</button><button class="btn danger" data-cleanup-confirm disabled>Auswahl löschen …</button></div>`);
    if (!view) return resolve(null);
    const all = view.dialog.querySelector<HTMLInputElement>("[data-cleanup-all]")!;
    const boxes = [...view.dialog.querySelectorAll<HTMLInputElement>("[data-cleanup-index]:not(:disabled)")];
    all.disabled = !boxes.length;
    const selected = () => boxes.filter(box => box.checked).map(box => rows[Number(box.dataset.cleanupIndex)]);
    const update = () => {
      const count = selected().length;
      all.checked = boxes.length > 0 && count === boxes.length;
      all.indeterminate = count > 0 && count < boxes.length;
      view.dialog.querySelector(".cleanup-count")!.textContent = m`${count} Branches ausgewählt`;
      view.dialog.querySelector<HTMLButtonElement>("[data-cleanup-confirm]")!.disabled = !count;
    };
    const finish = (value:CleanupBranch[] | null) => { view.close(); resolve(value); };
    all.addEventListener("change", () => { boxes.forEach(box => box.checked = all.checked); update(); });
    view.dialog.addEventListener("change", update);
    view.dialog.querySelector("[data-cleanup-cancel]")!.addEventListener("click", () => finish(null));
    view.dialog.querySelector("[data-cleanup-confirm]")!.addEventListener("click", () => finish(selected()));
    view.dialog.addEventListener("cancel", event => {event.preventDefault(); finish(null);});
    update();
  });
}
