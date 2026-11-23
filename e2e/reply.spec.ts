import { test, expect, BrowserContext, CDPSession, Locator, Page } from '@playwright/test';
import { PARTICIPANTS } from '../src/lib/participants';

/**
 * Replies end to end (emulators only): a recipient on a touch phone swipes Santa's
 * message to reply, Santa on desktop replies from the tap menu, and the public feed
 * quotes with the anonymous labels. Screenshots of each step go to the test's output
 * directory. Participant names are read from the source list.
 */

const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const PROJECT_ID = 'xmasteak-app';

type Participant = { name: string; email: string };
const santaName = (PARTICIPANTS as Participant[])[1].name;

async function devLogin(page: Page, name: string): Promise<void> {
    await page.goto('/dev/login');
    await expect(page.getByRole('heading', { name: /dev login/i })).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name, exact: true }).click();
    await page.waitForURL('/', { timeout: 30000 });
    await page.waitForLoadState('domcontentloaded');
}

async function waitForAssignedUser(page: Page) {
    await expect.poll(async () => {
        const data = await page.evaluate(() => (window as any).__e2eUserData__);
        return Boolean(data?.id && data?.recipientId && data?.gifterId);
    }, { timeout: 20000 }).toBeTruthy();
    return page.evaluate(() => (window as any).__e2eUserData__);
}

async function userName(page: Page, id: string): Promise<string> {
    const response = await page.request.get(
        `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${id}`,
        { headers: { Authorization: 'Bearer owner' } }
    );
    expect(response.ok()).toBeTruthy();
    return (await response.json()).fields.name.stringValue;
}

async function send(page: Page, text: string): Promise<any> {
    await page.getByPlaceholder('Type a message...').fill(text);
    const responsePromise = page.waitForResponse(
        (response) => response.url().includes('/api/messages/send') && response.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const response = await responsePromise;
    expect(response.ok(), `/api/messages/send returned ${response.status()}`).toBeTruthy();
    return (await response.json()).message;
}

function bubble(page: Page, messageId: string) {
    return page.locator(`[data-message-id="${messageId}"]`);
}

// Messages above can still change height while media loads; touch where the bubble settled.
async function stableCenter(locator: Locator) {
    let previous = '';
    let center = { x: 0, y: 0 };
    await expect.poll(async () => {
        const box = (await locator.boundingBox())!;
        center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        const key = JSON.stringify(center);
        const settled = key === previous;
        previous = key;
        return settled;
    }, { intervals: [150] }).toBe(true);
    return center;
}

// A real touch drag through Chromium's input pipeline, so touch-action and pointer
// events behave as on a phone. Leaves the finger down when release is false.
async function touchDrag(cdp: CDPSession, from: { x: number; y: number }, dx: number, dy: number, release = true) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
    for (let step = 1; step <= 10; step += 1) {
        await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ x: from.x + (dx * step) / 10, y: from.y + (dy * step) / 10 }],
        });
    }
    if (release) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
}

test('reply by swipe on a phone and from the tap menu on desktop; the feed keeps Santa anonymous', async ({ browser }, testInfo) => {
    const shot = (page: Page, name: string) => page.screenshot({ path: testInfo.outputPath(`${name}.png`) });

    const desktop: BrowserContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const santaPage = await desktop.newPage();
    await santaPage.goto('/');
    expect((await santaPage.request.post('/api/dev/seed')).ok()).toBeTruthy();
    expect((await santaPage.request.post('/api/dev/assign')).ok()).toBeTruthy();
    await devLogin(santaPage, santaName);
    const santa = await waitForAssignedUser(santaPage);
    const recipientName = await userName(santaPage, santa.recipientId);

    const phone: BrowserContext = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        hasTouch: true,
        isMobile: true,
    });
    const recipientPage = await phone.newPage();
    await devLogin(recipientPage, recipientName);
    await waitForAssignedUser(recipientPage);

    // Santa asks a question from the desktop Recipient tab.
    await santaPage.locator('.desktop-only').getByRole('button', { name: /recipient/i }).click();
    const question = `What is on your wishlist? ${Date.now()}`;
    const questionDoc = await send(santaPage, question);

    // The recipient swipes it on the phone's Santa tab.
    await recipientPage.locator('.mobile-only').getByRole('button', { name: /santa/i }).click();
    const questionBubble = bubble(recipientPage, questionDoc.id);
    await expect(questionBubble).toBeVisible({ timeout: 10000 });
    const cdp = await phone.newCDPSession(recipientPage);

    // A mostly vertical drag is scrolling: no reply.
    await touchDrag(cdp, await stableCenter(questionBubble), 30, 120);
    await expect(recipientPage.getByTestId('composer-reply')).toHaveCount(0);

    // That drag may have scrolled a long conversation; bring the message back first.
    await questionBubble.scrollIntoViewIfNeeded();
    await touchDrag(cdp, await stableCenter(questionBubble), 90, 4, false);
    await expect(recipientPage.getByTestId('swipe-to-reply').filter({ has: questionBubble }).locator(':scope > div'))
        .toHaveCSS('transform', /matrix/);
    await shot(recipientPage, 'phone-1-swiping');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

    const bar = recipientPage.getByTestId('composer-reply');
    await expect(bar).toContainText('Replying to Santa 🎅');
    await expect(bar).toContainText(question);
    await expect(bar).not.toContainText(santaName);
    // The swipe did not open the reaction menu.
    await expect(recipientPage.getByRole('button', { name: 'Reply', exact: true })).toHaveCount(0);
    await shot(recipientPage, 'phone-2-reply-bar');

    const answer = `A cozy scarf ${Date.now()}`;
    const answerDoc = await send(recipientPage, answer);
    expect(answerDoc.replyToId).toBe(questionDoc.id);
    await expect(bar).toHaveCount(0);
    await expect(bubble(recipientPage, answerDoc.id).getByTestId('message-quote')).toContainText('Santa 🎅');
    await shot(recipientPage, 'phone-3-reply-sent');

    // Santa sees the quote labelled "You" and replies from the tap menu.
    const answerOnDesktop = bubble(santaPage, answerDoc.id);
    await expect(answerOnDesktop.getByTestId('message-quote')).toContainText('You');
    await answerOnDesktop.getByText(answer, { exact: true }).click();
    await expect(answerOnDesktop.getByRole('button', { name: 'Reply', exact: true })).toBeVisible();
    await shot(santaPage, 'desktop-1-tap-menu');
    await answerOnDesktop.getByRole('button', { name: 'Reply', exact: true }).click();
    await expect(santaPage.getByTestId('composer-reply')).toContainText(`Replying to ${recipientName}`);
    await shot(santaPage, 'desktop-2-reply-bar');
    const followUp = `Noted! ${Date.now()}`;
    const followUpDoc = await send(santaPage, followUp);
    expect(followUpDoc.replyToId).toBe(answerDoc.id);
    await shot(santaPage, 'desktop-3-reply-sent');

    // The recipient sees their own message quoted as "You"; tapping the quote jumps to it.
    const followUpOnPhone = bubble(recipientPage, followUpDoc.id);
    await expect(followUpOnPhone.getByTestId('message-quote')).toContainText('You');
    await followUpOnPhone.getByTestId('message-quote').tap();
    await expect(bubble(recipientPage, answerDoc.id)).toHaveCSS('outline-color', 'rgb(0, 122, 255)');
    await shot(recipientPage, 'phone-4-jumped-to-original');

    // The public feed quotes with its anonymous labels.
    await santaPage.locator('.desktop-only').getByRole('button', { name: /public feed/i }).click();
    // Earlier pairings can leave another thread with the same name; open the one whose
    // latest message is this test's follow-up.
    await santaPage.getByText(followUp, { exact: true }).click();
    await expect(santaPage.getByText(`🎁 ${recipientName}'s Gift Exchange`)).toBeVisible();
    const answerQuote = bubble(santaPage, answerDoc.id).getByTestId('message-quote');
    await expect(answerQuote).toContainText('🎅 Santa');
    await expect(answerQuote).toContainText(question);
    await expect(answerQuote).not.toContainText(santaName);
    await expect(bubble(santaPage, followUpDoc.id).getByTestId('message-quote')).toContainText(recipientName);
    await shot(santaPage, 'desktop-4-public-feed');

    await desktop.close();
    await phone.close();
});
