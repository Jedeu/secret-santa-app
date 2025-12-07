'use client';

import { RealtimeMessagesProvider } from '@/context/RealtimeMessagesContext';

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
    return (
        <RealtimeMessagesProvider>
            {children}
        </RealtimeMessagesProvider>
    );
}
