function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

function normalizeCompactPath(path: string): string {
  return normalizePath(path).replace(/\s+/g, "");
}

function splitPathSegments(path: string): string[] {
  return path
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function pathContainsSegmentsInOrder(path: string, pattern: string): boolean {
  const pathSegments = splitPathSegments(normalizeCompactPath(path));
  const patternSegments = splitPathSegments(normalizeCompactPath(pattern));

  if (patternSegments.length < 2) {
    return false;
  }

  let pathIndex = 0;
  for (const patternSegment of patternSegments) {
    const nextIndex = pathSegments.findIndex((segment, index) => {
      return index >= pathIndex && segment.includes(patternSegment);
    });

    if (nextIndex === -1) {
      return false;
    }

    pathIndex = nextIndex + 1;
  }

  return true;
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

  return (
    normalizedPath.includes(normalizedPattern) ||
    compactPath.includes(compactPattern) ||
    pathContainsSegmentsInOrder(path, pattern)
  );
}

export function isPathExcluded(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => pathMatchesExcludePattern(path, pattern));
}
