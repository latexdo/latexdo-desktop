// @vitest-environment node
import { describe, expect, it } from "vitest";
import { accessLogPath, projectRole, sessionHash, withLock } from "./security.mjs";

describe("collaboration authorization", () => {
  const meta = {
    ownerSession: "owner-secret",
    shareToken: "invite-secret",
    permissions: {
      guest: { role: "viewer", sessionHash: sessionHash("guest-secret") },
      legacy: { role: "admin" },
    },
  };

  it.each([
    ["owner", "owner-secret", undefined, "admin"],
    ["guest", "guest-secret", "invite-secret", "viewer"],
    ["guest", "stolen-identity", "invite-secret", null],
    ["legacy", "attacker", "invite-secret", null],
    ["new", "new-secret", "invite-secret", "editor"],
    ["new", "new-secret", "wrong-token", null],
    ["toString", "attacker", "wrong-token", null],
  ])(
    "authorizes %s only with its actual credentials",
    (clientId, sessionId, token, expected) => {
      expect(projectRole(meta, { clientId, sessionId }, token)).toBe(expected);
    },
  );

  it("redacts invitation credentials and fails closed for malformed URL escapes", () => {
    expect(accessLogPath("/api/shares/invite%2Dsecret?token=another-secret")).toBe(
      "/api/shares/[redacted]",
    );
    expect(accessLogPath("/api/shares/%ZZ?token=secret")).toBe("/[invalid-path]");
    expect(accessLogPath()).toBe("/");
  });
});

describe("serialized collaboration writes", () => {
  it("keeps same-project writes ordered after failure without blocking other projects", async () => {
    let rejectFirst;
    const events = [];
    const first = withLock("project-a", () => {
      events.push("first");
      return new Promise((_resolve, reject) => {
        rejectFirst = reject;
      });
    });
    const failure = expect(first).rejects.toThrow("disk full");
    const second = withLock("project-a", () => {
      events.push("second");
      return "saved";
    });
    await withLock("project-b", () => {
      events.push("independent");
    });
    expect(events).toEqual(["first", "independent"]);
    rejectFirst(new Error("disk full"));
    await failure;
    expect(await second).toBe("saved");
    expect(events).toEqual(["first", "independent", "second"]);
    expect(await withLock("project-a", () => "next save")).toBe("next save");
  });
});
