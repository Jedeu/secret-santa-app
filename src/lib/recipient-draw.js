import { randomInt } from 'node:crypto';

/**
 * Automatic recipient draw (server-only; no Firebase SDK).
 *
 * The draw is one uniformly shuffled ring: shuffle the ids with Fisher–Yates using a
 * cryptographic random source, then each participant gives to the next and the last
 * gives to the first. Every one of the (n-1)! rings is equally likely given a uniform
 * source; assignments made of several smaller rings never occur.
 *
 * Never import this module from client code (node:crypto).
 */

function defaultPickIndex(maxExclusive) {
    return randomInt(maxExclusive);
}

function isNonEmptyString(value) {
    return typeof value === 'string' && value.length > 0;
}

/**
 * @param {string[]} ids  at least two distinct non-empty strings
 * @param {(maxExclusive: number) => number} [pickIndex]  uniform integer in [0, maxExclusive);
 *        defaults to (n) => randomInt(n)
 * @returns {Map<string, { recipientId: string, gifterId: string }>}
 */
export function drawRecipientCycle(ids, pickIndex = defaultPickIndex) {
    if (!Array.isArray(ids)
        || ids.length < 2
        || !ids.every(isNonEmptyString)
        || new Set(ids).size !== ids.length) {
        throw new Error('Recipient draw needs at least two distinct ids');
    }

    const order = [...ids];
    for (let i = order.length - 1; i >= 1; i -= 1) {
        const j = pickIndex(i + 1);
        if (!Number.isInteger(j) || j < 0 || j > i) {
            throw new Error('Recipient draw received an invalid random index');
        }
        const swap = order[i];
        order[i] = order[j];
        order[j] = swap;
    }

    const n = order.length;
    const draw = new Map();
    for (let k = 0; k < n; k += 1) {
        draw.set(order[k], {
            recipientId: order[(k + 1) % n],
            gifterId: order[(k - 1 + n) % n],
        });
    }
    return draw;
}

/**
 * True when profiles ({ id, recipientId, gifterId }) form one complete valid pairing:
 * at least two distinct non-empty ids; every recipient is another profile in the list;
 * recipients are distinct; and each recipient's gifterId points back. Validity does not
 * require a single ring.
 */
export function isCompletePairing(profiles) {
    if (!Array.isArray(profiles) || profiles.length < 2) {
        return false;
    }

    const byId = new Map();
    for (const profile of profiles) {
        const id = profile?.id;
        if (!isNonEmptyString(id) || byId.has(id)) {
            return false;
        }
        byId.set(id, profile);
    }

    const recipients = new Set();
    for (const profile of profiles) {
        const recipientId = profile.recipientId;
        if (!isNonEmptyString(recipientId) || recipientId === profile.id || !byId.has(recipientId)) {
            return false;
        }
        if (recipients.has(recipientId)) {
            return false;
        }
        recipients.add(recipientId);
        if (byId.get(recipientId).gifterId !== profile.id) {
            return false;
        }
    }

    return true;
}
