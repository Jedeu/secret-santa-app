/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import RecipientReveal from '@/components/RecipientReveal';
import { signOutCurrentUser } from '@/lib/sign-out';

jest.mock('@/lib/sign-out', () => ({
    signOutCurrentUser: jest.fn(() => Promise.resolve())
}));

// Synthetic fixtures only.
const CURRENT_USER = { id: 'alpha-2026', name: 'Alpha' };
const READY_LINE = 'Your 2026 Secret Santa recipient is';
const READY_NOTE = "Tap Continue when you're ready — this screen won't be shown again. Your recipient is always in the 🎁 Recipient tab.";
const LOADING_TEXT = "Finding out who you're buying a gift for…";
const ERROR_TEXT = "We couldn't load your recipient's name. Check your connection and try again.";
const INVALID_TEXT = "Your 2026 recipient isn't available. Ask the admin for help.";
const FAILED_TEXT = "That didn't save. Check your connection and try again.";

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function renderReveal(props = {}) {
    const onAcknowledge = props.onAcknowledge ?? jest.fn(() => Promise.resolve({ status: 'acknowledged' }));
    const onRetry = props.onRetry ?? jest.fn();
    const utils = render(
        <RecipientReveal
            currentUser={CURRENT_USER}
            year={2026}
            status="ready"
            recipientName="Bravo"
            {...props}
            onAcknowledge={onAcknowledge}
            onRetry={onRetry}
        />
    );
    return { ...utils, onAcknowledge, onRetry };
}

function continueButton() {
    return screen.queryByRole('button', { name: 'Continue' });
}

describe('RecipientReveal', () => {
    let errorSpy;

    beforeEach(() => {
        jest.clearAllMocks();
        errorSpy = jest.spyOn(console, 'error');
    });

    afterEach(() => {
        errorSpy.mockRestore();
    });

    test('ready: heading, year line, the name and Continue', () => {
        renderReveal();

        expect(screen.getByTestId('recipient-reveal')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Welcome, Alpha!' })).toBeInTheDocument();
        expect(screen.getByText(READY_LINE)).toBeInTheDocument();
        expect(screen.getByTestId('recipient-reveal-name')).toHaveTextContent('Bravo');
        expect(screen.getByText(READY_NOTE)).toBeInTheDocument();
        expect(continueButton()).toBeEnabled();
        expect(screen.getByText('2026 exchange')).toBeInTheDocument();
    });

    test('Continue calls onAcknowledge once; while pending it is disabled and reads Saving…; a double click sends one call', async () => {
        const pending = deferred();
        const { onAcknowledge } = renderReveal({ onAcknowledge: jest.fn(() => pending.promise) });

        const button = continueButton();
        fireEvent.click(button);
        fireEvent.click(button);

        expect(onAcknowledge).toHaveBeenCalledTimes(1);
        expect(onAcknowledge).toHaveBeenCalledWith();
        const saving = screen.getByRole('button', { name: 'Saving…' });
        expect(saving).toBeDisabled();
        fireEvent.click(saving);
        expect(onAcknowledge).toHaveBeenCalledTimes(1);

        await act(async () => {
            pending.resolve({ status: 'acknowledged' });
        });
        await waitFor(() => expect(continueButton()).toBeEnabled());
        expect(onAcknowledge).toHaveBeenCalledTimes(1);
    });

    test('a failed result shows the alert, re-enables Continue, and a second click calls again', async () => {
        const second = deferred();
        const onAcknowledge = jest.fn()
            .mockResolvedValueOnce({ status: 'failed', code: 'TIMEOUT' })
            .mockImplementationOnce(() => second.promise);
        renderReveal({ onAcknowledge });

        fireEvent.click(continueButton());

        expect(await screen.findByRole('alert')).toHaveTextContent(FAILED_TEXT);
        await waitFor(() => expect(continueButton()).toBeEnabled());

        fireEvent.click(continueButton());

        expect(onAcknowledge).toHaveBeenCalledTimes(2);
        // A new attempt clears the previous failure while it is saving.
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();

        await act(async () => {
            second.resolve({ status: 'acknowledged' });
        });
        await waitFor(() => expect(continueButton()).toBeEnabled());
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    test.each(['acknowledged', 'stale'])('a %s result shows no alert and dismisses nothing locally', async (status) => {
        const { onAcknowledge } = renderReveal({ onAcknowledge: jest.fn(() => Promise.resolve({ status })) });

        fireEvent.click(continueButton());

        await waitFor(() => expect(continueButton()).toBeEnabled());
        expect(onAcknowledge).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.getByTestId('recipient-reveal')).toBeInTheDocument();
        expect(screen.getByTestId('recipient-reveal-name')).toHaveTextContent('Bravo');
    });

    test('a rejecting onAcknowledge is treated as failed', async () => {
        renderReveal({ onAcknowledge: jest.fn(() => Promise.reject(new Error('unexpected'))) });

        fireEvent.click(continueButton());

        expect(await screen.findByRole('alert')).toHaveTextContent(FAILED_TEXT);
        await waitFor(() => expect(continueButton()).toBeEnabled());
    });

    test('loading: the status text, no Continue and no name', () => {
        renderReveal({ status: 'loading', recipientName: null });

        expect(screen.getByRole('status')).toHaveTextContent(LOADING_TEXT);
        expect(continueButton()).not.toBeInTheDocument();
        expect(screen.queryByTestId('recipient-reveal-name')).not.toBeInTheDocument();
    });

    test('error: the error text; Try again calls onRetry; no Continue', () => {
        const { onRetry, onAcknowledge } = renderReveal({ status: 'error', recipientName: null });

        expect(screen.getByText(ERROR_TEXT)).toBeInTheDocument();
        expect(continueButton()).not.toBeInTheDocument();
        expect(screen.queryByTestId('recipient-reveal-name')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(onAcknowledge).not.toHaveBeenCalled();
    });

    test.each([
        ['null', null],
        ['blank', '   '],
        ['empty', ''],
    ])('ready with a %s name behaves as error', (_label, recipientName) => {
        const { onRetry } = renderReveal({ status: 'ready', recipientName });

        expect(screen.getByText(ERROR_TEXT)).toBeInTheDocument();
        expect(continueButton()).not.toBeInTheDocument();
        expect(screen.queryByTestId('recipient-reveal-name')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    test('invalid: the unavailable text with the year; Try again calls onRetry; no Continue', () => {
        const { onRetry } = renderReveal({ status: 'invalid', recipientName: null });

        expect(screen.getByText(INVALID_TEXT)).toBeInTheDocument();
        expect(continueButton()).not.toBeInTheDocument();
        expect(screen.queryByTestId('recipient-reveal-name')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    test('invalid wins over a name', () => {
        renderReveal({ status: 'invalid', recipientName: 'Bravo' });

        expect(screen.getByText(INVALID_TEXT)).toBeInTheDocument();
        expect(screen.queryByText('Bravo')).not.toBeInTheDocument();
        expect(continueButton()).not.toBeInTheDocument();
    });

    test.each([
        ['ready', 'Bravo'],
        ['loading', null],
        ['error', null],
        ['invalid', null],
    ])('%s: adminControl, the exchange year and Sign out are rendered', (status, recipientName) => {
        renderReveal({
            status,
            recipientName,
            adminControl: <button type="button">Close 2026</button>,
        });

        expect(screen.getByRole('button', { name: 'Close 2026' })).toBeInTheDocument();
        expect(screen.getByText('2026 exchange')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Browse past years' })).not.toBeInTheDocument();
    });

    test('Browse past years appears only with onBrowseArchive and calls it', () => {
        const onBrowseArchive = jest.fn();
        renderReveal({ status: 'loading', recipientName: null, onBrowseArchive });

        fireEvent.click(screen.getByRole('button', { name: 'Browse past years' }));

        expect(onBrowseArchive).toHaveBeenCalledTimes(1);
    });

    test('Sign out calls signOutCurrentUser', () => {
        renderReveal();

        fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

        expect(signOutCurrentUser).toHaveBeenCalledTimes(1);
    });

    test('unmounting while the acknowledgment is pending, then resolving it, causes no error', async () => {
        const pending = deferred();
        const { unmount, onAcknowledge } = renderReveal({ onAcknowledge: jest.fn(() => pending.promise) });

        fireEvent.click(continueButton());
        expect(onAcknowledge).toHaveBeenCalledTimes(1);
        unmount();

        await act(async () => {
            pending.resolve({ status: 'failed' });
            await pending.promise;
        });

        expect(errorSpy).not.toHaveBeenCalled();
    });

    test.each([
        ['ready', 'Bravo'],
        ['loading', null],
        ['error', null],
        ['invalid', null],
    ])('%s: the card and its main keep their shared classes and add the reveal-only classes', (status, recipientName) => {
        renderReveal({ status, recipientName });

        const card = screen.getByTestId('recipient-reveal');
        expect(card).toHaveClass('card', 'login-card', 'recipient-reveal-card');

        const main = card.closest('main');
        expect(main).not.toBeNull();
        expect(main).toHaveClass('container', 'recipient-reveal-screen');
    });
});
