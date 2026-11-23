'use client';

import { useEffect } from 'react';
import dynamic from 'next/dynamic';

// Same lazy chunk as the composer's picker: downloaded the first time either opens.
const EmojiPicker = dynamic(
    () => import('emoji-picker-react'),
    { ssr: false }
);

// Full emoji picker for reacting with any emoji: a bottom sheet on phones, a
// centered dialog on wider screens. Native emoji so the choice looks like its chip.
export default function ReactionEmojiSheet({ onSelect, onClose }) {
    useEffect(() => {
        const onKeyDown = (event) => {
            if (event.key === 'Escape') {
                onClose?.();
            }
        };

        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [onClose]);

    return (
        <div
            className="reaction-sheet-backdrop"
            data-testid="reaction-emoji-sheet"
            onClick={(event) => {
                if (event.target === event.currentTarget) {
                    onClose?.();
                }
            }}
        >
            <div className="reaction-sheet" role="dialog" aria-label="Choose a reaction">
                <EmojiPicker
                    onEmojiClick={(emojiObject) => {
                        onSelect?.(emojiObject.emoji);
                        onClose?.();
                    }}
                    theme="dark"
                    emojiStyle="native"
                    autoFocusSearch={false}
                    previewConfig={{ showPreview: false }}
                    width="100%"
                    height="100%"
                />
            </div>
        </div>
    );
}
