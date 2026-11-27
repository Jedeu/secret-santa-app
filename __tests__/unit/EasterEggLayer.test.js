/**
 * @jest-environment jsdom
 */
import { act, render } from '@testing-library/react';
import EasterEggLayer from '@/components/EasterEggLayer';
import { grinchKeyframes } from '@/components/Grinch';
import { triggerEasterEgg } from '@/lib/easter-eggs';

const eggs = (container) => [...container.querySelectorAll('[data-easter-egg]')].map((el) => el.dataset.easterEgg);

describe('EasterEggLayer', () => {
    beforeEach(() => {
        // jsdom has no canvas or rAF: the effects mount, draw nothing, and wait to be unmounted.
        HTMLCanvasElement.prototype.getContext = jest.fn(() => null);
    });

    test('renders nothing until an effect fires, and Christmas Day only while christmas is true', () => {
        const { container, rerender } = render(<EasterEggLayer />);
        expect(eggs(container)).toEqual([]);
        expect(document.documentElement.hasAttribute('data-christmas')).toBe(false);

        rerender(<EasterEggLayer christmas />);
        expect(eggs(container)).toEqual(['christmas']);
        expect(document.documentElement.hasAttribute('data-christmas')).toBe(true);

        rerender(<EasterEggLayer christmas={false} />);
        expect(eggs(container)).toEqual([]);
        expect(document.documentElement.hasAttribute('data-christmas')).toBe(false);
    });

    test('a running effect ends when the view changes; Christmas Day stays', () => {
        // Reduced motion: one still frame on a no-op canvas, held until its timeout.
        const noop = new Proxy({}, { get: () => () => { } });
        HTMLCanvasElement.prototype.getContext = jest.fn(() => noop);
        window.matchMedia = jest.fn(() => ({ matches: true }));
        const { container, rerender } = render(<EasterEggLayer christmas scope='chat-a' />);
        act(() => triggerEasterEgg('snow'));
        expect(eggs(container)).toEqual(['christmas', 'snow']);

        rerender(<EasterEggLayer christmas scope={null} />);
        expect(eggs(container)).toEqual(['christmas']);
        delete window.matchMedia;
    });

    test('jingle is sound only; a Grinch without a tab bar ends at once', () => {
        const { container } = render(<EasterEggLayer />);
        act(() => {
            triggerEasterEgg('jingle');
            triggerEasterEgg('grinch');
        });
        expect(eggs(container)).toEqual([]);
    });
});

describe('grinchKeyframes', () => {
    const rect = { left: 10, right: 380, width: 370, top: 58, bottom: 106 };
    const { grinch, bar } = grinchKeyframes(rect, 390, 72);

    test('the bar starts and ends exactly where it was', () => {
        expect(bar[0].transform).toBe('translate(0px, 0px) rotate(0deg)');
        expect(bar[bar.length - 1].transform).toBe('translate(0px, 0px) rotate(0deg)');
        expect(bar.map((f) => f.offset)).toEqual([...bar.map((f) => f.offset)].sort((a, b) => a - b));
    });

    test('the bar leaves the screen fully while it is away', () => {
        const away = bar.filter((f) => f.offset >= 0.42 && f.offset <= 0.62);
        for (const f of away) {
            const x = Number(f.transform.match(/translate\((-?\d+)px/)[1]);
            expect(rect.right + x).toBeLessThan(0);
        }
    });

    test('he enters from beyond the right edge and leaves past the left', () => {
        const x = (f) => Number(f.transform.match(/translate\((-?\d+)px/)[1]);
        expect(x(grinch[0])).toBeGreaterThan(390);
        expect(x(grinch[grinch.length - 1]) + 72).toBeLessThan(0);
    });
});
