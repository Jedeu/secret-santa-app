// Optional: configure or set up a testing framework before each test.
// If you delete this file, remove `setupFilesAfterEnv` from `jest.config.js`

// Used for __tests__/testing-library.js
// Learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom'

// Suppress specific console warnings
const originalWarn = console.warn;
console.warn = (...args) => {
    // Suppress Firebase env warning
    if (args[0]?.includes('Firebase environment variables missing')) return;
    // Suppress participant list warning from auth tests
    if (args[0]?.includes('User') && args[0]?.includes('not in participants list')) return;
    originalWarn(...args);
};

// Mock console.error to silence reset failures in admin reset tests
const originalError = console.error;
console.error = (...args) => {
    if (args[0]?.includes('Reset failed:')) return;
    originalError(...args);
};
// Mock TextEncoder/TextDecoder for Node environment (needed for some libs)
if (typeof global.TextEncoder === 'undefined') {
    const { TextEncoder, TextDecoder } = require('util');
    global.TextEncoder = TextEncoder;
    global.TextDecoder = TextDecoder;
}
