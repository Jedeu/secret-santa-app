import fs from 'node:fs';
import path from 'node:path';

const projectRoot = path.join(__dirname, '..', '..');
const manifestPath = path.join(projectRoot, 'public', 'manifest.json');
const iconsDir = path.join(projectRoot, 'public', 'icons');

function readPngDimensions(filePath) {
    const fileBuffer = fs.readFileSync(filePath);

    // PNG IHDR stores width/height at bytes 16-23 in network byte order.
    return {
        width: fileBuffer.readUInt32BE(16),
        height: fileBuffer.readUInt32BE(20),
    };
}

describe('PWA manifest and icon assets', () => {
    test('manifest declares installability metadata and icon set', () => {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

        expect(manifest).toMatchObject({
            name: 'Secret Santa',
            short_name: 'Santa',
            start_url: '/',
            display: 'standalone',
            background_color: '#0a0a0a',
            theme_color: '#ff3b30',
            orientation: 'portrait',
        });

        expect(manifest.icons).toEqual([
            {
                src: '/icons/icon-192x192.png',
                sizes: '192x192',
                type: 'image/png',
            },
            {
                src: '/icons/icon-512x512.png',
                sizes: '512x512',
                type: 'image/png',
            },
            {
                src: '/icons/icon-maskable-512x512.png',
                sizes: '512x512',
                type: 'image/png',
                purpose: 'maskable',
            },
        ]);
    });

    test('required icon files exist with expected dimensions', () => {
        const requiredIcons = {
            'icon-180x180.png': { width: 180, height: 180 },
            'icon-192x192.png': { width: 192, height: 192 },
            'icon-512x512.png': { width: 512, height: 512 },
            'icon-maskable-512x512.png': { width: 512, height: 512 },
        };

        Object.entries(requiredIcons).forEach(([fileName, expectedDimensions]) => {
            const filePath = path.join(iconsDir, fileName);
            expect(fs.existsSync(filePath)).toBe(true);
            expect(readPngDimensions(filePath)).toEqual(expectedDimensions);
        });
    });
});
