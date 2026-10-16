import React from "react";
import {
  ArchiveRestore,
  BadgeCheck,
  BookMarked,
  BrainCircuit,
  BriefcaseBusiness,
  Building2,
  ChartNoAxesColumn,
  CheckCircle2,
  ClipboardCheck,
  Database,
  FileCheck2,
  FileOutput,
  HardDrive,
  Images,
  KeyRound,
  Library,
  LockKeyhole,
  MessageSquare,
  RefreshCw,
  SearchCheck,
  ShieldCheck,
  UserCog,
  Users,
  Workflow,
} from "lucide-react";
import {
  appendAuditEvent,
  buildEnterpriseComplianceReport,
  enterpriseStoragePercent,
  enterpriseSummary,
  extractMentions,
  type ApprovalRequest,
  type BusinessAiCheck,
  type DocumentLock,
  type EnterpriseComment,
  type EnterpriseState,
  type EnterpriseTask,
  type ExportTarget,
  type IdentityProvider,
  type ReportJob,
  type SecurityPolicy,
  type WorkflowStatus,
} from "../features/enterprise/enterprise";
import { pathForDisplay } from "../pathDisplay";

type EnterpriseSection =
  | "organization"
  | "collaboration"
  | "administration"
  | "ai"
  | "publishing";

interface EnterpriseDashboardProps {
  state: EnterpriseState;
  projectName: string;
  activeDocumentPath?: string;
  onChange: (state: EnterpriseState) => void;
  onExportReport: () => void;
  onStatusMessage?: (message: string) => void;
}

const sections: {
  id: EnterpriseSection;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
}[] = [
  { id: "organization", label: "Team", icon: Building2 },
  { id: "collaboration", label: "Review", icon: Workflow },
  { id: "administration", label: "Admin", icon: ShieldCheck },
  { id: "ai", label: "AI", icon: BrainCircuit },
  { id: "publishing", label: "Publish", icon: FileOutput },
];

function cycleProviderStatus(
  status: IdentityProvider["status"],
): IdentityProvider["status"] {
  if (status === "not-configured") return "configured";
  if (status === "configured") return "enforced";
  return "not-configured";
}

function nextWorkflowStatus(status: WorkflowStatus): WorkflowStatus {
  if (status === "draft") return "in-review";
  if (status === "in-review") return "approved";
  if (status === "approved") return "rejected";
  return "draft";
}

function statusLabel(value: string): string {
  return value
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function metric(label: string, value: string | number, icon: React.ReactNode) {
  return (
    <div className="enterprise-metric">
      <span>{icon}</span>
      <strong>{value}</strong>
      <small>{label}</small>
    </div>
  );
}

export function EnterpriseDashboard({
  state,
  projectName,
  activeDocumentPath,
  onChange,
  onExportReport,
  onStatusMessage,
}: EnterpriseDashboardProps) {
  const [section, setSection] = React.useState<EnterpriseSection>("organization");
  const [taskDraft, setTaskDraft] = React.useState("Review executive summary");
  const [commentDraft, setCommentDraft] = React.useState(
    "@reviewer please check the claims in this section.",
  );
  const summary = enterpriseSummary(state);
  const storagePercent = enterpriseStoragePercent(state);
  const activeDocumentLabel = activeDocumentPath
    ? pathForDisplay(activeDocumentPath)
    : "No active document";
  const compliancePreview = React.useMemo(
    () =>
      buildEnterpriseComplianceReport(state, {
        projectName,
        activeDocumentPath,
      }),
    [activeDocumentPath, projectName, state],
  );

  const commit = React.useCallback(
    (nextState: EnterpriseState, message?: string) => {
      onChange(nextState);
      if (message) onStatusMessage?.(message);
    },
    [onChange, onStatusMessage],
  );

  const audit = React.useCallback(
    (nextState: EnterpriseState, action: string, target: string) =>
      appendAuditEvent(nextState, "admin@company.example", action, target),
    [],
  );

  const updateOrganization = (
    key: keyof EnterpriseState["organization"],
    value: string,
  ) => {
    commit(
      audit(
        {
          ...state,
          organization: { ...state.organization, [key]: value },
        },
        "Updated organization setting",
        key,
      ),
      "Organization settings updated",
    );
  };

  const updateProvider = (providerId: IdentityProvider["id"]) => {
    const provider = state.identity.providers.find((item) => item.id === providerId);
    commit(
      audit(
        {
          ...state,
          identity: {
            ...state.identity,
            providers: state.identity.providers.map((item) =>
              item.id === providerId
                ? { ...item, status: cycleProviderStatus(item.status) }
                : item,
            ),
          },
        },
        "Updated SSO provider",
        provider?.label ?? providerId,
      ),
      `${provider?.label ?? "SSO"} status updated`,
    );
  };

  const toggleScim = () => {
    const enabled = !state.identity.scim.enabled;
    commit(
      audit(
        {
          ...state,
          identity: {
            ...state.identity,
            scim: {
              ...state.identity.scim,
              enabled,
              status: enabled ? "healthy" : "disabled",
            },
          },
        },
        enabled ? "Enabled SCIM provisioning" : "Disabled SCIM provisioning",
        state.identity.scim.baseUrl,
      ),
      enabled ? "SCIM provisioning enabled" : "SCIM provisioning disabled",
    );
  };

  const updatePolicy = (policyId: string) => {
    const policy = state.admin.securityPolicies.find((item) => item.id === policyId);
    commit(
      audit(
        {
          ...state,
          admin: {
            ...state.admin,
            securityPolicies: state.admin.securityPolicies.map((item) =>
              item.id === policyId ? { ...item, enabled: !item.enabled } : item,
            ),
          },
        },
        "Updated security policy",
        policy?.name ?? policyId,
      ),
      "Security policy updated",
    );
  };

  const updateApproval = (approvalId: string, status: ApprovalRequest["status"]) => {
    const approval = state.collaboration.approvalRequests.find(
      (item) => item.id === approvalId,
    );
    commit(
      audit(
        {
          ...state,
          collaboration: {
            ...state.collaboration,
            approvalRequests: state.collaboration.approvalRequests.map((item) =>
              item.id === approvalId ? { ...item, status } : item,
            ),
          },
        },
        `Marked approval ${status}`,
        approval?.title ?? approvalId,
      ),
      "Approval request updated",
    );
  };

  const addApproval = () => {
    const path = activeDocumentPath || "reports/main.tex";
    const approval: ApprovalRequest = {
      id: `approval-${Date.now().toString(36)}`,
      title: `Approve ${pathForDisplay(path)}`,
      documentPath: path,
      requester: "author@company.example",
      approver: "publisher@company.example",
      status: "pending",
      requestedAt: new Date().toISOString(),
    };
    commit(
      audit(
        {
          ...state,
          collaboration: {
            ...state.collaboration,
            approvalRequests: [approval, ...state.collaboration.approvalRequests],
          },
        },
        "Created approval request",
        approval.documentPath,
      ),
      "Approval request created",
    );
  };

  const lockDocument = () => {
    const path = activeDocumentPath || "reports/main.tex";
    const lock: DocumentLock = {
      id: `lock-${Date.now().toString(36)}`,
      path,
      scope: "document",
      owner: "admin@company.example",
      reason: "Controlled enterprise review",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
    commit(
      audit(
        {
          ...state,
          collaboration: {
            ...state.collaboration,
            documentLocks: [lock, ...state.collaboration.documentLocks],
          },
        },
        "Locked document",
        path,
      ),
      "Document locked for review",
    );
  };

  const addTask = () => {
    const path = activeDocumentPath || "reports/main.tex";
    const task: EnterpriseTask = {
      id: `task-${Date.now().toString(36)}`,
      title: taskDraft.trim() || "Review document",
      assignee: "reviewer@company.example",
      documentPath: path,
      status: "todo",
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10),
    };
    commit(
      audit(
        {
          ...state,
          collaboration: {
            ...state.collaboration,
            tasks: [task, ...state.collaboration.tasks],
          },
        },
        "Assigned task",
        task.title,
      ),
      "Task assigned",
    );
  };

  const updateTaskStatus = (taskId: string, status: EnterpriseTask["status"]) => {
    const task = state.collaboration.tasks.find((item) => item.id === taskId);
    commit(
      audit(
        {
          ...state,
          collaboration: {
            ...state.collaboration,
            tasks: state.collaboration.tasks.map((item) =>
              item.id === taskId ? { ...item, status } : item,
            ),
          },
        },
        `Marked task ${status}`,
        task?.title ?? taskId,
      ),
      "Task status updated",
    );
  };

  const addComment = () => {
    const path = activeDocumentPath || "reports/main.tex";
    const comment: EnterpriseComment = {
      id: `comment-${Date.now().toString(36)}`,
      documentPath: path,
      author: "admin@company.example",
      text: commentDraft.trim() || "@reviewer please review this document.",
      mentions: extractMentions(commentDraft),
      resolved: false,
      createdAt: new Date().toISOString(),
    };
    commit(
      audit(
        {
          ...state,
          collaboration: {
            ...state.collaboration,
            comments: [comment, ...state.collaboration.comments],
          },
        },
        "Added comment",
        path,
      ),
      comment.mentions.length
        ? `Comment added and ${comment.mentions.length} mention notification queued`
        : "Comment added",
    );
  };

  const updateWorkflow = (workflowId: string) => {
    const workflow = state.collaboration.reviewWorkflows.find(
      (item) => item.id === workflowId,
    );
    commit(
      audit(
        {
          ...state,
          collaboration: {
            ...state.collaboration,
            reviewWorkflows: state.collaboration.reviewWorkflows.map((item) =>
              item.id === workflowId
                ? { ...item, status: nextWorkflowStatus(item.status) }
                : item,
            ),
          },
        },
        "Advanced review workflow",
        workflow?.name ?? workflowId,
      ),
      "Review workflow updated",
    );
  };

  const toggleAiCheck = (checkId: string) => {
    const check = state.aiBusiness.checks.find((item) => item.id === checkId);
    commit(
      audit(
        {
          ...state,
          aiBusiness: {
            ...state.aiBusiness,
            checks: state.aiBusiness.checks.map((item) =>
              item.id === checkId ? { ...item, enabled: !item.enabled } : item,
            ),
          },
        },
        "Updated business AI check",
        check?.name ?? checkId,
      ),
      "Business AI check updated",
    );
  };

  const toggleExportTarget = (targetId: string) => {
    const target = state.publishing.exportTargets.find((item) => item.id === targetId);
    commit(
      audit(
        {
          ...state,
          publishing: {
            ...state.publishing,
            exportTargets: state.publishing.exportTargets.map((item) =>
              item.id === targetId
                ? {
                    ...item,
                    status:
                      item.status === "not-configured"
                        ? "configured"
                        : "not-configured",
                  }
                : item,
            ),
          },
        },
        "Updated export target",
        target?.name ?? targetId,
      ),
      "Publishing export target updated",
    );
  };

  const startReportJob = (jobId: string) => {
    const job = state.publishing.reportJobs.find((item) => item.id === jobId);
    commit(
      audit(
        {
          ...state,
          publishing: {
            ...state.publishing,
            reportJobs: state.publishing.reportJobs.map((item) =>
              item.id === jobId
                ? { ...item, status: "running", lastRun: new Date().toISOString() }
                : item,
            ),
          },
        },
        "Started report generation",
        job?.name ?? jobId,
      ),
      "Automated report generation started",
    );
  };

  const renderHeader = () => (
    <div className="enterprise-hero">
      <div>
        <span className="enterprise-kicker">LatexDo Pro</span>
        <h3>{state.organization.name}</h3>
        <p>
          {state.organization.domain} - {activeDocumentLabel}
        </p>
      </div>
      <button
        type="button"
        className="sidebar-mini-action primary"
        onClick={onExportReport}
      >
        <FileOutput size={13} />
        Export
      </button>
    </div>
  );

  const renderSectionTabs = () => (
    <div className="enterprise-tabs" role="tablist" aria-label="Enterprise sections">
      {sections.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={section === item.id}
            className={section === item.id ? "active" : ""}
            onClick={() => setSection(item.id)}
          >
            <Icon size={14} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );

  const renderOrganization = () => (
    <>
      <div className="enterprise-grid">
        {metric("Workspaces", summary.workspaceCount, <Users size={14} />)}
        {metric("Templates", summary.templateCount, <FileCheck2 size={14} />)}
        {metric("References", summary.managedReferences, <Library size={14} />)}
        {metric("Assets", summary.assetCount, <Images size={14} />)}
      </div>

      <section className="enterprise-section">
        <h4>Organization Branding</h4>
        <label>
          <span>Name</span>
          <input
            value={state.organization.name}
            onChange={(event) => updateOrganization("name", event.target.value)}
          />
        </label>
        <label>
          <span>Domain</span>
          <input
            value={state.organization.domain}
            onChange={(event) => updateOrganization("domain", event.target.value)}
          />
        </label>
        <label>
          <span>Brand color</span>
          <input
            value={state.organization.brandColor}
            onChange={(event) => updateOrganization("brandColor", event.target.value)}
          />
        </label>
      </section>

      <section className="enterprise-section">
        <h4>Shared Workspaces</h4>
        {state.workspaces.map((workspace) => (
          <article className="enterprise-card" key={workspace.id}>
            <strong>{workspace.name}</strong>
            <span>
              {workspace.owner} - {workspace.visibility} - {workspace.memberCount} users
            </span>
            <small>
              {workspace.storageGb} GB - {workspace.templateIds.length} templates
            </small>
          </article>
        ))}
      </section>

      <section className="enterprise-section">
        <h4>Team Templates</h4>
        {state.templates.map((template) => (
          <article className="enterprise-card" key={template.id}>
            <strong>{template.name}</strong>
            <span>
              {template.ownerTeam} - {template.category}
            </span>
            <small>
              Approvals: {template.requiredApprovals.map(statusLabel).join(", ")}
            </small>
          </article>
        ))}
      </section>

      <section className="enterprise-section">
        <h4>Identity and Provisioning</h4>
        {state.identity.providers.map((provider) => (
          <button
            key={provider.id}
            type="button"
            className="enterprise-card enterprise-action-card"
            onClick={() => updateProvider(provider.id)}
          >
            <strong>{provider.label}</strong>
            <span>{statusLabel(provider.status)}</span>
            <small>
              {provider.enforcedGroups.length
                ? provider.enforcedGroups.join(", ")
                : "No groups mapped"}
            </small>
          </button>
        ))}
        <button
          type="button"
          className="enterprise-card enterprise-action-card"
          onClick={toggleScim}
        >
          <strong>SCIM user provisioning</strong>
          <span>{state.identity.scim.enabled ? "Enabled" : "Disabled"}</span>
          <small>{state.identity.scim.baseUrl}</small>
        </button>
      </section>

      <section className="enterprise-section">
        <h4>Role Permissions</h4>
        {state.rolePolicies.map((policy) => (
          <article className="enterprise-card" key={policy.role}>
            <strong>{statusLabel(policy.role)}</strong>
            <span>
              {[
                policy.canCreateWorkspace ? "workspace" : "",
                policy.canApprove ? "approve" : "",
                policy.canPublish ? "publish" : "",
                policy.canManageUsers ? "users" : "",
              ]
                .filter(Boolean)
                .join(" - ") || "read-only"}
            </span>
          </article>
        ))}
      </section>
    </>
  );

  const renderCollaboration = () => (
    <>
      <div className="enterprise-grid">
        {metric("Approvals", summary.pendingApprovals, <BadgeCheck size={14} />)}
        {metric("Open tasks", summary.openTasks, <ClipboardCheck size={14} />)}
        {metric("Locks", summary.activeLocks, <LockKeyhole size={14} />)}
        {metric("Mentions", summary.unresolvedMentions, <MessageSquare size={14} />)}
      </div>

      <section className="enterprise-section">
        <div className="enterprise-section-title">
          <h4>Review Workflows</h4>
        </div>
        {state.collaboration.reviewWorkflows.map((workflow) => (
          <button
            type="button"
            className="enterprise-card enterprise-action-card"
            key={workflow.id}
            onClick={() => updateWorkflow(workflow.id)}
          >
            <strong>{workflow.name}</strong>
            <span>
              {statusLabel(workflow.status)} - {workflow.currentStage}
            </span>
            <small>Due {workflow.dueDate}</small>
          </button>
        ))}
      </section>

      <section className="enterprise-section">
        <div className="enterprise-section-title">
          <h4>Approvals and Locks</h4>
          <button type="button" className="sidebar-mini-action" onClick={addApproval}>
            Request
          </button>
          <button type="button" className="sidebar-mini-action" onClick={lockDocument}>
            Lock
          </button>
        </div>
        {state.collaboration.approvalRequests.map((approval) => (
          <article className="enterprise-card" key={approval.id}>
            <strong>{approval.title}</strong>
            <span>{pathForDisplay(approval.documentPath)}</span>
            <select
              value={approval.status}
              onChange={(event) =>
                updateApproval(
                  approval.id,
                  event.target.value as ApprovalRequest["status"],
                )
              }
            >
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="changes-requested">Changes requested</option>
            </select>
          </article>
        ))}
        {state.collaboration.documentLocks.map((lock) => (
          <article className="enterprise-card" key={lock.id}>
            <strong>{pathForDisplay(lock.path)}</strong>
            <span>
              {statusLabel(lock.scope)} lock - {lock.owner}
            </span>
            <small>{lock.reason}</small>
          </article>
        ))}
      </section>

      <section className="enterprise-section">
        <div className="enterprise-section-title">
          <h4>Task Assignment</h4>
          <button type="button" className="sidebar-mini-action" onClick={addTask}>
            Add
          </button>
        </div>
        <input
          value={taskDraft}
          onChange={(event) => setTaskDraft(event.target.value)}
          aria-label="Task title"
        />
        {state.collaboration.tasks.map((task) => (
          <article className="enterprise-card" key={task.id}>
            <strong>{task.title}</strong>
            <span>
              {task.assignee} - {pathForDisplay(task.documentPath)}
            </span>
            <select
              value={task.status}
              onChange={(event) =>
                updateTaskStatus(
                  task.id,
                  event.target.value as EnterpriseTask["status"],
                )
              }
            >
              <option value="todo">Todo</option>
              <option value="doing">Doing</option>
              <option value="blocked">Blocked</option>
              <option value="done">Done</option>
            </select>
          </article>
        ))}
      </section>

      <section className="enterprise-section">
        <div className="enterprise-section-title">
          <h4>Comments and Audit Trail</h4>
          <button type="button" className="sidebar-mini-action" onClick={addComment}>
            Comment
          </button>
        </div>
        <textarea
          value={commentDraft}
          onChange={(event) => setCommentDraft(event.target.value)}
          aria-label="Enterprise comment"
        />
        {state.collaboration.comments.map((comment) => (
          <article className="enterprise-card" key={comment.id}>
            <strong>{comment.author}</strong>
            <span>{comment.text}</span>
            <small>
              Mentions: {comment.mentions.length ? comment.mentions.join(", ") : "none"}
            </small>
          </article>
        ))}
        {state.collaboration.versionComparisons.map((comparison) => (
          <article className="enterprise-card" key={comparison.id}>
            <strong>
              {comparison.fromVersion} to {comparison.toVersion}
            </strong>
            <span>
              {comparison.changedSections} changed sections - {comparison.reviewer}
            </span>
          </article>
        ))}
        {state.collaboration.auditTrail.slice(0, 5).map((event) => (
          <article className="enterprise-card compact" key={event.id}>
            <strong>{event.action}</strong>
            <span>
              {event.actor} - {event.target}
            </span>
          </article>
        ))}
      </section>
    </>
  );

  const renderAdministration = () => (
    <>
      <div className="enterprise-grid">
        {metric("Active users", state.admin.usage.activeUsers, <Users size={14} />)}
        {metric(
          "Docs edited",
          state.admin.usage.documentsEdited,
          <FileCheck2 size={14} />,
        )}
        {metric(
          "Reviews",
          state.admin.usage.reviewsCompleted,
          <ClipboardCheck size={14} />,
        )}
        {metric(
          "AI requests",
          state.admin.usage.aiRequests,
          <BrainCircuit size={14} />,
        )}
      </div>

      <section className="enterprise-section">
        <h4>Storage Management</h4>
        <div className="enterprise-storage">
          <span>
            {state.admin.storage.usedGb} GB / {state.admin.storage.quotaGb} GB
          </span>
          <div>
            <i style={{ width: `${storagePercent}%` }} />
          </div>
          <small>{storagePercent}% used</small>
        </div>
      </section>

      <section className="enterprise-section">
        <h4>Security Policies</h4>
        {state.admin.securityPolicies.map((policy: SecurityPolicy) => (
          <button
            type="button"
            key={policy.id}
            className={`enterprise-card enterprise-action-card ${policy.enabled ? "enabled" : ""}`}
            onClick={() => updatePolicy(policy.id)}
          >
            <strong>{policy.name}</strong>
            <span>
              {policy.enabled ? "Enabled" : "Disabled"} - {policy.severity}
            </span>
          </button>
        ))}
      </section>

      <section className="enterprise-section">
        <h4>Backup and Retention</h4>
        <article className="enterprise-card">
          <strong>
            {state.admin.backupRetention.backupEnabled
              ? "Backups enabled"
              : "Backups disabled"}
          </strong>
          <span>{state.admin.backupRetention.retentionDays} day retention</span>
          <small>Last backup {state.admin.backupRetention.lastBackup}</small>
        </article>
      </section>

      <section className="enterprise-section">
        <div className="enterprise-section-title">
          <h4>Compliance Reports</h4>
          <button
            type="button"
            className="sidebar-mini-action"
            onClick={onExportReport}
          >
            Export
          </button>
        </div>
        {state.admin.complianceReports.map((report) => (
          <article className="enterprise-card" key={report.id}>
            <strong>{report.name}</strong>
            <span>
              {statusLabel(report.status)} - {report.scope}
            </span>
            <small>{report.lastGenerated}</small>
          </article>
        ))}
        <article className="enterprise-card">
          <strong>Current report risk items</strong>
          <span>{compliancePreview.riskItems.length || "No"} risks detected</span>
        </article>
      </section>
    </>
  );

  const renderAi = () => (
    <>
      <div className="enterprise-grid">
        {metric(
          "Private models",
          state.aiBusiness.privateModels.length,
          <BrainCircuit size={14} />,
        )}
        {metric(
          "Knowledge docs",
          state.aiBusiness.knowledgeSources.reduce(
            (total, source) => total + source.indexedDocuments,
            0,
          ),
          <SearchCheck size={14} />,
        )}
        {metric(
          "Style guides",
          state.aiBusiness.styleGuides.length,
          <BookMarked size={14} />,
        )}
        {metric(
          "AI checks",
          state.aiBusiness.checks.filter((check) => check.enabled).length,
          <CheckCircle2 size={14} />,
        )}
      </div>

      <section className="enterprise-section">
        <h4>Private AI Models</h4>
        {state.aiBusiness.privateModels.map((model) => (
          <article className="enterprise-card" key={model.id}>
            <strong>{model.name}</strong>
            <span>{statusLabel(model.status)}</span>
            <small>{model.trainedOn.join(", ")}</small>
          </article>
        ))}
      </section>

      <section className="enterprise-section">
        <h4>Internal Knowledge Search</h4>
        {state.aiBusiness.knowledgeSources.map((source) => (
          <article className="enterprise-card" key={source.id}>
            <strong>{source.name}</strong>
            <span>
              {source.indexedDocuments} documents - {source.type}
            </span>
            <small>{statusLabel(source.access)}</small>
          </article>
        ))}
      </section>

      <section className="enterprise-section">
        <h4>Style Guides and Checks</h4>
        {state.aiBusiness.styleGuides.map((guide) => (
          <article className="enterprise-card" key={guide.id}>
            <strong>{guide.name}</strong>
            <span>
              {guide.rules} rules - {guide.enforced ? "enforced" : "advisory"}
            </span>
          </article>
        ))}
        {state.aiBusiness.checks.map((check: BusinessAiCheck) => (
          <button
            type="button"
            key={check.id}
            className={`enterprise-card enterprise-action-card ${check.enabled ? "enabled" : ""}`}
            onClick={() => toggleAiCheck(check.id)}
          >
            <strong>{check.name}</strong>
            <span>
              {check.enabled ? "Enabled" : "Disabled"} - {statusLabel(check.category)}
            </span>
          </button>
        ))}
      </section>

      <section className="enterprise-section">
        <h4>Technical Writing Assistants</h4>
        {state.aiBusiness.writingAssistants.map((assistant) => (
          <article className="enterprise-card" key={assistant.id}>
            <strong>{assistant.name}</strong>
            <span>{assistant.enabled ? "Enabled" : "Disabled"}</span>
            <small>{assistant.purpose}</small>
          </article>
        ))}
      </section>
    </>
  );

  const renderPublishing = () => (
    <>
      <div className="enterprise-grid">
        {metric(
          "Company templates",
          state.publishing.companyTemplates.length,
          <BriefcaseBusiness size={14} />,
        )}
        {metric(
          "Journals",
          state.publishing.journalWorkflows.length,
          <BookMarked size={14} />,
        )}
        {metric("Export targets", summary.activeExportTargets, <Database size={14} />)}
        {metric(
          "DOI records",
          state.publishing.doiRecords.length,
          <BadgeCheck size={14} />,
        )}
      </div>

      <section className="enterprise-section">
        <h4>Company Templates</h4>
        {state.publishing.companyTemplates.map((template) => (
          <article className="enterprise-card" key={template.id}>
            <strong>{template.name}</strong>
            <span>
              {template.ownerTeam} - {template.output.toUpperCase()}
            </span>
          </article>
        ))}
      </section>

      <section className="enterprise-section">
        <h4>Journal Submission Workflows</h4>
        {state.publishing.journalWorkflows.map((workflow) => (
          <article className="enterprise-card" key={workflow.id}>
            <strong>{workflow.journal}</strong>
            <span>{statusLabel(workflow.status)}</span>
            <small>{workflow.requiredChecks.join(", ")}</small>
          </article>
        ))}
      </section>

      <section className="enterprise-section">
        <h4>Internal Document Systems</h4>
        {state.publishing.exportTargets.map((target: ExportTarget) => (
          <button
            key={target.id}
            type="button"
            className="enterprise-card enterprise-action-card"
            onClick={() => toggleExportTarget(target.id)}
          >
            <strong>{target.name}</strong>
            <span>
              {statusLabel(target.type)} - {statusLabel(target.status)}
            </span>
          </button>
        ))}
      </section>

      <section className="enterprise-section">
        <div className="enterprise-section-title">
          <h4>Automated Reports</h4>
        </div>
        {state.publishing.reportJobs.map((job: ReportJob) => (
          <button
            type="button"
            key={job.id}
            className="enterprise-card enterprise-action-card"
            onClick={() => startReportJob(job.id)}
          >
            <strong>{job.name}</strong>
            <span>
              {job.schedule} - {statusLabel(job.status)}
            </span>
            <small>Last run {job.lastRun}</small>
          </button>
        ))}
      </section>

      <section className="enterprise-section">
        <h4>DOI and Publication Tracking</h4>
        {state.publishing.doiRecords.map((record) => (
          <article className="enterprise-card" key={record.id}>
            <strong>{record.title}</strong>
            <span>
              {record.doi} - {statusLabel(record.status)}
            </span>
            <small>{record.publicationDate || "No publication date"}</small>
          </article>
        ))}
      </section>
    </>
  );

  return (
    <div className="enterprise-dashboard">
      {renderHeader()}
      {renderSectionTabs()}
      <div className="enterprise-scroll">
        {section === "organization"
          ? renderOrganization()
          : section === "collaboration"
            ? renderCollaboration()
            : section === "administration"
              ? renderAdministration()
              : section === "ai"
                ? renderAi()
                : renderPublishing()}
      </div>
      <div className="enterprise-footer">
        <HardDrive size={13} />
        <span>{storagePercent}% storage</span>
        <ArchiveRestore size={13} />
        <span>{state.admin.backupRetention.retentionDays}d retention</span>
        <KeyRound size={13} />
        <span>{state.identity.scim.enabled ? "SCIM" : "Manual"}</span>
        <UserCog size={13} />
        <span>{summary.enabledSecurityPolicies} policies</span>
        <RefreshCw size={13} />
        <span>{compliancePreview.riskItems.length} risks</span>
      </div>
    </div>
  );
}
