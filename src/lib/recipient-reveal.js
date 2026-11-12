/**
 * One-time recipient reveal: pure state rules shared by the client and the server.
 *
 * Pure module (no Firebase SDK import, no other imports). Must not import
 * '@/lib/recipient-draw' (server-only, uses node:crypto).
 *
 * A profile created by Start new year carries `drawMode: 'auto'`. Profiles without a
 * draw mode (2025, and any year started before the automatic draw) keep manual
 * selection. The reveal is pending until `revealAckRecipientId` equals `recipientId`;
 * only POST /api/reveal/acknowledge writes the acknowledgment.
 */

export const DRAW_MODE_AUTO = 'auto';

function isNonEmptyString(value) {
    return typeof value === 'string' && value.length > 0;
}

/** True when the profile carries any draw mode (drawMode neither undefined nor null). */
export function hasDrawMode(user) {
    return !!user && user.drawMode !== undefined && user.drawMode !== null;
}

/**
 * @returns {'manual'|'invalid'|'pending'|'acknowledged'}
 */
export function getRevealState(user) {
    if (!hasDrawMode(user)) {
        return 'manual';
    }
    if (user.drawMode !== DRAW_MODE_AUTO) {
        return 'invalid';
    }
    if (!isNonEmptyString(user.id)
        || !isNonEmptyString(user.recipientId)
        || !isNonEmptyString(user.gifterId)
        || user.recipientId === user.id
        || user.gifterId === user.id) {
        return 'invalid';
    }
    if (user.revealAckRecipientId === user.recipientId) {
        return 'acknowledged';
    }
    return 'pending';
}
