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
            customWorkerSrc: 'worker',
        });

        expect(config.reactStrictMode).toBe(true);
        expect(config.__pwaOptions).toMatchObject({
            dest: 'public',
            disable: false,
        });

        // GIPHY hosts are NetworkOnly with no-store, ahead of the preserved defaults.
        expect(capturedOptions.extendDefaultRuntimeCaching).toBe(true);
        const entries = capturedOptions.workboxOptions.runtimeCaching;
        expect(entries).toHaveLength(1);
        const [entry] = entries;
        expect(entry.handler).toBe('NetworkOnly');
        expect(entry.options).toEqual({ fetchOptions: { cache: 'no-store' } });
        expect(entry.options).not.toHaveProperty('cacheName');
        expect(entry.urlPattern).toBeInstanceOf(RegExp);

        const pattern = entry.urlPattern;
        [
            'https://api.giphy.com/v1/gifs/trending?api_key=e2e-giphy-placeholder&limit=24&offset=0&rating=pg-13',
            'https://media2.giphy.com/media/SyntheticGif01/200w.webp',
            'https://i.giphy.com/SyntheticGif01.webp',
            'https://giphy.com/embed/SyntheticGif01',
            'https://MEDIA.GIPHY.COM/media/SyntheticGif01/giphy.gif',
        ].forEach((url) => {
            const match = pattern.exec(url);
            expect(match).not.toBeNull();
            expect(match.index).toBe(0);
        });
        [
            'https://res.cloudinary.com/unit-cloud/image/upload/v1/ss-2026-x.png',
            'https://evilgiphy.com/x.gif',
            'https://giphy.com.evil.example/x.gif',
            'https://example.com/?u=https://giphy.com/embed/SyntheticGif01',
            'https://example.com/search?q=giphy.com',
            'http://media.giphy.com/x.gif',
        ].forEach((url) => {
            expect(pattern.test(url)).toBe(false);
        });
    });

    test('disables PWA behavior in development', () => {
        const { capturedOptions } = loadConfigFor('development');

        expect(capturedOptions).toMatchObject({
            disable: true,
            register: true,
            skipWaiting: true,
            customWorkerSrc: 'worker',
        });
    });
});
