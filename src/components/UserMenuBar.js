'use client';
import { useEffect, useRef, useState } from 'react';

function Chevron() {
    return (
        <svg className="user-bar-chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

/**
 * One-line top bar: "HI {NAME} ▾" opens a menu (push notifications, sound while push is on,
 * sign out); the admin season control (if any) sits right-aligned on the same line.
 * `pushControl` is PushNotificationsControl with variant="toggle"; `pushOn` is its effective state.
 */
export default function UserMenuBar({ name, soundEnabled, onToggleSound, pushControl, pushOn = false, adminControl = null, onSignOut }) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef(null);
    const buttonRef = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
        const onPointer = (event) => {
            if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
        };
        const onKey = (event) => {
            if (event.key === 'Escape') {
                setOpen(false);
                buttonRef.current?.focus();
            }
        };
        document.addEventListener('mousedown', onPointer);
        document.addEventListener('touchstart', onPointer);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onPointer);
            document.removeEventListener('touchstart', onPointer);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    return (
        <div className="user-bar">
            <div ref={rootRef} className="user-bar-menu">
                <button
                    ref={buttonRef}
                    type="button"
                    className="user-bar-trigger"
                    aria-haspopup="menu"
                    aria-expanded={open}
                    onClick={() => setOpen((prev) => !prev)}
                >
                    <span className="user-bar-name" data-testid="user-greeting">{'Hi ' + (name || '')}</span>
                    <Chevron />
                </button>
                {/* Kept mounted so the push control keeps reporting its state while closed. */}
                <div className="user-menu" role="menu" aria-label="Account" hidden={!open}>
                    <div className="user-menu-item user-menu-push">{pushControl}</div>
                    {pushOn && (
                        <button
                            type="button"
                            role="switch"
                            aria-checked={soundEnabled}
                            className="user-menu-item user-menu-sub"
                            onClick={onToggleSound}
                        >
                            <span>Sound on</span>
                            <span className={'user-menu-switch' + (soundEnabled ? ' is-on' : '')} aria-hidden="true">
                                <span className="user-menu-switch-knob" />
                            </span>
                        </button>
                    )}
                    <button type="button" role="menuitem" className="user-menu-item user-menu-signout" onClick={onSignOut}>
                        Sign out
                    </button>
                </div>
            </div>
            {adminControl && <div className="user-bar-admin">{adminControl}</div>}
        </div>
    );
}
