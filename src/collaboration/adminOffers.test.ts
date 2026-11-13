import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as notifications from "../features/notifications/notifications";
import type { CollaboratorPermission } from "../types";
import {
  adminOfferNews,
  adminOfferText,
  myAdminOffer,
  useAdminOffers,
} from "./adminOffers";

const offer = { from: "ada", transfer: false, offeredAt: 10 };

function people(
  overrides: Record<string, Partial<CollaboratorPermission>> = {},
  me = "bob",
): CollaboratorPermission[] {
  return [
    { clientId: "ada", name: "Ada", role: "admin" },
    { clientId: "bob", name: "Bob", role: "editor" },
    { clientId: "eve", name: "Eve", role: "viewer" },
  ].map((item) => ({
    ...(item as CollaboratorPermission),
    ...(item.clientId === me ? { isCurrent: true } : {}),
    ...overrides[item.clientId],
  }));
}

describe("admin offers in the app", () => {
  it("finds the invitation waiting for me, with who sent it", () => {
    expect(myAdminOffer(people())).toBeNull();
    const mine = myAdminOffer(people({ bob: { adminOffer: offer } }));
    expect(mine).toEqual({ ...offer, fromName: "Ada" });
    expect(adminOfferText(mine!)).toBe(
      "Ada invited you to become an admin of this project. Open Share to accept or decline.",
    );
    expect(adminOfferText({ ...mine!, transfer: true })).toContain(
      "hand over their admin role",
    );
  });

  it("announces a new invitation once", () => {
    const next = people({ bob: { adminOffer: offer } });
    expect(adminOfferNews(null, next, null).invited?.fromName).toBe("Ada");
    expect(adminOfferNews(next, next, "ada:10").invited).toBeNull();
    // Offered again later: news again.
    const again = people({ bob: { adminOffer: { ...offer, offeredAt: 20 } } });
    expect(adminOfferNews(next, again, "ada:10").invited?.offeredAt).toBe(20);
  });

  it("tells the admin how their invitations were answered, except withdrawn ones", () => {
    const sent = people(
      { bob: { adminOffer: offer }, eve: { adminOffer: offer } },
      "ada",
    );
    const answered = people({ bob: { role: "admin" } }, "ada");
    expect(adminOfferNews(sent, answered, null).answered).toEqual([
      { clientId: "bob", name: "Bob", accepted: true },
      { clientId: "eve", name: "Eve", accepted: false },
    ]);
    expect(adminOfferNews(sent, answered, null, new Set(["eve"])).answered).toEqual([
      { clientId: "bob", name: "Bob", accepted: true },
    ]);
    expect(adminOfferNews(sent, sent, null).answered).toEqual([]);
    // Removed, or given another role by someone else: not an answer.
    const otherwise = people({ eve: { role: "editor" } }, "ada").filter(
      (item) => item.clientId !== "bob",
    );
    expect(adminOfferNews(sent, otherwise, null).answered).toEqual([]);
    // Another admin's invitations are not mine to hear about.
    expect(
      adminOfferNews(
        sent,
        answered.map((item) => ({ ...item, isCurrent: item.clientId === "eve" })),
        null,
      ).answered,
    ).toEqual([]);
  });
});

describe("checking for admin invitations", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("checks rarely in the background, often in Share, and announces once", async () => {
    vi.useFakeTimers();
    const notify = vi.spyOn(notifications, "notify");
    const getCollaborationPermissions = vi.fn(async () => ({
      permissions: people({ bob: { adminOffer: offer } }),
      isAdmin: false,
    }));
    window.latexdo = {
      getCollaborationPermissions,
    } as unknown as typeof window.latexdo;
    const options = {
      projectId: "p",
      onPermissions: vi.fn(),
      openShare: vi.fn(),
      reload: vi.fn(async () => {}),
      watching: false,
    };
    const { result, rerender } = renderHook((props) => useAdminOffers(props), {
      initialProps: options,
    });
    await act(async () => {});
    expect(getCollaborationPermissions).toHaveBeenCalledTimes(1);
    expect(result.current.offer?.fromName).toBe("Ada");
    expect(notify).toHaveBeenCalledTimes(1);

    // A minute in the background: no extra request.
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(getCollaborationPermissions).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(4 * 60_000));
    expect(getCollaborationPermissions).toHaveBeenCalledTimes(2);

    // Share opens: checked at once and every 15 s, without announcing again.
    rerender({ ...options, watching: true });
    await act(async () => {});
    expect(getCollaborationPermissions).toHaveBeenCalledTimes(3);
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    expect(getCollaborationPermissions).toHaveBeenCalledTimes(4);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(result.current.offer?.fromName).toBe("Ada");
  });
});
