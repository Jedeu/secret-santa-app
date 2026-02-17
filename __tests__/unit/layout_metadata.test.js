import { metadata } from '@/app/layout';

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
});
