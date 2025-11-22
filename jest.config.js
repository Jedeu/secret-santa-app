const nextJest = require('next/jest')

const createJestConfig = nextJest({
    // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
    dir: './',
})

// Add any custom config to be passed to Jest
const customJestConfig = {
    setupFilesAfterEnv: ['<rootDir>/jest.setup.js', '<rootDir>/__tests__/setup.js'],
    testEnvironment: 'jest-environment-node', // Use node environment for API/Backend tests
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
    },
    transformIgnorePatterns: [
        'node_modules/(?!(react-markdown|remark-gfm|vfile|unist-util|unified|bail|is-plain-obj|trough|remark|mdast|micromark|decode|character|property|hast|space|comma|pretty|ccount|markdown-table|escape-string-regexp)/)'
    ],
    // Exclude integration tests from default test runs
    // Integration tests require Firebase Emulator to be running
    testPathIgnorePatterns: [
        '/node_modules/',
        '/__tests__/integration/',
        '/__tests__/helpers/',
        '/__tests__/setup.js'
    ],
}

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
module.exports = createJestConfig(customJestConfig)
