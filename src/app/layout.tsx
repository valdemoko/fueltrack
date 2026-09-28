import type { Metadata, Viewport } from "next";
import { DM_Sans } from "next/font/google";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { ConsentGate } from "@/components/layout/ConsentGate";
import {
  SITE_URL,
  SITE_NAME,
  SITE_DESCRIPTION,
  GOOGLE_SITE_VERIFICATION,
} from "@/lib/siteConfig";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  alternates: { canonical: "/" },
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
  ...(GOOGLE_SITE_VERIFICATION
    ? { verification: { google: GOOGLE_SITE_VERIFICATION } }
    : {}),
};

export const viewport: Viewport = {
  themeColor: "#D97706",
  width: "device-width",
  initialScale: 1,
};

/**
 * Consent Mode v2 — estado por defecto DENIED para las cuatro señales.
 * Se emite ANTES de cualquier script de Google para que ningún servicio
 * pueda instalar cookies con consentimiento pendiente. La CMP de Google
 * (Privacy & Messaging, mensaje publicado en AdSense → Privacidad y
 * mensajes → Reglamentos europeos) actualiza las señales según la decisión
 * real del usuario; este sitio no duplica esa lógica ni mantiene banner
 * propio.
 */
const CONSENT_MODE_DEFAULT = `
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('consent', 'default', {
  ad_storage: 'denied',
  analytics_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  wait_for_update: 500
});
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className={`${dmSans.variable} h-full`}>
      <head>
        {/* Consent Mode por defecto (denied) — script inline que se ejecuta
            sincrónicamente durante el parseo del HTML, antes que cualquier
            script externo async de Google (patrón documentado por Google;
            evita next/script beforeInteractive en App Router). */}
        <script dangerouslySetInnerHTML={{ __html: CONSENT_MODE_DEFAULT }} />
        {/* La CMP de Google y los scripts de AdSense/GA4 se cargan desde
            ConsentGate (solo cuando NEXT_PUBLIC_GOOGLE_CMP_SRC está
            configurado). CookieYes y el banner propio fueron eliminados. */}
      </head>
      <body className="min-h-full flex flex-col font-body antialiased bg-surface-primary text-content-primary">
        {/* Carga de la CMP de Google + AdSense/GA4 bajo Consent Mode */}
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
      </body>
    </html>
  );
}
