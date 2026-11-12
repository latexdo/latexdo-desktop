// Types for adminOffers.mjs, which both collaboration servers use.

export declare class AdminOfferError extends Error {
  constructor(status: number, message: string);
  readonly status: number;
}

export interface AdminOffer {
  from: string;
  transfer: boolean;
  offeredAt: number;
}

interface PermissionLike {
  clientId: string;
  role: "admin" | "editor" | "viewer" | null;
  updatedAt: number;
  adminOffer?: AdminOffer;
}

interface MetaLike {
  permissions: Record<string, PermissionLike>;
}

export declare function adminOfferFor(
  meta: MetaLike,
  clientId: string,
): AdminOffer | null;
export declare function offerAdmin(
  meta: MetaLike,
  options: {
    from: string;
    to: string;
    transfer?: boolean;
    fromIsOwner: boolean;
    now: number;
  },
): AdminOffer | null;
export declare function cancelAdminOffer(
  meta: MetaLike,
  to: string,
  now: number,
): boolean;
export declare function answerAdminOffer(
  meta: MetaLike,
  options: { clientId: string; accept: boolean; now: number },
): { changed: string[]; offer: AdminOffer };
