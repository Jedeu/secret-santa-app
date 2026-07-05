const nextJest = require('next/jest');

const createJestConfig = nextJest({
    dir: './',
});

const integrationJestConfig = {
    setupFiles: ['<rootDir>/__tests__/integration/setup.js'],
    testEnvironment: 'jest-environment-node',
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
    },
    // jose (firebase-admin dependency) is ESM-only and needs transforming; it must be
    // allowlisted BOTH here AND in next.config.js transpilePackages, because a file is
    // skipped if it matches any ignore pattern and next/jest prepends its own.
    transformIgnorePatterns: [
        'node_modules/(?!(react-markdown|remark-gfm|vfile|unist-util|unified|bail|is-plain-obj|trough|remark|mdast|micromark|decode|character|property|hast|space|comma|pretty|ccount|markdown-table|escape-string-regexp|jose)/)'
    ],
    testMatch: ['<rootDir>/__tests__/integration/**/*.test.js'],
    testPathIgnorePatterns: [
        '/node_modules/',
        '/.next/',
        '/e2e/'
    ],
    testTimeout: 20000,
};

module.exports = createJestConfig(integrationJestConfig);
