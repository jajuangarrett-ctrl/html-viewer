# HTML Viewer 0.2.0 validation

## Verified scope

This release ports the reader workflow of FJG HTML Viewer into the existing `html-viewer` Obsidian plugin. It does not modify or install into a live vault. Tests use synthetic documents only.

Final local check: TypeScript typecheck, production bundle, **28 unit tests and 44 browser tests passed**. Browser cases run in Chromium and WebKit using the actual reader class and rendering pipeline with a minimal Obsidian API harness. Dependency audit: zero known vulnerabilities at validation time.

| Area | Evidence |
|---|---|
| Opening | HTML, HTM, HTML-in-TXT and ordinary TXT; scoped project folder; encoded filenames |
| Local assets | Relative CSS, nested imports, media-qualified imports, images and JSON; traversal rejected |
| Navigation | Relative links with queries/fragments; back, forward; same-page reopening retains live state |
| Mobile layout | 264, 390, 560 and 867 CSS-pixel panes; no host overflow; 44px controls; narrow single pane |
| Fold and sidebar | View resize and Library toggle retain document, unsaved form state, scroll and script state |
| Sections | Unique opt-in document section control stays distinct from Library |
| Safe rendering | No original script execution; hostile resource fixtures produce zero probe requests, including before parsing |
| Isolation | Opaque-origin iframe; no arbitrary vault-open bridge; outside-project reads rejected |
| Trusted mode | Explicit confirmation; scoped local fetch; plain JS; temporary storage; host access denied |
| External links | Disabled by default; destination confirmation and cancellation |
| Video | No request until explicit Load; mocked provider; unload on leaving/inactive/background |
| Serialization | Malicious CSS closing-style text stays inert; literal closing-script text preserved |
| Removal | Removing a library reference leaves source files untouched |

## Important boundaries

- This is **not a physical iPhone or actual Obsidian mobile acceptance test**. The host harness cannot prove native keyboard, accessibility, OS safe-area/system rail or plugin interoperability behavior.
- The 44 browser tests include both browser projects (22 cases each), not 44 separate features.
- YouTube requests were intercepted with a fixture. Real provider playback and embedding policy remain unverified; use the external browser fallback when needed.
- Trusted project JavaScript is not guaranteed offline: iframe self-navigation can send scoped project contents to a network destination. Keep safe mode for untrusted documents.
- The native app's imports/share extension and stronger WebKit navigation restrictions are not replicated. Plugin projects reference files already inside the vault.
- No persistent website storage, arbitrary filesystem access, backend, modules/workers, camera/microphone or embedded remote frames are provided.
- Native layout/system-owned space cannot be removed by this plugin. Reader content uses the actual available Obsidian pane.

## Reproduce

Use Node 24, then `npm ci`, `npx playwright install chromium webkit`, and `npm run check`. Run `npm audit` separately. Generated fixtures and screenshots are ignored; no personal vault content belongs in test artifacts.

## Device acceptance after updating

1. Open a harmless HTML file and then a folder containing a relative stylesheet/image.
2. Check folded and unfolded portrait/landscape sizes. Toggle Library and document Sections; confirm scroll and any temporary form input survive.
3. Test back/forward and an HTML-in-TXT file.
4. Leave unknown projects in safe mode. Only enable scripts for documents you have reviewed.
5. Confirm links and video never open automatically. Test explicit video playback if needed.
