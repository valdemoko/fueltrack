import type { Metadata, Viewport } from "next";
import { DM_Sans } from "next/font/google";
import Script from "next/script";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { CookieConsent } from "@/components/layout/CookieConsent";
import { ConsentGate } from "@/components/layout/ConsentGate";
import {
  SITE_URL,
  SITE_NAME,
  SITE_DESCRIPTION,
  GOOGLE_SITE_VERIFICATION,
  COOKIEYES_CLIENT_KEY,
  cookieYesEnabled,
} from "@/lib/siteConfig";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — Precios de carburantes en tiempo real`,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "es_ES",
    title: `${SITE_NAME} — Precios de carburantes en tiempo real`,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
  },
  twitter: {
    card: "summary",
    title: `${SITE_NAME} — Precios de carburantes en tiempo real`,
    description: SITE_DESCRIPTION,
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    shortcut: "/favicon.ico",
    apple: "/apple-icon.png",
  },
  ...(GOOGLE_SITE_VERIFICATION
    ? { verification: { google: GOOGLE_SITE_VERIFICATION } }
    : {}),
};

export const viewport: Viewport = {
  themeColor: "#D97706",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className={`${dmSans.variable} h-full`}>
      <head>
        {/* CookieYes CMP — etiqueta literal dentro de <head> (requisito del
            verificador de instalación de CookieYes: "paste between the <head>
            tags, before any other scripts"). Solo se carga si la clave está
            configurada mediante NEXT_PUBLIC_COOKIEYES_CLIENT_KEY. */}
        {cookieYesEnabled && (
          // eslint-disable-next-line @next/next/no-sync-scripts
          <script
            id="cookieyes"
            type="text/javascript"
            src={`https://cdn-cookieyes.com/client_data/${COOKIEYES_CLIENT_KEY}/script.js`}
          />
        )}
      </head>
      <body className="min-h-full flex flex-col font-body antialiased bg-surface-primary text-content-primary">
        {/* Carga AdSense/GA4 solo cuando CookieYes otorga consentimiento */}
        <ConsentGate />

        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:bg-amber-600 focus:text-white focus:rounded-lg focus:text-sm focus:font-semibold"
        >
          Saltar al contenido
        </a>
        <Header />
        <main id="main-content" className="flex-1">
          {children}
        </main>
        <Footer />
        <CookieConsent />
      </body>
    </html>
  );
}
