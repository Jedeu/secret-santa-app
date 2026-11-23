import { test, expect } from '@playwright/test';

/**
 * Reacting with any emoji through the full picker (emulators only).
 *
 * Santa sends a message; the recipient taps it, opens the full picker with "+",
 * and reacts with a ZWJ emoji (👩‍💻) that the old rules rejected. Santa's page
 * shows the chip too, so the reaction was stored and delivered by the listener.
 */

const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const PROJECT_ID = 'xmasteak-app';
const TECHNOLOGIST = '👩‍💻';

test('a recipient reacts with an emoji from the full picker on a phone', async ({ browser }) => {
    // Two logins plus the picker's lazy chunk; a cold dev server compiles all of it.
    test.setTimeout(90000);
    const santaContext = await browser.newContext();
    const santaPage = await santaContext.newPage();

    await santaPage.request.post('/api/dev/seed');
    await santaPage.request.post('/api/dev/assign');

    await santaPage.goto('/dev/login');
    await santaPage.getByRole('button', { name: 'Jed' }).click();
    await santaPage.waitForURL('/');

    await expect.poll(async () => {
        const data = await santaPage.evaluate(() => (window as any).__e2eUserData__);
        return data?.recipientId;
    }, { timeout: 10000 }).toBeTruthy();
    const recipientId = await santaPage.evaluate(() => (window as any).__e2eUserData__.recipientId);
    const recipientDoc = await santaPage.request.get(
        `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${recipientId}`,
        { headers: { Authorization: 'Bearer owner' } }
    );
    expect(recipientDoc.ok(), 'recipient user doc must exist in the emulator').toBeTruthy();
    const recipientName = (await recipientDoc.json()).fields.name.stringValue;

    const message = `React to me ${Date.now()}`;
    const input = santaPage.getByPlaceholder(/type a message/i);
    await expect(input).toBeVisible({ timeout: 10000 });
    await input.fill(message);
    const sent = santaPage.waitForResponse(
        (response) => response.url().includes('/api/messages/send') && response.request().method() === 'POST'
    );
    await santaPage.getByRole('button', { name: /send/i }).click();
    expect((await sent).ok()).toBeTruthy();

    const recipientContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const recipientPage = await recipientContext.newPage();
    await recipientPage.goto('/dev/login');
    await recipientPage.getByRole('button', { name: recipientName, exact: true }).click();
    await recipientPage.waitForURL('/');
    await recipientPage.getByRole('button', { name: /santa/i }).first().click();

    await recipientPage.getByText(message).click();
    await recipientPage.getByRole('button', { name: 'More reactions' }).click();

    const sheet = recipientPage.getByRole('dialog', { name: 'Choose a reaction' });
    await expect(sheet).toBeVisible();
    await sheet.getByLabel('Type to search for an emoji').fill('technologist');
    // Wait for the filtered results before clicking, so the grid no longer shifts.
    await expect.poll(() => sheet.locator('button.epr-emoji:visible').count()).toBeLessThan(10);
    await sheet.locator(`button[data-unified="1f469-200d-1f4bb"]`).click();
    await expect(sheet).toBeHidden();

    const chip = `${TECHNOLOGIST} reaction count 1`;
    await expect(recipientPage.getByRole('button', { name: chip })).toBeVisible({ timeout: 10000 });
    await expect(santaPage.getByRole('button', { name: chip })).toBeVisible({ timeout: 10000 });

    await santaContext.close();
    await recipientContext.close();
});
