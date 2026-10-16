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
