import { parse } from "parse5";
/** Pure HTML parsing, then DOM construction in a template's inert owner document.
 * Unlike DOMParser on raw HTML, parsing cannot start resource fetches. */
export function inertDocument(source: string) {
  const template = document.createElement("template");
  const owner = template.content.ownerDocument;
  const tree = parse(source);
  const convert = (node: any): Node => {
    if (node.nodeName === "#text") return owner.createTextNode(node.value);
    if (node.nodeName === "#comment") return owner.createComment(node.data);
    const element = owner.createElementNS(
      node.namespaceURI ?? "http://www.w3.org/1999/xhtml",
      node.tagName,
    );
    for (const attr of node.attrs ?? []) {
      try {
        if (attr.namespace)
          element.setAttributeNS(
            attr.namespace,
            attr.prefix ? `${attr.prefix}:${attr.name}` : attr.name,
            attr.value,
          );
        else element.setAttribute(attr.name, attr.value);
      } catch {
        /* Ignore malformed attribute names. */
      }
    }
    const target =
      node.tagName === "template"
        ? (element as HTMLTemplateElement).content
        : element;
    for (const child of node.content?.childNodes ?? node.childNodes ?? [])
      target.appendChild(convert(child));
    return element;
  };
  let root = convert(
    (tree as any).childNodes.find((n: any) => n.tagName === "html"),
  ) as HTMLElement;
  template.content.append(root);
  return {
    get documentElement() {
      return root;
    },
    get head() {
      return root.querySelector("head") as HTMLHeadElement;
    },
    get body() {
      return root.querySelector("body") as HTMLBodyElement;
    },
    createElement: owner.createElement.bind(owner),
    importNode: owner.importNode.bind(owner),
    querySelector: (selector: string) => root.querySelector(selector),
    querySelectorAll: (selector: string) => root.querySelectorAll(selector),
    replace(next: HTMLElement) {
      root.replaceWith(next);
      root = next;
    },
  };
}
