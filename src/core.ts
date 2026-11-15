export type Project = {
  id: string;
  name: string;
  root: string;
  entry: string;
  last: string;
  trusted: boolean;
};
export type Settings = {
  projects: Project[];
  selected: string;
  allowExternal: boolean;
};
export const DEFAULTS: Settings = {
  projects: [],
  selected: "",
  allowExternal: false,
};
export const TEXT_EXT = new Set([
  "html",
  "htm",
  "txt",
  "css",
  "js",
  "json",
  "svg",
]);
export const ASSET_EXT = new Set([
  ...TEXT_EXT,
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "ico",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "mp3",
  "mp4",
  "ogg",
  "wav",
  "webm",
]);
export const MAX_FILES = 256,
  MAX_BYTES = 32 * 1024 * 1024,
  MAX_FILE_BYTES = 8 * 1024 * 1024;
export function extension(path: string) {
  return path.split(".").pop()?.toLowerCase() ?? "";
}
export function isPage(path: string) {
  return ["html", "htm", "txt"].includes(extension(path));
}
export function safePath(path: string): boolean {
  return (
    !!path &&
    !path.startsWith("/") &&
    !/[\\\0]/.test(path) &&
    path
      .split("/")
      .every((p) => p !== "." && p !== ".." && p !== "" && !p.startsWith("."))
  );
}
export function inRoot(path: string, root: string) {
  return safePath(path) && safePath(root) && path.startsWith(root + "/");
}
export function resolveLocal(base: string, href: string): string | null {
  if (
    !safePath(base) ||
    /[\\\0]/.test(href) ||
    /^[a-z][a-z\d+.-]*:/i.test(href) ||
    href.startsWith("//")
  )
    return null;
  let u: URL;
  try {
    u = new URL(href, "https://local.invalid/" + base);
  } catch {
    return null;
  }
  if (u.origin !== "https://local.invalid") return null;
  let path: string;
  try {
    path = decodeURIComponent(u.pathname.slice(1));
  } catch {
    return null;
  }
  if (!safePath(path)) return null;
  return u.pathname.slice(1) + u.search + u.hash;
}
export function pathOnly(path: string) {
  return path.split(/[?#]/)[0];
}
export function pagePath(url: string) {
  try {
    return decodeURIComponent(pathOnly(url));
  } catch {
    return "";
  }
}
export function pageURL(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}
export function safeExternal(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
      return null;
    return u.href;
  } catch {
    return null;
  }
}
export function videoURL(raw: string): { id: string; start: number } | null {
  const safe = safeExternal(raw);
  if (!safe) return null;
  const u = new URL(safe);
  let id = "";
  if (u.hostname === "youtu.be") id = u.pathname.slice(1);
  else if (
    [
      "youtube.com",
      "www.youtube.com",
      "youtube-nocookie.com",
      "www.youtube-nocookie.com",
    ].includes(u.hostname)
  ) {
    if (u.pathname === "/watch") id = u.searchParams.get("v") ?? "";
    else if (u.pathname.startsWith("/embed/")) id = u.pathname.slice(7);
  }
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
  const t = u.searchParams.get("start") ?? u.searchParams.get("t") ?? "0";
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
  const secs = /^\d+$/.test(t)
    ? Number(t)
    : m
      ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
      : 0;
  return { id, start: Math.min(86400, Math.max(0, secs)) };
}
export function isHTML(text: string) {
  return /<(?:!doctype\s+html|html|head|body|div|p|h[1-6]|script|style|table|main|section)\b/i.test(
    text,
  );
}
export function decodeText(bytes: ArrayBuffer): string {
  const b = new Uint8Array(bytes);
  if (b[0] === 255 && b[1] === 254)
    return new TextDecoder("utf-16le", { fatal: true }).decode(bytes);
  if (b[0] === 254 && b[1] === 255)
    return new TextDecoder("utf-16be", { fatal: true }).decode(bytes);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
export const MIME: Record<string, string> = {
  html: "text/html",
  htm: "text/html",
  txt: "text/plain",
  css: "text/css",
  js: "text/javascript",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  ogg: "audio/ogg",
  wav: "audio/wav",
  webm: "video/webm",
};
export type Bundle = {
  files: Map<string, ArrayBuffer>;
  text: Map<string, string>;
};
export function makeBundle(
  entries: { path: string; bytes: ArrayBuffer }[],
): Bundle {
  if (entries.length > MAX_FILES)
    throw new Error(
      `Project exceeds ${MAX_FILES} supported files. Choose a smaller folder.`,
    );
  let total = 0;
  const files = new Map<string, ArrayBuffer>(),
    text = new Map<string, string>();
  for (const entry of entries) {
    if (!safePath(entry.path) || !ASSET_EXT.has(extension(entry.path)))
      continue;
    if (entry.bytes.byteLength > MAX_FILE_BYTES)
      throw new Error("A file exceeds the 8 MB limit.");
    total += entry.bytes.byteLength;
    if (total > MAX_BYTES) throw new Error("Project exceeds 32 MB.");
    files.set(entry.path, entry.bytes);
    if (TEXT_EXT.has(extension(entry.path)))
      text.set(entry.path, decodeText(entry.bytes));
  }
  return { files, text };
}
export class PageHistory {
  items: string[] = [];
  index = -1;
  push(path: string) {
    if (this.items[this.index] === path) return;
    this.items.splice(this.index + 1);
    this.items.push(path);
    this.index = this.items.length - 1;
  }
  back() {
    if (this.index > 0) return this.items[--this.index];
  }
  forward() {
    if (this.index < this.items.length - 1) return this.items[++this.index];
  }
}
