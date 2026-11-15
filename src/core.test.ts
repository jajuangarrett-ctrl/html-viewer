import { describe, it, expect } from "vitest";
import {
  safePath,
  inRoot,
  resolveLocal,
  safeExternal,
  videoURL,
  makeBundle,
  PageHistory,
  decodeText,
} from "./core";
describe("scoped local resources", () => {
  it("requires normal project paths", () => {
    for (const p of [
      "/etc/file",
      "a/../b",
      "a/.secret",
      "a\\b",
      "a//b",
      "a\0b",
      "",
    ])
      expect(safePath(p)).toBe(false);
    expect(safePath("Project/Some page.html")).toBe(true);
  });
  it("checks the folder boundary", () => {
    expect(inRoot("App2/page.html", "App")).toBe(false);
    expect(inRoot("App/page.html", "App")).toBe(true);
    expect(inRoot("App/.secret/key", "App")).toBe(false);
  });
  it("resolves query, hash and escaped names", () => {
    expect(resolveLocal("sub/index.html", "../next%20page.html?q=1#x")).toBe(
      "next%20page.html?q=1#x",
    );
    expect(resolveLocal("index.html", "https://remote.test")).toBeNull();
    expect(resolveLocal("index.html", "//remote.test")).toBeNull();
    expect(resolveLocal("index.html", "data:text/html,hi")).toBeNull();
    expect(resolveLocal("index.html", "bad%00.html")).toBeNull();
  });
  it("restricts external handoff", () => {
    expect(safeExternal("https://user:password@example.com")).toBeNull();
    expect(safeExternal("obsidian://open")).toBeNull();
    expect(safeExternal("https://example.com")).toBe("https://example.com/");
  });
  it("only accepts known YouTube forms", () => {
    expect(videoURL("https://youtu.be/M7lc1UVf-VE?t=1m2s")).toEqual({
      id: "M7lc1UVf-VE",
      start: 62,
    });
    expect(
      videoURL("https://www.youtube.com/watch?v=M7lc1UVf-VE&secret=no"),
    ).toEqual({ id: "M7lc1UVf-VE", start: 0 });
    expect(
      videoURL("https://youtube.com.evil.test/watch?v=M7lc1UVf-VE"),
    ).toBeNull();
    expect(videoURL("https://www.youtube.com/shorts/M7lc1UVf-VE")).toBeNull();
  });
  it("bounds project reads", () => {
    expect(() =>
      makeBundle(
        Array.from({ length: 257 }, (_, i) => ({
          path: i + ".txt",
          bytes: new ArrayBuffer(1),
        })),
      ),
    ).toThrow();
    expect(() =>
      makeBundle([{ path: "a.txt", bytes: new ArrayBuffer(9 * 1024 * 1024) }]),
    ).toThrow();
    expect(
      makeBundle([{ path: ".secret.txt", bytes: new ArrayBuffer(1) }]).files
        .size,
    ).toBe(0);
  });
  it("decodes UTF16 BOM", () =>
    expect(decodeText(new Uint8Array([255, 254, 65, 0]).buffer)).toBe("A"));
  it("drops forward history after a new link and ignores repeat", () => {
    const h = new PageHistory();
    h.push("a");
    h.push("b");
    h.push("b");
    expect(h.items).toHaveLength(2);
    expect(h.back()).toBe("a");
    h.push("c");
    expect(h.forward()).toBeUndefined();
    expect(h.items).toEqual(["a", "c"]);
  });
});
