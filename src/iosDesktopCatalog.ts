import { App, FileSystemAdapter, TFile, TFolder } from "obsidian";
import type { promises as FileSystem } from "node:fs";
import { IOS_CATALOG_FILE, IOS_CATALOG_MAX_BYTES, type IOSCatalogOutput } from "./iosCatalogExport";

const PREF_KEY = "html-viewer.ios-catalog-publisher.v1";
const folderPaths = ["Artifacts", "Artifacts/HTML Viewer"];
type LocalState = { enabled: boolean; digest?: string };

function readLocal(app: App): LocalState {
  let raw: unknown;
  try {
    if (typeof app.loadLocalStorage === "function") raw = app.loadLocalStorage(PREF_KEY);
    else {
      const serialized = localStorage.getItem(PREF_KEY + ":" + app.vault.getName());
      if (serialized) raw = JSON.parse(serialized);
    }
  } catch { /* Unavailable or invalid local preferences leave publishing off. */ }
  const state = raw && typeof raw === "object" ? raw as Partial<LocalState> : {};
  return {
    enabled: state.enabled === true,
    digest: typeof state.digest === "string" && /^[a-f0-9]{64}$/.test(state.digest) ? state.digest : undefined,
  };
}

function saveLocal(app: App, state: LocalState): void {
  if (typeof app.saveLocalStorage === "function") app.saveLocalStorage(PREF_KEY, state);
  else localStorage.setItem(PREF_KEY + ":" + app.vault.getName(), JSON.stringify(state));
}

export function iosPublishingEnabled(app: App): boolean {
  return readLocal(app).enabled;
}

export function saveIOSPublishingEnabled(app: App, enabled: boolean): void {
  saveLocal(app, { ...readLocal(app), enabled });
}

/** Filesystem guard is desktop-only. Never inspect the contents of other files. */
async function verifyPhysicalTarget(app: App): Promise<boolean> {
  const adapter = app.vault.adapter;
  if (!(adapter instanceof FileSystemAdapter)) throw new Error("Unsupported desktop file adapter");
  // The native app never runs this branch and does not need Node modules.
  const fs: typeof FileSystem = require("node:fs").promises;
  const join: typeof import("node:path").join = require("node:path").join;
  const root = await fs.realpath(adapter.getBasePath());
  for (const path of [...folderPaths, IOS_CATALOG_FILE]) {
    try {
      const stat = await fs.lstat(join(root, ...path.split("/")));
      if (stat.isSymbolicLink() || (path === IOS_CATALOG_FILE ? !stat.isFile() || stat.nlink > 1 : !stat.isDirectory())) return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
      throw error;
    }
  }
  return true;
}

export function desktopCatalogOutput(app: App, safeTarget = () => verifyPhysicalTarget(app)): IOSCatalogOutput {
  const vault = app.vault;
  return {
    async read() {
      if (!await safeTarget()) return { state: "collision" };
      const entry = vault.getAbstractFileByPath(IOS_CATALOG_FILE);
      if (!entry) return { state: "missing" };
      if (!(entry instanceof TFile) || entry.path !== IOS_CATALOG_FILE || entry.stat.size > IOS_CATALOG_MAX_BYTES) {
        return { state: "collision" };
      }
      const text = await vault.read(entry);
      return new TextEncoder().encode(text).length <= IOS_CATALOG_MAX_BYTES ? { state: "file", text } : { state: "collision" };
    },
    async create(text, current) {
      if (!current() || !await safeTarget() || !current()) return false;
      for (const path of folderPaths) {
        const folder = vault.getAbstractFileByPath(path);
        if (folder && (!(folder instanceof TFolder) || folder.path !== path)) return false;
        if (!folder) {
          if (!current()) return false;
          try { await vault.createFolder(path); }
          catch (error) {
            if (!(vault.getAbstractFileByPath(path) instanceof TFolder)) throw error;
          }
        }
      }
      if (!await safeTarget() || !current() || vault.getAbstractFileByPath(IOS_CATALOG_FILE)) return false;
      try {
        // Vault.create refuses an existing destination, including during initial creation.
        await vault.create(IOS_CATALOG_FILE, text);
      } catch (error) {
        if (vault.getAbstractFileByPath(IOS_CATALOG_FILE)) return false;
        throw error;
      }
      return true;
    },
    async replace(previous, text, current) {
      if (!current() || !await safeTarget() || !current()) return false;
      const file = vault.getAbstractFileByPath(IOS_CATALOG_FILE);
      if (!(file instanceof TFile) || file.path !== IOS_CATALOG_FILE || file.stat.size > IOS_CATALOG_MAX_BYTES) return false;
      let applied = false;
      await vault.process(file, contents => {
        // Compare again inside Obsidian's atomic read/modify operation.
        if (!current() || contents !== previous || vault.getAbstractFileByPath(IOS_CATALOG_FILE) !== file) return contents;
        applied = true;
        return text;
      });
      return applied;
    },
    knownDigest: () => readLocal(app).digest,
    rememberDigest: digest => saveLocal(app, { ...readLocal(app), digest }),
  };
}
