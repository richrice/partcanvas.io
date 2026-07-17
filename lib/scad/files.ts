export interface ResolvedSources {
  source: string;
  libraries: string[];
}

export function canonicalProjectPath(value: string) {
  if (value.startsWith("/") || value.startsWith("\\")) throw new Error(`Invalid model file path '${value}'`);
  const segments: string[] = [];
  for (const segment of value.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!segments.length) throw new Error(`Invalid model file path '${value}'`);
      segments.pop();
    } else segments.push(segment);
  }
  if (!segments.length) throw new Error(`Invalid model file path '${value}'`);
  return segments.join("/");
}

function referencedPath(currentFile: string, target: string) {
  const directory = currentFile.split("/").slice(0, -1).join("/");
  return canonicalProjectPath(`${directory ? `${directory}/` : ""}${target.trim()}`);
}

export function resolveSourceFiles(source: string, inputFiles: Record<string, string> = {}): ResolvedSources {
  const files = new Map(Object.entries(inputFiles).map(([name, contents]) => [canonicalProjectPath(name), contents]));
  const libraries: string[] = [];
  const visitedLibraries = new Set<string>();
  const directive = /^\s*(include|use)\s*<([^>]+)>\s*;?\s*(?:\/\/.*)?$/gm;

  const resolveFile = (contents: string, currentFile: string, includeStack: string[]): string => contents.replace(
    directive,
    (_match, kind: "include" | "use", rawTarget: string) => {
      const target = referencedPath(currentFile, rawTarget);
      const targetSource = files.get(target);
      if (targetSource === undefined) throw new Error(`Model file '${target}' was not provided`);
      if (kind === "include") {
        if (includeStack.includes(target)) throw new Error(`Circular include: ${[...includeStack, target].join(" → ")}`);
        return `// begin include <${target}>\n${resolveFile(targetSource, target, [...includeStack, target])}\n// end include <${target}>`;
      }
      if (!visitedLibraries.has(target)) {
        visitedLibraries.add(target);
        libraries.push(resolveFile(targetSource, target, [target]));
      }
      return `// use <${target}>`;
    },
  );

  return { source: resolveFile(source, "main.scad", ["main.scad"]), libraries };
}
