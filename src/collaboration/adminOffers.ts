/*
 * Admin invitations in a shared project, seen from this app: an admin offers
 * admin rights, the person accepts or declines in their Share window. This
 * watches the project's permissions so the invited person hears about the
 * offer, and the admin who made it hears how it was answered.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { loadNotificationMode, notify } from "../features/notifications/notifications";
import type { AdminOffer, CollaboratorPermission } from "../types";

/*
 * Invitations are not urgent, and every check is a request on the always-on
 * server's daily allowance: look rarely, and often only while the Share
 * window (where they are answered) is open.
 */
const backgroundPollMs = 5 * 60_000;
const sharePollMs = 15_000;

/** An admin invitation waiting for this person. */
export interface MyAdminOffer extends AdminOffer {
  fromName: string;
}

export interface AdminOfferNews {
  /** A new invitation for me. */
  invited: MyAdminOffer | null;
  /** My invitations that were answered: accepted when they became admin. */
  answered: Array<{ clientId: string; name: string; accepted: boolean }>;
}

function offerKey(offer: AdminOffer): string {
  return `${offer.from}:${offer.offeredAt}`;
}

/** The invitation waiting for me in these permissions, if any. */
export function myAdminOffer(
  permissions: readonly CollaboratorPermission[],
): MyAdminOffer | null {
  const offer = permissions.find((item) => item.isCurrent)?.adminOffer;
  if (!offer) return null;
  const fromName =
    permissions.find((item) => item.clientId === offer.from)?.name ?? "An admin";
  return { ...offer, fromName };
}

/**
 * What changed between two looks at the permissions: a new invitation for
 * me, and invitations I made that are no longer waiting. `withdrawn` holds the
 * people whose invitation I took back myself, which is not news.
 */
export function adminOfferNews(
  previous: readonly CollaboratorPermission[] | null,
  next: readonly CollaboratorPermission[],
  seenInvitation: string | null,
  withdrawn: ReadonlySet<string> = new Set(),
): AdminOfferNews {
  const offer = myAdminOffer(next);
  const invited = offer && offerKey(offer) !== seenInvitation ? offer : null;
  const me = next.find((item) => item.isCurrent)?.clientId;
  const answered: AdminOfferNews["answered"] = [];
  if (previous && me) {
    for (const before of previous) {
      if (before.adminOffer?.from !== me || withdrawn.has(before.clientId)) continue;
      const now = next.find((item) => item.clientId === before.clientId);
      if (!now || now.adminOffer?.from === me) continue;
      // Became admin: accepted. Same role: declined. Anything else (removed,
      // or another admin changed their role) is not an answer to report.
      if (now.role !== "admin" && now.role !== before.role) continue;
      answered.push({
        clientId: before.clientId,
        name: now.name,
        accepted: now.role === "admin",
      });
    }
  }
  return { invited, answered };
}

/** The line shown in the notification center for an invitation. */
export function adminOfferText(offer: MyAdminOffer): string {
  return offer.transfer
    ? `${offer.fromName} wants to hand over their admin role to you. Open Share to accept or decline.`
    : `${offer.fromName} invited you to become an admin of this project. Open Share to accept or decline.`;
}

function showSystemNotification(body: string, onClick: () => void): void {
  const mode = loadNotificationMode();
  if (mode === "do-not-disturb" || mode === "reading") return;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") {
    return;
  }
  try {
    const notification = new Notification("LatexDo", { body });
    notification.onclick = () => {
      window.focus();
      onClick();
      notification.close();
    };
  } catch {
    // The notification center still has it.
  }
}

export interface UseAdminOffersOptions {
  /** The shared project, or null when this project is not shared. */
  projectId: string | null;
  /** Called with every fresh look at the permissions. */
  onPermissions: (result: {
    permissions: CollaboratorPermission[];
    isAdmin: boolean;
    canTransferAdmin?: boolean;
  }) => void;
  openShare: () => void;
  /** Reloads the project's permissions after an answer. */
  reload: () => Promise<void>;
  /** True while the Share window is open: checked more often then. */
  watching?: boolean;
}

export function useAdminOffers({
  projectId,
  onPermissions,
  openShare,
  reload,
  watching = false,
}: UseAdminOffersOptions) {
  const [offer, setOffer] = useState<MyAdminOffer | null>(null);
  const [answering, setAnswering] = useState(false);
  const previousRef = useRef<CollaboratorPermission[] | null>(null);
  const seenRef = useRef<string | null>(null);
  const withdrawnRef = useRef(new Set<string>());
  const callbacksRef = useRef({ onPermissions, openShare });
  callbacksRef.current = { onPermissions, openShare };

  // A different project starts from scratch (opening Share does not).
  useEffect(() => {
    previousRef.current = null;
    seenRef.current = null;
    withdrawnRef.current = new Set();
    setOffer(null);
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    let stopped = false;
    const check = async () => {
      let result: Awaited<
        ReturnType<typeof window.latexdo.getCollaborationPermissions>
      >;
      try {
        result = await window.latexdo.getCollaborationPermissions(projectId);
      } catch {
        return;
      }
      // A failed request comes back as an empty list (a shared project always
      // has at least me): keep what is known rather than hide the admin tools.
      if (stopped || !result || !result.permissions.length) return;
      const news = adminOfferNews(
        previousRef.current,
        result.permissions,
        seenRef.current,
        withdrawnRef.current,
      );
      previousRef.current = result.permissions;
      withdrawnRef.current = new Set();
      const current = myAdminOffer(result.permissions);
      seenRef.current = current ? offerKey(current) : null;
      setOffer(current);
      callbacksRef.current.onPermissions(result);
      if (news.invited) {
        const text = adminOfferText(news.invited);
        notify(text, { severity: "info", source: "Sharing" });
        showSystemNotification(text, () => callbacksRef.current.openShare());
      }
      for (const item of news.answered) {
        notify(
          item.accepted
            ? `${item.name} accepted and is now an admin.`
            : `${item.name} declined your admin invitation.`,
          { severity: "info", source: "Sharing" },
        );
      }
    };
    void check();
    const timer = window.setInterval(
      () => void check(),
      watching ? sharePollMs : backgroundPollMs,
    );
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [projectId, watching]);

  const answer = useCallback(
    async (accept: boolean) => {
      if (!projectId || answering) return;
      setAnswering(true);
      try {
        await window.latexdo.answerAdminOffer(projectId, accept);
        setOffer(null);
        notify(
          accept
            ? "You are now an admin of this project."
            : "You declined the admin invitation.",
          { severity: "info", source: "Sharing" },
        );
        await reload();
      } catch (error) {
        setOffer(null);
        notify(
          error instanceof Error ? error.message : "Could not answer the invitation.",
          { severity: "warning", source: "Sharing" },
        );
        await reload().catch(() => undefined);
      } finally {
        setAnswering(false);
      }
    },
    [answering, projectId, reload],
  );

  const withdraw = useCallback(
    async (clientId: string) => {
      if (!projectId) return;
      withdrawnRef.current.add(clientId);
      await window.latexdo.withdrawAdminOffer(projectId, clientId);
      await reload();
    },
    [projectId, reload],
  );

  return { offer, answering, answer, withdraw };
}
