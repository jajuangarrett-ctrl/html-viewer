// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { appendToDocumentBody } from "./htmlDocument";

const bridge = '<script data-html-viewer-bridge>window.bridgeLoaded = true;</script>';
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");

describe("appendToDocumentBody", () => {
  it("preserves an export document inside a script template and appends one sibling bridge", () => {
    const code = 'const exported = `<!doctype html><html><body><main>Budget</main></body></html>`; window.afterExport = true;';
    const result = appendToDocumentBody(`<!doctype html><html><body><main>Dashboard</main><script>${code}</script></body></html>`, bridge);
    const doc = parse(result);
    expect(doc.scripts).toHaveLength(2);
    expect(doc.scripts[0].textContent).toBe(code);
    expect(doc.body.lastElementChild).toBe(doc.scripts[1]);
    expect(doc.querySelectorAll("[data-html-viewer-bridge]")).toHaveLength(1);
    expect(() => new Function(doc.scripts[0].textContent!)).not.toThrow();
    expect(result.startsWith("<!DOCTYPE html>")).toBe(true);
  });

  it("ignores body-like text in comments, attributes, styles and textareas", () => {
    const doc = parse(appendToDocumentBody('<html><body><!-- </body> --><div title="</body>">Content</div><style>p::after{content:"</body>"}</style><textarea></body></textarea></body></html>', bridge));
    expect(doc.querySelector("textarea")!.value).toBe("</body>");
    expect(doc.querySelector("div")!.getAttribute("title")).toBe("</body>");
    expect(doc.querySelector("style")!.textContent).toContain('content:"</body>"');
    expect(doc.body.lastElementChild!.hasAttribute("data-html-viewer-bridge")).toBe(true);
  });

  it("supports fragments and omitted body tags", () => {
    const doc = parse(appendToDocumentBody('<main>Dashboard</main><script>window.ready = true;</script>', bridge));
    expect(doc.querySelector("main")!.textContent).toBe("Dashboard");
    expect(doc.scripts).toHaveLength(2);
    expect(doc.body.lastElementChild).toBe(doc.scripts[1]);
  });

  it("does not evaluate dashboard scripts while preparing srcdoc", () => {
    document.documentElement.removeAttribute("data-test-executed");
    appendToDocumentBody('<script>document.documentElement.setAttribute("data-test-executed", "yes")</script>', bridge);
    expect(document.documentElement.hasAttribute("data-test-executed")).toBe(false);
  });

  it("preserves literal replacement tokens in the bridge", () => {
    const code = 'const directory = "Reports/$&/$`";';
    const doc = parse(appendToDocumentBody('<body>Dashboard</body>', `<script>${code}</script>`));
    expect(doc.scripts[0].textContent).toBe(code);
  });
});
