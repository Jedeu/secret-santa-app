import {
    buildAssignmentMap,
    getConversationId,
    getLegacyConversationId,
    resolveMessageConversation,
} from '@/lib/message-utils';

/**
 * Pure assembler for the read-only archive of a closed year (no Firebase import).
 *
 * Routing uses resolveMessageConversation with that year's full assignment map and is
 * stricter about ambiguity than the live feed: an ambiguous row is never merged into a
 * pair thread and never labelled Santa; an unroutable row goes to one "Other messages"
 * thread. Every input message appears in exactly one thread.
 */

export const UNSORTED_THREAD_ID = '__unsorted__';

const UNKNOWN_NAME = 'Unknown';

function timestampMs(message) {
    const value = message?.timestamp;
    if (typeof value !== 'string') return null;
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
}

function compareIds(a, b) {
    const left = String(a?.id ?? '');
    const right = String(b?.id ?? '');
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
}

// Ascending by parsed timestamp; invalid or missing last; ties by id.
function compareMessages(a, b) {
    const left = timestampMs(a);
    const right = timestampMs(b);
    if (left === null && right === null) return compareIds(a, b);
    if (left === null) return 1;
    if (right === null) return -1;
    if (left !== right) return left - right;
    return compareIds(a, b);
}

function pairTitle(santaName, recipientName) {
    return `🎁 ${recipientName}'s gift exchange · Santa: ${santaName}`;
}

/**
 * @param {{ users: object[], messages: object[] }} input
 * @returns {{
 *   pairings: Array<{ santaId: string, recipientId: string, santaName: string, recipientName: string }>,
 *   threads: Array<{ id: string, kind: 'pair'|'ambiguous'|'unsorted', title: string,
 *     messages: Array<object & { label: string }>, latestTimestamp: string|null }>
 * }}
 */
export function buildArchiveView({ users, messages } = {}) {
    const userList = Array.isArray(users) ? users : [];
    const messageList = Array.isArray(messages) ? messages : [];

    const names = new Map();
    userList.forEach((user) => {
        if (user?.id) {
            names.set(user.id, typeof user.name === 'string' && user.name ? user.name : UNKNOWN_NAME);
        }
    });
    const nameOf = (id) => (id && names.has(id) ? names.get(id) : UNKNOWN_NAME);

    const assignments = buildAssignmentMap(userList);

    const pairings = Array.from(assignments.entries())
        .map(([santaId, recipientId]) => ({
            santaId,
            recipientId,
            santaName: nameOf(santaId),
            recipientName: nameOf(recipientId),
        }))
        .sort((a, b) => a.santaName.localeCompare(b.santaName)
            || a.recipientName.localeCompare(b.recipientName)
            || compareIds({ id: a.santaId }, { id: b.santaId }));

    const threads = new Map();
    const ensureThread = (id, kind, title) => {
        if (!threads.has(id)) {
            threads.set(id, { id, kind, title, messages: [] });
        }
        return threads.get(id);
    };

    // One pair thread per pairing, listed even without messages.
    pairings.forEach((pairing) => {
        ensureThread(
            getConversationId(pairing.santaId, pairing.recipientId),
            'pair',
            pairTitle(pairing.santaName, pairing.recipientName)
        );
    });

    messageList.forEach((message) => {
        const resolved = resolveMessageConversation(message, assignments);
        const fromId = message?.fromId;
        const toId = message?.toId;

        if (resolved.source === 'unroutable') {
            const thread = ensureThread(UNSORTED_THREAD_ID, 'unsorted', 'Other messages');
            thread.messages.push({ ...message, label: `${nameOf(fromId)} → ${nameOf(toId)}` });
            return;
        }

        if (resolved.isAmbiguous) {
            const [firstId, secondId] = [fromId, toId].sort();
            const thread = ensureThread(
                `ambiguous:${getLegacyConversationId(fromId, toId)}`,
                'ambiguous',
                `${nameOf(firstId)} & ${nameOf(secondId)} · direction unknown`
            );
            thread.messages.push({ ...message, label: nameOf(fromId) });
            return;
        }

        const thread = ensureThread(
            resolved.conversationId,
            'pair',
            pairTitle(nameOf(resolved.santaId), nameOf(resolved.recipientId))
        );
        const label = resolved.isSantaMsg
            ? `🎅 ${nameOf(resolved.santaId)} (Santa)`
            : nameOf(fromId);
        thread.messages.push({ ...message, label });
    });

    const latestMsById = new Map();
    const all = Array.from(threads.values()).map((thread) => {
        const sorted = [...thread.messages].sort(compareMessages);
        let latestMs = null;
        let latestTimestamp = null;
        sorted.forEach((message) => {
            const ms = timestampMs(message);
            if (ms !== null && (latestMs === null || ms > latestMs)) {
                latestMs = ms;
                latestTimestamp = message.timestamp;
            }
        });
        latestMsById.set(thread.id, latestMs);
        return { ...thread, messages: sorted, latestTimestamp };
    });

    const unsorted = all.filter((thread) => thread.kind === 'unsorted');
    const withMessages = all
        .filter((thread) => thread.kind !== 'unsorted' && thread.messages.length > 0)
        .sort((a, b) => {
            const left = latestMsById.get(a.id);
            const right = latestMsById.get(b.id);
            if (left === null && right === null) return a.title.localeCompare(b.title);
            if (left === null) return 1;
            if (right === null) return -1;
            if (left !== right) return right - left;
            return a.title.localeCompare(b.title);
        });
    const empty = all
        .filter((thread) => thread.kind !== 'unsorted' && thread.messages.length === 0)
        .sort((a, b) => a.title.localeCompare(b.title));

    return { pairings, threads: [...withMessages, ...empty, ...unsorted] };
}
