import { describe, expect, it } from "vitest";
import {
  isPathExcluded,
  parseExcludePatterns,
  pathMatchesExcludePattern,
} from "./fileFilters";

describe("parseExcludePatterns", () => {
  it("trims blank lines and comments", () => {
    expect(parseExcludePatterns("\nAI Team/owner_inbox/\n# ignore me\n\nArchive\n")).toEqual([
      "AI Team/owner_inbox/",
      "Archive",
    ]);
  });
});

describe("pathMatchesExcludePattern", () => {
  it("matches plain path fragments case-insensitively", () => {
    expect(
      pathMatchesExcludePattern(
        "AI Team/owner_inbox/2026-06-13_LARRY.html",
        "owner_INBOX"
      )
    ).toBe(true);
  });

  it("matches wildcard patterns", () => {
    expect(
      pathMatchesExcludePattern(
        "03 Areas/Professional-Dev/Job-Applications/Archive/Interview Prep Dashboard.html",
        "**/Archive/**"
      )
    ).toBe(true);
  });

  it("normalizes Windows-style backslashes", () => {
    expect(
      pathMatchesExcludePattern(
        "Artifacts\\Agenda Dashboard\\agenda.html",
        "Artifacts/Agenda Dashboard/"
      )
    ).toBe(true);
  });

  it("tolerates missing whitespace in path fragments", () => {
    expect(
      pathMatchesExcludePattern(
        "Artifacts/Jenny Workout Folder/BeInShapeAnywhere/node_modules/tslib/tslib.es6.html",
        "Jenny WorkoutFolder"
      )
    ).toBe(true);
  });

  it("matches path pieces in order when the actual path has an extra folder", () => {
    expect(
      pathMatchesExcludePattern(
        "Artifacts/Reusable HTML Design System/templates/starter.html",
        "Artifacts/Reusable HTML Design System/starter.html"
      )
    ).toBe(true);
  });

  it("does not match ordered path pieces when a required segment is missing", () => {
    expect(
      pathMatchesExcludePattern(
        "Artifacts/Reusable HTML Design System/templates/starter.html",
        "Artifacts/Other Design System/starter.html"
      )
    ).toBe(false);
  });
});

describe("isPathExcluded", () => {
  it("returns true when any pattern matches", () => {
    expect(
      isPathExcluded("Artifacts/Agenda Capture App/workflow.html", [
        "owner_inbox",
        "Agenda Capture App",
      ])
    ).toBe(true);
  });

  it("returns false when no patterns match", () => {
    expect(
      isPathExcluded("02 Programs/CalWORKs/Work-Study/index.html", [
        "owner_inbox",
        "**/Archive/**",
      ])
    ).toBe(false);
  });
});
