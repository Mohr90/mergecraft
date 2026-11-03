import {en, type MessageKey} from './messages';
import {hasMessage, mapHtmlMessages, messageKey, slot, slotPattern} from './template';

export type Language = 'de' | 'en';
const preferenceKey = 'mergecraft-language';
const missing = new Set<string>();
export function detectLanguage(saved: string | null, languages: readonly string[]): Language {
  if (saved === 'de' || saved === 'en') return saved;
  for (const preference of languages) {
    const language = preference.toLowerCase().split(/[-_]/)[0];
    if (language === 'de' || language === 'en') return language;
  }
  return 'en';
}
let stored: string | null = null;
try { stored = localStorage.getItem(preferenceKey); } catch { /* Session-only preferences still work. */ }
let language = detectLanguage(stored, navigator.languages ?? [navigator.language]);
document.documentElement.lang = language;
export const getLanguage = (): Language => language;
export const getLocale = (): string => language === 'de' ? 'de-DE' : 'en-GB';
export const missingMessages = (): string[] => [...missing];
export function setLanguage(next: Language): void {
  language = next;
  document.documentElement.lang = next;
  try { localStorage.setItem(preferenceKey, next); } catch { /* Keep the selection for this session. */ }
}

export function t(key: MessageKey): string {
  return language === 'en' ? en[key] : key;
}

const escapeMarkup = (text: string): string => text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
function translate(source: string, markup: boolean): string {
  const {key, slots} = messageKey(source);
  if (!hasMessage(key)) return source;
  if (!Object.prototype.hasOwnProperty.call(en, key)) { missing.add(key); return source; }
  const value = en[key as MessageKey];
  const translated = (markup ? escapeMarkup(value) : value).replace(/\{\{(\d+)\}\}/g, (_, index: string) => slot(slots[Number(index)]));
  return source.slice(0,source.length-source.trimStart().length) + translated + source.slice(source.trimEnd().length);
}

const templateCache = new WeakMap<TemplateStringsArray, Map<string,string>>();
function template(parts: TemplateStringsArray, values: unknown[], markup: boolean): string {
  let cache = templateCache.get(parts);
  if (!cache) { cache = new Map(); templateCache.set(parts, cache); }
  const cacheKey = language + String(markup);
  let compiled = cache.get(cacheKey);
  if (compiled === undefined) {
    const source = parts.map((part,index)=>index ? slot(index-1)+part : part).join('');
    compiled = language === 'de' ? source : markup ? mapHtmlMessages(source,message=>translate(message,true)) : translate(source,false);
    cache.set(cacheKey,compiled);
  }
  return compiled.replace(slotPattern, (_, index: string)=>String(values[Number(index)]));
}
/** Localize static text/attributes before interpolating any HTML or user content. */
export const h = (parts: TemplateStringsArray, ...values: unknown[]): string => template(parts,values,true);
/** Localize a complete message with reorderable interpolation slots. */
export const m = (parts: TemplateStringsArray, ...values: unknown[]): string => template(parts,values,false);

/** Translate an already displayed app message; raw Git output is left unchanged when no catalog message matches. */
export function localizeText(text: string): string {
  const direct = Object.entries(en).find(([source, translated]) => source === text || translated === text);
  if (direct) return language === 'en' ? direct[1] : direct[0];
  for (const [source, translated] of Object.entries(en)) {
    if (!source.includes('{{')) continue;
    for (const pattern of [source, translated]) {
      const slots: string[] = [];
      const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\{\\{(\d+)\\}\\}/g, (_, slot: string) => {slots.push(slot);return '([\\s\\S]*?)';});
      const match = new RegExp('^'+escaped+'$').exec(text);
      if (match) {
        const values = new Map(slots.map((slot,index)=>[slot,match[index+1]]));
        return (language === 'en' ? translated : source).replace(/\{\{(\d+)\}\}/g, (_, slot: string)=>values.get(slot) ?? '');
      }
    }
  }
  const prefix = text.startsWith('!') ? '!' : '';
  const body = prefix ? text.slice(1) : text;
  const separator = body.indexOf(': ');
  if (separator > 0) {
    const label=body.slice(0,separator);
    if(label==='Error' || Object.entries(en).some(([source,translated])=>source===label || translated===label)) {
      return prefix + localizeText(label) + ': ' + localizeText(body.slice(separator+2));
    }
  }
  return text;
}
