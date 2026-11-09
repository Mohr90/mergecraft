// Concurrent import insertions have no common base to align. Offer a preview
// only for complete declarations with distinct local bindings.
export function combineImports(path: string, left: string[], right: string[]): string[] | null {
  const java = path.endsWith(".java");
  if (!java && !/\.[cm]?[jt]sx?$/.test(path)) return null;

  const bindings = new Set<string>();
  for (const line of [...left, ...right]) {
    const source = line.trim();
    const declaration = java
      ? /^import\s+(?:[\w$]+\.)+([\w$]+);$/.exec(source)
      : /^import\s+(?:type\s+)?\{\s*([\w$]+(?:\s*,\s*[\w$]+)*)\s*\}\s+from\s+(['"])[^'"\\]+\2\s*;?$/.exec(source);
    if (!declaration) return null;
    for (const name of declaration[1].split(/\s*,\s*/)) {
      if (bindings.has(name)) return null;
      bindings.add(name);
    }
  }
  return [...left, ...right];
}

// Keep the current declaration's spelling and spacing. Only append names
// when both sides preserved the base list and the surrounding declaration.
export function extendNamedImport(base: string, left: string, right: string): string | null {
  const named = /^(\s*import\s+(?:type\s+)?\{\s*)([A-Za-z_$][\w$]*(?:\s*,\s*[A-Za-z_$][\w$]*)*)(\s*\}\s+from\s+(['"])[^'"\\]+\4\s*;?\s*)$/;
  const parse = (line: string) => {
    const match = named.exec(line);
    if (!match) return null;
    const names = match[2].split(/\s*,\s*/);
    return new Set(names).size === names.length ? { match, names } : null;
  };
  const b = parse(base), l = parse(left), r = parse(right);
  if (!b || !l || !r) return null;
  for (const side of [l, r]) {
    if (side.match[1] !== b.match[1] || side.match[3] !== b.match[3] ||
        side.names.length <= b.names.length || !b.names.every((name,i) => side.names[i] === name)) return null;
  }
  const extra = r.names.filter(name => !l.names.includes(name));
  return l.match[1] + l.match[2] + (extra.length ? ", " + extra.join(", ") : "") + l.match[3];
}
