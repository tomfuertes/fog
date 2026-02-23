import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateSalt } from "./salt";

describe("generateSalt", () => {
  it("returns a 64-char hex string", () => {
    expect(generateSalt()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces unique values", () => {
    expect(generateSalt()).not.toBe(generateSalt());
  });
});

describe("getSalt", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("creates a new salt and stores in KV when none exists", async () => {
    const mockKV = {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
    };
    const { getSalt } = await import("./salt");
    const salt = await getSalt({ FOG_KV: mockKV } as any);

    expect(salt).toMatch(/^[0-9a-f]{64}$/);
    expect(mockKV.get).toHaveBeenCalledOnce();
    expect(mockKV.put).toHaveBeenCalledWith(
      `salt:${new Date().toISOString().slice(0, 10)}`,
      salt
    );
  });

  it("returns cached value on second call without re-fetching KV", async () => {
    const fixedSalt = "b".repeat(64);
    const mockKV = {
      get: vi.fn().mockResolvedValue(fixedSalt),
      put: vi.fn(),
    };
    const { getSalt } = await import("./salt");
    const env = { FOG_KV: mockKV } as any;

    const first = await getSalt(env);
    const second = await getSalt(env);

    expect(first).toBe(fixedSalt);
    expect(second).toBe(fixedSalt);
    expect(mockKV.get).toHaveBeenCalledOnce();
    expect(mockKV.put).not.toHaveBeenCalled();
  });
});
