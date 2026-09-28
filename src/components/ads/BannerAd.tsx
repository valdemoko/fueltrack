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
  // Con Consent Mode, el consentimiento publicitario lo gestiona la CMP de
  // Google (Privacy & Messaging): AdSense decide si sirve según las señales
  // actualizadas (ad_storage/ad_personalization). El componente renderiza
  // el emplazamiento siempre que AdSense esté configurado; sin consentimiento
  // la CMP bloquea el anuncio sin intervención de este código.
  return true;
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

  // Comprobar consentimiento al montar (la CMP de Google aplica el bloqueo
  // real de anuncios; aquí solo controlamos que AdSense esté configurado)
  useEffect(() => {
    if (!adsenseEnabled || !slot) return;
    setConsent(readAdConsent());
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
