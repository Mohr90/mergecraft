import packageInfo from '../package.json';
import { api } from './api';
import { t, m, h } from './i18n';
import { esc, icon, showDialog } from './ui';

export const APP_VERSION = packageInfo.version;
export interface UpdateInfo { current: string; latest: string | null; available: boolean; }
const CACHE = 'mergecraft-version-check';
const INTERVAL = 24 * 60 * 60 * 1000;

export class Updates {
  private info: UpdateInfo | null = null;
  private phase: 'idle' | 'checking' | 'ready' | 'error' = 'idle';
  private view: ReturnType<typeof showDialog> = null;
  constructor(private changed: () => void) {}
  button(): string {
    return h`<button type="button" class="app-info-button ${this.info?.available ? 'has-update' : ''}" data-app-info aria-label="Über Mergecraft und Updates" title="Über Mergecraft und Updates">${icon('info', 14)}<span>Mergecraft ${APP_VERSION}${this.info?.available ? ` · ${t('Update verfügbar')}` : ''}</span></button>`;
  }
  async start(): Promise<void> {
    if (!api.inTauri) return;
    try {
      const cache = JSON.parse(localStorage.getItem(CACHE) || 'null');
      if (cache?.version === APP_VERSION && Number.isFinite(cache.time) && Date.now() >= cache.time && Date.now() - cache.time < INTERVAL) {
        if (cache.info?.current === APP_VERSION) { this.info = cache.info; this.phase = 'ready'; this.changed(); }
        return;
      }
      localStorage.setItem(CACHE, JSON.stringify({version: APP_VERSION, time: Date.now()}));
    } catch { /* Optional cache. */ }
    await this.check();
  }
  async check(): Promise<void> {
    if (this.phase === 'checking') return;
    this.phase = 'checking'; this.refresh();
    try {
      this.info = await api.checkForUpdates(); this.phase = 'ready';
      try { localStorage.setItem(CACHE, JSON.stringify({version: APP_VERSION, time: Date.now(), info: this.info})); } catch { /* Optional cache. */ }
    } catch { this.phase = 'error'; }
    this.refresh();
  }
  open(): void {
    if (this.view?.dialog.isConnected) return;
    this.view = showDialog('');
    if (!this.view) return;
    const close = () => { this.view?.close(); this.view = null; };
    this.view.dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    this.view.dialog.addEventListener('click', event => {
      const action = (event.target as HTMLElement).closest<HTMLElement>('[data-update-action]')?.dataset.updateAction;
      if (action === 'close') close();
      if (action === 'project') void api.openProject().catch(() => { this.phase = 'error'; this.refresh(); });
    });
    this.renderDialog();
    if (this.phase === 'idle' || this.phase === 'error') void this.check();
  }
  private refresh(): void { this.changed(); this.renderDialog(); }
  private renderDialog(): void {
    const dialog = this.view?.dialog;
    if (!dialog?.isConnected) return;
    const focused = (document.activeElement as HTMLElement | null)?.dataset.updateAction;
    const headline = this.info?.available ? m`Version ${this.info.latest} ist verfügbar` : this.phase === 'ready' ? t('Du bist auf dem neuesten Stand') : this.phase === 'error' ? t('Versionsprüfung derzeit nicht möglich') : t('Suche nach Updates …');
    dialog.classList.add('about-updates');
    dialog.innerHTML = h`<div class="about-brand"><span class="about-mark">${icon('logo',30)}</span><div><h2 id="dialog-title">Mergecraft</h2><p>Version ${APP_VERSION}</p></div></div>
      <p class="version-status" role="status">${esc(headline)}</p>
      <div class="actions"><button class="btn" data-update-action="close">Schließen</button><button class="btn primary" data-update-action="project">GitHub-Projekt öffnen …</button></div>`;
    dialog.querySelector<HTMLButtonElement>(`[data-update-action="${focused === 'project' ? 'project' : 'close'}"]`)?.focus();
  }
}
