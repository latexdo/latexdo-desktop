import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePdfReviewMarkers } from "./usePdfReviewMarkers";
import type { ReviewChat } from "../../types";

const chat: ReviewChat = {
  id: "thread",
  filePath: "main.tex",
  comments: [],
  selection: { text: "Claim", startLine: 1, startColumn: 1, endLine: 1, endColumn: 6 },
};

describe("PDF review markers", () => {
  it("locates moved source text, skips paper reviews and tolerates missing SyncTeX", async () => {
    const readFile = vi.fn(async () => "Intro\nClaim");
    const forwardSyncTex = vi
      .fn()
      .mockResolvedValueOnce({ page: 2, x: 50, y: 90, height: 10 })
      .mockRejectedValueOnce(new Error("No SyncTeX"));
    window.latexdo = { readFile, forwardSyncTex } as unknown as typeof window.latexdo;
    const data = new Uint8Array([1]);
    const chats: ReviewChat[] = [
      chat,
      { ...chat, id: "paper", kind: "paper" },
      { ...chat, id: "missing" },
    ];
    const h = renderHook(() => usePdfReviewMarkers("project", "main.pdf", data, chats));
    await waitFor(() => expect(h.result.current).toHaveLength(1));
    expect(forwardSyncTex).toHaveBeenCalledWith(
      "project",
      "main.pdf",
      "main.tex",
      2,
      1,
    );
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(h.result.current[0]).toMatchObject({
      id: "thread",
      pageNumber: 2,
      x: 50,
      y: 85,
    });
  });

  it("discards a slow response from a previous PDF build", async () => {
    let resolve: (value: unknown) => void = () => {};
    const forwardSyncTex = vi
      .fn()
      .mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        }),
      )
      .mockResolvedValueOnce({ page: 1, x: 20, y: 30, height: 10 });
    window.latexdo = {
      readFile: vi.fn(async () => "Claim"),
      forwardSyncTex,
    } as unknown as typeof window.latexdo;
    const chats = [chat];
    const h = renderHook(
      ({ data }) => usePdfReviewMarkers("project", "main.pdf", data, chats),
      { initialProps: { data: new Uint8Array([1]) } },
    );
    await waitFor(() => expect(forwardSyncTex).toHaveBeenCalledTimes(1));
    h.rerender({ data: new Uint8Array([2]) });
    await waitFor(() => expect(h.result.current[0]?.x).toBe(20));
    await act(async () => resolve({ page: 5, x: 99, y: 90, height: 10 }));
    expect(h.result.current[0]).toMatchObject({ pageNumber: 1, x: 20 });
  });
});
