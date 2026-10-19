// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  statfsSync: vi.fn(),
  totalmem: vi.fn(() => 16 * 1024),
  freemem: vi.fn(() => 1024),
}));

vi.mock("node:child_process", () => ({ execFileSync: mocks.execFileSync }));
vi.mock("node:fs", () => ({
  mkdirSync: mocks.mkdirSync,
  readFileSync: mocks.readFileSync,
  statfsSync: mocks.statfsSync,
}));
vi.mock("node:os", () => ({
  default: {
    totalmem: mocks.totalmem,
    freemem: mocks.freemem,
    cpus: () => [{}, {}, {}],
  },
}));
vi.mock("./models.js", () => ({ modelsDir: () => "/models" }));

import {
  getAiSystemCapabilities,
  parseDarwinVmStatAvailableBytes,
  parseLinuxMemAvailableBytes,
} from "./systemCapabilities.js";

const realPlatform = process.platform;
function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
}

beforeEach(() => {
  mocks.statfsSync.mockReturnValue({ bsize: 4, blocks: 100, bavail: 25 });
});

afterEach(() => {
  setPlatform(realPlatform);
  vi.clearAllMocks();
});

describe("memory parsers", () => {
  it("returns null without a page size or reclaimable pages", () => {
    expect(parseDarwinVmStatAvailableBytes("Pages free: 10.")).toBeNull();
    expect(
      parseDarwinVmStatAvailableBytes("(page size of 4096 bytes)\nPages free: 0.\nnonsense line"),
    ).toBeNull();
    expect(
      parseDarwinVmStatAvailableBytes("(page size of 4,096 bytes)\nPages free: 1,000."),
    ).toBeNull();
    expect(parseDarwinVmStatAvailableBytes("(page size of 4096 bytes)\nPages free: 1,000.")).toBe(
      4_096_000,
    );
    expect(parseLinuxMemAvailableBytes("MemTotal: 1 kB")).toBeNull();
    // Counts that overflow to Infinity are ignored rather than trusted.
    expect(parseLinuxMemAvailableBytes(`MemAvailable: ${"9".repeat(400)} kB`)).toBeNull();
    expect(
      parseDarwinVmStatAvailableBytes("(page size of 4096 bytes)\nPages speculative: 2."),
    ).toBe(8192);
  });
});

describe("getAiSystemCapabilities", () => {
  it("uses vm_stat on macOS and storage stats for the model folder", () => {
    setPlatform("darwin");
    mocks.execFileSync.mockReturnValue("(page size of 1024 bytes)\nPages free: 4.");
    const caps = getAiSystemCapabilities();
    expect(mocks.execFileSync).toHaveBeenCalledWith("vm_stat", expect.any(Object));
    expect(mocks.mkdirSync).toHaveBeenCalledWith("/models", { recursive: true });
    expect(caps).toMatchObject({
      totalRamBytes: 16 * 1024,
      freeRamBytes: 4 * 1024,
      totalStorageBytes: 400,
      freeStorageBytes: 100,
      modelStoragePath: "/models",
      platform: "darwin",
      cpuCount: 3,
      localAiAvailable: true,
    });
  });

  it("falls back to os.freemem when vm_stat fails and clamps to total RAM", () => {
    setPlatform("darwin");
    mocks.execFileSync.mockImplementation(() => {
      throw new Error("no vm_stat");
    });
    expect(getAiSystemCapabilities().freeRamBytes).toBe(1024);
    mocks.execFileSync.mockReturnValue("(page size of 1048576 bytes)\nPages free: 4.");
    expect(getAiSystemCapabilities().freeRamBytes).toBe(16 * 1024);
  });

  it("reads /proc/meminfo on Linux and tolerates read errors", () => {
    setPlatform("linux");
    mocks.readFileSync.mockReturnValue("MemAvailable:   8 kB\n");
    expect(getAiSystemCapabilities().freeRamBytes).toBe(8 * 1024);
    expect(mocks.readFileSync).toHaveBeenCalledWith("/proc/meminfo", "utf8");
    mocks.readFileSync.mockImplementation(() => {
      throw new Error("EACCES");
    });
    expect(getAiSystemCapabilities().freeRamBytes).toBe(1024);
  });

  it("uses only os.freemem on other platforms and reports unknown storage on failure", () => {
    setPlatform("win32");
    mocks.statfsSync.mockImplementation(() => {
      throw new Error("ENOSYS");
    });
    const caps = getAiSystemCapabilities();
    expect(mocks.execFileSync).not.toHaveBeenCalled();
    expect(mocks.readFileSync).not.toHaveBeenCalled();
    expect(caps.freeRamBytes).toBe(1024);
    expect(caps.totalStorageBytes).toBeNull();
    expect(caps.freeStorageBytes).toBeNull();
    expect(caps.modelStoragePath).toBe("/models");
  });
});
