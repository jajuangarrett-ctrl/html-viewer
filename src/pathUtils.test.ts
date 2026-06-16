import { describe, expect, it } from "vitest";
import { absolutePathToFileUrl, vaultFileToFileUrl } from "./pathUtils";

describe("vaultFileToFileUrl", () => {
  it("encodes spaces in the vault name", () => {
    expect(
      vaultFileToFileUrl(
        "/Users/franklingarrett/FJG Vault",
        "Artifacts/dashboard.html"
      )
    ).toBe("file:///Users/franklingarrett/FJG%20Vault/Artifacts/dashboard.html");
  });

  it("encodes special characters in path segments", () => {
    expect(
      vaultFileToFileUrl(
        "/Users/franklingarrett/FJG Vault",
        "Briefings/A&B report #1.html"
      )
    ).toBe(
      "file:///Users/franklingarrett/FJG%20Vault/Briefings/A%26B%20report%20%231.html"
    );
  });

  it("normalizes Windows-style backslashes", () => {
    expect(
      vaultFileToFileUrl(
        "C:\\Users\\Franklin\\FJG Vault",
        "Artifacts\\dashboard.html"
      )
    ).toBe("file:///C%3A/Users/Franklin/FJG%20Vault/Artifacts/dashboard.html");
  });
});

describe("absolutePathToFileUrl", () => {
  it("encodes absolute paths with spaces", () => {
    expect(
      absolutePathToFileUrl("/Users/franklingarrett/FJG Vault/Artifacts/dashboard.html")
    ).toBe("file:///Users/franklingarrett/FJG%20Vault/Artifacts/dashboard.html");
  });

  it("encodes special characters in absolute paths", () => {
    expect(
      absolutePathToFileUrl("/Users/franklingarrett/FJG Vault/Briefings/A&B #1.html")
    ).toBe("file:///Users/franklingarrett/FJG%20Vault/Briefings/A%26B%20%231.html");
  });

  it("normalizes Windows-style backslashes", () => {
    expect(
      absolutePathToFileUrl("C:\\Users\\Franklin\\FJG Vault\\Artifacts\\dashboard.html")
    ).toBe("file:///C%3A/Users/Franklin/FJG%20Vault/Artifacts/dashboard.html");
  });
});
