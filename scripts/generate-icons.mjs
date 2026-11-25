// Renders assets/icons/app-icon.svg into every app icon, and assets/icons/badge.svg into the
// transparent notification badge, using the Chromium that Playwright (already a dev
// dependency) installs: `node scripts/generate-icons.mjs`.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const root = path.join(import.meta.dirname, '..');
const svg = fs.readFileSync(path.join(root, 'assets/icons/app-icon.svg'), 'utf-8');
const badgeSvg = fs.readFileSync(path.join(root, 'assets/icons/badge.svg'), 'utf-8');

// The artwork already sits inside the maskable safe zone, so one render serves both 512s.
const pngs = {
    'public/icons/icon-180x180.png': 180,
    'public/icons/icon-192x192.png': 192,
    'public/icons/icon-512x512.png': 512,
    'public/icons/icon-maskable-512x512.png': 512,
};
const faviconSizes = [16, 32, 48];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function render(size, source = svg, transparent = false) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
        `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${source}`
    );
    return page.screenshot({ type: 'png', omitBackground: transparent });
}

for (const [file, size] of Object.entries(pngs)) {
    fs.writeFileSync(path.join(root, file), await render(size));
}
fs.writeFileSync(path.join(root, 'public/icons/badge-96x96.png'), await render(96, badgeSvg, true));

// An ICO may hold PNG images directly: a 6-byte header, a 16-byte entry per image, then the images.
const images = [];
for (const size of faviconSizes) images.push({ size, data: await render(size) });
await browser.close();

const header = Buffer.alloc(6 + 16 * images.length);
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach(({ size, data }, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(size, entry); // width
    header.writeUInt8(size, entry + 1); // height
    header.writeUInt16LE(1, entry + 4); // colour planes
    header.writeUInt16LE(32, entry + 6); // bits per pixel
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
});
fs.writeFileSync(
    path.join(root, 'src/app/favicon.ico'),
    Buffer.concat([header, ...images.map(({ data }) => data)])
);
