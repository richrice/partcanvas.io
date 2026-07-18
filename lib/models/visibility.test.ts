import { describe, expect, it } from "vitest";
import { canViewModel } from "./visibility";

describe("canViewModel", () => {
  it("lets everyone view public and unlisted models", () => {
    expect(canViewModel({ visibility: "public", ownerId: "a" }, null)).toBe(true);
    expect(canViewModel({ visibility: "unlisted", ownerId: "a" }, undefined)).toBe(true);
    expect(canViewModel({ visibility: "unlisted", ownerId: "a" }, "b")).toBe(true);
  });

  it("restricts private models to their owner", () => {
    expect(canViewModel({ visibility: "private", ownerId: "a" }, "a")).toBe(true);
    expect(canViewModel({ visibility: "private", ownerId: "a" }, "b")).toBe(false);
    expect(canViewModel({ visibility: "private", ownerId: "a" }, null)).toBe(false);
  });
});
