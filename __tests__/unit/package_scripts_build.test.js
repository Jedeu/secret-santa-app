import fs from 'node:fs';
import path from 'node:path';

describe('package scripts', () => {
    test('uses webpack for production build compatibility with next-pwa', () => {
        const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

        expect(packageJson.scripts.build).toBe('next build --webpack');
        expect(packageJson.devDependencies.webpack).toBeTruthy();
    });
});
