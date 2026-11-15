import { inertDocument } from "./inertDocument";
import DOMPurify from "dompurify";
import postcss from "postcss";
import valueParser from "postcss-value-parser";
import {
  Bundle,
  MIME,
  extension,
  isHTML,
  pathOnly,
  pagePath,
  resolveLocal,
  videoURL,
} from "./core";
export type Rendered = {
  html: string;
  nonce: string;
  videos: { id: string; start: number }[];
  pageOwned: boolean;
  warnings: string[];
};
function encode(bytes: ArrayBuffer) {
  let s = "";
  const b = new Uint8Array(bytes);
  for (let i = 0; i < b.length; i += 8192)
    s += String.fromCharCode(...b.subarray(i, i + 8192));
  return btoa(s);
}
function dataURI(bundle: Bundle, path: string): string | null {
  const b = bundle.files.get(pagePath(path));
  if (!b) return null;
  const ext = extension(pagePath(path));
  if (["html", "htm", "js", "txt", "json"].includes(ext)) return null;
  return `data:${MIME[ext] ?? "application/octet-stream"};base64,${encode(b)}`;
}
function json(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
export function preparePage(
  bundle: Bundle,
  page: string,
  trusted = false,
): Rendered {
  const raw = bundle.text.get(pagePath(page));
  if (raw === undefined) throw new Error("Page is missing or not supported.");
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const warnings: string[] = [];
  const videos = new Map<string, { id: string; start: number }>();
  const source =
    extension(pagePath(page)) === "txt" && !isHTML(raw)
      ? "<html><head><title>Text document</title></head><body><pre></pre></body></html>"
      : raw;
  const doc = inertDocument(source);
  if (extension(pagePath(page)) === "txt" && !isHTML(raw))
    doc.querySelector("pre")!.textContent = raw;
  const pageOwned =
    doc
      .querySelector('meta[name="fjg-navigation"]')
      ?.getAttribute("content") === "page-sections";
  const resource = (base: string, url: string) => {
    // Keep generated URLs through nested CSS import rewrites, and support safe
    // self-contained base64 media. Never admit HTML/script data documents.
    if (
      /^data:(?:image\/(?:png|jpeg|gif|webp|avif|x-icon|svg\+xml)|font\/(?:woff2?|ttf|otf)|audio\/(?:mpeg|ogg|wav)|video\/(?:mp4|webm));base64,[A-Za-z0-9+/=]+$/i.test(
        url,
      )
    )
      return url;
    const p = resolveLocal(base, url);
    return p ? dataURI(bundle, p) : null;
  };
  const css = (
    text: string,
    base: string,
    seen = new Set<string>(),
  ): string => {
    try {
      const ast = postcss.parse(text);
      ast.walkAtRules((rule) => {
        if (rule.name.toLowerCase() === "import") {
          const parsed = valueParser(rule.params);
          let url = "";
          const first = parsed.nodes[0];
          if (first?.type === "string") url = first.value;
          else if (
            first?.type === "function" &&
            first.value.toLowerCase() === "url"
          )
            url = valueParser
              .stringify(first.nodes)
              .replace(/^['"]|['"]$/g, "");
          const p = resolveLocal(base, url);
          if (
            p &&
            bundle.text.has(pagePath(p)) &&
            !seen.has(p) &&
            seen.size < 12
          ) {
            const next = new Set(seen);
            next.add(p);
            const imported = postcss.parse(
              css(bundle.text.get(pagePath(p))!, pathOnly(p), next),
            );
            const qualifier = valueParser
              .stringify(parsed.nodes.slice(1))
              .trim();
            if (!qualifier) rule.replaceWith(imported);
            else if (/^(?:all|screen|print|not|only|\()/i.test(qualifier)) {
              const media = postcss.atRule({
                name: "media",
                params: qualifier,
              });
              media.append(imported.nodes);
              rule.replaceWith(media);
            } else {
              warnings.push(
                "A stylesheet import with an unsupported qualifier was skipped.",
              );
              rule.remove();
            }
          } else rule.remove();
        }
      });
      ast.walkDecls((d) => {
        if (/(?:behavior|-moz-binding)/i.test(d.prop)) {
          d.remove();
          return;
        }
        const parsed = valueParser(d.value);
        parsed.walk((n) => {
          if (n.type === "function" && n.value.toLowerCase() === "url") {
            const url = valueParser
              .stringify(n.nodes)
              .replace(/^['"]|['"]$/g, "");
            const resolved = resource(base, url);
            n.nodes = [
              {
                type: "string",
                quote: '"',
                value: resolved ?? "",
                sourceIndex: 0,
                sourceEndIndex: 0,
              },
            ];
          }
        });
        d.value = parsed.toString();
      });
      return ast.toString();
    } catch {
      warnings.push("A malformed stylesheet was skipped.");
      return "";
    }
  };
  // Resolve project resources before sanitization. Nothing in this inert document is mounted.
  for (const el of Array.from(doc.querySelectorAll("*"))) {
    for (const a of ["href", "src"]) {
      const rawURL = el.getAttribute(a);
      if (rawURL) {
        const v = videoURL(rawURL);
        if (v) videos.set(v.id, v);
      }
    }
    if (el.tagName === "LINK") {
      if (el.getAttribute("rel")?.toLowerCase() === "stylesheet") {
        const p = resolveLocal(page, el.getAttribute("href") ?? "");
        const content = p ? bundle.text.get(pagePath(p)) : undefined;
        const style = doc.createElement("style");
        style.textContent = content ? css(content, pathOnly(p!)) : "";
        el.replaceWith(style);
      } else el.remove();
      continue;
    }
    if (el.tagName === "STYLE") {
      el.textContent = css(el.textContent ?? "", page);
      continue;
    }
    if (el.hasAttribute("style"))
      el.setAttribute(
        "style",
        css(`x{${el.getAttribute("style")}}`, page).replace(/^x\s*\{|\}$/g, ""),
      );
    if (["IFRAME", "OBJECT", "EMBED"].includes(el.tagName)) {
      const placeholder = doc.createElement("p");
      placeholder.className = "fjg-media-placeholder";
      placeholder.textContent = videoURL(el.getAttribute("src") ?? "")
        ? "YouTube video available in Page Options → Videos."
        : "Embedded content is disabled in this local reader.";
      el.replaceWith(placeholder);
      continue;
    }
    if (el.tagName === "SCRIPT") {
      if (!trusted) {
        el.remove();
        continue;
      }
      const src = el.getAttribute("src");
      if (src) {
        const p = resolveLocal(page, src);
        const script = p ? bundle.text.get(pagePath(p)) : undefined;
        if (script === undefined) {
          warnings.push("An unavailable or remote script was blocked.");
          el.remove();
          continue;
        }
        el.removeAttribute("src");
        el.removeAttribute("integrity");
        el.removeAttribute("crossorigin");
        el.removeAttribute("async");
        el.removeAttribute("defer");
        el.textContent = script;
      }
      el.setAttribute("nonce", nonce);
      continue;
    }
    if (el.tagName === "BASE" || el.tagName === "META") {
      el.remove();
      continue;
    }
    if (el.tagName === "A" || el.tagName === "AREA") {
      const href = el.getAttribute("href");
      if (href) el.setAttribute("data-fjg-href", href);
      el.removeAttribute("href");
      el.removeAttribute("target");
      el.removeAttribute("download");
      el.removeAttribute("ping");
      el.setAttribute("role", "link");
      el.setAttribute("tabindex", "0");
    }
    for (const attr of ["src", "poster", "background"]) {
      const val = el.getAttribute(attr);
      if (val) {
        const resolved = resource(page, val);
        if (resolved) el.setAttribute(attr, resolved);
        else el.removeAttribute(attr);
      }
    }
    for (const attr of [
      "srcset",
      "imagesrcset",
      "action",
      "formaction",
      "xlink:href",
      "srcdoc",
      "manifest",
      "profile",
    ])
      el.removeAttribute(attr);
  }
  // Escape raw-text closing tags before sanitizer inspection and final serialization.
  for (const style of Array.from(doc.querySelectorAll("style"))) {
    style.textContent = (style.textContent ?? "").replace(/</g, "\\3c ");
  }
  if (!trusted) {
    DOMPurify.sanitize(doc.documentElement, {
      IN_PLACE: true,
      WHOLE_DOCUMENT: true,
      FORBID_TAGS: [
        "script",
        "iframe",
        "object",
        "embed",
        "base",
        "meta",
        "link",
        "form",
        "svg",
        "math",
      ],
      FORBID_ATTR: ["srcset", "ping", "action", "formaction", "srcdoc"],
      ADD_ATTR: ["data-fjg-href", "data-fjg-section-toggle"],
    });
  }
  // Trusted inline event handlers get normal listeners; CSP never permits arbitrary inline events.
  const handlers: string[] = [];
  if (trusted)
    for (const el of Array.from(doc.querySelectorAll("*")))
      for (const a of Array.from(el.attributes)) {
        if (a.name.toLowerCase().startsWith("on")) {
          const id =
            el.getAttribute("data-fjg-handler") ?? `fjg-${handlers.length}`;
          el.setAttribute("data-fjg-handler", id);
          handlers.push(
            `document.querySelector('[data-fjg-handler="${id}"]')?.addEventListener(${json(a.name.slice(2))},function(event){${a.value}\n});`,
          );
          el.removeAttribute(a.name);
        }
      }
  const policy = doc.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content = `default-src 'none'; script-src 'nonce-${nonce}'${trusted ? " 'unsafe-eval'" : ""}; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; worker-src 'none';`;
  const charset = doc.createElement("meta");
  charset.setAttribute("charset", "utf-8");
  const vp = doc.createElement("meta");
  vp.name = "viewport";
  vp.content = "width=device-width,initial-scale=1";
  doc.head.prepend(vp);
  doc.head.prepend(policy);
  doc.head.prepend(charset);
  const baseStyle = doc.createElement("style");
  baseStyle.textContent =
    "html{color-scheme:light dark} body{overflow-wrap:anywhere} img,video{max-width:100%;height:auto} pre{white-space:pre-wrap} [data-fjg-href]{cursor:pointer;text-decoration:underline} .fjg-media-placeholder{border:1px solid #888;padding:12px}";
  doc.head.append(baseStyle);
  const payload: Record<string, { data: string; type: string }> = {};
  if (trusted)
    for (const [p, bytes] of bundle.files)
      payload[p] = {
        data: encode(bytes),
        type: MIME[extension(p)] ?? "application/octet-stream",
      };
  const bootstrap = doc.createElement("script");
  bootstrap.setAttribute("nonce", nonce);
  bootstrap.textContent = `(()=>{'use strict';const nonce=${json(nonce)},page=${json(page)},assets=${json(payload)};
 const send=(type,value)=>parent.postMessage({source:'fjg-html-reader',nonce,type,value},'*');
 const visible=e=>!!(e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&!e.closest('[hidden],[inert],[aria-hidden="true"],[disabled]'));
 const sections=()=>[...document.querySelectorAll('[data-fjg-section-toggle]')].filter(e=>visible(e)&&!document.querySelector('dialog[open],[aria-modal="true"]'));
 const report=()=>{const s=sections();send('meta',{title:document.title,sections:s.length===1});};
 const activate=e=>{const a=e.target.closest?.('a,area,[data-fjg-href]');if(!a)return;const href=a.getAttribute('data-fjg-href')||a.getAttribute('href');if(!href)return;e.preventDefault();e.stopPropagation();if(href.startsWith('#')){try{document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView();}catch{}return;}send('link',href);};
 document.addEventListener('click',activate,true);document.addEventListener('keydown',e=>{if(e.key==='Enter')activate(e)},true);document.addEventListener('submit',e=>e.preventDefault(),true);
 addEventListener('message',e=>{if(e.source!==parent||e.data?.nonce!==nonce)return;if(e.data.type==='sections'){const s=sections();if(s.length===1){s[0].focus();s[0].click();}}if(e.data.type==='scale'){document.documentElement.style.zoom=String(Math.min(2,Math.max(.5,Number(e.data.value)||1)));}});
 const start=()=>{report();const hash=page.split('#')[1];if(hash){try{document.getElementById(decodeURIComponent(hash))?.scrollIntoView();}catch{}}new MutationObserver(()=>report()).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','disabled','style','class']});};
 if(${trusted}){const nativeResponse=Response;window.fetch=async(input,init)=>{if(init?.method&&init.method!=='GET')throw new Error('Local read-only fetch');const raw=typeof input==='string'?input:input instanceof URL?input.href:input.url;const url=new URL(raw,'https://local.invalid/'+page);if(url.origin!=='https://local.invalid')throw new Error('Remote fetch blocked');let p;try{p=decodeURIComponent(url.pathname.slice(1));}catch{throw new Error('Invalid path');}const entry=assets[p];if(!entry)return new nativeResponse('Not found',{status:404});const bytes=Uint8Array.from(atob(entry.data),c=>c.charCodeAt(0));return new nativeResponse(bytes,{headers:{'Content-Type':entry.type}});};
 const store=new Map();const memory={getItem:k=>store.get(String(k))??null,setItem:(k,v)=>store.set(String(k),String(v)),removeItem:k=>store.delete(String(k)),clear:()=>store.clear(),key:i=>[...store.keys()][i]??null,get length(){return store.size}};for(const k of ['localStorage','sessionStorage'])try{Object.defineProperty(window,k,{value:memory});}catch{} }
 addEventListener('DOMContentLoaded',()=>{start();${handlers.join("\n")}});})();`;
  doc.head.insertBefore(
    bootstrap,
    Array.from(doc.head.children).find((el) => el.tagName === "SCRIPT") ?? null,
  );
  // Serialized raw-text elements must not turn CSS/JS strings into active HTML.
  for (const style of Array.from(doc.querySelectorAll("style"))) {
    style.textContent = (style.textContent ?? "").replace(/</g, "\\3c ");
  }
  for (const script of Array.from(doc.querySelectorAll("script"))) {
    script.textContent = (script.textContent ?? "").replace(
      /<\/script/gi,
      "<\\/script",
    );
  }
  return {
    html: "<!doctype html>\n" + doc.documentElement.outerHTML,
    nonce,
    videos: [...videos.values()].slice(0, 24),
    pageOwned,
    warnings,
  };
}
