/** Append trusted viewer markup to the real body, never to HTML inside scripts. */
export function appendToDocumentBody(html: string, markup: string): string {
  // Parsing is inert. The serialized scripts execute only when loaded into srcdoc.
  const document = new DOMParser().parseFromString(html, "text/html");
  document.body.insertAdjacentHTML("beforeend", markup);
  const doctype = document.doctype
    ? `${new XMLSerializer().serializeToString(document.doctype)}\n`
    : "";
  return doctype + document.documentElement.outerHTML;
}
