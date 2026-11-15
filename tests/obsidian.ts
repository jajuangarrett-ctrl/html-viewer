export class TFolder {
  constructor(
    public path: string,
    public name = path.split("/").pop() ?? path,
  ) {}
}
export class TFile {
  name: string;
  basename: string;
  extension: string;
  stat: { size: number };
  parent: TFolder;
  constructor(
    public path: string,
    public bytes: ArrayBuffer,
  ) {
    this.name = path.split("/").pop()!;
    this.basename = this.name.replace(/\.[^.]+$/, "");
    this.extension = this.name.split(".").pop()!;
    this.parent = new TFolder(path.split("/").slice(0, -1).join("/") || "/");
    this.stat = { size: bytes.byteLength };
  }
}
export class ItemView {
  app: any;
  contentEl: HTMLElement;
  constructor(public leaf: any) {
    this.app = leaf.app;
    this.contentEl = leaf.contentEl;
  }
  addAction(icon: string, title: string, callback: () => void) {
    let header = document.querySelector("#host-header");
    if (!header) { header = document.createElement("header"); header.id="host-header"; this.contentEl.before(header); }
    header.replaceChildren();
    const b = document.createElement("div"); b.setAttribute("aria-label", title); b.onclick=callback; header.append(b); return b;
  }
  registerDomEvent(target: any, event: string, fn: any) {
    target.addEventListener(event, fn);
  }
  registerEvent(_event: any) {}
  getState() {
    return {};
  }
  async setState(_s: any, _r: any) {}
}
export class WorkspaceLeaf {}
export type ViewStateResult = any;
export class Notice {
  constructor(text: string) {
    (window as any).lastNotice = text;
  }
}
export class Menu {
  items: any[] = [];
  addItem(fn: any) {
    const i: any = {
      setTitle: (v: string) => ((i.title = v), i),
      setDisabled: (v: boolean) => ((i.disabled = v), i),
      onClick: (v: any) => ((i.action = v), i),
    };
    fn(i);
    this.items.push(i);
    return this;
  }
  addSeparator() {
    return this;
  }
  showAtPosition() {
    document.querySelector("#test-menu")?.remove();
    const m = document.createElement("div");
    m.id = "test-menu";
    m.style.cssText =
      "position:fixed;right:0;top:44px;background:white;color:black;z-index:100;max-height:80vh;overflow:auto";
    for (const i of this.items) {
      const b = document.createElement("button");
      b.textContent = i.title;
      b.disabled = i.disabled;
      b.style.display = "block";
      b.onclick = () => {
        m.remove();
        i.action();
      };
      m.append(b);
    }
    document.body.append(m);
  }
}
export class Modal {
  titleEl: HTMLElement;
  contentEl: HTMLElement;
  el: HTMLElement;
  constructor(_app: any) {
    this.el = document.createElement("section");
    this.el.className = "test-modal";
    this.el.style.cssText =
      "position:fixed;inset:20px;padding:20px;background:white;color:black;z-index:110;overflow:auto";
    this.titleEl = document.createElement("h2");
    this.contentEl = document.createElement("div");
    this.el.append(this.titleEl, this.contentEl);
  }
  open() {
    document.body.append(this.el);
  }
  close() {
    this.onClose();
    this.el.remove();
  }
  onClose() {}
}
export function setIcon(el: HTMLElement, icon: string) {
  el.textContent =
    ({ "panel-left": "☰", ellipsis: "•••", x: "×", "list-tree": "☷" } as any)[
      icon
    ] ?? icon;
}
