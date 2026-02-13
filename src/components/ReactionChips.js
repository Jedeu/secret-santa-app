'use client';

export default function ReactionChips({ messageId, allReactions = [], currentUserId, onToggle }) {
    if (!messageId || !Array.isArray(allReactions) || allReactions.length === 0) {
        return null;
    }

    const grouped = new Map();

    allReactions
        .filter((reaction) => reaction?.messageId === messageId)
        .forEach((reaction) => {
            const emoji = reaction?.emoji;
            if (!emoji) {
                return;
            }

            if (!grouped.has(emoji)) {
                grouped.set(emoji, {
                    emoji,
                    count: 0,
                    reactedByCurrentUser: false,
                });
            }

            const entry = grouped.get(emoji);
            entry.count += 1;
            if (reaction.userId === currentUserId) {
                entry.reactedByCurrentUser = true;
            }
        });

    const chips = Array.from(grouped.values());
    if (!chips.length) {
        return null;
    }

    return (
        <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '6px',
            marginTop: '6px',
        }}>
            {chips.map((chip) => {
                const sharedStyle = {
                    border: chip.reactedByCurrentUser
                        ? '1px solid var(--primary)'
                        : '1px solid var(--border)',
                    borderRadius: '12px',
                    padding: '2px 8px',
                    fontSize: '12px',
                    background: chip.reactedByCurrentUser
                        ? 'rgba(58, 134, 255, 0.18)'
                        : 'var(--surface)',
                    color: 'var(--foreground)',
                };

                if (!onToggle) {
                    return (
                        <span key={chip.emoji} style={sharedStyle}>
                            {chip.emoji} {chip.count}
                        </span>
                    );
                }

                return (
                    <button
                        key={chip.emoji}
                        type="button"
                        onClick={(event) => {
                            event.stopPropagation();
                            onToggle(chip.emoji);
                        }}
                        aria-label={`${chip.emoji} reaction count ${chip.count}`}
                        style={{
                            ...sharedStyle,
                            cursor: 'pointer',
                        }}
                    >
                        {chip.emoji} {chip.count}
                    </button>
                );
            })}
        </div>
    );
}
