/**
 * @jest-environment jsdom
 *
 * The page's Firebase app config must carry messagingSenderId and appId (required by
 * FCM getToken) when the env vars are set, and omit them when they are not.
 */

jest.unmock('@/lib/firebase-client');

const mockInitializeApp = jest.fn(() => ({ name: '[DEFAULT]' }));

jest.mock('firebase/app', () => ({
    initializeApp: (...args) => mockInitializeApp(...args),
    getApps: () => [],
}));

jest.mock('firebase/firestore', () => ({
    getFirestore: jest.fn(() => ({})),
    connectFirestoreEmulator: jest.fn(),
    enableIndexedDbPersistence: jest.fn(() => Promise.resolve()),
    CACHE_SIZE_UNLIMITED: -1,
}));

jest.mock('firebase/auth', () => ({
    getAuth: jest.fn(() => ({})),
    connectAuthEmulator: jest.fn(),
}));

const ENV_KEYS = [
    'NEXT_PUBLIC_FIREBASE_API_KEY',
    'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
    'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
    'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
    'NEXT_PUBLIC_FIREBASE_APP_ID',
];

function loadClient() {
    jest.isolateModules(() => {
        require('@/lib/firebase-client');
    });
}

describe('firebase-client config', () => {
    let saved;

    beforeEach(() => {
        jest.clearAllMocks();
        saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
        process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'fake-api-key';
        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = 'localhost';
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'demo-config-test';
    });

    afterEach(() => {
        ENV_KEYS.forEach((key) => {
            if (saved[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = saved[key];
            }
        });
    });

    test('passes appId and messagingSenderId to initializeApp when set', () => {
        process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = '000000000000';
        process.env.NEXT_PUBLIC_FIREBASE_APP_ID = '1:000000000000:web:0000000000000000';

        loadClient();

        expect(mockInitializeApp).toHaveBeenCalledTimes(1);
        expect(mockInitializeApp.mock.calls[0][0]).toEqual(expect.objectContaining({
            projectId: 'demo-config-test',
            messagingSenderId: '000000000000',
            appId: '1:000000000000:web:0000000000000000',
        }));
    });

    test('omits appId and messagingSenderId when unset', () => {
        delete process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID;
        delete process.env.NEXT_PUBLIC_FIREBASE_APP_ID;

        loadClient();

        expect(mockInitializeApp).toHaveBeenCalledTimes(1);
        const config = mockInitializeApp.mock.calls[0][0];
        expect(config).not.toHaveProperty('messagingSenderId');
        expect(config).not.toHaveProperty('appId');
    });
});
