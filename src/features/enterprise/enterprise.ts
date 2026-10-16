export const enterpriseStorageKey = "latexdo.enterprise.state.v1";

export type EnterpriseRole =
  | "owner"
  | "admin"
  | "publisher"
  | "reviewer"
  | "author"
  | "viewer";

export type IdentityProviderId = "google-workspace" | "microsoft-entra" | "okta";
export type ProviderStatus = "not-configured" | "configured" | "enforced";
export type WorkflowStatus = "draft" | "in-review" | "approved" | "rejected";
export type TaskStatus = "todo" | "doing" | "blocked" | "done";
export type LockScope = "document" | "section" | "asset";
export type ReportStatus = "ready" | "scheduled" | "running" | "failed";

export interface EnterpriseWorkspace {
  id: string;
  name: string;
  owner: string;
  visibility: "team" | "organization" | "restricted";
  memberCount: number;
  storageGb: number;
  templateIds: string[];
  bibliographyId: string;
  assetLibraryId: string;
}

export interface EnterpriseTemplate {
  id: string;
  name: string;
  category: "proposal" | "report" | "policy" | "journal" | "letter";
  ownerTeam: string;
  requiredApprovals: EnterpriseRole[];
  lastUpdated: string;
}

export interface EnterpriseBibliography {
  id: string;
  name: string;
  source: "bibtex" | "zotero" | "doi-registry" | "manual";
  entries: number;
  duplicateWarnings: number;
  verificationStatus: "verified" | "warnings" | "needs-review";
}

export interface EnterpriseAssetLibrary {
  id: string;
  name: string;
  assets: number;
  storageGb: number;
  allowedTypes: string[];
  reviewed: boolean;
}

export interface RolePolicy {
  role: EnterpriseRole;
  canCreateWorkspace: boolean;
  canApprove: boolean;
  canPublish: boolean;
  canManageBranding: boolean;
  canManageUsers: boolean;
}

export interface IdentityProvider {
  id: IdentityProviderId;
  label: string;
  status: ProviderStatus;
  domainHint: string;
  enforcedGroups: string[];
}

export interface ScimProvisioning {
  enabled: boolean;
  baseUrl: string;
  tokenRotationDays: number;
  lastSync: string;
  status: "healthy" | "warning" | "disabled";
}

export interface ReviewWorkflow {
  id: string;
  name: string;
  status: WorkflowStatus;
  currentStage: string;
  approvers: string[];
  dueDate: string;
}

export interface ApprovalRequest {
  id: string;
  title: string;
  documentPath: string;
  requester: string;
  approver: string;
  status: "pending" | "approved" | "changes-requested";
  requestedAt: string;
}

export interface DocumentLock {
  id: string;
  path: string;
  scope: LockScope;
  owner: string;
  reason: string;
  expiresAt: string;
}

export interface EnterpriseTask {
  id: string;
  title: string;
  assignee: string;
  documentPath: string;
  status: TaskStatus;
  dueDate: string;
}

export interface EnterpriseComment {
  id: string;
  documentPath: string;
  author: string;
  text: string;
  mentions: string[];
  resolved: boolean;
  createdAt: string;
}

export interface VersionComparison {
  id: string;
  documentPath: string;
  fromVersion: string;
  toVersion: string;
  changedSections: number;
  reviewer: string;
  auditedAt: string;
}

export interface AuditEvent {
  id: string;
  actor: string;
  action: string;
  target: string;
  createdAt: string;
}

export interface UsageAnalytics {
  activeUsers: number;
  documentsEdited: number;
  reviewsCompleted: number;
  aiRequests: number;
  publishedDocuments: number;
}

export interface StorageManagement {
  quotaGb: number;
  usedGb: number;
  largestWorkspaceId: string;
  archiveAfterDays: number;
}

export interface SecurityPolicy {
  id: string;
  name: string;
  enabled: boolean;
  severity: "required" | "recommended";
}

export interface BackupRetention {
  backupEnabled: boolean;
  retentionDays: number;
  legalHoldEnabled: boolean;
  lastBackup: string;
}

export interface ComplianceReportConfig {
  id: string;
  name: string;
  status: ReportStatus;
  scope: string;
  lastGenerated: string;
}

export interface PrivateAiModel {
  id: string;
  name: string;
  status: "training" | "ready" | "disabled";
  trainedOn: string[];
  lastEvaluated: string;
}

export interface KnowledgeSource {
  id: string;
  name: string;
  type: "wiki" | "drive" | "sharepoint" | "repository";
  indexedDocuments: number;
  access: "all-employees" | "restricted";
}

export interface StyleGuide {
  id: string;
  name: string;
  rules: number;
  enforced: boolean;
}

export interface BusinessAiCheck {
  id: string;
  name: string;
  enabled: boolean;
  category: "compliance" | "citation-verification" | "style" | "technical-writing";
}

export interface WritingAssistant {
  id: string;
  name: string;
  purpose: string;
  enabled: boolean;
}

export interface CompanyTemplate {
  id: string;
  name: string;
  output: "pdf" | "latex" | "docx" | "html";
  ownerTeam: string;
}

export interface JournalWorkflow {
  id: string;
  journal: string;
  status: "preflight" | "submission-ready" | "submitted" | "accepted";
  requiredChecks: string[];
}

export interface ExportTarget {
  id: string;
  name: string;
  type: "sharepoint" | "google-drive" | "box" | "s3" | "webhook";
  status: ProviderStatus;
}

export interface ReportJob {
  id: string;
  name: string;
  schedule: string;
  status: ReportStatus;
  lastRun: string;
}

export interface DoiRecord {
  id: string;
  title: string;
  doi: string;
  status: "draft" | "registered" | "published";
  publicationDate: string;
}

export interface EnterpriseState {
  schemaVersion: 1;
  organization: {
    name: string;
    domain: string;
    brandColor: string;
    logoAssetPath: string;
    defaultWorkspaceId: string;
  };
  workspaces: EnterpriseWorkspace[];
  templates: EnterpriseTemplate[];
  bibliographies: EnterpriseBibliography[];
  assetLibraries: EnterpriseAssetLibrary[];
  rolePolicies: RolePolicy[];
  identity: {
    providers: IdentityProvider[];
    scim: ScimProvisioning;
  };
  collaboration: {
    reviewWorkflows: ReviewWorkflow[];
    approvalRequests: ApprovalRequest[];
    documentLocks: DocumentLock[];
    tasks: EnterpriseTask[];
    comments: EnterpriseComment[];
    versionComparisons: VersionComparison[];
    auditTrail: AuditEvent[];
  };
  admin: {
    usage: UsageAnalytics;
    storage: StorageManagement;
    securityPolicies: SecurityPolicy[];
    backupRetention: BackupRetention;
    complianceReports: ComplianceReportConfig[];
  };
  aiBusiness: {
    privateModels: PrivateAiModel[];
    knowledgeSources: KnowledgeSource[];
    styleGuides: StyleGuide[];
    checks: BusinessAiCheck[];
    writingAssistants: WritingAssistant[];
  };
  publishing: {
    companyTemplates: CompanyTemplate[];
    journalWorkflows: JournalWorkflow[];
    exportTargets: ExportTarget[];
    reportJobs: ReportJob[];
    doiRecords: DoiRecord[];
  };
}

export interface EnterpriseSummary {
  workspaceCount: number;
  templateCount: number;
  managedReferences: number;
  assetCount: number;
  pendingApprovals: number;
  openTasks: number;
  activeLocks: number;
  unresolvedMentions: number;
  enabledSecurityPolicies: number;
  readyAiModels: number;
  activeExportTargets: number;
}

export interface EnterpriseReportContext {
  projectName: string;
  activeDocumentPath?: string;
  generatedAt?: string;
}

export interface EnterpriseComplianceReport {
  title: string;
  generatedAt: string;
  markdown: string;
  riskItems: string[];
}

const defaultTimestamp = "2026-07-24T00:00:00.000Z";

export const defaultEnterpriseState: EnterpriseState = {
  schemaVersion: 1,
  organization: {
    name: "Acme Research Group",
    domain: "company.example",
    brandColor: "#2f6fdb",
    logoAssetPath: "brand/logo.svg",
    defaultWorkspaceId: "workspace-client-deliverables",
  },
  workspaces: [
    {
      id: "workspace-client-deliverables",
      name: "Client Deliverables",
      owner: "Operations",
      visibility: "organization",
      memberCount: 42,
      storageGb: 18,
      templateIds: ["proposal-master", "board-report"],
      bibliographyId: "global-references",
      assetLibraryId: "brand-assets",
    },
    {
      id: "workspace-regulated-reports",
      name: "Regulated Reports",
      owner: "Compliance",
      visibility: "restricted",
      memberCount: 14,
      storageGb: 9,
      templateIds: ["policy-control"],
      bibliographyId: "verified-citations",
      assetLibraryId: "approved-figures",
    },
  ],
  templates: [
    {
      id: "proposal-master",
      name: "Client Proposal",
      category: "proposal",
      ownerTeam: "Sales Engineering",
      requiredApprovals: ["reviewer", "publisher"],
      lastUpdated: "2026-07-18",
    },
    {
      id: "board-report",
      name: "Board Report",
      category: "report",
      ownerTeam: "Executive Office",
      requiredApprovals: ["admin", "publisher"],
      lastUpdated: "2026-07-20",
    },
    {
      id: "policy-control",
      name: "Controlled Policy",
      category: "policy",
      ownerTeam: "Compliance",
      requiredApprovals: ["admin"],
      lastUpdated: "2026-07-22",
    },
  ],
  bibliographies: [
    {
      id: "global-references",
      name: "Company References",
      source: "bibtex",
      entries: 1280,
      duplicateWarnings: 4,
      verificationStatus: "warnings",
    },
    {
      id: "verified-citations",
      name: "Verified Regulatory Citations",
      source: "doi-registry",
      entries: 412,
      duplicateWarnings: 0,
      verificationStatus: "verified",
    },
  ],
  assetLibraries: [
    {
      id: "brand-assets",
      name: "Brand Assets",
      assets: 96,
      storageGb: 3.8,
      allowedTypes: ["svg", "png", "pdf"],
      reviewed: true,
    },
    {
      id: "approved-figures",
      name: "Approved Figures",
      assets: 54,
      storageGb: 2.1,
      allowedTypes: ["pdf", "png"],
      reviewed: true,
    },
  ],
  rolePolicies: [
    {
      role: "owner",
      canCreateWorkspace: true,
      canApprove: true,
      canPublish: true,
      canManageBranding: true,
      canManageUsers: true,
    },
    {
      role: "admin",
      canCreateWorkspace: true,
      canApprove: true,
      canPublish: true,
      canManageBranding: true,
      canManageUsers: true,
    },
    {
      role: "publisher",
      canCreateWorkspace: false,
      canApprove: true,
      canPublish: true,
      canManageBranding: false,
      canManageUsers: false,
    },
    {
      role: "reviewer",
      canCreateWorkspace: false,
      canApprove: true,
      canPublish: false,
      canManageBranding: false,
      canManageUsers: false,
    },
    {
      role: "author",
      canCreateWorkspace: false,
      canApprove: false,
      canPublish: false,
      canManageBranding: false,
      canManageUsers: false,
    },
    {
      role: "viewer",
      canCreateWorkspace: false,
      canApprove: false,
      canPublish: false,
      canManageBranding: false,
      canManageUsers: false,
    },
  ],
  identity: {
    providers: [
      {
        id: "google-workspace",
        label: "Google Workspace",
        status: "configured",
        domainHint: "company.example",
        enforcedGroups: ["latexdo-authors", "latexdo-reviewers"],
      },
      {
        id: "microsoft-entra",
        label: "Microsoft Entra",
        status: "not-configured",
        domainHint: "",
        enforcedGroups: [],
      },
      {
        id: "okta",
        label: "Okta",
        status: "not-configured",
        domainHint: "",
        enforcedGroups: [],
      },
    ],
    scim: {
      enabled: true,
      baseUrl: "",
      tokenRotationDays: 90,
      lastSync: "2026-07-24T08:00:00.000Z",
      status: "healthy",
    },
  },
  collaboration: {
    reviewWorkflows: [
      {
        id: "workflow-technical-brief",
        name: "Technical Brief Review",
        status: "in-review",
        currentStage: "Legal and security",
        approvers: ["legal@company.example", "security@company.example"],
        dueDate: "2026-07-31",
      },
    ],
    approvalRequests: [
      {
        id: "approval-release-notes",
        title: "Approve release notes",
        documentPath: "reports/release-notes.tex",
        requester: "author@company.example",
        approver: "publisher@company.example",
        status: "pending",
        requestedAt: "2026-07-23T15:30:00.000Z",
      },
    ],
    documentLocks: [
      {
        id: "lock-board-pack",
        path: "board/main.tex",
        scope: "document",
        owner: "cfo@company.example",
        reason: "Final financial review",
        expiresAt: "2026-07-25T18:00:00.000Z",
      },
    ],
    tasks: [
      {
        id: "task-citation-audit",
        title: "Verify high-risk citations",
        assignee: "reviewer@company.example",
        documentPath: "reports/main.tex",
        status: "doing",
        dueDate: "2026-07-29",
      },
      {
        id: "task-style-pass",
        title: "Apply company style guide",
        assignee: "author@company.example",
        documentPath: "reports/main.tex",
        status: "todo",
        dueDate: "2026-07-28",
      },
    ],
    comments: [
      {
        id: "comment-risk",
        documentPath: "reports/main.tex",
        author: "reviewer@company.example",
        text: "@author please clarify the compliance exception.",
        mentions: ["author"],
        resolved: false,
        createdAt: "2026-07-23T12:00:00.000Z",
      },
    ],
    versionComparisons: [
      {
        id: "comparison-v12-v13",
        documentPath: "reports/main.tex",
        fromVersion: "v1.2",
        toVersion: "v1.3",
        changedSections: 6,
        reviewer: "publisher@company.example",
        auditedAt: "2026-07-23T09:45:00.000Z",
      },
    ],
    auditTrail: [
      {
        id: "audit-initial",
        actor: "system",
        action: "Enterprise policy initialized",
        target: "organization",
        createdAt: defaultTimestamp,
      },
    ],
  },
  admin: {
    usage: {
      activeUsers: 58,
      documentsEdited: 342,
      reviewsCompleted: 47,
      aiRequests: 2180,
      publishedDocuments: 19,
    },
    storage: {
      quotaGb: 250,
      usedGb: 86,
      largestWorkspaceId: "workspace-client-deliverables",
      archiveAfterDays: 365,
    },
    securityPolicies: [
      {
        id: "sso-required",
        name: "Require SSO for all users",
        enabled: true,
        severity: "required",
      },
      {
        id: "external-share-review",
        name: "Require approval before external sharing",
        enabled: true,
        severity: "required",
      },
      {
        id: "watermark-confidential",
        name: "Watermark confidential exports",
        enabled: true,
        severity: "recommended",
      },
      {
        id: "ai-data-boundary",
        name: "Restrict AI to company knowledge sources",
        enabled: true,
        severity: "required",
      },
    ],
    backupRetention: {
      backupEnabled: true,
      retentionDays: 2555,
      legalHoldEnabled: false,
      lastBackup: "2026-07-24T06:00:00.000Z",
    },
    complianceReports: [
      {
        id: "soc2-export",
        name: "SOC 2 Evidence Pack",
        status: "ready",
        scope: "Access, backup, review workflow, AI boundaries",
        lastGenerated: "2026-07-24T06:30:00.000Z",
      },
      {
        id: "publishing-audit",
        name: "Publishing Audit",
        status: "scheduled",
        scope: "Journal submissions, DOI records, export targets",
        lastGenerated: "2026-07-22T10:00:00.000Z",
      },
    ],
  },
  aiBusiness: {
    privateModels: [
      {
        id: "company-style-model",
        name: "Company Style Model",
        status: "ready",
        trainedOn: ["Client proposals", "Board reports", "Technical briefs"],
        lastEvaluated: "2026-07-21",
      },
    ],
    knowledgeSources: [
      {
        id: "internal-wiki",
        name: "Internal Knowledge Base",
        type: "wiki",
        indexedDocuments: 4200,
        access: "all-employees",
      },
      {
        id: "regulated-drive",
        name: "Regulated Document Library",
        type: "sharepoint",
        indexedDocuments: 740,
        access: "restricted",
      },
    ],
    styleGuides: [
      {
        id: "executive-style",
        name: "Executive Writing Guide",
        rules: 36,
        enforced: true,
      },
      {
        id: "technical-style",
        name: "Technical Report Guide",
        rules: 54,
        enforced: true,
      },
    ],
    checks: [
      {
        id: "compliance-language",
        name: "Automatic compliance checking",
        enabled: true,
        category: "compliance",
      },
      {
        id: "citation-verification",
        name: "Citation verification",
        enabled: true,
        category: "citation-verification",
      },
      {
        id: "style-guide-check",
        name: "Style guide enforcement",
        enabled: true,
        category: "style",
      },
      {
        id: "technical-writing",
        name: "Technical writing assistant",
        enabled: true,
        category: "technical-writing",
      },
    ],
    writingAssistants: [
      {
        id: "proposal-assistant",
        name: "Proposal Assistant",
        purpose: "Turns engineering notes into client-ready proposal sections.",
        enabled: true,
      },
      {
        id: "compliance-assistant",
        name: "Compliance Assistant",
        purpose: "Flags unsupported claims and missing required language.",
        enabled: true,
      },
    ],
  },
  publishing: {
    companyTemplates: [
      {
        id: "branded-report",
        name: "Branded Report",
        output: "pdf",
        ownerTeam: "Brand",
      },
      {
        id: "internal-policy",
        name: "Internal Policy",
        output: "html",
        ownerTeam: "Compliance",
      },
    ],
    journalWorkflows: [
      {
        id: "nature-methods",
        journal: "Nature Methods",
        status: "preflight",
        requiredChecks: ["Citation verification", "Figure resolution", "COI statement"],
      },
      {
        id: "ieee-transactions",
        journal: "IEEE Transactions",
        status: "submission-ready",
        requiredChecks: ["IEEE bibliography style", "PDF compliance"],
      },
    ],
    exportTargets: [
      {
        id: "sharepoint-records",
        name: "SharePoint Records",
        type: "sharepoint",
        status: "configured",
      },
      {
        id: "document-webhook",
        name: "Document System Webhook",
        type: "webhook",
        status: "not-configured",
      },
    ],
    reportJobs: [
      {
        id: "weekly-program-report",
        name: "Weekly Program Report",
        schedule: "Every Monday 08:00",
        status: "scheduled",
        lastRun: "2026-07-20T08:00:00.000Z",
      },
    ],
    doiRecords: [
      {
        id: "doi-model-card",
        title: "Model Card for Internal Classifier",
        doi: "10.0000/company.model-card",
        status: "draft",
        publicationDate: "",
      },
    ],
  },
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function arrayValue<T>(
  value: unknown,
  fallback: T[],
  normalize: (value: unknown, fallback: T) => T,
): T[] {
  if (!Array.isArray(value)) return fallback;
  return value.map((item, index) =>
    normalize(item, fallback[Math.min(index, Math.max(0, fallback.length - 1))]),
  );
}

export function extractMentions(text: string): string[] {
  return [...new Set((text.match(/@[a-zA-Z0-9._-]+/g) ?? []).map((m) => m.slice(1)))];
}

export function createAuditEvent(
  actor: string,
  action: string,
  target: string,
): AuditEvent {
  return {
    id: `audit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    actor,
    action,
    target,
    createdAt: new Date().toISOString(),
  };
}

export function appendAuditEvent(
  state: EnterpriseState,
  actor: string,
  action: string,
  target: string,
): EnterpriseState {
  return {
    ...state,
    collaboration: {
      ...state.collaboration,
      auditTrail: [
        createAuditEvent(actor, action, target),
        ...state.collaboration.auditTrail,
      ].slice(0, 50),
    },
  };
}

function normalizeOrganization(value: unknown): EnterpriseState["organization"] {
  const fallback = defaultEnterpriseState.organization;
  if (!isObject(value)) return fallback;
  return {
    name: stringValue(value.name, fallback.name),
    domain: stringValue(value.domain, fallback.domain),
    brandColor: stringValue(value.brandColor, fallback.brandColor),
    logoAssetPath: stringValue(value.logoAssetPath, fallback.logoAssetPath),
    defaultWorkspaceId: stringValue(
      value.defaultWorkspaceId,
      fallback.defaultWorkspaceId,
    ),
  };
}

function normalizeIdentityProvider(
  value: unknown,
  fallback: IdentityProvider,
): IdentityProvider {
  if (!isObject(value)) return fallback;
  return {
    id: fallback.id,
    label: fallback.label,
    status:
      value.status === "configured" || value.status === "enforced"
        ? value.status
        : value.status === "not-configured"
          ? "not-configured"
          : fallback.status,
    domainHint: stringValue(value.domainHint, fallback.domainHint),
    enforcedGroups: Array.isArray(value.enforcedGroups)
      ? value.enforcedGroups.filter((item): item is string => typeof item === "string")
      : fallback.enforcedGroups,
  };
}

function normalizeSecurityPolicy(
  value: unknown,
  fallback: SecurityPolicy,
): SecurityPolicy {
  if (!isObject(value)) return fallback;
  return {
    id: stringValue(value.id, fallback.id),
    name: stringValue(value.name, fallback.name),
    enabled: booleanValue(value.enabled, fallback.enabled),
    severity: value.severity === "recommended" ? "recommended" : fallback.severity,
  };
}

function normalizeReportJob(value: unknown, fallback: ReportJob): ReportJob {
  if (!isObject(value)) return fallback;
  return {
    id: stringValue(value.id, fallback.id),
    name: stringValue(value.name, fallback.name),
    schedule: stringValue(value.schedule, fallback.schedule),
    status:
      value.status === "ready" ||
      value.status === "running" ||
      value.status === "failed"
        ? value.status
        : value.status === "scheduled"
          ? "scheduled"
          : fallback.status,
    lastRun: stringValue(value.lastRun, fallback.lastRun),
  };
}

export function normalizeEnterpriseState(value: unknown): EnterpriseState {
  if (!isObject(value) || value.schemaVersion !== 1) {
    return defaultEnterpriseState;
  }

  const fallback = defaultEnterpriseState;
  const identity = isObject(value.identity) ? value.identity : {};
  const admin = isObject(value.admin) ? value.admin : {};
  const storage = isObject(admin.storage) ? admin.storage : {};
  const backupRetention = isObject(admin.backupRetention) ? admin.backupRetention : {};
  const publishing = isObject(value.publishing) ? value.publishing : {};

  return {
    ...fallback,
    organization: normalizeOrganization(value.organization),
    workspaces: Array.isArray(value.workspaces)
      ? (value.workspaces as EnterpriseWorkspace[])
      : fallback.workspaces,
    templates: Array.isArray(value.templates)
      ? (value.templates as EnterpriseTemplate[])
      : fallback.templates,
    bibliographies: Array.isArray(value.bibliographies)
      ? (value.bibliographies as EnterpriseBibliography[])
      : fallback.bibliographies,
    assetLibraries: Array.isArray(value.assetLibraries)
      ? (value.assetLibraries as EnterpriseAssetLibrary[])
      : fallback.assetLibraries,
    rolePolicies: Array.isArray(value.rolePolicies)
      ? (value.rolePolicies as RolePolicy[])
      : fallback.rolePolicies,
    identity: {
      providers: arrayValue(
        identity.providers,
        fallback.identity.providers,
        normalizeIdentityProvider,
      ),
      scim: {
        enabled: booleanValue(
          isObject(identity.scim) ? identity.scim.enabled : undefined,
          fallback.identity.scim.enabled,
        ),
        baseUrl: stringValue(
          isObject(identity.scim) ? identity.scim.baseUrl : undefined,
          fallback.identity.scim.baseUrl,
        ),
        tokenRotationDays: numberValue(
          isObject(identity.scim) ? identity.scim.tokenRotationDays : undefined,
          fallback.identity.scim.tokenRotationDays,
        ),
        lastSync: stringValue(
          isObject(identity.scim) ? identity.scim.lastSync : undefined,
          fallback.identity.scim.lastSync,
        ),
        status:
          isObject(identity.scim) && identity.scim.status === "warning"
            ? "warning"
            : isObject(identity.scim) && identity.scim.status === "disabled"
              ? "disabled"
              : fallback.identity.scim.status,
      },
    },
    collaboration: isObject(value.collaboration)
      ? {
          ...fallback.collaboration,
          ...value.collaboration,
        }
      : fallback.collaboration,
    admin: {
      usage: isObject(admin.usage)
        ? { ...fallback.admin.usage, ...admin.usage }
        : fallback.admin.usage,
      storage: {
        quotaGb: numberValue(storage.quotaGb, fallback.admin.storage.quotaGb),
        usedGb: numberValue(storage.usedGb, fallback.admin.storage.usedGb),
        largestWorkspaceId: stringValue(
          storage.largestWorkspaceId,
          fallback.admin.storage.largestWorkspaceId,
        ),
        archiveAfterDays: numberValue(
          storage.archiveAfterDays,
          fallback.admin.storage.archiveAfterDays,
        ),
      },
      securityPolicies: arrayValue(
        admin.securityPolicies,
        fallback.admin.securityPolicies,
        normalizeSecurityPolicy,
      ),
      backupRetention: {
        backupEnabled: booleanValue(
          backupRetention.backupEnabled,
          fallback.admin.backupRetention.backupEnabled,
        ),
        retentionDays: numberValue(
          backupRetention.retentionDays,
          fallback.admin.backupRetention.retentionDays,
        ),
        legalHoldEnabled: booleanValue(
          backupRetention.legalHoldEnabled,
          fallback.admin.backupRetention.legalHoldEnabled,
        ),
        lastBackup: stringValue(
          backupRetention.lastBackup,
          fallback.admin.backupRetention.lastBackup,
        ),
      },
      complianceReports: Array.isArray(admin.complianceReports)
        ? (admin.complianceReports as ComplianceReportConfig[])
        : fallback.admin.complianceReports,
    },
    aiBusiness: isObject(value.aiBusiness)
      ? {
          ...fallback.aiBusiness,
          ...value.aiBusiness,
        }
      : fallback.aiBusiness,
    publishing: {
      ...fallback.publishing,
      ...(isObject(value.publishing) ? value.publishing : {}),
      reportJobs: arrayValue(
        publishing.reportJobs,
        fallback.publishing.reportJobs,
        normalizeReportJob,
      ),
    },
  };
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadEnterpriseState(): EnterpriseState {
  const store = storage();
  if (!store) return defaultEnterpriseState;
  try {
    return normalizeEnterpriseState(
      JSON.parse(store.getItem(enterpriseStorageKey) ?? "null"),
    );
  } catch {
    return defaultEnterpriseState;
  }
}

export function saveEnterpriseState(state: EnterpriseState): void {
  storage()?.setItem(enterpriseStorageKey, JSON.stringify(state));
}

export function enterpriseStoragePercent(state: EnterpriseState): number {
  if (state.admin.storage.quotaGb <= 0) return 0;
  return Math.min(
    100,
    Math.round((state.admin.storage.usedGb / state.admin.storage.quotaGb) * 100),
  );
}

export function enterpriseSummary(state: EnterpriseState): EnterpriseSummary {
  return {
    workspaceCount: state.workspaces.length,
    templateCount: state.templates.length + state.publishing.companyTemplates.length,
    managedReferences: state.bibliographies.reduce(
      (total, library) => total + library.entries,
      0,
    ),
    assetCount: state.assetLibraries.reduce(
      (total, library) => total + library.assets,
      0,
    ),
    pendingApprovals: state.collaboration.approvalRequests.filter(
      (request) => request.status === "pending",
    ).length,
    openTasks: state.collaboration.tasks.filter((task) => task.status !== "done")
      .length,
    activeLocks: state.collaboration.documentLocks.length,
    unresolvedMentions: state.collaboration.comments.filter(
      (comment) => !comment.resolved && comment.mentions.length > 0,
    ).length,
    enabledSecurityPolicies: state.admin.securityPolicies.filter(
      (policy) => policy.enabled,
    ).length,
    readyAiModels: state.aiBusiness.privateModels.filter(
      (model) => model.status === "ready",
    ).length,
    activeExportTargets: state.publishing.exportTargets.filter(
      (target) => target.status !== "not-configured",
    ).length,
  };
}

export function enterpriseRiskItems(state: EnterpriseState): string[] {
  const risks: string[] = [];
  if (!state.identity.providers.some((provider) => provider.status === "enforced")) {
    risks.push("SSO is configured but not enforced for every identity provider.");
  }
  if (!state.identity.scim.enabled) {
    risks.push("SCIM provisioning is disabled.");
  }
  for (const policy of state.admin.securityPolicies) {
    if (policy.severity === "required" && !policy.enabled) {
      risks.push(`Required security policy disabled: ${policy.name}.`);
    }
  }
  for (const bibliography of state.bibliographies) {
    if (bibliography.verificationStatus !== "verified") {
      risks.push(`${bibliography.name} has citation verification warnings.`);
    }
  }
  if (enterpriseStoragePercent(state) >= 85) {
    risks.push("Storage usage is above 85% of quota.");
  }
  if (!state.admin.backupRetention.backupEnabled) {
    risks.push("Backups are disabled.");
  }
  return risks;
}

export function buildEnterpriseComplianceReport(
  state: EnterpriseState,
  context: EnterpriseReportContext,
): EnterpriseComplianceReport {
  const generatedAt = context.generatedAt ?? new Date().toISOString();
  const summary = enterpriseSummary(state);
  const risks = enterpriseRiskItems(state);
  const lines = [
    `# ${state.organization.name} Compliance Report`,
    "",
    `Generated: ${generatedAt}`,
    `Project: ${context.projectName}`,
    context.activeDocumentPath ? `Active document: ${context.activeDocumentPath}` : "",
    "",
    "## Organization",
    `- Domain: ${state.organization.domain}`,
    `- Workspaces: ${summary.workspaceCount}`,
    `- Team templates: ${summary.templateCount}`,
    `- Managed bibliography entries: ${summary.managedReferences}`,
    `- Shared assets: ${summary.assetCount}`,
    "",
    "## Identity and Access",
    `- Enforced SSO providers: ${state.identity.providers.filter((p) => p.status === "enforced").length}`,
    `- Configured SSO providers: ${state.identity.providers.filter((p) => p.status !== "not-configured").length}`,
    `- SCIM provisioning: ${state.identity.scim.enabled ? "enabled" : "disabled"}`,
    `- SCIM status: ${state.identity.scim.status}`,
    "",
    "## Collaboration Controls",
    `- Pending approvals: ${summary.pendingApprovals}`,
    `- Open tasks: ${summary.openTasks}`,
    `- Active locks: ${summary.activeLocks}`,
    `- Unresolved mentions: ${summary.unresolvedMentions}`,
    `- Audit events retained: ${state.collaboration.auditTrail.length}`,
    "",
    "## Administration",
    `- Active users: ${state.admin.usage.activeUsers}`,
    `- Documents edited: ${state.admin.usage.documentsEdited}`,
    `- Storage: ${state.admin.storage.usedGb} GB of ${state.admin.storage.quotaGb} GB (${enterpriseStoragePercent(state)}%)`,
    `- Backup retention: ${state.admin.backupRetention.retentionDays} days`,
    `- Legal hold: ${state.admin.backupRetention.legalHoldEnabled ? "enabled" : "disabled"}`,
    "",
    "## Business AI",
    `- Ready private models: ${summary.readyAiModels}`,
    `- Knowledge sources: ${state.aiBusiness.knowledgeSources.length}`,
    `- Enforced style guides: ${state.aiBusiness.styleGuides.filter((guide) => guide.enforced).length}`,
    `- Enabled AI checks: ${state.aiBusiness.checks.filter((check) => check.enabled).length}`,
    "",
    "## Publishing",
    `- Journal workflows: ${state.publishing.journalWorkflows.length}`,
    `- Active export targets: ${summary.activeExportTargets}`,
    `- Report jobs: ${state.publishing.reportJobs.length}`,
    `- DOI records: ${state.publishing.doiRecords.length}`,
    "",
    "## Risk Items",
    ...(risks.length
      ? risks.map((risk) => `- ${risk}`)
      : ["- No high-priority risks detected."]),
    "",
  ].filter((line) => line !== "");

  return {
    title: `${state.organization.name} Compliance Report`,
    generatedAt,
    markdown: `${lines.join("\n")}\n`,
    riskItems: risks,
  };
}
