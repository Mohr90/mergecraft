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
