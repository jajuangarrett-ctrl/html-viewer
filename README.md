# HTML Viewer for Obsidian

**0.2.1** brings the local HTML reading workflow from the companion iOS HTML Viewer into the existing `html-viewer` plugin, now on desktop **and mobile**. It does not replace or change the iOS app.

## Install or update with BRAT

Use `jajuangarrett-ctrl/html-viewer` in BRAT, then enable **HTML Viewer** under Community plugins. Existing users should update that plugin rather than installing another one. Plugin ID, saved exclusions and the **Open HTML file in viewer** command are retained.

A manual release contains `main.js`, `manifest.json`, and `styles.css`. Put those in `.obsidian/plugins/html-viewer/` in a test vault, then enable the plugin. Do not overwrite `data.json` when updating. The plugin does not install itself into a vault.

## Open a project

1. Put the HTML file and its local assets in a dedicated folder inside your vault. Keep relative paths intact. Obsidian Sync must actually have downloaded those files on the phone.
2. Run **HTML Viewer: Open HTML file in viewer**, use the code icon in the ribbon, or choose **Open in HTML Viewer** from the file menu. HTML, HTM, HTML stored in TXT, and plain TXT are supported.
3. Tap **Library and Pages** to switch projects or pages. **Add folder** selects an existing vault folder; it is a reference, not a second imported copy. Removing a library reference never deletes files.
4. **Page Options** offers back/forward, start page, reload from vault, scale, safe/trusted mode, and detected videos.

The source is read-only. No source HTML, attachments, dashboard data, or other vault files are rewritten. A file at the vault root is a single-file project; put it in its own folder to use neighboring assets. Hidden paths and unsupported file types are not bundled. Limits: 256 supported files, 32 MB total, 8 MB per file.

## iPhone Duo and responsive layouts

- One compact 44-pixel control row, with no duplicate title/header. Controls never overlay the HTML's first line.
- Narrow panes use a full-width reader and a switchable Library. Wider panes (at least 760 CSS pixels **inside the Obsidian view**) can show Library and the reader together.
- Tap Library, or drag its handle right to show and left to hide. The page itself keeps its normal text selection and scroll gestures. Escape closes Library; Command/Control–Shift–L toggles it.
- Folding, rotation and Library visibility do not rebuild the iframe. Draft form text, script state and scroll position stay in the same live page. Selecting the current project/page again does not reset it.
- The plugin fills the space Obsidian assigns. It cannot reclaim an OS-owned rail, hinge/system area, or Obsidian-owned chrome. No model-name or guessed hinge-width heuristics are used.

Opted-in dashboards can keep their own section menu separate from Library. Add `<meta name="fjg-navigation" content="page-sections">` and one visible, enabled `[data-fjg-section-toggle]` button. In safe mode, opted-in pages get a reader-owned Sections drawer built from visible same-document table-of-contents targets or headings. Both the page’s Sections button and the toolbar open it without enabling document JavaScript. At 640 CSS pixels it docks alongside the document; narrower panes use a dismissible overlay. This is separate from the Library breakpoint. In trusted mode, **Page Sections** invokes the document button’s existing handler. It does not expose hidden admin sections or invent authorization rules. Duplicate visible selectors or an active dialog disable the shortcut.

## Safe and trusted mode

**Safe mode is the default**, including for existing 0.1.x users. It renders local content, styles, images and fonts without running document scripts. Links are inert viewer actions rather than direct browser navigation; forms, frames, meta-refresh, active SVG markup and event handlers are removed. This means interactive dashboards may initially look correct but their own buttons will not do anything.

To use a reviewed dashboard you made, choose **Page Options → Enable trusted interactive mode**, read the project-specific warning, and confirm. Local classic JavaScript, inline handlers, local read-only `fetch()`/JSON and temporary storage then work. Script execution stays in a sandboxed, opaque-origin iframe without access to the Obsidian parent, native APIs, or a bridge to arbitrary vault files.

**Trusted mode is not an offline security boundary.** Unlike the native iOS app, an Obsidian plugin cannot install WebKit's navigation/resource blockers. A malicious script can navigate its own iframe online and leak the supported files bundled from the project folder. Do not trust unknown HTML or keep confidential unrelated files in a trusted project folder. CSP blocks ordinary remote subresources, but that is not a promise of zero network traffic. Trust is remembered for that project until switched off.

Existing 0.1.x automatic scripts, same-origin access, arbitrary filesystem paths, and the HTML-to-host “open any vault file” bridge are intentionally removed. Legacy absolute-path tabs must be reopened from a vault folder. Do not enable trusted mode to bypass a security error for content you have not reviewed.

## External links and videos

- Ordinary external links start **off**. Enable **Allow external web links** in plugin settings. Each HTTP(S) destination is shown for explicit approval; credentials and custom schemes are rejected. Inspect the entire URL for private information. The viewer adds no automatic referrer.
- Supported YouTube watch, short-link and embed references appear under Page Options, or can be selected from a page link. Opening the video panel makes **no network request**. Press **Load video from YouTube** to contact the provider. The separate panel receives only a validated public video ID/start time, not the document, path, tracking parameters or page title.
- No autoplay is requested. **Unload video**, **Done**, changing pages, leaving the view, or backgrounding unloads the player. The underlying local page is kept. A pane under 200 pixels uses the browser fallback instead.
- YouTube can reject playback in Obsidian because of embedding/app-origin requirements. The explicit public-browser fallback remains available. Arbitrary embedded remote frames, remote scripts and general web browsing are not enabled.

## Parity and limitations

| Native iOS feature | Plugin 0.2.0 |
| --- | --- |
| Local HTML / TXT / folder projects | Vault file/folder references; same relative structure, no duplicate import |
| CSS, local images, fonts | Supported within the project limits |
| Classic JavaScript and local fetch | Explicit trusted mode; different security boundary |
| Library + searchable pages | Included; existing file-exclusion chooser retained |
| Back/forward, home, reload, scale | Included; selected page URL/query/fragment saved |
| Compact/Duo layout, page-owned Sections | Included, keyed to actual pane width |
| External link confirmation | Included, disabled by default |
| Explicit YouTube panel | Included; provider/network acceptance not guaranteed |
| iOS Share extension and security-scoped folder import | Not ported; add original files to the vault using Files/Obsidian |
| Native WebKit offline isolation | Not available for arbitrary scripts; safe mode or reviewed trusted projects |
| Persistent website database, modules/workers/server apps | Not supported; page storage is temporary and resets on page reload/change |

The plugin is a viewer, not a website editor. It does not persist changes a dashboard makes to its own DOM, temporary localStorage/sessionStorage or JSON response. Query/fragment are retained in reader navigation, but a sandboxed `srcdoc` page does not get the native app's custom-scheme `window.location`. Use local relative fetch/link paths. ES module graphs, XHR, service workers, dynamic imports, arbitrary child frames, camera/microphone and browser downloads are not supported. Remote dependencies must be vendored locally where compatible. Supported local media files are subject to the platform's codecs and the 8 MB file limit.

## Development and checks

Node 24 is used for the test toolchain. `npm ci`, then `npx playwright install chromium webkit`, then `npm run check`. Browser tests use synthetic documents and the actual view/renderer with a minimal Obsidian host adapter. They do not use personal vault documents.

See [VALIDATION.md](VALIDATION.md) for the checked matrix and remaining physical-device acceptance. No real iPhone installation or YouTube playback is implied by browser tests.
