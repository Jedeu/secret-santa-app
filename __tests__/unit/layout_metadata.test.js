import { metadata, viewport } from '@/app/layout';

describe('app layout metadata', () => {
    test('exports PWA metadata for manifest and iOS standalone mode', () => {
        expect(metadata).toMatchObject({
            title: 'Secret Santa',
            description: 'Secret Santa gift exchange with your friends',
            manifest: '/manifest.json',
            appleWebApp: {
                capable: true,
                statusBarStyle: 'black-translucent',
                title: 'Secret Santa',
            },
            icons: {
                icon: '/icons/icon-192x192.png',
                apple: '/icons/icon-180x180.png',
            },
        });
    });

    test('viewport does not block pinch-zoom (WCAG 1.4.4)', () => {
        expect(viewport).toEqual({
            width: 'device-width',
            initialScale: 1,
        });
        expect(viewport).not.toHaveProperty('maximumScale');
        expect(viewport).not.toHaveProperty('userScalable');
    });
});
