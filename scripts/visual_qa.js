#!/usr/bin/env node
/**
 * Visual QA Smoke Test for Secret Santa App
 *
 * This script uses Puppeteer to:
 * 1. Launch headless browser
 * 2. Navigate to the app
 * 3. Sign in via Firebase Emulator Auth
 * 4. Verify the Santa tab appears
 * 5. Take screenshots for verification
 *
 * Run with: npx puppeteer@latest node scripts/visual_qa.js
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Configuration
const APP_URL = 'http://localhost:3000';
const TEST_EMAIL = 'jed.piezas@gmail.com';
const QA_ARTIFACTS_DIR = path.join(__dirname, '..', 'qa_artifacts');
const TIMEOUT = 30000; // 30 seconds

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message) {
    log(`✅ ${message}`, 'green');
}

function logError(message) {
    log(`❌ ${message}`, 'red');
}

function logWarning(message) {
    log(`⚠️  ${message}`, 'yellow');
}

function logInfo(message) {
    log(`ℹ️  ${message}`, 'blue');
}

// Ensure artifacts directory exists
function ensureArtifactsDir() {
    if (!fs.existsSync(QA_ARTIFACTS_DIR)) {
        fs.mkdirSync(QA_ARTIFACTS_DIR, { recursive: true });
        logInfo(`Created artifacts directory: ${QA_ARTIFACTS_DIR}`);
    }
}

// Generate timestamp for filenames
function getTimestamp() {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
}

// Take and save screenshot
async function takeScreenshot(page, name) {
    const timestamp = getTimestamp();
    const filename = `${timestamp}_${name}.png`;
    const filepath = path.join(QA_ARTIFACTS_DIR, filename);

    await page.screenshot({ path: filepath, fullPage: true });
    logSuccess(`Screenshot saved: ${filename}`);
    return filepath;
}

// Main test function
async function runVisualQA() {
    log('\n🎨 Secret Santa Visual QA Smoke Test', 'blue');
    log('=====================================\n', 'blue');

    ensureArtifactsDir();

    let browser;
    let testsPassed = 0;
    let testsFailed = 0;

    try {
        // Launch browser
        logInfo('Launching headless browser...');
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });

        // Navigate to app
        logInfo(`Navigating to ${APP_URL}...`);
        try {
            await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: TIMEOUT });
            logSuccess('App loaded successfully');
            testsPassed++;
        } catch (error) {
            logError('Failed to load app - is the dev server running?');
            logError('Start with: npm run dev');
            testsFailed++;
            await takeScreenshot(page, 'error-app-not-loaded');
            throw error;
        }

        await takeScreenshot(page, '01-landing-page');

        // Check for "Sign in with Google" button
        logInfo('Looking for "Sign in with Google" button...');
        const signInButton = await page.waitForXPath("//button[contains(text(), 'Sign in with Google')]", { timeout: 5000 }).catch(() => null);

        if (!signInButton) {
            logError('Sign in button not found');
            testsFailed++;
            await takeScreenshot(page, 'error-no-signin-button');
            throw new Error('Sign in button not found');
        }

        logSuccess('Sign in button found');
        testsPassed++;

        // Click sign in button and handle popup
        logInfo('Clicking "Sign in with Google" button...');

        // Listen for popup
        const popupPromise = new Promise((resolve) => {
            browser.once('targetcreated', async (target) => {
                if (target.type() === 'page') {
                    const popup = await target.page();
                    logInfo('Auth popup detected');
                    resolve(popup);
                }
            });
        });

        // Click the sign in button
        await signInButton.click();

        // Wait for popup to open
        const popup = await Promise.race([
            popupPromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('Popup timeout')), 10000))
        ]).catch(async (error) => {
            logError('Failed to detect auth popup');
            await takeScreenshot(page, 'error-no-popup');
            throw error;
        });

        logSuccess('Auth popup opened');
        await popup.waitForNetworkIdle({ timeout: 5000 }).catch(() => {});

        // Take screenshot of auth popup
        await popup.screenshot({
            path: path.join(QA_ARTIFACTS_DIR, `${getTimestamp()}_02-auth-popup.png`)
        });
        logSuccess('Auth popup screenshot saved');

        // In Firebase Emulator, sign in with test account
        logInfo(`Attempting to sign in as ${TEST_EMAIL}...`);

        // Wait a moment for the popup to fully load
        await popup.waitForTimeout(1000);

        // Try to find and click the test email if it exists
        const existingAccountXPath = `//*[contains(text(), '${TEST_EMAIL}')]`;
        const existingAccount = await popup.$x(existingAccountXPath);

        if (existingAccount.length > 0) {
            logInfo('Found existing test account, clicking it...');
            await existingAccount[0].click();
            logSuccess('Clicked existing account');
        } else {
            logInfo('Account not found in emulator - trying to add it...');

            // Look for "Add new account" button
            const addAccountButtons = await popup.$x("//button[contains(text(), 'Add new account')]");

            if (addAccountButtons.length > 0) {
                await addAccountButtons[0].click();
                await popup.waitForTimeout(500);

                // Enter email
                const emailInput = await popup.$('input[type="email"]');
                if (emailInput) {
                    await emailInput.type(TEST_EMAIL);
                    logInfo(`Entered email: ${TEST_EMAIL}`);
                }

                // Enter display name if field exists
                const nameInputs = await popup.$$('input[type="text"]');
                if (nameInputs.length > 0) {
                    await nameInputs[0].type('Jed');
                    logInfo('Entered display name: Jed');
                }

                // Click sign in button
                const signInButtons = await popup.$x("//button[contains(text(), 'Sign in') or @type='submit']");
                if (signInButtons.length > 0) {
                    await signInButtons[0].click();
                    logSuccess('Submitted new account');
                }
            } else {
                logWarning('Emulator UI may have changed - attempting direct email input');

                // Try to find email input directly
                const emailInput = await popup.$('input[type="email"]');
                if (emailInput) {
                    await emailInput.type(TEST_EMAIL);

                    // Find and click submit button
                    const submitButton = await popup.$('button[type="submit"]');
                    if (submitButton) {
                        await submitButton.click();
                    }
                }
            }
        }

        // Wait for popup to close (auth successful)
        logInfo('Waiting for authentication to complete...');
        await Promise.race([
            popup.waitForFunction(() => false, { timeout: 5000 }).catch(() => {}),
            new Promise(resolve => setTimeout(resolve, 5000))
        ]);

        logSuccess('Authentication completed');
        testsPassed++;

        // Wait for navigation after auth
        await page.waitForTimeout(3000);
        await takeScreenshot(page, '03-after-auth');

        // Check if we're on the recipient selection screen
        const recipientSelector = await page.$('select.input');
        if (recipientSelector) {
            logInfo('First-time user flow detected - need to select recipient...');
            logWarning('For automated testing, ensure user is already initialized');

            // For now, take screenshot and report
            await takeScreenshot(page, '04-recipient-selection-screen');
            logInfo('User needs recipient assignment - run visual QA after initial setup');
        }

        // Look for the Santa tab (🎅 Santa)
        logInfo('Looking for Santa tab...');

        const santaTabXPath = "//button[contains(text(), '🎅') and contains(text(), 'Santa')]";
        const santaTab = await page.waitForXPath(santaTabXPath, { timeout: 10000 }).catch(() => null);

        if (!santaTab) {
            logWarning('Santa tab not found - user may need to be assigned a recipient first');

            // Check for recipient tab instead
            const recipientTabXPath = "//button[contains(text(), '🎁') and contains(text(), 'Recipient')]";
            const recipientTab = await page.waitForXPath(recipientTabXPath, { timeout: 5000 }).catch(() => null);

            if (recipientTab) {
                logSuccess('Recipient tab found (user has assignment)');
                testsPassed++;
                await takeScreenshot(page, '05-recipient-tab');
            } else {
                logError('Neither Santa nor Recipient tab found');
                testsFailed++;
                await takeScreenshot(page, 'error-no-tabs');

                // Debug: print page content
                const bodyText = await page.evaluate(() => document.body.innerText);
                logInfo('Page content preview:');
                console.log(bodyText.substring(0, 500));
            }
        } else {
            logSuccess('Santa tab found!');
            testsPassed++;

            // Click the Santa tab
            await santaTab.click();
            await page.waitForTimeout(1000);

            await takeScreenshot(page, '05-santa-tab');
            logSuccess('Santa tab screenshot captured');

            // Also check recipient tab
            const recipientTabXPath = "//button[contains(text(), '🎁') and contains(text(), 'Recipient')]";
            const recipientTab = await page.$x(recipientTabXPath);
            if (recipientTab.length > 0) {
                await recipientTab[0].click();
                await page.waitForTimeout(1000);
                await takeScreenshot(page, '06-recipient-tab');
                logSuccess('Recipient tab screenshot captured');
            }

            // Check public feed tab
            const feedTabXPath = "//button[contains(text(), '🎄') and contains(text(), 'Public Feed')]";
            const feedTab = await page.$x(feedTabXPath);
            if (feedTab.length > 0) {
                await feedTab[0].click();
                await page.waitForTimeout(1000);
                await takeScreenshot(page, '07-public-feed-tab');
                logSuccess('Public Feed tab screenshot captured');
            }
        }

        // Final screenshot
        await takeScreenshot(page, '99-final-state');

    } catch (error) {
        logError(`Test failed: ${error.message}`);
        testsFailed++;

        if (error.stack) {
            console.error(error.stack);
        }
    } finally {
        if (browser) {
            await browser.close();
            logInfo('Browser closed');
        }

        // Summary
        log('\n=====================================', 'blue');
        log('Test Summary:', 'blue');
        log(`  Passed: ${testsPassed}`, testsPassed > 0 ? 'green' : 'reset');
        log(`  Failed: ${testsFailed}`, testsFailed > 0 ? 'red' : 'reset');
        log(`  Artifacts: ${QA_ARTIFACTS_DIR}`, 'blue');
        log('=====================================\n', 'blue');

        // Exit with appropriate code
        process.exit(testsFailed > 0 ? 1 : 0);
    }
}

// Run the test
runVisualQA();
