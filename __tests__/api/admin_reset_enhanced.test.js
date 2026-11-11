/**
 * Tests for /api/admin/reset - retired: always 410 RESET_RETIRED, no Firestore access.
 */

import { POST } from '@/app/api/admin/reset/route';
import { firestore, auth as adminAuth } from '@/lib/firebase';
import { ADMIN_EMAILS } from '@/lib/config';

jest.mock('@/lib/firebase', () => ({
    firestore: {
        collection: jest.fn(),
        runTransaction: jest.fn(),
        getAll: jest.fn(),
    },
    auth: {
        verifyIdToken: jest.fn(),
    },
}));

const ADMIN_EMAIL = ADMIN_EMAILS[0];

function createRequest(withToken = true) {
    return {
        method: 'POST',
        headers: {
            get: (name) => (withToken && name === 'Authorization' ? 'Bearer fake-token' : null)
        },
        json: async () => ({}),
    };
}

describe('POST /api/admin/reset', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        adminAuth.verifyIdToken.mockResolvedValue({ uid: 'admin-uid', email: ADMIN_EMAIL, email_verified: true });
    });

    test.each([
        ['with an admin token', true],
        ['without a token', false],
    ])('returns 410 RESET_RETIRED %s', async (_label, withToken) => {
        const res = await POST(createRequest(withToken));
        const data = await res.json();

        expect(res.status).toBe(410);
        expect(data).toEqual({
            error: 'Reset has been retired. Use Close year and Start new year.',
            code: 'RESET_RETIRED',
        });
    });

    test('touches neither Firestore nor token verification', async () => {
        await POST(createRequest());

        expect(adminAuth.verifyIdToken).not.toHaveBeenCalled();
        expect(firestore.collection).not.toHaveBeenCalled();
        expect(firestore.runTransaction).not.toHaveBeenCalled();
        expect(firestore.getAll).not.toHaveBeenCalled();
    });
});
