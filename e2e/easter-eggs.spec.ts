import { test, expect, type Browser, type Page } from '@playwright/test';

/**
 * Easter eggs on the emulators: a magic word fires its effect for both people in the chat,
 * only when the message arrives live, and Christmas Day mode can be forced in development.
 */

const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const PROJECT_ID = 'xmasteak-app';

async function login(browser: Browser, name: string): Promise<Page> {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/dev/login');
    await page.getByRole('button', { name, exact: true }).click();
    await page.waitForURL('/');
    await page.waitForLoadState('domcontentloaded');
    return page;
}

test('"let it snow" snows for the sender and the recipient, and not on reopening the chat', async ({ browser }) => {
    const setup = await browser.newPage();
    await setup.request.post('/api/dev/seed');
    await setup.request.post('/api/dev/assign');
    await setup.close();

    const sender = await login(browser, 'Jed');
    await expect.poll(async () => sender.evaluate(() => (window as any).__e2eUserData__?.recipientId), { timeout: 10000 }).toBeTruthy();
    const recipientId = await sender.evaluate(() => (window as any).__e2eUserData__.recipientId);
    const doc = await sender.request.get(
        `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${recipientId}`,
        { headers: { Authorization: 'Bearer owner' } }
    );
    expect(doc.ok()).toBeTruthy();
    const recipientName = (await doc.json()).fields.name.stringValue;

    const recipient = await login(browser, recipientName);
    await recipient.getByRole('button', { name: /santa/i }).first().click();
    const input = sender.getByPlaceholder(/type a message/i);
    await expect(input).toBeVisible({ timeout: 10000 });
    await expect(recipient.getByPlaceholder(/type a message/i)).toBeVisible({ timeout: 10000 });

    const text = `Let it snow! ${Date.now()}`;
    await input.fill(text);
    const sent = sender.waitForResponse((r) => r.url().includes('/api/messages/send') && r.request().method() === 'POST');
    await sender.getByRole('button', { name: /send/i }).click();
    expect((await sent).ok()).toBeTruthy();

    await expect(recipient.getByText(text)).toBeVisible({ timeout: 10000 });
    await expect(sender.locator('[data-easter-egg="snow"]')).toBeAttached({ timeout: 10000 });
    await expect(recipient.locator('[data-easter-egg="snow"]')).toBeAttached({ timeout: 10000 });
    // Snow never blocks the composer.
    await expect(sender.locator('[data-easter-egg="snow"]')).toHaveCSS('pointer-events', 'none');
    await expect(recipient.locator('[data-easter-egg="snow"]')).toHaveCount(0, { timeout: 10000 });

    // Loading the chat with the message in its history is silent.
    await recipient.reload();
    await recipient.getByRole('button', { name: /santa/i }).first().click();
    await expect(recipient.getByText(text)).toBeVisible({ timeout: 10000 });
    await recipient.waitForTimeout(1500);
    await expect(recipient.locator('[data-easter-egg="snow"]')).toHaveCount(0);

    await sender.context().close();
    await recipient.context().close();
});

test('Christmas Day mode can be forced with ?xmas=1 in development', async ({ browser }) => {
    const page = await login(browser, 'Jed');
    await expect(page.getByTestId('user-greeting').first()).toBeVisible({ timeout: 10000 });
    await page.goto('/?xmas=1');
    await expect(page.locator('[data-easter-egg="christmas"]').first()).toBeAttached({ timeout: 10000 });
    await page.context().close();
});
