import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResearcherProfile } from "../features/ai/researcherProfile";

const profileMock = vi.hoisted(() => ({
  generateScholarToken: vi.fn(() => "sch-solar-orchid-123"),
  tokenCodename: vi.fn((token: string) => token.split("-").slice(1, 3).join("-")),
}));

const orcidMock = vi.hoisted(() => ({
  fetchOrcidProfile: vi.fn(),
  isValidOrcid: vi.fn((value: string) => value.includes("0000-0002-1825-0097")),
}));

vi.mock("../features/ai/researcherProfile", async () => {
  const actual = await vi.importActual<
    typeof import("../features/ai/researcherProfile")
  >("../features/ai/researcherProfile");
  return {
    ...actual,
    generateScholarToken: profileMock.generateScholarToken,
    tokenCodename: profileMock.tokenCodename,
  };
});

vi.mock("../features/ai/orcid", () => ({
  fetchOrcidProfile: orcidMock.fetchOrcidProfile,
  isValidOrcid: orcidMock.isValidOrcid,
}));

import { ProfileDialog } from "./ProfileDialog";

function profile(overrides: Partial<ResearcherProfile> = {}): ResearcherProfile {
  return {
    mode: "anonymous",
    token: "sch-lunar-beacon-abc",
    orcidId: "",
    displayName: "",
    title: "",
    affiliation: "",
    externalProviders: [],
    papers: [],
    papersFetchedAt: 0,
    includeInContext: true,
    ...overrides,
  };
}

describe("ProfileDialog", () => {
  beforeEach(() => {
    profileMock.generateScholarToken.mockClear();
    profileMock.tokenCodename.mockClear();
    orcidMock.fetchOrcidProfile.mockReset();
    orcidMock.isValidOrcid.mockClear();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("edits the name, title, AI toggle and anonymous ID", async () => {
    const onChange = vi.fn();
    const onClose = vi.fn();
    render(<ProfileDialog profile={profile()} onChange={onChange} onClose={onClose} />);

    expect(screen.getByText("lunar-beacon")).toBeVisible();
    expect(screen.queryByPlaceholderText("Lab, university, or company")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Copy anonymous ID" }));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "sch-lunar-beacon-abc",
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "New anonymous ID" }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ token: "sch-solar-orchid-123" }),
    );

    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Ada" } });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ displayName: "Ada" }),
    );

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Dr" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Dr" }));

    fireEvent.click(screen.getByRole("switch", { name: "Personalize the AI" }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ includeInContext: false }),
    );

    fireEvent.click(screen.getByTitle("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when Escape is pressed from a field", () => {
    const onClose = vi.fn();
    render(<ProfileDialog profile={profile()} onChange={vi.fn()} onClose={onClose} />);

    fireEvent.keyDown(screen.getByLabelText("Your name"), { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("imports the public ORCID name and publications without claiming authentication", async () => {
    orcidMock.fetchOrcidProfile.mockResolvedValue({
      name: "Ada Lovelace",
      papers: [{ title: "Notes on the Analytical Engine", year: "1843" }],
    });
    const onChange = vi.fn();
    const onOpenExternal = vi.fn();
    render(
      <ProfileDialog
        profile={profile()}
        onChange={onChange}
        onClose={vi.fn()}
        onOpenExternal={onOpenExternal}
      />,
    );

    expect(screen.queryByLabelText("ORCID iD")).toBeNull();
    expect(screen.getByText(/This does not sign you in/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Import ORCID record" }));
    fireEvent.click(screen.getByRole("button", { name: /Create one at orcid\.org/i }));
    expect(onOpenExternal).toHaveBeenCalledWith("https://orcid.org/register");

    fireEvent.click(screen.getByRole("button", { name: "Import record" }));
    expect(
      screen.getByText("Enter a valid ORCID iD, e.g. 0000-0002-1825-0097."),
    ).toBeVisible();

    fireEvent.change(screen.getByLabelText("ORCID iD"), {
      target: { value: "https://orcid.org/0000-0002-1825-0097" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import record" }));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "orcid",
          orcidId: "0000-0002-1825-0097",
          displayName: "Ada Lovelace",
          papers: [{ title: "Notes on the Analytical Engine", year: "1843" }],
        }),
      );
    });
  });

  it("shows linked papers, refreshes and unlinks ORCID", async () => {
    orcidMock.fetchOrcidProfile.mockResolvedValue({
      name: "",
      papers: [{ title: "Refreshed paper", year: "2026" }],
    });
    const papers = Array.from({ length: 13 }, (_, i) => ({
      title: `Paper ${i + 1}`,
      year: "2026",
    }));
    const onChange = vi.fn();
    render(
      <ProfileDialog
        profile={profile({ mode: "orcid", orcidId: "0000-0002-1825-0097", papers })}
        onChange={onChange}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("ORCID 0000-0002-1825-0097 · 13 papers")).toBeVisible();
    expect(screen.getByText(/Show my 13 papers/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /Refresh/i }));
    await waitFor(() => {
      expect(orcidMock.fetchOrcidProfile).toHaveBeenCalledWith("0000-0002-1825-0097");
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove record" }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: "anonymous", orcidId: "", papers: [] }),
    );
  });

  it("imports an Overleaf project from its Git link and remembers it", async () => {
    const onImportOverleafProject = vi.fn().mockResolvedValue(undefined);
    const onChange = vi.fn();
    render(
      <ProfileDialog
        profile={profile()}
        onChange={onChange}
        onClose={vi.fn()}
        onImportOverleafProject={onImportOverleafProject}
      />,
    );

    fireEvent.change(screen.getByLabelText("Overleaf Git link"), {
      target: { value: "https://git.overleaf.com/abc123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() => {
      expect(onImportOverleafProject).toHaveBeenCalledWith(
        "https://git.overleaf.com/abc123",
      );
    });
    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          externalProviders: [
            expect.objectContaining({
              provider: "overleaf",
              username: "abc123",
              projectFetchUrl: "https://git.overleaf.com/abc123",
            }),
          ],
        }),
      );
    });
    expect(screen.getByText("Project imported and opened.")).toBeVisible();
  });

  it("fetches a remembered Overleaf project again", async () => {
    const onImportOverleafProject = vi.fn().mockResolvedValue(undefined);
    render(
      <ProfileDialog
        profile={profile({
          externalProviders: [
            {
              provider: "overleaf",
              username: "omarabedelkader",
              displayName: "Abedelkader",
              title: "Dr",
              confirmed: true,
              connectedAt: 1,
              updatedAt: 1,
              projectFetchUrl: "https://git.overleaf.com/project",
            },
          ],
        })}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onImportOverleafProject={onImportOverleafProject}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /fetch again/i }));
    await waitFor(() => {
      expect(onImportOverleafProject).toHaveBeenCalledWith(
        "https://git.overleaf.com/project",
      );
    });
  });
});
