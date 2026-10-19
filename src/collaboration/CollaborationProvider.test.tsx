import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./collaborationApi", () => ({
  collaborationApiBaseUrl: () => "https://api.example.test",
}));
vi.mock("./collaborationStorage", () => ({
  collaborationIdentity: () => ({ clientName: "Ada", color: "#0f0", emoji: "🐙" }),
}));

import { useCollaborationContext } from "./CollaborationContext";
import { CollaborationProvider } from "./CollaborationProvider";

function Probe() {
  const value = useCollaborationContext();
  return <output>{JSON.stringify(value)}</output>;
}

describe("CollaborationProvider", () => {
  it("exposes the identity and API base URL to children", () => {
    render(
      <CollaborationProvider>
        <Probe />
      </CollaborationProvider>,
    );
    expect(JSON.parse(screen.getByRole("status").textContent ?? "")).toEqual({
      clientName: "Ada",
      color: "#0f0",
      emoji: "🐙",
      apiBaseUrl: "https://api.example.test",
    });
  });
});
