import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSpeechRuntimeStatus,
  installSpeechRuntime,
  subscribeSpeechInstall,
} from "../ai/aiClient";
import { formatDownloadSize, useLocalSpeechInstall } from "./useLocalSpeechInstall";

vi.mock("../ai/aiClient", () => ({
  getSpeechRuntimeStatus: vi.fn(),
  installSpeechRuntime: vi.fn(),
  subscribeSpeechInstall: vi.fn(),
}));

type Progress = Parameters<Parameters<typeof subscribeSpeechInstall>[0]>[0];
let emit: (progress: Partial<Progress>) => void;
const unsubscribe = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(subscribeSpeechInstall).mockImplementation((listener) => {
    emit = (progress) => listener(progress as Progress);
    return unsubscribe;
  });
});

describe("formatDownloadSize", () => {
  it("formats megabytes and hides unknown sizes", () => {
    expect(formatDownloadSize(null)).toBe("");
    expect(formatDownloadSize(0)).toBe("");
    expect(formatDownloadSize(148_600_000)).toBe("149 MB");
  });
});

describe("useLocalSpeechInstall", () => {
  it("reports unavailable, installed and missing runtimes", async () => {
    const { result } = renderHook(() => useLocalSpeechInstall());
    expect(result.current.state).toEqual({ phase: "unknown" });

    vi.mocked(getSpeechRuntimeStatus).mockResolvedValueOnce(null);
    await act(async () => {
      expect(await result.current.refresh()).toEqual({ phase: "unavailable" });
    });
    vi.mocked(getSpeechRuntimeStatus).mockResolvedValueOnce({
      installed: true,
    } as never);
    await act(() => result.current.refresh());
    expect(result.current.state).toEqual({ phase: "installed" });

    vi.mocked(getSpeechRuntimeStatus).mockResolvedValueOnce({
      installed: false,
    } as never);
    await act(() => result.current.refresh());
    expect(result.current.state).toEqual({ phase: "missing", downloadBytes: null });

    vi.mocked(getSpeechRuntimeStatus).mockResolvedValueOnce({
      installed: false,
      downloadBytes: 5_000_000,
    } as never);
    await act(() => result.current.refresh());
    expect(result.current.state).toEqual({
      phase: "missing",
      downloadBytes: 5_000_000,
    });

    vi.mocked(getSpeechRuntimeStatus).mockRejectedValueOnce(new Error("ipc"));
    await act(() => result.current.refresh());
    expect(result.current.state).toEqual({ phase: "unavailable" });
  });

  it("tracks install progress and finishes installed", async () => {
    let finish!: (value: { ok: boolean; error?: string }) => void;
    vi.mocked(installSpeechRuntime).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve as typeof finish;
      }) as never,
    );
    vi.mocked(getSpeechRuntimeStatus).mockResolvedValue({ installed: false } as never);
    const { result } = renderHook(() => useLocalSpeechInstall());
    let installing!: Promise<boolean>;
    act(() => {
      installing = result.current.install();
    });
    expect(result.current.state).toEqual({
      phase: "installing",
      percent: 0,
      message: "Starting download…",
    });

    act(() =>
      emit({ receivedBytes: 50, totalBytes: 200, message: "Downloading model" }),
    );
    expect(result.current.state).toEqual({
      phase: "installing",
      percent: 25,
      message: "Downloading model",
    });
    act(() => emit({ receivedBytes: 300, totalBytes: 200 }));
    expect(result.current.state).toMatchObject({
      percent: 100,
      message: "Installing local speech…",
    });
    act(() => emit({ receivedBytes: 0, totalBytes: 0 }));
    expect(result.current.state).toMatchObject({ percent: null });
    act(() => emit({ error: "ignored" }));
    expect(result.current.state).toMatchObject({ percent: null });

    // A status refresh during install does not interrupt the progress view.
    await act(() => result.current.refresh());
    expect(result.current.state.phase).toBe("installing");

    await act(async () => {
      finish({ ok: true });
      expect(await installing).toBe(true);
    });
    expect(result.current.state).toEqual({ phase: "installed" });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("reports install failures with the known download size", async () => {
    vi.mocked(getSpeechRuntimeStatus).mockResolvedValue({
      installed: false,
      downloadBytes: 9,
    } as never);
    const { result } = renderHook(() => useLocalSpeechInstall());
    await act(() => result.current.refresh());

    vi.mocked(installSpeechRuntime).mockResolvedValueOnce({
      ok: false,
      error: "disk full",
    } as never);
    await act(async () => {
      expect(await result.current.install()).toBe(false);
    });
    expect(result.current.state).toEqual({
      phase: "failed",
      error: "disk full",
      downloadBytes: 9,
    });

    vi.mocked(installSpeechRuntime).mockResolvedValueOnce({ ok: false } as never);
    await act(() => result.current.install());
    expect(result.current.state).toMatchObject({
      error: "Speech support install failed.",
    });

    vi.mocked(installSpeechRuntime).mockRejectedValueOnce("offline");
    await act(() => result.current.install());
    expect(result.current.state).toMatchObject({ error: "offline" });
    expect(unsubscribe).toHaveBeenCalledTimes(3);
  });
});
