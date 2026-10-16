import { describe, expect, it } from "vitest";
import {
  parseDarwinVmStatAvailableBytes,
  parseLinuxMemAvailableBytes,
  type AiSystemCapabilities,
} from "../electron/ai/systemCapabilities.js";
import {
  fastTierAvailability,
  fastTierRuntimeAvailability,
  findLatexDoAiTier,
} from "../electron/ai/productTiers.js";

const GB = 1024 ** 3;

describe("AI system capability memory parsers", () => {
  it("counts reclaimable macOS pages as available memory", () => {
    const output = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                    31026.
Pages active:                                 937986.
Pages inactive:                               951972.
Pages speculative:                              1849.
Pages throttled:                                   0.
Pages wired down:                             242951.
Pages purgeable:                               55646.
"Translation faults":                      198303993.
Pages copy-on-write:                        12329286.
Pages zero filled:                          95355303.
Pages reactivated:                            712278.
Pages purged:                                 692421.
File-backed pages:                            582466.
Anonymous pages:                             1309341.
Pages stored in compressor:                   290761.
Pages occupied by compressor:                 135074.
Decompressions:                                85255.
Compressions:                                 552918.
Pageins:                                     3087753.
Pageouts:                                       7238.
Swapins:                                           0.
Swapouts:                                          0.
`;

    expect(parseDarwinVmStatAvailableBytes(output)).toBe(
      (31_026 + 1_849 + 55_646 + 582_466) * 16_384,
    );
  });

  it("reads Linux MemAvailable from /proc/meminfo text", () => {
    expect(
      parseLinuxMemAvailableBytes(`MemTotal:       32768000 kB
MemFree:          512000 kB
MemAvailable:   10485760 kB
Buffers:          100000 kB
Cached:          9000000 kB
`),
    ).toBe(10_485_760 * 1024);
  });
});

describe("Electron LatexDo AI tier availability", () => {
  it("checks storage for model installs but not for installed model runtime", () => {
    const tier = findLatexDoAiTier("latexdo-ai-plus");
    const system: AiSystemCapabilities = {
      totalRamBytes: 32 * GB,
      freeRamBytes: 16 * GB,
      totalStorageBytes: 256 * GB,
      freeStorageBytes: 1 * GB,
      modelStoragePath: "/Users/ada/Library/Application Support/LatexDo/models",
      platform: "darwin",
      arch: "arm64",
      cpuCount: 10,
      localAiAvailable: true,
    };

    expect(tier).toBeDefined();
    expect(fastTierAvailability(tier!, system)).toMatchObject({
      state: "storage-pressure",
    });
    expect(fastTierRuntimeAvailability(tier!, system)).toMatchObject({
      state: "available",
    });
  });
});
