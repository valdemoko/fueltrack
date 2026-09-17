"use client";

import Script from "next/script";
import { useEffect, useState } from "react";
import {
  COOKIEYES_CLIENT_KEY,
  cookieYesEnabled,
  ADSENSE_CLIENT,
  adsenseEnabled,
} from "@/lib/siteConfig";

const GA4_ID = process.env.NEXT_PUBLIC_GA4_ID ?? "";
const ADSENSE_SRC = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`;

type ConsentDetail = {
  categories?: Record<string, boolean>;
  accepted?: string[];
};

function readConsent(detail: ConsentDetail): {
  advertisement: boolean;
  analytics: boolean;
} {
  // cookieyes_banner_load expone detail.categories (booleans por categoría)
  if (detail.categories) {
    return {
      advertisement: detail.categories.advertisement === true,
      analytics: detail.categories.analytics === true,
    };
  }
  // cookieyes_consent_update expone detail.accepted (array de nombres de categoría)
  const accepted = detail.accepted ?? [];
  return {
    advertisement: accepted.includes("advertisement"),
    analytics: accepted.includes("analytics"),
  };
}

/**
 * Carga AdSense y Google Analytics 4 únicamente cuando existe consentimiento
 * válido. Dos modos, según configuración:
 *
 * 1. CookieYes configurada (NEXT_PUBLIC_COOKIEYES_CLIENT_KEY): escucha los
 *    eventos cookieyes_banner_load / cookieyes_consent_update y respeta la
 *    categoría otorgada (advertisement / analytics).
 * 2. Sin CookieYes (fallback): respeta la cookie `cookie_consent` que escribe
 *    el banner propio (CookieConsent). Sin decisión previa NO se carga nada.
 *
 * En ambos modos, sin consentimiento los scripts no existen en el DOM.
 */
export function ConsentGate() {
  const [advertisement, setAdvertisement] = useState(false);
  const [analytics, setAnalytics] = useState(false);

  useEffect(() => {
    // ─── Modo fallback: banner propio (cookie `cookie_consent`) ───────────
    if (!cookieYesEnabled) {
      try {
        const match = document.cookie.match(/(?:^|; )cookie_consent=([^;]*)/);
        if (match) {
          const state = JSON.parse(decodeURIComponent(match[1]));
          setAdvertisement(state.advertising === true);
          setAnalytics(state.analytics === true);
        }
      } catch {
        // cookie corrupta o acceso bloqueado → sin consentimiento
      }
      return;
    }

    // ─── Modo CookieYes ──────────────────────────────────────────────────
    const applyConsent = (event: Event) => {
      const detail = (event as CustomEvent<ConsentDetail>).detail;
      if (!detail) return;
      const consent = readConsent(detail);
      setAdvertisement(consent.advertisement);
      setAnalytics(consent.analytics);
    };

    document.addEventListener("cookieyes_banner_load", applyConsent);
    document.addEventListener("cookieyes_consent_update", applyConsent);

    // CookieYes dispara banner_load al cargar la página si ya hay consentimiento previo
    // (el banner carga de forma asíncrona; el listener captura el evento cuando ocurra)
    return () => {
      document.removeEventListener("cookieyes_banner_load", applyConsent);
      document.removeEventListener("cookieyes_consent_update", applyConsent);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!cookieYesEnabled) return null;

  return (
    <>
      {advertisement && adsenseEnabled && (
        <Script
          id="adsense-consent"
          async
          strategy="afterInteractive"
          src={ADSENSE_SRC}
          crossOrigin="anonymous"
        />
      )}
      {analytics && GA4_ID && (
        <Script
          id="ga4-consent"
          async
          strategy="afterInteractive"
          src={`https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`}
        />
      )}
      {analytics && GA4_ID && (
        <Script id="ga4-init" strategy="afterInteractive">
          {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA4_ID}');`}
        </Script>
      )}
    </>
  );
}
