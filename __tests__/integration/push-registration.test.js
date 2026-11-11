/**
 * Push registration fencing against the Firestore emulator (Admin SDK).
 * No FCM call is made: cleanupInvalidTokens is driven with crafted responses.
 */

import { createHash } from 'node:crypto';
import { auth as adminAuth, firestore } from '@/lib/firebase';
import { closeYear, startNewYear } from '@/lib/participant-admission';
import {
    cleanupInvalidTokens,
    getPushRegistrationStatus,
    registerPushToken,
    unregisterPushToken,
} from '@/lib/push-server';
import { getRoster } from '@/lib/participants';
import { POST as registerRoute } from '@/app/api/push/register/route';
import { clearEmulatorFirestore } from './helpers/emulator-admin';

const TOKEN = 'it-device-token-push-000000001';
const OTHER_TOKEN = 'it-device-token-push-000000002';
const INVALID_RESPONSE = { responses: [{ success: false, error: { code: 'messaging/registration-token-not-registered' } }] };

// Both members are on the 2025 and the 2026 rosters.
const memberA = { uid: 'it-push-uid-a', email: getRoster(2026)[0].email, email_verified: true };
const memberB = { uid: 'it-push-uid-b', email: getRoster(2026)[1].email, email_verified: true };

async function closeAndStart2026() {
    await closeYear({ year: 2025 });
    await startNewYear({ fromYear: 2025, targetYear: 2026 });
}

function rowRef(token) {
    return firestore.collection('pushTokens').doc(createHash('sha256').update(token).digest('hex'));
}

async function row(token = TOKEN) {
    const snap = await rowRef(token).get();
    return snap.exists ? snap.data() : null;
}

async function status(decoded = memberA, token = TOKEN) {
    return getPushRegistrationStatus({ decodedToken: decoded, token });
}

async function register(decoded, { epoch, revision }, enabled = true, token = TOKEN) {
    return registerPushToken({ decodedToken: decoded, token, expectedEpoch: epoch, expectedRevision: revision, enabled });
}

async function unregister(decoded, { epoch, revision }, token = TOKEN) {
    return unregisterPushToken({ decodedToken: decoded, token, expectedEpoch: epoch, expectedRevision: revision });
}

function routeRequest(body) {
    return {
        headers: { get: (name) => (name === 'Authorization' ? 'Bearer synthetic-token' : null) },
        json: async () => body,
    };
}

describe('push registration (emulator)', () => {
    beforeEach(async () => {
        await clearEmulatorFirestore();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('1. a missing precondition is rejected with 400', async () => {
        jest.spyOn(adminAuth, 'verifyIdToken').mockResolvedValue(memberA);

        const missingRevision = await registerRoute(routeRequest({ token: TOKEN, expectedEpoch: 1 }));
        const missingEpoch = await registerRoute(routeRequest({ token: TOKEN, expectedRevision: null }));

        expect(missingRevision.status).toBe(400);
        expect((await missingRevision.json()).code).toBe('PRECONDITION_REQUIRED');
        expect(missingEpoch.status).toBe(400);
        expect(await row()).toBeNull();
    });

    test('2. two registers with the same revision: one succeeds, one gets 409', async () => {
        const current = await status();

        const results = await Promise.allSettled([
            register(memberA, current, true),
            register(memberA, current, false),
        ]);

        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        const rejected = results.filter((result) => result.status === 'rejected');
        expect(rejected).toHaveLength(1);
        expect(rejected[0].reason).toMatchObject({ code: 'STALE_REGISTRATION' });
    });

    test('3. a stale unregister after a newer register gets 409 and the row stays enabled', async () => {
        const first = await status();
        const registered = await register(memberA, first, true);

        await expect(unregister(memberA, first)).rejects.toMatchObject({ code: 'STALE_REGISTRATION' });
        expect(await row()).toMatchObject({ enabled: true, revision: registered.revision });
    });

    test("4. another user's unregister reports changed: false", async () => {
        const registered = await register(memberA, await status(), true);

        const result = await unregister(memberB, { epoch: registered.epoch, revision: registered.revision });

        expect(result.changed).toBe(false);
        expect(await row()).toMatchObject({ enabled: true, revision: registered.revision });
    });

    test('5. every mutation changes the revision', async () => {
        const seen = new Set();
        let current = await status();
        seen.add(current.revision);

        const r1 = await register(memberA, current, true);
        seen.add(r1.revision);
        const r2 = await register(memberA, r1, true); // same owner, same state
        seen.add(r2.revision);
        const u1 = await unregister(memberA, r2);
        expect(u1.changed).toBe(true);
        seen.add(u1.revision);
        current = await status();
        expect(current.revision).toBe(u1.revision);

        expect(seen.size).toBe(4);
    });

    test('6. after Start the pre-Start epoch gets 409 even with a null revision', async () => {
        const before = await status();

        await closeAndStart2026();

        await expect(register(memberA, { epoch: before.epoch, revision: null }, true))
            .rejects.toMatchObject({ code: 'STALE_REGISTRATION' });
        expect(await row()).toBeNull();
    });

    test('7. matching-state reaffirmation (disable) fences an earlier enable', async () => {
        const disabled = await register(memberA, await status(), false); // row disabled at R
        const R = { epoch: disabled.epoch, revision: disabled.revision };

        const reaffirmed = await register(memberA, R, false);
        expect(reaffirmed.revision).not.toBe(R.revision);

        // An earlier enable request, built against R, arrives late.
        await expect(register(memberA, R, true)).rejects.toMatchObject({ code: 'STALE_REGISTRATION' });
        expect(await row()).toMatchObject({ enabled: false, revision: reaffirmed.revision });
    });

    test('8. matching-state reaffirmation (enable) fences an earlier unregister and disable', async () => {
        const enabled = await register(memberA, await status(), true); // row enabled (mine) at R
        const R = { epoch: enabled.epoch, revision: enabled.revision };

        const reaffirmed = await register(memberA, R, true);
        expect(reaffirmed.revision).not.toBe(R.revision);

        await expect(unregister(memberA, R)).rejects.toMatchObject({ code: 'STALE_REGISTRATION' });
        await expect(register(memberA, R, false)).rejects.toMatchObject({ code: 'STALE_REGISTRATION' });
        expect(await row()).toMatchObject({ enabled: true, revision: reaffirmed.revision });
    });

    test('9. cleanup after Start with the old epoch writes nothing', async () => {
        const registered = await register(memberA, await status(), true);

        await closeAndStart2026();

        const cleaned = await cleanupInvalidTokens({
            epoch: registered.epoch,
            sent: [{ token: TOKEN, revision: registered.revision }],
            fcmResponse: INVALID_RESPONSE,
        });
        expect(cleaned).toBe(0);
        expect((await firestore.collection('pushTokens').get()).size).toBe(1);
        const after = await row();
        expect(after).toMatchObject({ enabled: true, revision: registered.revision });
        expect(after.invalid).toBeUndefined();
    });

    test('9b. cleanup in a closed year writes nothing', async () => {
        const registered = await register(memberA, await status(), true);

        await closeYear({ year: 2025 });

        const cleaned = await cleanupInvalidTokens({
            epoch: registered.epoch,
            sent: [{ token: TOKEN, revision: registered.revision }],
            fcmResponse: INVALID_RESPONSE,
        });
        expect(cleaned).toBe(0);
        expect(await row()).toMatchObject({ enabled: true, revision: registered.revision });
    });

    test('10. cleanup with a superseded revision leaves the newer enabled row untouched', async () => {
        const first = await register(memberA, await status(), true);
        const newer = await register(memberA, first, true);

        const cleaned = await cleanupInvalidTokens({
            epoch: first.epoch,
            sent: [{ token: TOKEN, revision: first.revision }],
            fcmResponse: INVALID_RESPONSE,
        });

        expect(cleaned).toBe(0);
        expect(await row()).toMatchObject({ enabled: true, revision: newer.revision });
        expect((await row()).invalid).toBeUndefined();
    });

    test('11. cleanup with the current revision disables the row; old revision or null then gets 409', async () => {
        const registered = await register(memberA, await status(), true);

        const cleaned = await cleanupInvalidTokens({
            epoch: registered.epoch,
            sent: [{ token: TOKEN, revision: registered.revision }],
            fcmResponse: INVALID_RESPONSE,
        });

        expect(cleaned).toBe(1);
        const after = await row();
        expect(after).toMatchObject({ enabled: false, invalid: true });
        expect(after.revision).not.toBe(registered.revision);

        await expect(register(memberA, { epoch: registered.epoch, revision: registered.revision }, true))
            .rejects.toMatchObject({ code: 'STALE_REGISTRATION' });
        await expect(register(memberA, { epoch: registered.epoch, revision: null }, true))
            .rejects.toMatchObject({ code: 'STALE_REGISTRATION' });
    });

    test('12. cleanup for a token with no row writes nothing and creates nothing', async () => {
        const current = await status();

        const cleaned = await cleanupInvalidTokens({
            epoch: current.epoch,
            sent: [{ token: OTHER_TOKEN, revision: null }],
            fcmResponse: INVALID_RESPONSE,
        });

        expect(cleaned).toBe(0);
        expect(await row(OTHER_TOKEN)).toBeNull();
    });
});
