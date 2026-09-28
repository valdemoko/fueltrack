"use client";

import Script from "next/script";
import {
  googleCmpEnabled,
  ADSENSE_CLIENT,
  adsenseEnabled,
} from "@/lib/siteConfig";

const GA4_ID = process.env.NEXT_PUBLIC_GA4_ID ?? "";
const ADSENSE_SRC = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`;

/**
 * Carga de los servicios de Google tras la integración del consentimiento.
 *
 * Modelo (integración oficial de Google):
 *  1. Consent Mode v2 con default DENIED para las cuatro señales
 *     (ad_storage, analytics_storage, ad_user_data, ad_personalization):
 *     se emite inline en src/app/layout.tsx ANTES de cualquier script de Google.
 *  2. La CMP de Google (Privacy & Messaging) se carga también en el <head> del
 *     layout (env-gated) y actualiza las señales según la decisión real del
 *     usuario. El sitio NO duplica esa lógica ni mantiene banner propio.
 *  3. Este componente solo añade los scripts de AdSense y GA4 (async); en
 *     zonas reguladas la CMP bloquea su actividad hasta que existe
 *     consentimiento.
 *
 * CookieYes y el banner propio (CookieConsent) se han eliminado: ya no se
 * escuchan eventos cookieyes_* ni se lee la cookie `cookie_consent`.
 */
export function ConsentGate() {
  // Sin CMP configurada no se cargan scripts de publicidad/medición.
  if (!googleCmpEnabled) return null;

  return (
    <>
      {advertisementEnabled(adsenseEnabled) && (
        <Script
          id="adsense-consent"
          async
          strategy="afterInteractive"
          src={ADSENSE_SRC}
          crossOrigin="anonymous"
        />
      )}
      {GA4_ID && (
        <>
          <Script
            id="ga4-consent"
            async
            strategy="afterInteractive"
            src={`https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`}
          />
          <Script id="ga4-init" strategy="afterInteractive">
            {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA4_ID}');`}
          </Script>
        </>
      )}
    </>
  );
}

function advertisementEnabled(enabled: boolean): boolean {
  return enabled && ADSENSE_CLIENT.length > 0;
}
