import { m, t } from "./i18n";
import type {BranchInfo} from "./api";
export function branchSync(branch:BranchInfo) {
  if(!branch.upstream) return {tone:"unknown",label:t("Kein Upstream"),detail:t("Dieser Branch hat keinen Tracking-Branch. Push kann den Upstream beim Veröffentlichen einrichten.")};
  if(!branch.tracking_known) return {tone:"unknown",label:t("Status unbekannt"),detail:m`${branch.upstream}: Der Vergleich ist nicht verfügbar. Mit Fetch die Remote-Referenzen aktualisieren.`};
  const parts=[];
  if(branch.ahead)parts.push(`${branch.ahead} ${branch.ahead===1?t("ungepushter Commit"):t("ungepushte Commits")}`);
  if(branch.behind)parts.push(`${branch.behind} ${branch.behind===1?t("Remote-Commit fehlt"):t("Remote-Commits fehlen")}`);
  return {tone:branch.ahead?"pending":branch.behind?"incoming":"ok",label:parts.join(" · ")||t("Synchron"),detail:m`Vergleich mit ${branch.upstream}. Stand der lokal bekannten Remote-Referenz; mit Fetch aktualisieren. Uncommittete Änderungen zählen hier nicht mit.`};
}
