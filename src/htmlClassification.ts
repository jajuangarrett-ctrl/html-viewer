/** Shared, inert content classifier. No DOM parsing, execution, assets or network. */
export const HTML_CLASSIFICATION_PREFIX = 64 * 1024;
export function classifyHtmlContent(text: string): boolean {
  let prefix = text.slice(0, HTML_CLASSIFICATION_PREFIX).replace(/^\uFEFF/, "").trimStart();
  // Leading comments and an XML declaration are common in generated/XHTML pages.
  for (let n = 0; n < 64; n++) {
    if (prefix.startsWith("<!--")) {
      const end = prefix.indexOf("-->");
      if (end < 0) return false;
      prefix = prefix.slice(end + 3).trimStart();
    } else if (/^<\?xml\s/i.test(prefix)) {
      const end = prefix.indexOf("?>");
      if (end < 0) return false;
      prefix = prefix.slice(end + 2).trimStart();
    } else break;
  }
  if (/^<!doctype\s+html(?=\s|>)[^<>]*>/i.test(prefix)) return true;
  if (/^<(?:html|head|body)(?:\s[^<>]*|\s*)>/i.test(prefix)) return true;
  // Fragments must start with actual structural markup and contain a matching
  // closing tag. Prose/fences/escaped examples and lone script/style are not pages.
  const fragment = /^<(main|article|section|div|p|h[1-6]|table|ul|ol|form|nav|header|footer|aside|figure|blockquote|pre|details|dl)(?:\s[^<>]*|\s*)>/i.exec(prefix);
  return !!fragment && new RegExp("</" + fragment[1] + "\\s*>", "i").test(prefix.slice(fragment[0].length));
}
