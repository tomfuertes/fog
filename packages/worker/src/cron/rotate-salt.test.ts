import { describe, it, expect, vi } from "vitest";
import { handleScheduled } from "./rotate-salt";

function makeEnv(kvStore: Record<string, string | null> = {}) {
  const store = { ...kvStore };
  const mockGet = vi.fn().mockImplementation((key: string) => Promise.resolve(store[key] ?? null));
  const mockPut = vi.fn().mockResolvedValue(undefined);
  const mockDelete = vi.fn().mockResolvedValue(undefined);
  return {
    env: {
      FOG_KV: { get: mockGet, put: mockPut, delete: mockDelete },
    } as any,
    mockGet,
    mockPut,
    mockDelete,
  };
}

function tomorrowKey(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return `salt:${d.toISOString().slice(0, 10)}`;
}

function yesterdayKey(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return `salt:${d.toISOString().slice(0, 10)}`;
}

describe("handleScheduled (rotate-salt cron)", () => {
  it("generates and stores tomorrow's salt when not already present", async () => {
    const { env, mockPut } = makeEnv({});
    await handleScheduled(env);
    const key = tomorrowKey();
    expect(mockPut).toHaveBeenCalledWith(key, expect.stringMatching(/^[0-9a-f]{64}$/));
  });

  it("skips generating tomorrow's salt if it already exists", async () => {
    const key = tomorrowKey();
    const { env, mockPut } = makeEnv({ [key]: "a".repeat(64) });
    await handleScheduled(env);
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("deletes yesterday's salt", async () => {
    const { env, mockDelete } = makeEnv({});
    await handleScheduled(env);
    expect(mockDelete).toHaveBeenCalledWith(yesterdayKey());
  });

  it("still deletes yesterday's salt even if tomorrow already exists", async () => {
    const key = tomorrowKey();
    const { env, mockDelete } = makeEnv({ [key]: "b".repeat(64) });
    await handleScheduled(env);
    expect(mockDelete).toHaveBeenCalledWith(yesterdayKey());
  });

  it("checks KV before writing tomorrow's salt (no unnecessary writes)", async () => {
    const { env, mockGet, mockPut } = makeEnv({});
    await handleScheduled(env);
    expect(mockGet).toHaveBeenCalledWith(tomorrowKey());
    // called once for tomorrow check; no second get
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockPut).toHaveBeenCalledTimes(1);
  });
});
