import { describe, expect, it, vi } from "vitest";
import {
  appendAuditEvent,
  buildEnterpriseComplianceReport,
  defaultEnterpriseState,
  enterpriseRiskItems,
  enterpriseStorageKey,
  enterpriseStoragePercent,
  enterpriseSummary,
  extractMentions,
  loadEnterpriseState,
  saveEnterpriseState,
} from "./enterprise";

describe("enterprise state", () => {
  it("summarizes every business feature area", () => {
    const summary = enterpriseSummary(defaultEnterpriseState);

    expect(summary.workspaceCount).toBeGreaterThan(0);
    expect(summary.templateCount).toBeGreaterThan(0);
    expect(summary.managedReferences).toBeGreaterThan(0);
    expect(summary.assetCount).toBeGreaterThan(0);
    expect(summary.pendingApprovals).toBe(1);
    expect(summary.openTasks).toBe(2);
    expect(summary.readyAiModels).toBe(1);
    expect(summary.activeExportTargets).toBe(1);
  });

  it("extracts unique comment mentions for notifications", () => {
    expect(extractMentions("@legal please ask @author and @legal again.")).toEqual([
      "legal",
      "author",
    ]);
  });

  it("builds a compliance report with identity, AI, publishing, and risks", () => {
    const report = buildEnterpriseComplianceReport(defaultEnterpriseState, {
      projectName: "Client Deliverables",
      activeDocumentPath: "reports/main.tex",
      generatedAt: "2026-07-24T12:00:00.000Z",
    });

    expect(report.markdown).toContain("Identity and Access");
    expect(report.markdown).toContain("Business AI");
    expect(report.markdown).toContain("Publishing");
    expect(report.markdown).toContain("reports/main.tex");
    expect(report.riskItems).toEqual(enterpriseRiskItems(defaultEnterpriseState));
  });

  it("persists normalized enterprise state", () => {
    window.localStorage.clear();
    const state = {
      ...defaultEnterpriseState,
      organization: { ...defaultEnterpriseState.organization, name: "Globex" },
    };

    saveEnterpriseState(state);

    expect(window.localStorage.getItem(enterpriseStorageKey)).toContain("Globex");
    expect(loadEnterpriseState().organization.name).toBe("Globex");
  });

  it("appends bounded audit events and reports storage percentage", () => {
    vi.spyOn(Date.prototype, "toISOString").mockReturnValue("2026-07-24T12:30:00.000Z");
    const next = appendAuditEvent(
      defaultEnterpriseState,
      "admin@company.example",
      "Enabled policy",
      "sso-required",
    );

    expect(next.collaboration.auditTrail[0]).toMatchObject({
      actor: "admin@company.example",
      action: "Enabled policy",
      target: "sso-required",
      createdAt: "2026-07-24T12:30:00.000Z",
    });
    expect(enterpriseStoragePercent(defaultEnterpriseState)).toBe(34);
  });
});
