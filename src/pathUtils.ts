function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}

function encodePath(path: string): string {
  const normalized = normalizePath(path);
  const hasLeadingSlash = normalized.startsWith("/");
  const pathWithoutLeadingSlash = hasLeadingSlash ? normalized.slice(1) : normalized;

  return pathWithoutLeadingSlash
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join("/");
}

export function vaultFileToFileUrl(basePath: string, filePath: string): string {
  const fullPath = normalizePath(`${basePath}/${filePath}`);
  return `file:///${encodePath(fullPath)}`;
}

export function absolutePathToFileUrl(absPath: string): string {
  return `file:///${encodePath(absPath)}`;
}
