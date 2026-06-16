function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

function normalizeCompactPath(path: string): string {
  return normalizePath(path).replace(/\s+/g, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wildcardToRegExp(pattern: string, compact = false): RegExp {
  const normalized = compact ? normalizeCompactPath(pattern.trim()) : normalizePath(pattern.trim());
  const wildcardPattern = normalized
    .split("*")
    .map(escapeRegExp)
    .join(".*");

  return new RegExp(wildcardPattern);
}

export function parseExcludePatterns(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0 && !pattern.startsWith("#"));
}

export function pathMatchesExcludePattern(path: string, pattern: string): boolean {
  const normalizedPath = normalizePath(path);
  const compactPath = normalizeCompactPath(path);
  const normalizedPattern = normalizePath(pattern.trim());
  const compactPattern = normalizeCompactPath(pattern.trim());

  if (!normalizedPattern) {
    return false;
  }

  if (normalizedPattern.includes("*")) {
    return (
      wildcardToRegExp(normalizedPattern).test(normalizedPath) ||
      wildcardToRegExp(normalizedPattern, true).test(compactPath)
    );
  }

  return normalizedPath.includes(normalizedPattern) || compactPath.includes(compactPattern);
}

export function isPathExcluded(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => pathMatchesExcludePattern(path, pattern));
}
