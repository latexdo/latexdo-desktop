import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToolchainSetupCard, useSystemPrefersDark } from "./appShared";
const api = vi.hoisted(() => ({
  getTexRuntimeStatus: vi.fn(),
  installTexRuntime: vi.fn(),
  subscribeTexInstall: vi.fn(),
}));
vi.mock("../features/ai/aiClient", async (original) => ({
  ...(await original<typeof import("../features/ai/aiClient")>()),
  ...api,
}));
beforeEach(() => {
  api.getTexRuntimeStatus.mockResolvedValue({ supported: true });
  api.installTexRuntime.mockReset();
  api.subscribeTexInstall.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("compiler setup card", () => {
  it("reports installation progress and refreshes the compiler after completion", async () => {
    let complete!: (value: { ok: boolean }) => void;
    const unsubscribe = vi.fn();
    api.installTexRuntime.mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    api.subscribeTexInstall.mockReturnValue(unsubscribe);
    const installed = vi.fn();
    render(
      <ToolchainSetupCard
        issue="latex"
        onOpenExternal={vi.fn()}
        onInstalled={installed}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Install it for me" }));
    expect(
      screen.getByRole("button", { name: "Installing the PDF builder…" }),
    ).toBeDisabled();
    act(() =>
      api.subscribeTexInstall.mock.calls[0][0]({
        receivedBytes: 50,
        totalBytes: 100,
        message: "Downloading",
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Downloading · 50%");
    act(() =>
      api.subscribeTexInstall.mock.calls[0][0]({ receivedBytes: 60, totalBytes: 0 }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Downloading");
    await act(async () => complete({ ok: true }));
    expect(installed).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it.each([{ ok: false, error: "Disk full" }, { ok: false }])(
    "shows failed installs and permits retry",
    async (result) => {
      api.installTexRuntime.mockResolvedValue(result);
      const unsubscribe = vi.fn();
      api.subscribeTexInstall.mockReturnValue(unsubscribe);
      const installed = vi.fn();
      render(
        <ToolchainSetupCard
          issue="latex"
          onOpenExternal={vi.fn()}
          onInstalled={installed}
        />,
      );
      fireEvent.click(await screen.findByRole("button", { name: "Install it for me" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        result.error ?? "PDF builder install failed.",
      );
      expect(installed).not.toHaveBeenCalled();
      expect(unsubscribe).toHaveBeenCalledOnce();
      expect(screen.getByRole("button", { name: "Install it for me" })).toBeEnabled();
    },
  );
  it.each(["Win32", "MacIntel", "Linux x86_64"])(
    "offers external installers for %s",
    (platform) => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
      const open = vi.fn();
      render(
        <ToolchainSetupCard
          issue="asymptote"
          onOpenExternal={open}
          onInstalled={vi.fn()}
        />,
      );
      expect(screen.getByRole("heading")).toHaveTextContent("drawing builder");
      for (const button of screen.getAllByRole("button")) fireEvent.click(button);
      expect(open).toHaveBeenCalledTimes(3);
      expect(open).toHaveBeenCalledWith(expect.stringMatching(/^https:/));
    },
  );
  it("handles unavailable runtime status without showing automatic installation", async () => {
    api.getTexRuntimeStatus.mockRejectedValue(new Error("offline"));
    render(
      <ToolchainSetupCard
        issue="latex"
        onOpenExternal={vi.fn()}
        onInstalled={vi.fn()}
      />,
    );
    await waitFor(() => expect(api.getTexRuntimeStatus).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Install it for me" })).toBeNull();
  });
  it("tracks system theme changes and removes the media listener", () => {
    const media = {
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => media),
    );
    const h = renderHook(() => useSystemPrefersDark());
    expect(h.result.current).toBe(true);
    const handler = media.addEventListener.mock.calls[0][1];
    act(() => handler({ matches: false }));
    expect(h.result.current).toBe(false);
    h.unmount();
    expect(media.removeEventListener).toHaveBeenCalledWith("change", handler);
  });
});
