/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import MessageGif from '@/components/MessageGif';

// Synthetic GIF ids only. No key is needed to render an embed.

const ID = 'SyntheticGif01';
const EMBED = 'https://giphy.com/embed/SyntheticGif01';
const KEY_ENV = 'NEXT_PUBLIC_GIPHY_API_KEY';

describe('MessageGif', () => {
    let savedKey;

    beforeEach(() => {
        savedKey = process.env[KEY_ENV];
        delete process.env[KEY_ENV];
        global.fetch.mockClear();
    });

    afterEach(() => {
        if (savedKey === undefined) {
            delete process.env[KEY_ENV];
        } else {
            process.env[KEY_ENV] = savedKey;
        }
    });

    test('renders a sandboxed embed rebuilt from the id, with no key and no fetch', () => {
        render(<MessageGif id={ID} />);

        const wrapper = screen.getByTestId('message-gif');
        expect(wrapper).toHaveStyle({ display: 'block', maxWidth: '100%' });
        expect(wrapper.style.width).toBe('280px');

        const frame = screen.getByTitle('GIF from GIPHY');
        expect(frame.tagName).toBe('IFRAME');
        expect(frame).toHaveAttribute('src', EMBED);
        expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin');
        expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
        expect(frame).toHaveAttribute('loading', 'lazy');
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('the "via GIPHY" link opens the embed in a new tab without bubbling', () => {
        const onParentClick = jest.fn();
        render(
            <div onClick={onParentClick}>
                <MessageGif id={ID} />
            </div>
        );

        const link = screen.getByRole('link', { name: 'via GIPHY' });
        expect(link).toHaveAttribute('href', EMBED);
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');

        fireEvent.click(link);
        expect(onParentClick).not.toHaveBeenCalled();
    });

    test('a custom width is applied', () => {
        render(<MessageGif id={ID} width={160} />);
        expect(screen.getByTestId('message-gif').style.width).toBe('160px');
    });

    test.each([
        ['a slug', 'funny-cat-SyntheticGif01'],
        ['a URL', EMBED],
        ['empty', ''],
        ['too long', 'a'.repeat(65)],
        ['null', null],
    ])('an invalid id (%s) shows the unavailable text and no frame', (_label, id) => {
        render(<MessageGif id={id} />);
        expect(screen.getByTestId('message-gif-unavailable')).toHaveTextContent('GIF unavailable');
        expect(screen.queryByTestId('message-gif')).not.toBeInTheDocument();
        expect(document.querySelector('iframe')).toBeNull();
    });
});
