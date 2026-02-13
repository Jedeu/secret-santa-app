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
    transformIgnorePatterns: [
        'node_modules/(?!(react-markdown|remark-gfm|vfile|unist-util|unified|bail|is-plain-obj|trough|remark|mdast|micromark|decode|character|property|hast|space|comma|pretty|ccount|markdown-table|escape-string-regexp)/)'
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
