function loadConfigFor(nodeEnv) {
    jest.resetModules();
    process.env.NODE_ENV = nodeEnv;

    let capturedOptions;

    jest.doMock('@ducanh2912/next-pwa', () => ({
        __esModule: true,
        default: jest.fn((options) => {
            capturedOptions = options;
            return (nextConfig) => ({
                ...nextConfig,
                __pwaOptions: options,
            });
        }),
    }));

    const config = require('../../next.config.js');
    return { config, capturedOptions };
}

describe('next.config PWA integration', () => {
    const originalNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
        jest.resetModules();
        jest.dontMock('@ducanh2912/next-pwa');
        process.env.NODE_ENV = originalNodeEnv;
    });

    test('enables PWA wrapper with production-safe defaults', () => {
        const { config, capturedOptions } = loadConfigFor('production');

        expect(capturedOptions).toMatchObject({
            dest: 'public',
            disable: false,
            register: true,
            skipWaiting: true,
        });

        expect(config.reactStrictMode).toBe(true);
        expect(config.__pwaOptions).toMatchObject({
            dest: 'public',
            disable: false,
        });
    });

    test('disables PWA behavior in development', () => {
        const { capturedOptions } = loadConfigFor('development');

        expect(capturedOptions).toMatchObject({
            disable: true,
            register: true,
            skipWaiting: true,
        });
    });
});
