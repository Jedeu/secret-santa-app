'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { RealtimeMessagesProvider } from '@/context/RealtimeMessagesContext';

const ToastContext = createContext({
    showToast: () => {}
});

export function useToast() {
    return useContext(ToastContext);
}

function ToastViewport({ toasts, onDismiss }) {
    return (
        <div
            aria-live="polite"
            aria-atomic="false"
            style={{
                position: 'fixed',
                right: '16px',
                bottom: '16px',
                zIndex: 9999,
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                maxWidth: '360px',
                width: 'calc(100vw - 32px)',
                pointerEvents: 'none'
            }}
        >
            {toasts.map(toast => {
                const accent = toast.type === 'error'
                    ? '#dc3545'
                    : toast.type === 'success'
                        ? '#198754'
                        : 'var(--primary)';

                return (
                    <div
                        key={toast.id}
                        role="status"
                        style={{
                            pointerEvents: 'auto',
                            background: 'var(--surface)',
                            color: 'var(--foreground)',
                            border: `1px solid ${accent}`,
                            borderLeft: `4px solid ${accent}`,
                            borderRadius: '8px',
                            padding: '10px 12px',
                            boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: '10px',
                            fontSize: '14px'
                        }}
                    >
                        <span>{toast.message}</span>
                        <button
                            type="button"
                            aria-label="Dismiss notification"
                            onClick={() => onDismiss(toast.id)}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--text-muted)',
                                cursor: 'pointer',
                                fontSize: '16px',
                                lineHeight: 1
                            }}
                        >
                            ×
                        </button>
                    </div>
                );
            })}
        </div>
    );
}

/**
 * ClientProviders
 *
 * Wraps children with all client-side Context providers.
 * This component has 'use client' directive and is imported by layout.js.
 *
 * Provider order (outermost to innermost):
 * 1. RealtimeMessagesProvider (consumes useUser internally)
 *
 * Note: useUser() is called inside RealtimeMessagesProvider, not here.
 * This means auth state is fetched once per render tree.
 *
 * @param {Object} props
 * @param {React.ReactNode} props.children
 */
export default function ClientProviders({ children }) {
    const [toasts, setToasts] = useState([]);
    const toastIdRef = useRef(0);
    const timeoutMapRef = useRef(new Map());

    const dismissToast = useCallback((toastId) => {
        const timeoutId = timeoutMapRef.current.get(toastId);
        if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutMapRef.current.delete(toastId);
        }

        setToasts(prev => prev.filter(toast => toast.id !== toastId));
    }, []);

    const showToast = useCallback((message, type = 'error') => {
        if (!message) return;

        toastIdRef.current += 1;
        const id = toastIdRef.current;

        setToasts(prev => [...prev, { id, message, type }]);

        const timeoutId = setTimeout(() => {
            dismissToast(id);
        }, 4000);

        timeoutMapRef.current.set(id, timeoutId);
    }, [dismissToast]);

    useEffect(() => {
        return () => {
            timeoutMapRef.current.forEach(timeoutId => clearTimeout(timeoutId));
            timeoutMapRef.current.clear();
        };
    }, []);

    const contextValue = useMemo(() => ({ showToast }), [showToast]);

    return (
        <ToastContext.Provider value={contextValue}>
            <RealtimeMessagesProvider>
                {children}
            </RealtimeMessagesProvider>
            <ToastViewport toasts={toasts} onDismiss={dismissToast} />
        </ToastContext.Provider>
    );
}
