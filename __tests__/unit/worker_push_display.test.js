/**
 * The custom service worker must not render its own notification for background
 * messages: the FCM SDK displays the server-provided notification payload, so a
 * custom background handler would show a duplicate.
 */
import fs from 'node:fs';
import path from 'node:path';

const mockGetMessaging = jest.fn(() => ({}));
const mockOnBackgroundMessage = jest.fn();
const mockInitializeApp = jest.fn(() => ({ name: '[DEFAULT]' }));

jest.mock('firebase/app', () => ({
    getApps: () => [],
    initializeApp: (...args) => mockInitializeApp(...args),
}));

jest.mock('firebase/messaging/sw', () => ({
    getMessaging: (...args) => mockGetMessaging(...args),
    onBackgroundMessage: (...args) => mockOnBackgroundMessage(...args),
}), { virtual: true });

const WORKER_PATH = path.join(__dirname, '..', '..', 'worker', 'index.js');
const ENV_KEYS = [
    'NEXT_PUBLIC_FIREBASE_API_KEY',
    'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
    'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
    'NEXT_PUBLIC_FIREBASE_APP_ID',
];

describe('worker push display', () => {
    let saved;
    let showNotification;
    let listeners;

    beforeEach(() => {
        jest.clearAllMocks();
        saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
        process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'fake-api-key';
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'demo-worker-test';
        process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = '000000000000';
        process.env.NEXT_PUBLIC_FIREBASE_APP_ID = '1:000000000000:web:0000000000000000';

        showNotification = jest.fn();
        listeners = {};
        global.self = {
            registration: { showNotification },
            addEventListener: jest.fn((type, handler) => {
                listeners[type] = handler;
            }),
        };
        global.clients = { matchAll: jest.fn(() => Promise.resolve([])), openWindow: jest.fn() };
    });

    afterEach(() => {
        ENV_KEYS.forEach((key) => {
            if (saved[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = saved[key];
            }
        });
        delete global.self;
        delete global.clients;
    });

    test('initializes messaging once and registers no background handler', () => {
        jest.isolateModules(() => {
            require(WORKER_PATH);
        });

        expect(mockGetMessaging).toHaveBeenCalledTimes(1);
        expect(mockOnBackgroundMessage).not.toHaveBeenCalled();
        expect(showNotification).not.toHaveBeenCalled();
        expect(listeners.notificationclick).toEqual(expect.any(Function));
    });

    test('the worker source never calls showNotification and has no custom tag', () => {
        const source = fs.readFileSync(WORKER_PATH, 'utf8');

        expect(source).not.toMatch(/showNotification/);
        expect(source).not.toMatch(/onBackgroundMessage/);
        expect(source).not.toMatch(/secret-santa-message["']/);
    });
});
