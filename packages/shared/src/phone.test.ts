import { describe, expect, it } from "vitest";
import { phoneSchema } from "./phone";

describe("phoneSchema", () => {
  it.each([
    ["01012345678", "+201012345678"],
    ["01112345678", "+201112345678"],
    ["01212345678", "+201212345678"],
    ["01512345678", "+201512345678"],
    ["+201012345678", "+201012345678"],
    ["00201012345678", "+201012345678"],
    ["201012345678", "+201012345678"],
    ["010 1234 5678", "+201012345678"],
    ["010-1234-5678", "+201012345678"],
    ["  01012345678  ", "+201012345678"],
  ])("normalizes %s → %s", (input, expected) => {
    expect(phoneSchema.parse(input)).toBe(expected);
  });

  it.each([
    "01312345678", // 013 not a mobile prefix
    "01412345678", // 014
    "01612345678", // 016
    "0221234567", // Cairo landline
    "0101234567", // too short
    "010123456789", // too long
    "1012345678", // missing leading 0
    "+21012345678", // wrong country code
    "abc",
    "",
  ])("rejects %s", (input) => {
    expect(() => phoneSchema.parse(input)).toThrow();
  });
});
