import { test, expect, Page } from "@playwright/test";
async function start(page: Page, opts: any = {}) {
  await page.goto("/tests/browser/");
  await page.evaluate((o) => (window as any).setup(o), opts);
  await expect(
    page.frameLocator("iframe.html-viewer-iframe").locator("body"),
  ).toBeVisible();
}
async function menu(page: Page, item: string) {
  await page.getByRole("button", { name: "Page Options", exact: true }).click();
  await page.getByRole("button", { name: item, exact: true }).click();
}
const reader = (page: Page) => page.frameLocator("iframe.html-viewer-iframe");
test("safe renderer: local CSS/assets, no original script or network", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await start(page);
  await expect(reader(page).locator("h1")).toHaveCSS(
    "color",
    "rgb(0, 100, 100)",
  );
  await expect(reader(page).locator("#json")).toBeEmpty();
  await expect(reader(page).locator("img")).toHaveJSProperty("complete", true);
  expect(
    requests.filter(
      (u) => !u.startsWith("http://127.0.0.1:4176/") && !u.startsWith("data:"),
    ),
  ).toEqual([]);
  await reader(page).locator("#counter").click();
  await expect(reader(page).locator("#counter")).toHaveText("0");
});
test("safe hostile HTML cannot navigate or request remote content", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("probe")) requests.push(r.url());
  });
  await start(page, {
    files: {
      "Demo/index.html": `<meta http-equiv="refresh" content="0;url=http://127.0.0.1:4176/probe-refresh"><img src="http://127.0.0.1:4176/probe-img" onerror="location='http://127.0.0.1:4176/probe-event'"><iframe src="http://127.0.0.1:4176/probe-frame"></iframe><style>body{background:url('http://127.0.0.1:4176/probe-css')}</style><script>fetch('http://127.0.0.1:4176/probe-fetch');location='http://127.0.0.1:4176/probe-script'</script><a id="out" href="http://127.0.0.1:4176/probe-link">Outbound</a><form action="http://127.0.0.1:4176/probe-form"><button>Submit</button></form><h1>Safe page</h1>`,
    },
  });
  await reader(page).locator("#out").click();
  await page.waitForTimeout(300);
  await expect(reader(page).locator("h1")).toHaveText("Safe page");
  expect(requests).toEqual([]);
});
test("trusted code runs local classic JS/fetch but cannot reach host", async ({
  page,
}) => {
  await start(page, { trusted: true });
  await expect(reader(page).locator("#json")).toHaveText("Local JSON loaded");
  await reader(page).locator("#counter").click();
  await expect(reader(page).locator("#counter")).toHaveText("1");
  const blocked = await reader(page)
    .locator("body")
    .evaluate(() => {
      try {
        return Boolean(parent.document);
      } catch {
        return "blocked";
      }
    });
  expect(blocked).toBe("blocked");
  const priv = await reader(page)
    .locator("body")
    .evaluate(async () => {
      const r = await fetch("../Private/secret.json");
      return r.status;
    });
  expect(priv).toBe(404);
});
test("relative navigation preserves query and fragment, back/forward work", async ({
  page,
}) => {
  await start(page);
  await reader(page).locator("#next").click();
  await expect(reader(page).locator("h1")).toHaveText("Chapter Two");
  expect(await page.evaluate(() => (window as any).view.getState().url)).toBe(
    "Demo/pages/next.html?mode=read#chapter",
  );
  await menu(page, "Back");
  await expect(reader(page).locator("h1")).toHaveText("Field Notes");
  await menu(page, "Forward");
  await expect(reader(page).locator("h1")).toHaveText("Chapter Two");
});
test("explicit trust confirmation cancel then enable", async ({ page }) => {
  await start(page);
  await menu(page, "Enable trusted interactive mode");
  await expect(page.getByText(/leak project data/)).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(reader(page).locator("#json")).toBeEmpty();
  await menu(page, "Enable trusted interactive mode");
  await page.getByRole("button", { name: "Trust and enable scripts" }).click();
  await expect(reader(page).locator("#json")).toHaveText("Local JSON loaded");
  await menu(page, "Switch to safe mode");
  await expect(reader(page).locator("#json")).toBeEmpty();
});
test("Sections is distinct from Library and invokes existing selector", async ({
  page,
}) => {
  await start(page, { trusted: true });
  await expect(
    page.getByRole("button", { name: "Page Sections", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Page Sections", exact: true })
    .click();
  await expect(reader(page).locator("#panel")).toBeVisible();
  await page.getByRole("button", { name: "Library and Pages" }).click();
  await expect(page.getByRole("complementary")).toBeVisible();
  await page.getByRole("button", { name: "Close Library" }).click();
  await expect(reader(page).locator("#panel")).toBeVisible();
});
test("HTML-like and plain TXT render correctly", async ({ page }) => {
  await start(page, { path: "Demo/HTML as text.txt" });
  await expect(reader(page).locator("h1")).toHaveText("HTML in text");
  await start(page, { path: "Demo/plain.txt" });
  await expect(reader(page).locator("pre")).toHaveText(
    "This <is> ordinary text & not HTML.",
  );
});
test("video panel does not load network until Load, closes without page reset", async ({
  page,
}) => {
  const hits: string[] = [];
  await page.route("**/*youtube*", (route) => {
    hits.push(route.request().url());
    void route.fulfill({
      body: "<h1>Mock player</h1>",
      contentType: "text/html",
    });
  });
  await start(page, { trusted: true });
  await reader(page).locator("#draft").fill("Kept");
  await reader(page).locator("#video").click();
  expect(hits).toHaveLength(0);
  await page.getByRole("button", { name: "Load video from YouTube" }).click();
  await expect.poll(() => hits.length).toBe(1);
  await page.getByRole("button", { name: "Unload video", exact: true }).click();
  await expect(page.locator("iframe.html-viewer-video")).toHaveCount(0);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(reader(page).locator("#draft")).toHaveValue("Kept");
});
for (const width of [264, 390, 560, 867])
  test(`responsive ${width}px controls and state survive resize/sidebar`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 700 });
    await start(page, { trusted: true });
    await reader(page).locator("#draft").fill("Unsaved");
    await reader(page).locator("#counter").click();
    await page.getByRole("button", { name: "Library and Pages" }).click();
    await expect(page.getByRole("complementary")).toBeVisible();
    await page.getByRole("button", { name: "Close Library" }).click();
    await page.setViewportSize({
      width: width === 867 ? 390 : 867,
      height: 600,
    });
    await expect(reader(page).locator("#draft")).toHaveValue("Unsaved");
    await expect(reader(page).locator("#counter")).toHaveText("1");
    await page.setViewportSize({ width, height: 700 });
    const dimensions = await page
      .locator("#root")
      .evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
    const boxes = await page
      .locator(".html-viewer-navbar button:visible")
      .evaluateAll((els) =>
        els.map((el) => ({
          w: el.getBoundingClientRect().width,
          h: el.getBoundingClientRect().height,
        })),
      );
    for (const b of boxes) {
      expect(b.w).toBeGreaterThanOrEqual(44);
      expect(b.h).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({
      path: `tests/screenshots/${test.info().project.name}-${width}.png`,
    });
  });
test("same page selection does not reload live state", async ({ page }) => {
  await start(page, { trusted: true });
  await reader(page).locator("#draft").fill("Keep");
  await page.getByRole("button", { name: "Library and Pages" }).click();
  await page.getByRole("button", { name: "index.html", exact: true }).click();
  await expect(reader(page).locator("#draft")).toHaveValue("Keep");
});
test("remove reference never changes source files", async ({ page }) => {
  await start(page);
  await page.getByRole("button", { name: "Library and Pages" }).click();
  await page
    .getByRole("button", { name: "Remove Field Notes from library" })
    .click();
  await page
    .getByRole("button", { name: "Remove reference", exact: true })
    .click();
  expect(
    await page.evaluate(() => (window as any).settings.projects.length),
  ).toBe(0);
  await page.getByRole("button", { name: "Close Library" }).click();
  await expect(reader(page).locator("h1")).toHaveText("Field Notes");
});
test("same project and narrow-wide layout preserve scroll and draft", async ({
  page,
}) => {
  await start(page, { trusted: true });
  await reader(page).locator("#draft").fill("Keep draft");
  await reader(page)
    .locator("body")
    .evaluate(() => window.scrollTo(0, 400));
  const before = await reader(page)
    .locator("body")
    .evaluate(() => scrollY);
  expect(before).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Library and Pages" }).click();
  await page.getByRole("button", { name: "Field Notes", exact: true }).click();
  await expect(reader(page).locator("#draft")).toHaveValue("Keep draft");
  expect(
    await reader(page)
      .locator("body")
      .evaluate(() => scrollY),
  ).toBe(before);
  await page.setViewportSize({ width: 390, height: 700 });
  expect(
    await reader(page)
      .locator("body")
      .evaluate(() => scrollY),
  ).toBe(before);
});
test("Library handle drag opens without a second click reversing it", async ({
  page,
}) => {
  await start(page);
  const b = page.getByRole("button", { name: "Library and Pages" });
  const box = (await b.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + 22);
  await page.mouse.up();
  await expect(page.getByRole("complementary")).toBeVisible();
  await page.getByRole("button", { name: "Close Library" }).click();
  await expect(page.getByRole("complementary")).toBeHidden();
});
test("external links require enabled setting and explicit destination approval", async ({
  page,
}) => {
  await start(page, { external: true });
  await reader(page).locator("#external").click();
  await expect(
    page.getByText("Open external link?", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/displayed URL will be sent/)).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(reader(page).locator("h1")).toHaveText("Field Notes");
  expect(page.context().pages()).toHaveLength(1);
});
test("spaces, hashes and non-ASCII filenames are encoded without losing assets", async ({
  page,
}) => {
  await start(page, {
    path: "Demo/My # page.html",
    files: {
      "Demo/My # page.html":
        '<title>Encoded</title><link rel="stylesheet" href="my%20%23.css"><h1>Encoded names</h1><a href="caf%C3%A9%20%23.html">Next</a>',
      "Demo/my #.css": "h1{color:rgb(1,2,3)}",
      "Demo/café #.html": "<h1>Next café</h1>",
    },
  });
  await expect(reader(page).locator("h1")).toHaveCSS("color", "rgb(1, 2, 3)");
  await reader(page).getByRole("link", { name: "Next" }).click();
  await expect(reader(page).locator("h1")).toHaveText("Next café");
  expect(await page.evaluate(() => (window as any).view.getState().file)).toBe(
    "Demo/café #.html",
  );
});
test("CSS raw-text breakout cannot create active HTML during srcdoc serialization", async ({
  page,
}) => {
  const hits: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("probe-breakout")) hits.push(r.url());
  });
  await start(page, {
    files: {
      "Demo/index.html":
        '<link rel="stylesheet" href="style.css"><h1>Still safe</h1>',
      "Demo/style.css":
        'h1::after {content:"</style><meta http-equiv=refresh content=0;url=http://127.0.0.1:4176/probe-breakout>"} h1 {color:rgb(0,100,100)}',
    },
  });
  await page.waitForTimeout(250);
  await expect(reader(page).locator("h1")).toHaveText("Still safe");
  await expect(reader(page).locator("h1")).toHaveCSS(
    "color",
    "rgb(0, 100, 100)",
  );
  expect(hits).toEqual([]);
});
test("trusted code containing HTML closing-script text still executes", async ({
  page,
}) => {
  await start(page, {
    trusted: true,
    files: {
      "Demo/index.html": '<h1 id="result"></h1><script src="app.js"></script>',
      "Demo/app.js":
        'document.getElementById("result").textContent="</script> literal preserved";',
    },
  });
  await expect(reader(page).locator("h1")).toHaveText(
    "</script> literal preserved",
  );
});
test("nested local CSS imports retain data images", async ({ page }) => {
  await start(page, {
    files: {
      "Demo/index.html":
        '<link rel="stylesheet" href="a.css"><h1>Assets</h1><div id="art"></div>',
      "Demo/a.css": '@import "b.css";',
      "Demo/b.css":
        '#art {width:40px;height:40px;background-image:url("dot.svg")}',
      "Demo/dot.svg":
        '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="teal"/></svg>',
    },
  });
  const background = await reader(page)
    .locator("#art")
    .evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(background).toContain("data:image/svg+xml;base64,");
});
test("conditional CSS import stays conditional on the reader width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await start(page, {
    files: {
      "Demo/index.html":
        '<link rel="stylesheet" href="a.css"><h1>Responsive import</h1>',
      "Demo/a.css":
        'h1{color:rgb(0,0,0)} @import "b.css" screen and (min-width:600px);',
      "Demo/b.css": "h1{color:rgb(0,100,100)}",
    },
  });
  await expect(reader(page).locator("h1")).toHaveCSS("color", "rgb(0, 0, 0)");
  await page.setViewportSize({ width: 867, height: 700 });
  await expect(reader(page).locator("h1")).toHaveCSS(
    "color",
    "rgb(0, 100, 100)",
  );
});

test("safe page-owned Sections works without document scripts, in compact and wide panes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 740 });
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/probe")) requests.push(r.url());
  });
  await start(page, {
    files: {
      "Demo/index.html": `<meta name="fjg-navigation" content="page-sections"><title>Example guide</title><style>body{margin:0}nav.toc{display:none}main{padding:16px}section{min-height:800px}#sectionMenuButton{position:fixed;top:0;left:0}</style><button id="sectionMenuButton">Sections</button><nav class="toc"><a href="#one">First section</a><a href="#two">Second section</a></nav><main><section id="one"><h1>Example guide</h1><input id="draft"><p>First paragraph</p></section><section id="two"><h2>Second section</h2><p>Last paragraph</p></section></main><script>fetch('/probe');document.querySelector('#sectionMenuButton').onclick=()=>{throw Error('must not run')}</script>`,
    },
  });
  const frame = reader(page),
    nav = frame.locator("[data-fjg-safe-sections] nav");
  await expect(nav).toBeHidden();
  await frame.locator("#draft").fill("keep this");
  await frame.locator("#sectionMenuButton").click();
  await expect(nav).toBeVisible();
  await nav
    .getByRole("button", { name: "Second section", exact: true })
    .click();
  await expect(nav).toBeHidden();
  await expect(frame.locator("#two")).toBeInViewport();
  await page
    .getByRole("button", { name: "Page Sections", exact: true })
    .click();
  await expect(nav).toBeVisible();
  await nav.getByRole("button", { name: "Hide sections" }).click();
  await expect(nav).toBeHidden();
  await page.setViewportSize({ width: 867, height: 740 });
  await expect(nav).toBeVisible();
  await page.screenshot({ path: "tests/screenshots/safe-sections-wide.png" });
  await expect(frame.locator("#draft")).toHaveValue("keep this");
  await expect(frame.locator("html")).toHaveCSS("padding-left", "280px");
  await page
    .getByRole("button", { name: "Page Sections", exact: true })
    .click();
  await expect(nav).toBeHidden();
  await expect(frame.locator("html")).toHaveCSS("padding-left", "0px");
  expect(requests).toEqual([]);
});

test("safe generated Sections handles touch gestures and ignores hidden headings", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 740 });
  await start(page, {
    files: {
      "Demo/index.html":
        '<meta name="fjg-navigation" content="page-sections"><button hidden data-fjg-section-toggle>Hidden control</button><main><h1>Public guide</h1><h2>Public chapter</h2><section hidden><h2>Hidden chapter</h2></section><input id="draft"></main>',
    },
  });
  const frame = reader(page),
    toggle = frame.locator("[data-fjg-section-toggle]"),
    nav = frame.locator("[data-fjg-safe-sections] nav");
  await expect(nav).toBeHidden();
  await toggle.dispatchEvent("pointerdown", {
    clientX: 10,
    clientY: 10,
    pointerId: 1,
    pointerType: "touch",
  });
  await toggle.dispatchEvent("pointerup", {
    clientX: 90,
    clientY: 12,
    pointerId: 1,
    pointerType: "touch",
  });
  await expect(nav).toBeVisible();
  await expect(nav).not.toContainText("Hidden chapter");
  await frame
    .locator("[data-fjg-safe-sections] .shade")
    .click({ position: { x: 380, y: 400 } });
  await expect(nav).toBeHidden();
  await page.waitForTimeout(260);
  await toggle.click();
  await expect(nav).toBeVisible();
  await page
    .getByRole("button", { name: "Page Sections", exact: true })
    .click();
  await expect(nav).toBeHidden();
});
