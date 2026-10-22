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
  normalizeEnterpriseState,
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

describe("enterprise state normalization", () => {
  const base = defaultEnterpriseState;

  it("falls back to defaults for missing or unknown versions", () => {
    expect(normalizeEnterpriseState(null)).toBe(base);
    expect(normalizeEnterpriseState([])).toBe(base);
    expect(normalizeEnterpriseState({ schemaVersion: 2 })).toBe(base);
  });

  it("fills every section from defaults when only the version is stored", () => {
    const state = normalizeEnterpriseState({ schemaVersion: 1 });
    expect(state.organization).toEqual(base.organization);
    expect(state.workspaces).toBe(base.workspaces);
    expect(state.templates).toBe(base.templates);
    expect(state.bibliographies).toBe(base.bibliographies);
    expect(state.assetLibraries).toBe(base.assetLibraries);
    expect(state.rolePolicies).toBe(base.rolePolicies);
    expect(state.identity).toEqual(base.identity);
    expect(state.collaboration).toBe(base.collaboration);
    expect(state.admin).toEqual(base.admin);
    expect(state.aiBusiness).toBe(base.aiBusiness);
    expect(state.publishing).toEqual(base.publishing);
  });

  it("keeps valid stored values and replaces invalid ones", () => {
    const state = normalizeEnterpriseState({
      schemaVersion: 1,
      organization: { name: "Initech", domain: 4 },
      workspaces: [],
      templates: [],
      bibliographies: [],
      assetLibraries: [],
      rolePolicies: [],
      identity: {
        providers: [
          { status: "enforced", domainHint: "x.org", enforcedGroups: ["a", 1] },
          { status: "not-configured", enforcedGroups: "nope" },
          { status: "bogus" },
          "garbage",
        ],
        scim: {
          enabled: false,
          baseUrl: "https://scim",
          tokenRotationDays: Number.NaN,
          lastSync: "yesterday",
          status: "warning",
        },
      },
      collaboration: { tasks: [] },
      admin: {
        usage: { activeUsers: 3 },
        storage: {
          quotaGb: 0,
          usedGb: 5,
          largestWorkspaceId: "w",
          archiveAfterDays: 7,
        },
        securityPolicies: [
          { id: "p", name: "Policy", enabled: false, severity: "recommended" },
          null,
        ],
        backupRetention: {
          backupEnabled: false,
          retentionDays: 10,
          legalHoldEnabled: true,
          lastBackup: "never",
        },
        complianceReports: [],
      },
      aiBusiness: { privateModels: [] },
      publishing: {
        doiRecords: [],
        reportJobs: [
          { status: "running" },
          { status: "scheduled", name: "Weekly" },
          { status: "odd" },
          7,
        ],
      },
    });

    expect(state.organization).toEqual({ ...base.organization, name: "Initech" });
    expect(state.workspaces).toEqual([]);
    const [first, second, third, fourth] = state.identity.providers;
    expect(first).toMatchObject({
      status: "enforced",
      domainHint: "x.org",
      enforcedGroups: ["a"],
    });
    expect(second.status).toBe("not-configured");
    expect(second.enforcedGroups).toEqual(base.identity.providers[1].enforcedGroups);
    expect(third.status).toBe(base.identity.providers[2].status);
    expect(fourth).toBe(base.identity.providers[base.identity.providers.length - 1]);
    expect(state.identity.scim).toEqual({
      enabled: false,
      baseUrl: "https://scim",
      tokenRotationDays: base.identity.scim.tokenRotationDays,
      lastSync: "yesterday",
      status: "warning",
    });
    expect(state.collaboration.tasks).toEqual([]);
    expect(state.admin.usage.activeUsers).toBe(3);
    expect(state.admin.storage).toEqual({
      quotaGb: 0,
      usedGb: 5,
      largestWorkspaceId: "w",
      archiveAfterDays: 7,
    });
    expect(state.admin.securityPolicies[0]).toEqual({
      id: "p",
      name: "Policy",
      enabled: false,
      severity: "recommended",
    });
    expect(state.admin.securityPolicies[1]).toBe(base.admin.securityPolicies[1]);
    expect(state.admin.backupRetention).toEqual({
      backupEnabled: false,
      retentionDays: 10,
      legalHoldEnabled: true,
      lastBackup: "never",
    });
    expect(state.aiBusiness.privateModels).toEqual([]);
    expect(state.publishing.doiRecords).toEqual([]);
    expect(state.publishing.reportJobs.map((job) => job.status)).toEqual([
      "running",
      "scheduled",
      base.publishing.reportJobs[base.publishing.reportJobs.length - 1].status,
      base.publishing.reportJobs[base.publishing.reportJobs.length - 1].status,
    ]);
    expect(state.publishing.reportJobs[1].name).toBe("Weekly");

    expect(enterpriseStoragePercent(state)).toBe(0);
    const report = buildEnterpriseComplianceReport(state, {
      projectName: "P",
      generatedAt: "now",
    });
    expect(report.markdown).not.toContain("Active document");
    expect(report.markdown).toContain("- Legal hold: enabled");
    expect(report.riskItems).toEqual(
      expect.arrayContaining([
        "SCIM provisioning is disabled.",
        "Backups are disabled.",
      ]),
    );

    expect(
      normalizeEnterpriseState({
        schemaVersion: 1,
        identity: { scim: { status: "disabled" } },
      }).identity.scim.status,
    ).toBe("disabled");
  });

  it("flags storage pressure and reports when nothing is at risk", () => {
    const risky = {
      ...base,
      admin: { ...base.admin, storage: { ...base.admin.storage, usedGb: 9_999 } },
    };
    expect(enterpriseStoragePercent(risky)).toBe(100);
    expect(enterpriseRiskItems(risky)).toContain(
      "Storage usage is above 85% of quota.",
    );
    const unenforced = {
      ...base,
      admin: {
        ...base.admin,
        securityPolicies: [
          {
            id: "sso",
            name: "Require SSO",
            enabled: false,
            severity: "required" as const,
          },
        ],
      },
    };
    expect(enterpriseRiskItems(unenforced)).toContain(
      "Required security policy disabled: Require SSO.",
    );

    const safe = {
      ...base,
      identity: {
        ...base.identity,
        providers: base.identity.providers.map((provider) => ({
          ...provider,
          status: "enforced" as const,
        })),
      },
      bibliographies: base.bibliographies.map((library) => ({
        ...library,
        verificationStatus: "verified" as const,
      })),
      admin: {
        ...base.admin,
        securityPolicies: base.admin.securityPolicies.map((policy) => ({
          ...policy,
          enabled: true,
        })),
      },
    };
    expect(enterpriseRiskItems(safe)).toEqual([]);
    expect(
      buildEnterpriseComplianceReport(safe, { projectName: "P" }).markdown,
    ).toContain("- No high-priority risks detected.");
  });

  it("ignores corrupt or unavailable storage", () => {
    window.localStorage.setItem(enterpriseStorageKey, "{oops");
    expect(loadEnterpriseState()).toBe(base);
    window.localStorage.removeItem(enterpriseStorageKey);
    expect(loadEnterpriseState()).toBe(base);

    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage")!;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("denied");
      },
    });
    try {
      expect(loadEnterpriseState()).toBe(base);
      expect(() => saveEnterpriseState(base)).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, "localStorage", descriptor);
    }

    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: undefined,
    });
    try {
      expect(loadEnterpriseState()).toBe(base);
    } finally {
      Object.defineProperty(globalThis, "localStorage", descriptor);
    }
  });

  it("finds no mentions in plain text", () => {
    expect(extractMentions("no mentions here")).toEqual([]);
  });
});
