import { afterEach, describe, expect, it } from "vitest";
import { authEnabled, checkPassword, createSession, verifySession } from "./auth";

describe("password protection", () => {
  afterEach(() => {
    delete process.env.APP_PASSWORD;
  });

  it("is off when no password is set", () => {
    delete process.env.APP_PASSWORD;
    expect(authEnabled()).toBe(false);
    expect(verifySession(undefined)).toBe(true);
  });

  it("checks the password", () => {
    process.env.APP_PASSWORD = "Sacco-2018";
    expect(authEnabled()).toBe(true);
    expect(checkPassword("Sacco-2018")).toBe(true);
    expect(checkPassword("sacco-2018")).toBe(false);
    expect(checkPassword("")).toBe(false);
  });

  it("accepts its own login cookie only, and only until it expires", () => {
    process.env.APP_PASSWORD = "Sacco-2018";
    const now = Date.now();
    const token = createSession(now);
    expect(verifySession(token, now)).toBe(true);
    expect(verifySession(undefined, now)).toBe(false);
    expect(verifySession(token.replace(/.$/, (c) => (c === "0" ? "1" : "0")), now)).toBe(false); // tampered
    expect(verifySession(`${now + 1e12}.${token.split(".")[1]}`, now)).toBe(false); // longer expiry with the old signature
    expect(verifySession(token, now + 8 * 24 * 60 * 60 * 1000)).toBe(false); // expired after 7 days
  });

  it("signs everyone out when the password changes", () => {
    process.env.APP_PASSWORD = "old-password";
    const token = createSession();
    process.env.APP_PASSWORD = "new-password";
    expect(verifySession(token)).toBe(false);
  });
});
