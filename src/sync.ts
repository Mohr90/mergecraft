import type {BranchInfo} from "./api";
export function branchSync(branch:BranchInfo) {
  if(!branch.upstream) return {tone:"unknown",label:"Kein Upstream",detail:"Dieser Branch hat keinen Tracking-Branch. Push kann den Upstream beim Veröffentlichen einrichten."};
  if(!branch.tracking_known) return {tone:"unknown",label:"Status unbekannt",detail:`${branch.upstream}: Der Vergleich ist nicht verfügbar. Mit Fetch die Remote-Referenzen aktualisieren.`};
  const parts=[];
  if(branch.ahead)parts.push(`${branch.ahead} ${branch.ahead===1?"ungepushter Commit":"ungepushte Commits"}`);
  if(branch.behind)parts.push(`${branch.behind} ${branch.behind===1?"Remote-Commit fehlt":"Remote-Commits fehlen"}`);
  return {tone:branch.ahead?"pending":branch.behind?"incoming":"ok",label:parts.join(" · ")||"Synchron",detail:`Vergleich mit ${branch.upstream}. Stand der lokal bekannten Remote-Referenz; mit Fetch aktualisieren. Uncommittete Änderungen zählen hier nicht mit.`};
}
