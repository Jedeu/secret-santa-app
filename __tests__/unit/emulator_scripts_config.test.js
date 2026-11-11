/**
 * Maintenance scripts target the Firestore emulator only, with the app's project id
 * and the app's collection list.
 */
import fs from 'node:fs';
import path from 'node:path';
import { GLOBAL_COLLECTIONS, YEAR_COLLECTIONS } from '@/lib/year-paths';

const mockInitializeApp = jest.fn();
const mockGetFirestore = jest.fn(() => ({ __fake: 'firestore' }));

jest.mock('firebase-admin/app', () => ({
    initializeApp: (...args) => mockInitializeApp(...args),
    getApps: () => [],
}));

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: (...args) => mockGetFirestore(...args),
}));

const ROOT = path.join(__dirname, '..', '..');
const HELPER_PATH = path.join(ROOT, 'scripts', 'lib', 'emulator-firestore.js');

function loadHelper() {
    let helper;
    jest.isolateModules(() => {
        helper = require(HELPER_PATH);
    });
    return helper;
}

describe('scripts/lib/emulator-firestore', () => {
    let savedHost;

    beforeEach(() => {
        jest.clearAllMocks();
        savedHost = process.env.FIRESTORE_EMULATOR_HOST;
    });

    afterEach(() => {
        if (savedHost === undefined) {
            delete process.env.FIRESTORE_EMULATOR_HOST;
        } else {
            process.env.FIRESTORE_EMULATOR_HOST = savedHost;
        }
    });

    test('the project id matches .firebaserc and both Firebase lib files', () => {
        const { EMULATOR_PROJECT_ID } = loadHelper();
        const firebaserc = JSON.parse(fs.readFileSync(path.join(ROOT, '.firebaserc'), 'utf8'));
        const adminSource = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'firebase.js'), 'utf8');
        const clientSource = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'firebase-client.js'), 'utf8');

        expect(EMULATOR_PROJECT_ID).toBe(firebaserc.projects.default);
        expect(adminSource).toContain(`projectId: '${EMULATOR_PROJECT_ID}'`);
        expect(clientSource).toContain(`'${EMULATOR_PROJECT_ID}'`);
    });

    test('APP_COLLECTIONS equals the global and year collection names (as sets)', () => {
        const { APP_COLLECTIONS } = loadHelper();
        expect(new Set(APP_COLLECTIONS)).toEqual(new Set([...GLOBAL_COLLECTIONS, ...YEAR_COLLECTIONS]));
        expect(APP_COLLECTIONS).toHaveLength(new Set(APP_COLLECTIONS).size);
    });

    test('clearEmulatorFirestore is exported for the emulator wipe script', () => {
        const { clearEmulatorFirestore } = loadHelper();
        expect(typeof clearEmulatorFirestore).toBe('function');
    });

    test('defaults to the loopback emulator host and initializes with the project id', () => {
        delete process.env.FIRESTORE_EMULATOR_HOST;
        const { getEmulatorFirestore, EMULATOR_PROJECT_ID } = loadHelper();

        const db = getEmulatorFirestore();

        expect(process.env.FIRESTORE_EMULATOR_HOST).toBe('127.0.0.1:8080');
        expect(mockInitializeApp).toHaveBeenCalledWith({ projectId: EMULATOR_PROJECT_ID });
        expect(db).toEqual({ __fake: 'firestore' });
    });

    test.each(['localhost:8080', '127.0.0.1:9999'])('accepts loopback host %s', (host) => {
        process.env.FIRESTORE_EMULATOR_HOST = host;
        const { getEmulatorFirestore } = loadHelper();

        expect(() => getEmulatorFirestore()).not.toThrow();
    });

    test.each(['firestore.googleapis.com:443', '10.0.0.5:8080', 'example.test:8080'])(
        'exits with code 1 for non-loopback host %s before any Firestore call',
        (host) => {
            process.env.FIRESTORE_EMULATOR_HOST = host;
            const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined);
            const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            const { getEmulatorFirestore } = loadHelper();

            try {
                expect(() => getEmulatorFirestore()).toThrow();
                expect(exitSpy).toHaveBeenCalledWith(1);
                expect(mockInitializeApp).not.toHaveBeenCalled();
                expect(mockGetFirestore).not.toHaveBeenCalled();
            } finally {
                exitSpy.mockRestore();
                errorSpy.mockRestore();
            }
        }
    );

    test('the scripts use the helper and contain no hardcoded user ids', () => {
        const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
        ['wipe_db.js', 'check_all_data.js', 'check_messages.js', 'test_message_routing.js'].forEach((file) => {
            const source = fs.readFileSync(path.join(ROOT, 'scripts', file), 'utf8');
            expect(source).toContain("require('./lib/emulator-firestore')");
            expect(source).not.toMatch(uuidPattern);
            expect(source).not.toContain('demo-secret-santa');
        });
    });
});
