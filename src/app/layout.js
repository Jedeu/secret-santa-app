import './globals.css';
import ClientProviders from '@/components/ClientProviders';

export const viewport = {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
};

export const metadata = {
    title: 'Secret Santa',
    description: 'Secret Santa gift exchange with your friends',
    manifest: '/manifest.json',
    appleWebApp: {
        capable: true,
        statusBarStyle: 'black-translucent',
        title: 'Secret Santa',
    },
    icons: {
        icon: '/icons/icon-192x192.png',
        apple: '/icons/icon-180x180.png',
    },
};

export default function RootLayout({ children }) {
    return (
        <html lang="en" suppressHydrationWarning>
            <body>
                <ClientProviders>
                    {children}
                </ClientProviders>
            </body>
        </html>
    );
}
