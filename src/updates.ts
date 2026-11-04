import packageInfo from '../package.json';
import { api } from './api';
import { t, m, h } from './i18n';
import { esc, icon, showDialog } from './ui';

export const APP_VERSION = packageInfo.version;
export interface UpdateInfo {
  current: string; latest: string | null; available: boolean;
  install_kind: 'user' | 'package'; can_install: boolean; can_download: boolean;
}
type Phase = 'idle' | 'checking' | 'ready' | 'error' | 'installing' | 'installed';
const INTERVAL = 24 * 60 * 60 * 1000;
const AUTO = 'mergecraft-auto-updates';
const CACHE = 'mergecraft-update-check';

/** App-wide state, independent of repository renders and merge editor state. */
export class Updates {
  private info: UpdateInfo | null = null;
  private phase: Phase = 'idle';
  private auto = true;
  private installFailed = false;
  private view: ReturnType<typeof showDialog> = null;
  constructor(private changed: () => void) {
    try { this.auto = localStorage.getItem(AUTO) !== 'off'; } catch { /* Session preference. */ }
  }
  button(): string {
    const available = this.info?.available && this.phase !== 'installed';
    return h`<button type="button" class="app-info-button ${available ? 'has-update' : ''}" data-app-info aria-label="Über Mergecraft und Updates" title="Über Mergecraft und Updates">${icon(available ? 'pull' : 'info', 14)}<span>${available ? t('Update verfügbar') : `Mergecraft ${APP_VERSION}`}</span></button>`;
  }
  async start(): Promise<void> {
    if (!api.inTauri || !this.auto) return;
    try {
      const cache = JSON.parse(localStorage.getItem(CACHE) || 'null');
      if (cache && cache.version === APP_VERSION && Number.isFinite(cache.time) && Date.now() >= cache.time && Date.now() - cache.time < INTERVAL) {
        if (cache.info && cache.info.current === APP_VERSION) { this.info = cache.info; this.phase = 'ready'; this.changed(); }
        return;
      }
    } catch { /* Missing or corrupt cache: check normally. */ }
    try { localStorage.setItem(CACHE, JSON.stringify({version: APP_VERSION, time: Date.now()})); } catch { /* Optional cache. */ }
    await this.check();
  }
  private refresh(): void { this.changed(); this.renderDialog(); }
  async check(): Promise<void> {
    if (this.phase === 'checking' || this.phase === 'installing' || this.phase === 'installed') return;
    this.installFailed = false;
    this.phase = 'checking'; this.refresh();
    try {
      this.info = await api.checkForUpdates();
      this.phase = 'ready';
      try { localStorage.setItem(CACHE, JSON.stringify({version: APP_VERSION, time: Date.now(), info: this.info})); } catch { /* Optional cache. */ }
    } catch { this.phase = 'error'; }
    this.refresh();
  }
  open(): void {
    if (this.view?.dialog.isConnected) return;
    this.view = showDialog('');
    if (!this.view) return;
    this.renderDialog();
    const close = () => { if (this.phase === 'installing') return; this.view?.close(); this.view = null; };
    this.view.dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    this.view.dialog.addEventListener('change', event => {
      const input = event.target as HTMLInputElement;
      if (!input.matches('[data-update-auto]')) return;
      this.auto = input.checked;
      try { localStorage.setItem(AUTO, this.auto ? 'on' : 'off'); } catch { /* Session preference. */ }
    });
    this.view.dialog.addEventListener('click', event => {
      const action = (event.target as HTMLElement).closest<HTMLElement>('[data-update-action]')?.dataset.updateAction;
      if (action === 'close') close();
      if (action === 'check') void this.check();
      if (action === 'releases') void api.openReleases().catch(() => { this.phase = 'error'; this.refresh(); });
      if (action === 'download') void api.openUpdateDownload().catch(() => { this.phase = 'error'; this.refresh(); });
      if (action === 'install') void this.install();
    });
  }
  private async install(): Promise<void> {
    if (!this.info?.can_install || !this.info.latest || this.phase === 'checking' || this.phase === 'installing' || this.phase === 'installed') return;
    const expected = this.info.latest;
    this.phase = 'installing'; this.refresh();
    try { await api.installUpdate(expected); this.phase = 'installed'; try { localStorage.removeItem(CACHE); } catch { /* Optional. */ } }
    catch { this.installFailed = true; this.phase = 'error'; }
    this.refresh();
  }
  private renderDialog(): void {
    const dialog = this.view?.dialog;
    if (!dialog?.isConnected) return;
    const focus = (document.activeElement as HTMLElement | null)?.dataset.updateAction;
    const installing = this.phase === 'installing';
    const installed = this.phase === 'installed';
    const available = !!this.info?.available;
    const headline = installed ? t('Update installiert') : installing ? t('Update wird installiert …') : this.phase === 'checking' ? t('Suche nach Updates …') : this.phase === 'error' ? t('Update nicht abgeschlossen') : available ? m`Version ${this.info!.latest} ist verfügbar` : this.phase === 'ready' ? t('Du bist auf dem neuesten Stand') : t('Bereit für Neues');
    const detail = installed ? t('Öffne Mergecraft erneut, um die neue Version zu verwenden. Deine aktuelle Sitzung bleibt geöffnet.') : installing ? t('Das Update wird heruntergeladen und geprüft. Bitte lasse dieses Fenster geöffnet.') : this.phase === 'error' && this.installFailed ? t('Download oder Prüfung fehlgeschlagen. Die vorhandene Installation bleibt erhalten. Versuche es erneut oder öffne die Releases.') : this.phase === 'error' ? t('Prüfe deine Internetverbindung und versuche es erneut. Du kannst die Releases auch im Browser öffnen.') : available && this.info?.can_install ? t('Die Benutzerinstallation wird nach Prüfung der SHA-256-Prüfsumme ersetzt. Öffne Mergecraft danach erneut.') : available && this.info?.install_kind === 'user' ? t('Für diese Version ist kein geprüftes Benutzerupdate verfügbar. Öffne die Releases für Installationshinweise.') : available ? t('Lade das Debian-Paket herunter und öffne es mit deinem Paketmanager. Öffne Mergecraft danach erneut.') : t('Hier findest du die installierte Version und neue Veröffentlichungen.');
    dialog.classList.add('about-updates');
    dialog.innerHTML = h`<div class="about-brand"><span class="about-mark">${icon('logo', 30)}</span><div><h2 id="dialog-title">Mergecraft</h2><p>Version ${APP_VERSION} · MIT</p></div></div>
      <section class="update-state" aria-live="polite" aria-busy="${installing || this.phase === 'checking'}"><span class="update-state-icon">${icon(installed ? 'check' : available ? 'pull' : 'info', 20)}</span><div><strong>${esc(headline)}</strong><p>${esc(detail)}</p></div></section>
      <label class="update-auto"><input type="checkbox" data-update-auto ${this.auto ? 'checked' : ''}> Automatisch nach Updates suchen</label>
      <p class="update-privacy">Prüft beim Start höchstens einmal täglich die öffentlichen GitHub-Releases. Dabei werden keine Repository-Daten übertragen.</p>
      <div class="actions update-actions"><button class="btn" data-update-action="releases" ${installing ? 'disabled' : ''}>Release Notes …</button><span class="right"></span><button class="btn" data-update-action="close" ${installing ? 'disabled' : ''}>Schließen</button>
      ${available && !installed && this.info?.can_install ? h`<button class="btn primary" data-update-action="install" ${installing || this.phase === 'checking' ? 'disabled' : ''}>${installing ? t('Installiere …') : t('Update installieren')}</button>` : available && !installed && this.info?.can_download && this.info.install_kind !== 'user' ? h`<button class="btn primary" data-update-action="download" ${this.phase === 'checking' ? 'disabled' : ''}>Update herunterladen …</button>` : ''}
      ${!installed && !installing ? h`<button class="btn ${available ? '' : 'primary'}" data-update-action="check" ${this.phase === 'checking' ? 'disabled' : ''}>Nach Updates suchen</button>` : ''}</div>`;
    if (focus) dialog.querySelector<HTMLButtonElement>(`[data-update-action="${focus}"]:not([disabled])`)?.focus();
    else dialog.querySelector<HTMLButtonElement>('[data-update-action="close"]')?.focus();
  }
}
