/*
 * Handing over admin rights in a shared project. An admin cannot make someone
 * admin on their own: they offer it, and the person accepts or declines. A
 * non-owner admin may also hand over their own seat ("transfer"): when the
 * other person accepts, the admin who offered becomes an editor. The project
 * owner always stays admin (the servers grant it to the owner's session), so
 * the owner can share admin rights but not give them away.
 *
 * The offer lives on the invited person's permission entry, so both servers
 * (server.mjs and the Cloudflare room) store it with the rest of the project
 * metadata. These functions only change `meta.permissions`.
 */

export class AdminOfferError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function permissionOf(meta, clientId) {
  return typeof clientId === "string" && Object.hasOwn(meta.permissions, clientId)
    ? meta.permissions[clientId]
    : undefined;
}

/** The offer waiting for this person, if it is still valid. */
export function adminOfferFor(meta, clientId) {
  const permission = permissionOf(meta, clientId);
  const offer = permission?.adminOffer;
  if (!offer || typeof offer !== "object") return null;
  // An offer is only as good as the admin who made it.
  if (permissionOf(meta, offer.from)?.role !== "admin") return null;
  return {
    from: offer.from,
    transfer: offer.transfer === true,
    offeredAt: offer.offeredAt,
  };
}

/**
 * Offers admin rights to `to`. With `transfer`, the offering admin steps down
 * to editor once it is accepted; the owner cannot (`fromIsOwner`).
 */
export function offerAdmin(meta, { from, to, transfer = false, fromIsOwner, now }) {
  if (permissionOf(meta, from)?.role !== "admin") {
    throw new AdminOfferError(403, "Only an admin can offer admin rights.");
  }
  if (from === to) throw new AdminOfferError(400, "You are already an admin.");
  const target = permissionOf(meta, to);
  if (!target || !target.role)
    throw new AdminOfferError(404, "Collaborator not found.");
  if (target.role === "admin") {
    throw new AdminOfferError(409, "This person is already an admin.");
  }
  if (transfer && fromIsOwner) {
    throw new AdminOfferError(
      400,
      "The project owner always stays admin. Make them an admin instead.",
    );
  }
  target.adminOffer = { from, transfer: transfer === true, offeredAt: now };
  target.updatedAt = now;
  return adminOfferFor(meta, to);
}

/** Withdraws the offer made to `to`. True when there was one. */
export function cancelAdminOffer(meta, to, now) {
  const target = permissionOf(meta, to);
  if (!target?.adminOffer) return false;
  delete target.adminOffer;
  target.updatedAt = now;
  return true;
}

/**
 * The invited person accepts or declines. Returns the client ids whose role
 * changed, so their connections can be refreshed.
 */
export function answerAdminOffer(meta, { clientId, accept, now }) {
  const target = permissionOf(meta, clientId);
  const offer = adminOfferFor(meta, clientId);
  if (!target || !offer) {
    if (target?.adminOffer) delete target.adminOffer;
    throw new AdminOfferError(404, "This admin invitation is no longer valid.");
  }
  delete target.adminOffer;
  target.updatedAt = now;
  if (!accept) return { changed: [], offer };
  target.role = "admin";
  const changed = [clientId];
  if (offer.transfer) {
    const giver = permissionOf(meta, offer.from);
    if (giver && giver.role === "admin") {
      giver.role = "editor";
      giver.updatedAt = now;
      // Someone who steps down has nothing left to offer.
      for (const permission of Object.values(meta.permissions)) {
        if (permission?.adminOffer?.from === offer.from) delete permission.adminOffer;
      }
      changed.push(offer.from);
    }
  }
  return { changed, offer };
}
