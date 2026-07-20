import type {Metadata, Viewport} from 'next';
import './globals.css';
import MainLayout from '@/src/components/layout/MainLayout';
import { Toaster } from '@/src/components/ui/Toast';
import { appConfig } from '@/src/config/app';

export const metadata: Metadata = {
  applicationName: appConfig.name,
  title: {
    default: `${appConfig.name} | ${appConfig.tagline}`,
    template: `%s | ${appConfig.name}`,
  },
  description: appConfig.description,
  manifest: '/manifest.json',
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }, { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
  },
  appleWebApp: { capable: true, title: appConfig.shortName, statusBarStyle: 'black-translucent' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0A0E17',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="th" className="dark">
      <body className="bg-[#0A0E17] text-slate-200 antialiased selection:bg-[#D4FF00]/30">
        <MainLayout>{children}</MainLayout>
        <Toaster />
      </body>
    </html>
  );
}
