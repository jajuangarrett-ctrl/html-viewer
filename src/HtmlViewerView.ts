import {
  ItemView,
  Menu,
  Modal,
  Notice,
  TFile,
  TFolder,
  ViewStateResult,
  WorkspaceLeaf,
  setIcon,
} from "obsidian";
import type HtmlViewerPlugin from "../main";
import {
  ASSET_EXT,
  Bundle,
  MAX_BYTES,
  MAX_FILES,
  MAX_FILE_BYTES,
  PageHistory,
  Project,
  extension,
  inRoot,
  isReadablePage,
  makeBundle,
  pathOnly,
  pagePath,
  pageURL,
  resolveLocal,
  safeExternal,
  safePath,
  videoURL,
} from "./core";
import { preparePage, Rendered } from "./renderer";
export const VIEW_TYPE_HTML = "html-viewer";
export function confirmAction(
  plugin: HtmlViewerPlugin,
  title: string,
  description: string,
  label: string,
  action: () => void,
) {
  const modal = new Modal(plugin.app);
  modal.titleEl.setText(title);
  modal.contentEl.createEl("p", { text: description });
  const buttons = modal.contentEl.createDiv({
    cls: "html-viewer-dialog-buttons",
  });
  const cancel = buttons.createEl("button", { text: "Cancel" });
  cancel.onclick = () => modal.close();
  const yes = buttons.createEl("button", { text: label });
  yes.onclick = () => {
    modal.close();
    action();
  };
  modal.open();
}
export class HtmlViewerView extends ItemView {
  plugin: HtmlViewerPlugin;
  currentFile: TFile | null = null;
  currentPath = "";
  iframe: HTMLIFrameElement | null = null;
  private project: Project | null = null;
  private bundle: Bundle | null = null;
  private rendered: Rendered | null = null;
  private history = new PageHistory();
  private generation = 0;
  private sidebar!: HTMLElement;
  private list!: HTMLElement;
  private title!: HTMLElement;
  private notice!: HTMLElement;
  private section!: HTMLButtonElement;
  private focusReading = false;
  private focusAction?: HTMLElement;
  private toolbar?: HTMLElement;
  private optionsButton?: HTMLButtonElement;
  private search = "";
  private catalogGeneration = 0;
  private unsubscribeCatalog?: () => void;
  private openLibrary = false;
  private zoom = 1;
  private video: Modal | null = null;
  private resize?: ResizeObserver;
  private message = (e: MessageEvent) => this.onMessage(e);
  constructor(leaf: WorkspaceLeaf, plugin: HtmlViewerPlugin) {
    super(leaf);
    this.plugin = plugin;
  }
  getViewType() {
    return VIEW_TYPE_HTML;
  }
  getDisplayText() {
    return this.currentFile?.name ?? "HTML Viewer";
  }
  getIcon() {
    return "code-2";
  }
  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass("html-viewer-container");
    const bar = root.createDiv({ cls: "html-viewer-navbar" });
    this.toolbar = bar;
    this.focusAction = this.addAction("maximize", "Focus Reading", () => this.toggleFocusReading());
    this.focusAction.addClass("html-viewer-focus-action");
    this.focusAction.setAttribute("role", "button");
    this.focusAction.setAttribute("tabindex", "0");
    this.registerDomEvent(this.focusAction, "keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this.toggleFocusReading(); }
    });
    this.updateFocusReading();
    let skipLibraryClick = false;
    const library = this.button(bar, "Library and Pages", "panel-left", () => {
      if (skipLibraryClick) {
        skipLibraryClick = false;
        return;
      }
      this.toggleLibrary();
    });
    library.setAttribute("data-library", "");
    this.title = bar.createDiv({
      cls: "html-viewer-path",
      text: "HTML Viewer",
    });
    this.section = this.button(bar, "Page Sections", "list-tree", () =>
      this.frameMessage("sections"),
    );
    this.section.hidden = true;
    const options = this.button(bar, "Page Options", "ellipsis", () =>
      this.options(options),
    );
    this.optionsButton = options;
    const body = root.createDiv({ cls: "html-viewer-body" });
    this.sidebar = body.createEl("aside", {
      cls: "html-viewer-library",
      attr: { "aria-label": "Library and Pages" },
    });
    const head = this.sidebar.createDiv({ cls: "html-viewer-library-head" });
    head.createEl("strong", { text: "Library & Pages" });
    this.button(head, "Close Library", "x", () => this.toggleLibrary(false));
    const input = this.sidebar.createEl("input", {
      type: "search",
      attr: {
        placeholder: "Find project or page",
        "aria-label": "Find project or page",
      },
    });
    input.oninput = () => {
      this.search = input.value;
      this.renderLibrary();
    };
    const add = this.sidebar.createDiv({ cls: "html-viewer-library-actions" });
    const open = add.createEl("button", { text: "Open file" });
    open.onclick = () => this.plugin.openFileSuggestModal();
    const folder = add.createEl("button", { text: "Add folder" });
    folder.onclick = () => this.plugin.openFolderSuggestModal(this);
    this.list = this.sidebar.createDiv({ cls: "html-viewer-list" });
    const reader = body.createDiv({ cls: "html-viewer-reader" });
    this.notice = reader.createDiv({ cls: "html-viewer-notice" });
    this.notice.hidden = true;
    this.iframe = reader.createEl("iframe", {
      cls: "html-viewer-iframe",
      attr: {
        sandbox: "allow-scripts",
        referrerpolicy: "no-referrer",
        title: "Local HTML document",
        allow:
          "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-write 'none'; autoplay 'none'",
      },
    });
    this.registerDomEvent(window, "message", this.message);
    this.registerDomEvent(document, "visibilitychange", () => {
      if (document.hidden) this.video?.close();
    });
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf !== this.leaf) this.video?.close();
      }),
    );
    this.registerDomEvent(root, "keydown", (e: KeyboardEvent) => {
      if (e.key === "Escape" && this.openLibrary) {
        this.toggleLibrary(false);
        library.focus();
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "l"
      ) {
        e.preventDefault();
        this.toggleLibrary();
      }
    });
    let startX = 0,
      startY = 0;
    library.addEventListener("pointerdown", (e) => {
      startX = e.clientX;
      startY = e.clientY;
      library.setPointerCapture(e.pointerId);
    });
    library.addEventListener("pointerup", (e) => {
      const dx = e.clientX - startX,
        dy = e.clientY - startY;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        skipLibraryClick = true;
        this.toggleLibrary(dx > 0);
        setTimeout(() => {
          skipLibraryClick = false;
        }, 250);
      }
      if (library.hasPointerCapture(e.pointerId))
        library.releasePointerCapture(e.pointerId);
    });
    this.resize = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? root.clientWidth;
      root.toggleClass("html-viewer-wide", width >= 760);
      this.updateLibrary();
    });
    this.resize.observe(root);
    this.unsubscribeCatalog = this.plugin.subscribeHtmlCatalog(() => void this.renderLibrary());
    void this.renderLibrary();
    this.toggleLibrary(false);
    this.registerEvent(
      this.app.vault.on("rename", (file, old) => {
        if (
          this.project &&
          (old === this.project.root ||
            old === this.project.entry ||
            old === pagePath(this.currentPath))
        ) {
          this.showNotice(
            "The source was renamed. Reopen it to update the project reference.",
          );
        }
        this.renderLibrary();
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file.path === this.currentFile?.path)
          this.showNotice(
            "This source file was removed. The displayed copy is not saved back.",
          );
      }),
    );
  }
  async onClose() {
    this.generation++;
    this.catalogGeneration++;
    this.unsubscribeCatalog?.();
    this.video?.close();
    this.resize?.disconnect();
    this.focusAction?.remove();
    this.focusAction = undefined;
    this.iframe?.remove();
    this.iframe = null;
  }
  private button(
    parent: HTMLElement,
    label: string,
    icon: string,
    callback: () => void,
  ) {
    const b = parent.createEl("button", {
      cls: "html-viewer-icon",
      attr: { "aria-label": label, title: label },
    });
    setIcon(b, icon);
    b.onclick = callback;
    return b;
  }
  toggleFocusReading(value = !this.focusReading) {
    this.focusReading = value;
    if (value) this.toggleLibrary(false);
    this.updateFocusReading();
    // Controls live in the host header, never above HTML text inside the frame.
    if (!value) this.optionsButton?.focus();
    else this.focusAction?.focus();
  }
  private updateFocusReading() {
    if (this.toolbar) this.toolbar.hidden = this.focusReading;
    const label = this.focusReading ? "Show reader controls" : "Focus Reading";
    this.focusAction?.setAttribute("aria-label", label);
    this.focusAction?.setAttribute("title", label);
    this.focusAction?.setAttribute("aria-pressed", String(this.focusReading));
    if (this.focusAction) setIcon(this.focusAction, this.focusReading ? "minimize" : "maximize");
  }
  private updateLibrary() {
    this.sidebar.hidden = !this.openLibrary;
    this.contentEl.toggleClass("html-viewer-library-open", this.openLibrary);
    this.contentEl
      .querySelector("[data-library]")
      ?.setAttribute("aria-expanded", String(this.openLibrary));
    if (this.iframe) {
      const narrow = !this.contentEl.hasClass("html-viewer-wide");
      this.iframe.hidden = this.openLibrary && narrow;
    }
  }
  private toggleLibrary(value = !this.openLibrary) {
    this.openLibrary = value;
    this.updateLibrary();
  }
  private showNotice(message: string) {
    this.notice.setText(message);
    this.notice.hidden = !message;
  }
  private async readProject(project: Project): Promise<Bundle> {
    const candidates = this.app.vault
      .getFiles()
      .filter(
        (f) =>
          (project.root
            ? inRoot(f.path, project.root)
            : f.path === project.entry) && ASSET_EXT.has(extension(f.path)),
      );
    if (candidates.length > MAX_FILES)
      throw new Error(
        `Folder has more than ${MAX_FILES} supported files. Select a smaller project folder.`,
      );
    let total = 0;
    const entries = [];
    for (const f of candidates) {
      if (f.stat.size > MAX_FILE_BYTES)
        throw new Error(`${f.name} exceeds 8 MB.`);
      total += f.stat.size;
      if (total > MAX_BYTES)
        throw new Error("Project exceeds the 32 MB limit.");
      const bytes = await this.app.vault.readBinary(f);
      entries.push({
        path: project.root ? f.path.slice(project.root.length + 1) : f.path,
        bytes,
      });
    }
    return makeBundle(entries);
  }
  async loadFile(file: TFile) {
    if (!isReadablePage(file.path)) return;
    let p = this.plugin.settings.projects.find(
      (p) => p.entry === file.path || (p.root && inRoot(file.path, p.root)),
    );
    if (!p) {
      const root = file.parent?.path === "/" ? "" : (file.parent?.path ?? "");
      p = {
        id: crypto.randomUUID(),
        root,
        entry: file.path,
        last: pageURL(file.path),
        name: file.basename,
        trusted: false,
      };
      this.plugin.settings.projects.push(p);
      await this.plugin.saveSettings();
    }
    await this.loadProject(p, pageURL(file.path));
  }
  async addFolder(folder: TFolder) {
    const files = (await this.plugin.getHtmlFiles())
      .filter((f) => inRoot(f.path, folder.path))
      .sort((a, b) => a.path.localeCompare(b.path));
    const first = files.find((f) => /^index\.html?$/i.test(f.name)) ?? files[0];
    if (!first) {
      new Notice("No visible HTML pages in this folder.");
      return;
    }
    let p = this.plugin.settings.projects.find((p) => p.root === folder.path);
    if (!p) {
      p = {
        id: crypto.randomUUID(),
        name: folder.name,
        root: folder.path,
        entry: first.path,
        last: pageURL(first.path),
        trusted: false,
      };
      this.plugin.settings.projects.push(p);
      await this.plugin.saveSettings();
    }
    const last = files.some(f => f.path === pagePath(p.last)) ? p.last : pageURL(first.path);
    await this.loadProject(p, last);
  }
  private async loadProject(
    project: Project,
    path = project.last,
    force = false,
  ) {
    if (
      !force &&
      this.project?.id === project.id &&
      this.currentPath === path &&
      this.bundle
    ) {
      this.toggleLibrary(false);
      return;
    }
    const ticket = ++this.generation;
    this.video?.close();
    try {
      const bundle = await this.readProject(project);
      if (ticket !== this.generation) return;
      this.project = project;
      this.bundle = bundle;
      this.history = new PageHistory();
      await this.showPage(path, true, true);
      this.plugin.settings.selected = project.id;
      await this.plugin.saveSettings();
    } catch (e) {
      if (ticket === this.generation)
        this.showNotice(
          e instanceof Error ? e.message : "Unable to read project.",
        );
    }
  }
  private async showPage(fullPath: string, push = true, force = false) {
    if (!this.project || !this.bundle || !this.iframe) return;
    if (
      !force &&
      (fullPath === this.currentPath ||
        (fullPath === pathOnly(fullPath) &&
          fullPath === pathOnly(this.currentPath)))
    ) {
      this.toggleLibrary(false);
      return;
    }
    const relative = this.project.root
      ? fullPath.slice(pageURL(this.project.root).length + 1)
      : fullPath;
    if (this.project.root && !inRoot(pagePath(fullPath), this.project.root)) {
      this.showNotice("Link is outside the selected project.");
      return;
    }
    if (
      !this.bundle.text.has(pagePath(relative)) ||
      !isReadablePage(pagePath(relative))
    ) {
      this.showNotice("That page is not in this project.");
      return;
    }
    try {
      const rendered = preparePage(this.bundle, relative, this.project.trusted);
      this.video?.close();
      this.rendered = rendered;
      this.currentPath = fullPath;
      const f = this.app.vault.getAbstractFileByPath(pagePath(fullPath));
      this.currentFile = f instanceof TFile ? f : null;
      this.title.setText(this.currentFile?.name ?? "HTML Viewer");
      this.title.title = fullPath;
      this.iframe.srcdoc = rendered.html;
      this.iframe.onload = () => this.frameMessage("scale", this.zoom);
      this.section.hidden = true;
      if (push) this.history.push(fullPath);
      this.project.last = fullPath;
      this.toggleLibrary(false);
      this.showNotice(
        rendered.warnings.length ? rendered.warnings.join(" ") : "",
      );
      this.renderLibrary();
      await this.plugin.saveSettings();
      this.app.workspace.requestSaveLayout();
    } catch (e) {
      this.showNotice(
        e instanceof Error ? e.message : "Unable to display this page.",
      );
    }
  }
  private frameMessage(type: string, value?: unknown) {
    if (this.rendered)
      this.iframe?.contentWindow?.postMessage(
        { nonce: this.rendered.nonce, type, value },
        "*",
      );
  }
  private onMessage(e: MessageEvent) {
    if (
      e.source !== this.iframe?.contentWindow ||
      !this.rendered ||
      e.data?.nonce !== this.rendered.nonce ||
      e.data.source !== "fjg-html-reader"
    )
      return;
    const d = e.data;
    if (d.type === "meta" && d.value && typeof d.value === "object") {
      if (typeof d.value.title === "string" && d.value.title)
        this.title.setText(d.value.title.slice(0, 300));
      this.section.hidden = !(
        (this.project?.trusted || this.rendered.pageOwned) &&
        d.value.sections === true
      );
    }
    if (
      d.type === "link" &&
      typeof d.value === "string" &&
      d.value.length < 4096
    )
      this.handleLink(d.value);
  }
  private handleLink(raw: string) {
    if (!this.project) return;
    const v = videoURL(raw);
    if (v) {
      this.videoPanel(v);
      return;
    }
    const external = safeExternal(raw);
    if (external) {
      if (!this.plugin.settings.allowExternal) {
        new Notice(
          "External links are off. Enable them in HTML Viewer settings.",
        );
        return;
      }
      confirmAction(
        this.plugin,
        "Open external link?",
        external +
          "\nThe displayed URL will be sent to the browser. No automatic referrer is attached. Check the URL for private information before opening.",
        "Open link",
        () => {
          window.open(external, "_blank", "noopener,noreferrer");
        },
      );
      return;
    }
    const relative = this.project.root
      ? this.currentPath.slice(pageURL(this.project.root).length + 1)
      : this.currentPath;
    const next = resolveLocal(relative, raw);
    if (!next) {
      new Notice("Unsafe or unsupported link blocked.");
      return;
    }
    void this.showPage(
      (this.project.root ? pageURL(this.project.root) + "/" : "") + next,
    );
  }
  private async renderLibrary() {
    if (!this.list) return;
    const ticket = ++this.catalogGeneration;
    const catalog = await this.plugin.getHtmlCatalog();
    if (ticket !== this.catalogGeneration || !this.iframe) return;
    const paths = new Set(catalog.map(row => row.path));
    this.list.empty();
    const q = this.search.toLowerCase();
    this.list.createEl("h3", { text: "Projects" });
    for (const p of this.plugin.settings.projects.filter(
      (p) =>
        catalog.some(row => p.root ? inRoot(row.path, p.root) : row.path === p.entry) &&
        (!q || p.name.toLowerCase().includes(q) || p.root.toLowerCase().includes(q)),
    )) {
      const row = this.list.createDiv({ cls: "html-viewer-project" });
      const b = row.createEl("button", { text: p.name });
      b.setAttribute("aria-current", String(p.id === this.project?.id));
      const first = catalog.find(row => p.root ? inRoot(row.path, p.root) : row.path === p.entry)!;
      const target = paths.has(pagePath(p.last)) ? p.last : pageURL(paths.has(p.entry) ? p.entry : first.path);
      b.onclick = () => void this.loadProject(p, target);
      this.button(row, `Remove ${p.name} from library`, "x", () =>
        confirmAction(
          this.plugin,
          "Remove library reference?",
          "Original files, folders and documents are not deleted.",
          "Remove reference",
          () => {
            this.plugin.settings.projects =
              this.plugin.settings.projects.filter((x) => x.id !== p.id);
            void this.plugin.saveSettings();
            this.renderLibrary();
          },
        ),
      );
    }
    if (this.project && this.bundle) {
      this.list.createEl("h3", { text: "Pages" });
      for (const p of [...this.bundle.text.keys()]
        .filter(p => paths.has((this.project!.root ? this.project!.root + "/" : "") + p))
        .filter((p) => !q || p.toLowerCase().includes(q))
        .sort()) {
        const full = (this.project.root ? this.project.root + "/" : "") + p;
        const b = this.list.createEl("button", {
          text: p,
          cls: "html-viewer-page",
        });
        b.setAttribute(
          "aria-current",
          String(pagePath(this.currentPath) === full),
        );
        b.onclick = () => void this.showPage(pageURL(full));
      }
    }
  }
  private options(button: HTMLElement) {
    const menu = new Menu();
    const add = (name: string, fn: () => void, disabled = false) =>
      menu.addItem((i) => i.setTitle(name).setDisabled(disabled).onClick(fn));
    add("Focus Reading", () => this.toggleFocusReading(true));
    menu.addSeparator();
    add(
      "Back",
      () => {
        const p = this.history.back();
        if (p) void this.showPage(p, false);
      },
      this.history.index <= 0,
    );
    add(
      "Forward",
      () => {
        const p = this.history.forward();
        if (p) void this.showPage(p, false);
      },
      this.history.index >= this.history.items.length - 1,
    );
    add(
      "Start Page",
      () => {
        if (this.project) void this.showPage(pageURL(this.project.entry));
      },
      !this.project,
    );
    add("Reload from vault", () => this.reload(), !this.project);
    menu.addSeparator();
    add("Larger text / page", () => {
      this.zoom = Math.min(2, this.zoom + 0.1);
      this.frameMessage("scale", this.zoom);
    });
    add("Smaller text / page", () => {
      this.zoom = Math.max(0.5, this.zoom - 0.1);
      this.frameMessage("scale", this.zoom);
    });
    add("Actual size", () => {
      this.zoom = 1;
      this.frameMessage("scale", 1);
    });
    menu.addSeparator();
    add(
      this.project?.trusted
        ? "Mode: Trusted scripts (not offline-isolated)"
        : "Mode: Safe (scripts off)",
      () => {},
      true,
    );
    if (this.project)
      add(
        this.project.trusted
          ? "Switch to safe mode"
          : "Enable trusted interactive mode",
        () => this.changeTrust(),
      );
    for (const v of this.rendered?.videos ?? [])
      add(`Video · ${v.id}`, () => this.videoPanel(v));
    menu.showAtPosition({
      x: button.getBoundingClientRect().right,
      y: button.getBoundingClientRect().bottom,
    });
  }
  private changeTrust() {
    const p = this.project;
    if (!p) return;
    if (p.trusted) {
      p.trusted = false;
      void this.loadProject(p, this.currentPath, true);
      return;
    }
    confirmAction(
      this.plugin,
      "Trust this HTML project?",
      `Scripts in “${p.name}” can read the supported files in ${p.root || p.entry}. They cannot access the Obsidian host or other vault folders through this plugin, but can navigate their own frame online and leak project data. This is NOT the iOS app’s offline network isolation. Only enable this for your own reviewed code. Reloading resets temporary page state.`,
      "Trust and enable scripts",
      () => {
        p.trusted = true;
        void this.loadProject(p, this.currentPath, true);
      },
    );
  }
  private videoPanel(v: { id: string; start: number }) {
    this.video?.close();
    const modal = new Modal(this.app);
    this.video = modal;
    modal.titleEl.setText("YouTube video");
    modal.contentEl.createEl("p", {
      text: "Nothing is loaded yet. Loading contacts YouTube and its delivery/advertising services. Only the public video ID and start time are supplied, not this page or vault path. Playback may be rejected by YouTube inside Obsidian.",
    });
    const load = modal.contentEl.createEl("button", {
      text: "Load video from YouTube",
    });
    let frame: HTMLIFrameElement | undefined;
    load.onclick = () => {
      load.disabled = true;
      frame = modal.contentEl.createEl("iframe", {
        cls: "html-viewer-video",
        attr: {
          title: "YouTube video",
          src: `https://www.youtube-nocookie.com/embed/${v.id}?start=${v.start}&autoplay=0&playsinline=1`,
          sandbox: "allow-scripts allow-same-origin allow-presentation",
          allow: "encrypted-media; fullscreen; picture-in-picture",
          referrerpolicy: "no-referrer",
        },
      });
    };
    const unload = modal.contentEl.createEl("button", { text: "Unload video" });
    unload.onclick = () => {
      frame?.remove();
      frame = undefined;
      load.disabled = false;
    };
    const browser = modal.contentEl.createEl("button", {
      text: "Open public video in browser",
    });
    browser.onclick = () =>
      confirmAction(
        this.plugin,
        "Open YouTube?",
        `https://www.youtube.com/watch?v=${v.id}`,
        "Open link",
        () =>
          window.open(
            `https://www.youtube.com/watch?v=${v.id}&t=${v.start}`,
            "_blank",
            "noopener,noreferrer",
          ),
      );
    const done = modal.contentEl.createEl("button", { text: "Done" });
    done.onclick = () => modal.close();
    modal.onClose = () => {
      frame?.remove();
      if (this.video === modal) this.video = null;
    };
    modal.open();
    if (modal.contentEl.clientWidth < 200) {
      load.disabled = true;
      modal.contentEl.createEl("p", {
        text: "This pane is too narrow for an embedded player. Open the public video in your browser instead.",
      });
    }
  }
  reload() {
    if (this.project)
      void this.loadProject(this.project, this.currentPath, true);
  }
  getState() {
    return {
      ...super.getState(),
      file: pagePath(this.currentPath),
      url: this.currentPath,
    };
  }
  async setState(state: unknown, result: ViewStateResult) {
    await super.setState(state, result);
    if (!state || typeof state !== "object") return;
    const s = state as { file?: unknown; url?: unknown; absPath?: unknown };
    if (typeof s.file === "string") {
      const f = this.app.vault.getAbstractFileByPath(s.file);
      if (f instanceof TFile) {
        await this.loadFile(f);
        if (typeof s.url === "string" && pagePath(s.url) === f.path)
          await this.showPage(s.url);
      }
    } else if (s.absPath) {
      new Notice(
        "Absolute filesystem paths are no longer opened. Add the HTML project to the vault and reopen it.",
      );
    }
  }
}
