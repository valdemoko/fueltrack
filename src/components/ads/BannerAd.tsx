"use client";

import { useEffect, useRef, useState } from "react";
import { ADSENSE_CLIENT, adsenseEnabled } from "@/lib/siteConfig";

// ─── Tipos ─────────────────────────────────────────────────────────────────
interface BannerAdProps {
  /** Slot ID de AdSense (obligatorio; sin valor no se renderiza nada) */
  slot: string;
  /** Formato del anuncio */
  format?: "auto" | "horizontal" | "vertical" | "rectangle";
  /** Clase CSS adicional */
  className?: string;
  /** Etiqueta visual (opcional, para debugging) */
  label?: string;
}

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

function readAdConsent(): boolean {
  try {
    // 1) CookieYes expone el estado en el objeto global
    const ckyConsent = (
      window as unknown as {
        cookieyes?: { consented?: { advertisement?: boolean } };
      }
    ).cookieyes;
    if (ckyConsent?.consented) {
      return ckyConsent.consented.advertisement === true;
    }
    // 2) Fallback: cookie propia de consentimiento (modo sin CMP)
    const match = document.cookie.match(
      /(?:^|; )cookie_consent=([^;]*)/
    );
    if (match) {
      const state = JSON.parse(decodeURIComponent(match[1]));
      return state.advertising === true;
    }
  } catch {
    // cookie corrupta o acceso bloqueado → sin consentimiento
  }
  return false;
}

// ─── Componente ────────────────────────────────────────────────────────────
/**
 * Emplazamiento de anuncio AdSense.
 *
 * - No renderiza NADA sin publisher ID, slot configurado y consentimiento
 *   de la categoría "advertisement".
 * - El slot debe configurarse por variable de entorno
 *   (NEXT_PUBLIC_ADSENSE_SLOT_*); nunca se hardcodea.
 */
export function BannerAd({
  slot,
  format = "auto",
  className = "",
  label,
}: BannerAdProps) {
  const adRef = useRef<HTMLModElement>(null);
  const pushedRef = useRef(false);
  const [consent, setConsent] = useState(false);

  // Comprobar consentimiento al montar y cuando CookieYes lo actualice
  useEffect(() => {
    if (!adsenseEnabled || !slot) return;

    const update = () => setConsent(readAdConsent());
    update();

    window.addEventListener("cookieyes_consent_update", update);
    window.addEventListener("cookieyes_banner_load", update);
    return () => {
      window.removeEventListener("cookieyes_consent_update", update);
      window.removeEventListener("cookieyes_banner_load", update);
    };
  }, [slot]);

  // Empujar el anuncio cuando hay consentimiento
  useEffect(() => {
    if (!consent || pushedRef.current || !adRef.current) return;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
      pushedRef.current = true;
    } catch {
      // AdSense no cargado aún o bloqueador de anuncios — fallo silencioso
    }
  }, [consent]);

  // Sin AdSense configurado, sin slot o sin consentimiento: no renderizar nada
  if (!adsenseEnabled || !slot || !consent) return null;

  return (
    <div className={`ad-container ${className}`}>
      {label && <div className="text-xs text-stone-400 mb-1">{label}</div>}
      <ins
        ref={adRef}
        className="adsbygoogle"
        style={{ display: "block" }}
        data-ad-client={ADSENSE_CLIENT}
        data-ad-slot={slot}
        data-ad-format={format}
        data-full-width-responsive="true"
      />
    </div>
  );
}
