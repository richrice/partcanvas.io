import { describe, expect, it } from "vitest";
import { validateUsername } from "./username";

describe("validateUsername", () => {
  it("accepts well-formed usernames", () => {
    for (const name of ["abc", "gear-smith", "a1b2c3", "x".repeat(30), "3d-printer-fan"]) {
      expect(validateUsername(name), name).toBeNull();
    }
  });

  it("rejects bad formats", () => {
    for (const name of ["ab", "x".repeat(31), "Uppercase", "spa ce", "under_score", "émile", "dot.name", ""]) {
      expect(validateUsername(name), name).toMatch(/3–30 characters/);
    }
  });

  it("rejects reserved names", () => {
    for (const name of ["admin", "api", "explore", "settings", "docs", "welcome"]) {
      expect(validateUsername(name), name).toMatch(/reserved/);
    }
    // Single-letter route prefixes fall to the length rule but stay blocked.
    for (const name of ["m", "u"]) {
      expect(validateUsername(name), name).not.toBeNull();
    }
  });
});
