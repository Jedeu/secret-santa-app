const withPWA = require('@ducanh2912/next-pwa').default({
    dest: 'public',
    disable: process.env.NODE_ENV === 'development',
    register: true,
    skipWaiting: true,
    customWorkerSrc: 'worker',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    // jose (firebase-admin dependency) ships ESM-only. next/jest folds this list
    // into its node_modules transform allowlist so CJS test runs can parse it.
    transpilePackages: ['jose'],
};

module.exports = withPWA(nextConfig);
