import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  defaultEnterpriseState,
  type EnterpriseState,
} from "../features/enterprise/enterprise";
import { EnterpriseDashboard } from "./EnterpriseDashboard";

function cloneEnterpriseState(): EnterpriseState {
  return structuredClone(defaultEnterpriseState);
}

function renderDashboard(initialState = cloneEnterpriseState()) {
  let currentState = initialState;
  const onChange = vi.fn();
  const onExportReport = vi.fn();
  const onStatusMessage = vi.fn();

  function Harness() {
    const [state, setState] = React.useState(initialState);

    return (
      <EnterpriseDashboard
        state={state}
        projectName="Client Deliverables"
        activeDocumentPath="reports/main.tex"
        onChange={(nextState) => {
          currentState = nextState;
          onChange(nextState);
          setState(nextState);
        }}
        onExportReport={onExportReport}
        onStatusMessage={onStatusMessage}
      />
    );
  }

  render(<Harness />);

  return {
    getState: () => currentState,
    onChange,
    onExportReport,
    onStatusMessage,
  };
}

describe("EnterpriseDashboard", () => {
  it("updates organization identity settings from the team section", () => {
    const { getState, onExportReport, onStatusMessage } = renderDashboard();

    expect(screen.getByText("Acme Research Group")).toBeVisible();
    expect(screen.getByText(/company\.example - reports\/main\.tex/)).toBeVisible();
    expect(screen.getByText("Client Deliverables")).toBeVisible();

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Globex Research" },
    });
    expect(getState().organization.name).toBe("Globex Research");
    expect(onStatusMessage).toHaveBeenLastCalledWith("Organization settings updated");

    fireEvent.click(screen.getByRole("button", { name: /Google Workspace/i }));
    expect(
      getState().identity.providers.find(
        (provider) => provider.id === "google-workspace",
      )?.status,
    ).toBe("enforced");
    expect(onStatusMessage).toHaveBeenLastCalledWith("Google Workspace status updated");

    fireEvent.click(screen.getByRole("button", { name: /SCIM user provisioning/i }));
    expect(getState().identity.scim.enabled).toBe(false);
    expect(onStatusMessage).toHaveBeenLastCalledWith("SCIM provisioning disabled");

    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(onExportReport).toHaveBeenCalledTimes(1);
  });

  it("handles review workflows, approvals, locks, tasks, and comments", () => {
    const { getState, onStatusMessage } = renderDashboard();

    fireEvent.click(screen.getByRole("tab", { name: "Review" }));
    expect(screen.getByText("Review Workflows")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /Technical Brief Review/i }));
    expect(getState().collaboration.reviewWorkflows[0].status).toBe("approved");

    fireEvent.click(screen.getByRole("button", { name: "Request" }));
    expect(getState().collaboration.approvalRequests[0]).toMatchObject({
      title: "Approve reports/main.tex",
      documentPath: "reports/main.tex",
      status: "pending",
    });
    expect(screen.getByText("Approve reports/main.tex")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Lock" }));
    expect(getState().collaboration.documentLocks[0]).toMatchObject({
      path: "reports/main.tex",
      owner: "admin@company.example",
    });

    const approvalSelect = screen.getAllByDisplayValue("Pending")[0];
    fireEvent.change(approvalSelect, { target: { value: "approved" } });
    expect(
      getState().collaboration.approvalRequests.some(
        (approval) => approval.status === "approved",
      ),
    ).toBe(true);

    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Check appendix" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(getState().collaboration.tasks[0].title).toBe("Check appendix");
    expect(screen.getByText("Check appendix")).toBeVisible();

    const existingTask = screen
      .getByText("Verify high-risk citations")
      .closest("article");
    expect(existingTask).not.toBeNull();
    fireEvent.change(within(existingTask as HTMLElement).getByRole("combobox"), {
      target: { value: "done" },
    });
    expect(
      getState().collaboration.tasks.find((task) => task.id === "task-citation-audit")
        ?.status,
    ).toBe("done");

    fireEvent.change(screen.getByLabelText("Enterprise comment"), {
      target: { value: "@legal approve claims" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    expect(getState().collaboration.comments[0]).toMatchObject({
      text: "@legal approve claims",
      mentions: ["legal"],
    });
    expect(onStatusMessage).toHaveBeenLastCalledWith(
      "Comment added and 1 mention notification queued",
    );
  });

  it("covers administration, AI, and publishing actions", () => {
    const { getState, onExportReport } = renderDashboard();

    fireEvent.click(screen.getByRole("tab", { name: "Admin" }));
    expect(screen.getByText("Storage Management")).toBeVisible();
    expect(screen.getByText("SOC 2 Evidence Pack")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /Require SSO for all users/i }));
    expect(getState().admin.securityPolicies[0].enabled).toBe(false);

    fireEvent.click(screen.getAllByRole("button", { name: "Export" })[1]);
    expect(onExportReport).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("tab", { name: "AI" }));
    expect(screen.getByText("Private AI Models")).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: /Automatic compliance checking/i }),
    );
    expect(getState().aiBusiness.checks[0].enabled).toBe(false);

    fireEvent.click(screen.getByRole("tab", { name: "Publish" }));
    expect(screen.getByText("Company Templates")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /SharePoint Records/i }));
    expect(getState().publishing.exportTargets[0].status).toBe("not-configured");

    fireEvent.click(screen.getByRole("button", { name: /Weekly Program Report/i }));
    expect(getState().publishing.reportJobs[0].status).toBe("running");
  });
});

describe("EnterpriseDashboard state cycles and fallbacks", () => {
  function renderBare(initialState: EnterpriseState) {
    let currentState = initialState;
    function Harness() {
      const [state, setState] = React.useState(initialState);
      return (
        <EnterpriseDashboard
          state={state}
          projectName="P"
          onChange={(next) => {
            currentState = next;
            setState(next);
          }}
          onExportReport={vi.fn()}
        />
      );
    }
    render(<Harness />);
    return { getState: () => currentState };
  }

  it("cycles providers, SCIM and branding without an active document", () => {
    const initial = cloneEnterpriseState();
    initial.identity.scim.enabled = false;
    const { getState } = renderBare(initial);
    expect(screen.getByText(/No active document/)).toBeVisible();

    const okta = () => getState().identity.providers.find((p) => p.id === "okta")!;
    const oktaButton = screen.getByRole("button", { name: /Okta/i });
    fireEvent.click(oktaButton);
    expect(okta().status).toBe("configured");
    fireEvent.click(oktaButton);
    expect(okta().status).toBe("enforced");
    fireEvent.click(oktaButton);
    expect(okta().status).toBe("not-configured");

    fireEvent.click(screen.getByRole("button", { name: /SCIM user provisioning/i }));
    expect(getState().identity.scim).toMatchObject({
      enabled: true,
      status: "healthy",
    });
    expect(getState().collaboration.auditTrail[0].action).toBe(
      "Enabled SCIM provisioning",
    );

    fireEvent.change(screen.getByLabelText("Domain"), {
      target: { value: "globex.example" },
    });
    fireEvent.change(screen.getByLabelText("Brand color"), {
      target: { value: "#123456" },
    });
    expect(getState().organization).toMatchObject({
      domain: "globex.example",
      brandColor: "#123456",
    });
  });

  it("uses default paths and texts and cycles workflows back to draft", () => {
    const initial = cloneEnterpriseState();
    initial.collaboration.reviewWorkflows.push({
      ...initial.collaboration.reviewWorkflows[0],
      id: "workflow-other",
      name: "Other Review",
    });
    const { getState } = renderBare(initial);
    fireEvent.click(screen.getByRole("tab", { name: "Review" }));
    const workflow = screen.getByRole("button", { name: /Technical Brief Review/i });
    const status = () => getState().collaboration.reviewWorkflows[0].status;
    fireEvent.click(workflow);
    expect(status()).toBe("approved");
    fireEvent.click(workflow);
    expect(status()).toBe("rejected");
    fireEvent.click(workflow);
    expect(status()).toBe("draft");
    fireEvent.click(workflow);
    expect(status()).toBe("in-review");
    expect(getState().collaboration.reviewWorkflows[1].status).toBe("in-review");

    fireEvent.click(screen.getByRole("button", { name: "Request" }));
    expect(getState().collaboration.approvalRequests[0].documentPath).toBe(
      "reports/main.tex",
    );
    fireEvent.click(screen.getByRole("button", { name: "Lock" }));
    expect(getState().collaboration.documentLocks[0].path).toBe("reports/main.tex");

    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(getState().collaboration.tasks[0]).toMatchObject({
      title: "Review document",
      documentPath: "reports/main.tex",
    });

    fireEvent.change(screen.getByLabelText("Enterprise comment"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    expect(getState().collaboration.comments[0]).toMatchObject({
      text: "@reviewer please review this document.",
      mentions: [],
    });
    expect(screen.getAllByText(/Mentions: none/).length).toBeGreaterThan(0);
  });

  it("shows disabled backups, advisory guides, disabled assistants and no risks", () => {
    const state = cloneEnterpriseState();
    state.admin.backupRetention.backupEnabled = false;
    state.aiBusiness.styleGuides = state.aiBusiness.styleGuides.map((guide) => ({
      ...guide,
      enforced: false,
    }));
    state.aiBusiness.writingAssistants = state.aiBusiness.writingAssistants.map(
      (assistant) => ({ ...assistant, enabled: false }),
    );
    state.publishing.reportJobs = [
      ...state.publishing.reportJobs,
      { ...state.publishing.reportJobs[0], id: "second-job", name: "Second Job" },
    ];
    state.publishing.exportTargets = [
      ...state.publishing.exportTargets.map((target) => ({
        ...target,
        status: "not-configured" as const,
      })),
    ];
    const { getState } = renderBare(state);

    fireEvent.click(screen.getByRole("tab", { name: "Admin" }));
    expect(screen.getByText("Backups disabled")).toBeVisible();

    fireEvent.click(screen.getByRole("tab", { name: "AI" }));
    expect(screen.getAllByText(/advisory/).length).toBe(
      state.aiBusiness.styleGuides.length,
    );
    expect(screen.getAllByText("Disabled").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("tab", { name: "Publish" }));
    fireEvent.click(screen.getByRole("button", { name: /Second Job/i }));
    expect(getState().publishing.reportJobs.map((job) => job.status)).toEqual([
      state.publishing.reportJobs[0].status,
      "running",
    ]);
    fireEvent.click(screen.getByRole("button", { name: /SharePoint Records/i }));
    expect(getState().publishing.exportTargets[0].status).toBe("configured");

    const safe = cloneEnterpriseState();
    safe.identity.providers = safe.identity.providers.map((provider) => ({
      ...provider,
      status: "enforced" as const,
    }));
    safe.bibliographies = safe.bibliographies.map((library) => ({
      ...library,
      verificationStatus: "verified" as const,
    }));
    safe.admin.securityPolicies = safe.admin.securityPolicies.map((policy) => ({
      ...policy,
      enabled: true,
    }));
    document.body.innerHTML = "";
    renderBare(safe);
    fireEvent.click(screen.getByRole("tab", { name: "Admin" }));
    expect(screen.getByText("No risks detected")).toBeVisible();
  });
});
