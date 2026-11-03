/** Template values remain opaque: repository names, file paths and source text are never translated. */
export const slotPattern = /\uFFF0(\d+)\uFFF1/g;
export const slot = (index: number): string => `\uFFF0${index}\uFFF1`;

export function messageKey(source: string): {key: string; slots: number[]} {
  const slots: number[] = [];
  const key = source.trim().replace(/\s+/g, ' ').replace(slotPattern, (_, index: string) => {
    slots.push(Number(index));
    return `{{${slots.length - 1}}}`;
  });
  return {key, slots};
}

export function hasMessage(key: string): boolean {
  return /[A-Za-zÄÖÜäöüß]/.test(key.replace(/\{\{\d+\}\}/g, ''));
}

/** Only human-facing text and accessibility attributes are messages. CSS, URLs and data attributes are not. */
export function mapHtmlMessages(source: string, visit: (message: string) => string): string {
  return source.split(/(<(?:[^>"']|"[^"]*"|'[^']*')*>)/g).map((part, index) => {
    if (index % 2) {
      return part.replace(/\b(title|aria-label|placeholder|alt)=("([^"]*)"|'([^']*)')/g,
        (_, name: string, quoted: string, double: string | undefined, single: string | undefined) =>
          `${name}=${quoted[0]}${visit(double ?? single ?? '')}${quoted[0]}`);
    }
    return visit(part);
  }).join('');
}

export function htmlMessages(source: string): string[] {
  const messages: string[] = [];
  mapHtmlMessages(source, message => {
    const {key} = messageKey(message);
    if (hasMessage(key)) messages.push(key);
    return message;
  });
  return messages;
}
