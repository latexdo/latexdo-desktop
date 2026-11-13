import { describe, expect, it } from "vitest";
import {
  adminOfferFor,
  answerAdminOffer,
  cancelAdminOffer,
  offerAdmin,
} from "./adminOffers.mjs";

function project() {
  const person = (clientId, role) => ({ clientId, role, updatedAt: 0 });
  return {
    permissions: {
      owner: person("owner", "admin"),
      ada: person("ada", "admin"),
      bob: person("bob", "editor"),
      eve: person("eve", "viewer"),
      gone: person("gone", null),
    },
  };
}

describe("admin offers", () => {
  it("only makes someone admin once they accept", () => {
    const meta = project();
    const offer = offerAdmin(meta, {
      from: "owner",
      to: "bob",
      fromIsOwner: true,
      now: 5,
    });
    expect(offer).toEqual({ from: "owner", transfer: false, offeredAt: 5 });
    expect(meta.permissions.bob.role).toBe("editor");
    expect(adminOfferFor(meta, "bob")).toEqual(offer);

    expect(answerAdminOffer(meta, { clientId: "bob", accept: true, now: 6 })).toEqual({
      changed: ["bob"],
      offer,
    });
    expect(meta.permissions.bob.role).toBe("admin");
    expect(meta.permissions.owner.role).toBe("admin");
    expect(adminOfferFor(meta, "bob")).toBeNull();
  });

  it("keeps the role when declined and lets the admin withdraw an offer", () => {
    const meta = project();
    offerAdmin(meta, { from: "ada", to: "eve", fromIsOwner: false, now: 1 });
    expect(
      answerAdminOffer(meta, { clientId: "eve", accept: false, now: 2 }).changed,
    ).toEqual([]);
    expect(meta.permissions.eve.role).toBe("viewer");
    expect(() =>
      answerAdminOffer(meta, { clientId: "eve", accept: true, now: 3 }),
    ).toThrow("no longer valid");

    offerAdmin(meta, { from: "ada", to: "eve", fromIsOwner: false, now: 4 });
    expect(cancelAdminOffer(meta, "eve", 5)).toBe(true);
    expect(cancelAdminOffer(meta, "eve", 6)).toBe(false);
    expect(adminOfferFor(meta, "eve")).toBeNull();
  });

  it("hands over a non-owner admin's seat, but never the owner's", () => {
    const meta = project();
    expect(() =>
      offerAdmin(meta, {
        from: "owner",
        to: "bob",
        transfer: true,
        fromIsOwner: true,
        now: 1,
      }),
    ).toThrow("owner always stays admin");

    offerAdmin(meta, { from: "ada", to: "eve", fromIsOwner: false, now: 1 });
    offerAdmin(meta, {
      from: "ada",
      to: "bob",
      transfer: true,
      fromIsOwner: false,
      now: 2,
    });
    expect(
      answerAdminOffer(meta, { clientId: "bob", accept: true, now: 3 }).changed,
    ).toEqual(["bob", "ada"]);
    expect(meta.permissions.bob.role).toBe("admin");
    expect(meta.permissions.ada.role).toBe("editor");
    // Ada stepped down, so what she offered Eve is gone.
    expect(adminOfferFor(meta, "eve")).toBeNull();
  });

  it("drops offers whose admin lost their rights and refuses invalid ones", () => {
    const meta = project();
    offerAdmin(meta, { from: "ada", to: "bob", fromIsOwner: false, now: 1 });
    meta.permissions.ada.role = "editor";
    expect(adminOfferFor(meta, "bob")).toBeNull();
    expect(() =>
      answerAdminOffer(meta, { clientId: "bob", accept: true, now: 2 }),
    ).toThrow("no longer valid");
    expect(meta.permissions.bob.role).toBe("editor");

    expect(() =>
      offerAdmin(meta, { from: "bob", to: "eve", fromIsOwner: false, now: 3 }),
    ).toThrow("Only an admin");
    expect(() =>
      offerAdmin(meta, { from: "owner", to: "owner", fromIsOwner: true, now: 3 }),
    ).toThrow("already an admin");
    expect(() =>
      offerAdmin(project(), { from: "owner", to: "ada", fromIsOwner: true, now: 3 }),
    ).toThrow("already an admin");
    expect(() =>
      offerAdmin(meta, { from: "owner", to: "gone", fromIsOwner: true, now: 3 }),
    ).toThrow("not found");
    expect(() =>
      offerAdmin(meta, { from: "owner", to: "__proto__", fromIsOwner: true, now: 3 }),
    ).toThrow("not found");
  });
});
