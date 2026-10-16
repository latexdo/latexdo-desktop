import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WhatsNewModal } from "./WhatsNewModal";

describe("WhatsNewModal", () => {
  it("lists the changes a build update brought, even without version notes", () => {
    render(
      <WhatsNewModal
        fromVersion="0.3.1"
        toVersion="0.3.1"
        releases={[]}
        notesAvailable={false}
        buildChanges={[
          { kind: "new", text: "Complete the sentence being written" },
          { kind: "fixed", text: "Let the author keep typing after a citation" },
        ]}
        onClose={vi.fn()}
        onViewFullNotes={vi.fn()}
      />,
    );
    const changes = screen.getByRole("region", { name: "Changes in this update" });
    expect(
      within(changes).getByText("Complete the sentence being written"),
    ).toBeVisible();
    expect(within(changes).getByText("Fixed")).toBeVisible();
  });
});
