/**
 * Seasonal easter eggs: pure rules plus a tiny window event bus. Shared by the chat, the GIF
 * picker and the page-level runtimes; it reads no data and never looks at who sent a message.
 */

export const PLAIN_SANTA_TYPING = 'Santa is typing...';

export const SANTA_TYPING_VARIANTS = [
    'Santa is checking his list twice...',
    'Santa is consulting the elves...',
    'Santa is hiding the receipts...',
    'Santa is feeding the reindeer...',
    'Santa is untangling the lights...',
    'Santa is warming up the sleigh...',
    'Santa is wrapping something suspicious...',
    'Santa is eating the cookies...',
];

// About one typing session in four shows a playful line.
export const SANTA_TYPING_VARIANT_CHANCE = 0.25;

/** The line for one Santa typing session; call once per session, not per render. */
export function pickSantaTypingLine(random = Math.random) {
    if (random() >= SANTA_TYPING_VARIANT_CHANCE) return PLAIN_SANTA_TYPING;
    const index = Math.floor(random() * SANTA_TYPING_VARIANTS.length);
    return SANTA_TYPING_VARIANTS[Math.min(index, SANTA_TYPING_VARIANTS.length - 1)];
}

// Magic words, in the order their effects fire. Case-insensitive, whole words, any spacing.
const MAGIC_WORDS = [
    { effect: 'snow', pattern: /\blet\s+it\s+snow\b/i },
    { effect: 'jingle', pattern: /\bho[\s,!.-]*ho[\s,!.-]*ho\b/i },
    { effect: 'confetti', pattern: /\bmerry\s+(?:christmas|xmas)\b/i },
];

/** The effects a message's text asks for: a subset of ['snow', 'jingle', 'confetti']. */
export function findMagicEffects(text) {
    if (typeof text !== 'string' || !text) return [];
    return MAGIC_WORDS.filter(({ pattern }) => pattern.test(text)).map(({ effect }) => effect);
}

/** Christmas Day by the viewer's local calendar date. */
export function isChristmasDay(date = new Date()) {
    return date.getMonth() === 11 && date.getDate() === 25;
}

/**
 * Development-only overrides from the page URL, so the eggs can be checked without changing
 * the clock: `?xmas=1` forces Christmas Day mode. Always off outside development.
 */
export function readDevEggOverrides(search, nodeEnv = process.env.NODE_ENV) {
    if (nodeEnv !== 'development' || typeof search !== 'string') return { christmas: false };
    const params = new URLSearchParams(search);
    return { christmas: params.get('xmas') === '1' };
}

// --- Event bus: effects are fire-and-forget window events the effect layer listens for. ---

export const EASTER_EGG_EVENT = 'secret-santa:easter-egg';
export const EASTER_EGG_EFFECTS = ['snow', 'jingle', 'confetti', 'grinch'];

export function triggerEasterEgg(effect) {
    if (typeof window === 'undefined' || !EASTER_EGG_EFFECTS.includes(effect)) return;
    window.dispatchEvent(new CustomEvent(EASTER_EGG_EVENT, { detail: { effect } }));
}

/** Subscribe to effects; returns the unsubscribe function. */
export function onEasterEgg(handler) {
    if (typeof window === 'undefined') return () => { };
    const listener = (event) => {
        const effect = event?.detail?.effect;
        if (EASTER_EGG_EFFECTS.includes(effect)) handler(effect);
    };
    window.addEventListener(EASTER_EGG_EVENT, listener);
    return () => window.removeEventListener(EASTER_EGG_EVENT, listener);
}

export function prefersReducedMotion() {
    return typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
