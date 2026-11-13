import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CollaboratorsList } from "./CollaboratorsList";
import { collaboratorLook } from "../collaboration/collaboratorLook";

describe("CollaboratorsList", () => {
  it("shows a waiting message without collaborators", () => {
    render(<CollaboratorsList users={[]} />);
    expect(screen.getByText("Waiting for collaborators")).toBeInTheDocument();
  });

  it("lists each collaborator with their file and role", () => {
    const { container } = render(
      <CollaboratorsList
        users={[
          {
            clientId: "1",
            name: "ada",
            currentFile: "chapters/intro.tex",
            lastSeen: 0,
            role: "admin",
          },
          { clientId: "2", name: "bob", currentFile: null, lastSeen: 0, active: false },
          {
            clientId: "3",
            name: "cy",
            currentFile: "main.tex",
            lastSeen: 0,
            role: "owner" as never,
          },
        ]}
      />,
    );
    const items = container.querySelectorAll("li");
    expect(items).toHaveLength(3);
    // Their emoji, as on their cursor: a button to go to them when in a file.
    const avatar = items[0].querySelector<HTMLButtonElement>(".collaborator-avatar")!;
    expect(avatar.textContent).toBe(collaboratorLook("1").emoji);
    expect(avatar).toBeDisabled();
    // Active people show their file next to a green dot; away people say so.
    expect(items[0]).toHaveAttribute("data-presence", "active");
    expect(items[0].querySelector(".collaborator-presence")?.textContent).toBe(
      "intro.tex",
    );
    expect(screen.getByTitle("admin").querySelector("svg")).not.toBeNull();
    expect(items[1]).toHaveAttribute("data-presence", "away");
    expect(items[1].querySelector(".collaborator-presence")?.textContent).toBe("Away");
    expect(items[1].querySelector(".presence-dot")?.getAttribute("data-presence")).toBe(
      "away",
    );
    expect(items[1].querySelector(".collaborator-role")).toBeNull();
    // An unknown role still shows a generic icon.
    expect(screen.getByTitle("owner").querySelector("svg")).not.toBeNull();
  });

  it("goes to a person when their emoji is clicked", () => {
    const onGoTo = vi.fn();
    render(
      <CollaboratorsList
        onGoTo={onGoTo}
        users={[
          { clientId: "1", name: "ada", currentFile: "main.tex", lastSeen: 0 },
          { clientId: "2", name: "bob", currentFile: null, lastSeen: 0 },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Go to ada" }));
    expect(onGoTo).toHaveBeenCalledWith("1");
    // Nobody to go to without a file open.
    expect(screen.getByRole("button", { name: "bob" })).toBeDisabled();
  });
});
