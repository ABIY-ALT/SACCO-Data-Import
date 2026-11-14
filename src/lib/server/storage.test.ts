import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { blobEnabled, blobUploadMode } from "./storage";

const blobEnv = ["BLOB_READ_WRITE_TOKEN", "VERCEL_OIDC_TOKEN", "BLOB_STORE_ID", "VERCEL"] as const;
const originalEnv = new Map(blobEnv.map((key) => [key, process.env[key]]));

describe("Vercel Blob upload mode", () => {
  beforeEach(() => {
    for (const key of blobEnv) delete process.env[key];
  });

  afterEach(() => {
    for (const key of blobEnv) {
      const value = originalEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("uses local/server mode without Blob credentials", () => {
    expect(blobUploadMode()).toBe("server");
    expect(blobEnabled()).toBe(false);
  });

  it("supports the read-write-token upload flow", () => {
    process.env.BLOB_READ_WRITE_TOKEN = "token";
    expect(blobUploadMode()).toBe("blob");
    expect(blobEnabled()).toBe(true);
  });

  it("uses presigned uploads when OIDC and the store id are configured", () => {
    process.env.VERCEL_OIDC_TOKEN = "oidc-token";
    process.env.BLOB_STORE_ID = "store-id";
    expect(blobUploadMode()).toBe("blob-presigned");
    expect(blobEnabled()).toBe(true);
  });

  it("uses presigned uploads on Vercel with only the store id (the OIDC token comes per request, not as an env var)", () => {
    process.env.VERCEL = "1";
    process.env.BLOB_STORE_ID = "store-id";
    expect(blobUploadMode()).toBe("blob-presigned");
    expect(blobEnabled()).toBe(true);
  });

  it("does not enable OIDC mode without a store id", () => {
    process.env.VERCEL_OIDC_TOKEN = "oidc-token";
    expect(blobUploadMode()).toBe("server");
    expect(blobEnabled()).toBe(false);
  });

  it("does not enable OIDC mode off Vercel without an OIDC token", () => {
    process.env.BLOB_STORE_ID = "store-id";
    expect(blobUploadMode()).toBe("server");
    expect(blobEnabled()).toBe(false);
  });
});
