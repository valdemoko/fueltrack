"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { cookieYesEnabled } from "@/lib/siteConfig";

// ─── Tipos ─────────────────────────────────────────────────────────────────
interface CookieConsentState {
  necessary: boolean;
  analytics: boolean;
  advertising: boolean;
}

// ─── Constantes ────────────────────────────────────────────────────────────
const COOKIE_NAME = "cookie_consent";
const COOKIE_EXPIRY_DAYS = 365;

// ─── Utilidades cookies ────────────────────────────────────────────────────
function setCookie(name: string, value: string, days: number) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

// ─── Componente ────────────────────────────────────────────────────────────
/**
 * Banner de consentimiento de respaldo.
 *
 * SOLO se muestra cuando CookieYes NO está configurado
 * (NEXT_PUBLIC_COOKIEYES_CLIENT_KEY vacío). Con CookieYes activo, la CMP
 * certificada gestiona el consentimiento y este banner no debe aparecer
 * (dos sistemas de consentimiento compitiendo = comportamiento indefinido).
 */
export function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [preferences, setPreferences] = useState<CookieConsentState>({
    necessary: true,
    analytics: false,
    advertising: false,
  });

  // ─── Comprobar si ya dio consentimiento ──────────────────────────────────
  useEffect(() => {
    if (cookieYesEnabled) return; // CookieYes gestiona el banner

    const consent = getCookie(COOKIE_NAME);
    if (!consent) {
      setVisible(true);
    }
  }, []);

  // ─── Aceptar todas ───────────────────────────────────────────────────────
  function acceptAll() {
    const state = { necessary: true, analytics: true, advertising: true };
    saveConsent(state);
  }

  // ─── Rechazar todas (solo necesarias) ────────────────────────────────────
  function rejectAll() {
    const state = { necessary: true, analytics: false, advertising: false };
    saveConsent(state);
  }

  // ─── Guardar preferencias ────────────────────────────────────────────────
  function savePreferences() {
    saveConsent(preferences);
  }

  // ─── Guardar consentimiento ──────────────────────────────────────────────
  function saveConsent(state: CookieConsentState) {
    setCookie(COOKIE_NAME, JSON.stringify(state), COOKIE_EXPIRY_DAYS);
    setVisible(false);
    setShowSettings(false);

    // Recargar para aplicar scripts de analytics/publicidad si se aceptaron
    if (state.analytics || state.advertising) {
      window.location.reload();
    }
  }

  if (cookieYesEnabled) return null;
  if (!visible) return null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t shadow-lg"
      role="dialog"
      aria-label="Politica de cookies"
    >
      <div className="max-w-7xl mx-auto px-4 py-4">
        {!showSettings ? (
          /* ─── Banner principal ────────────────────────────────────────── */
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="flex-1">
              <p className="text-sm text-gray-700">
                Utilizamos cookies para mejorar su experiencia, analizar el
                tráfico y mostrar anuncios personalizados.{" "}
                <Link
                  href="/politica-cookies"
                  className="text-amber-600 hover:text-amber-700 underline"
                >
                  Más información
                </Link>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={rejectAll}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Rechazar
              </button>
              <button
                onClick={() => setShowSettings(true)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Configurar
              </button>
              <button
                onClick={acceptAll}
                className="px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
              >
                Aceptar todas
              </button>
            </div>
          </div>
        ) : (
          /* ─── Panel de configuración ──────────────────────────────────── */
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Configuración de cookies
            </h3>

            <div className="space-y-3">
              {/* Técnicas */}
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-gray-900">
                    Cookies técnicas
                  </span>
                  <span className="ml-2 text-xs text-gray-500">(necesarias)</span>
                </div>
                <input
                  type="checkbox"
                  checked
                  disabled
                  className="h-4 w-4 text-amber-600 rounded"
                />
              </div>

              {/* Analíticas */}
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-gray-900">
                    Cookies de análisis
                  </span>
                  <span className="ml-2 text-xs text-gray-500">
                    (Google Analytics)
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={preferences.analytics}
                  onChange={(e) =>
                    setPreferences({ ...preferences, analytics: e.target.checked })
                  }
                  className="h-4 w-4 text-amber-600 rounded"
                />
              </div>

              {/* Publicidad */}
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-gray-900">
                    Cookies de publicidad
                  </span>
                  <span className="ml-2 text-xs text-gray-500">
                    (Google AdSense)
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={preferences.advertising}
                  onChange={(e) =>
                    setPreferences({
                      ...preferences,
                      advertising: e.target.checked,
                    })
                  }
                  className="h-4 w-4 text-amber-600 rounded"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2 mt-6">
              <button
                onClick={() => setShowSettings(false)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Volver
              </button>
              <button
                onClick={savePreferences}
                className="px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
              >
                Guardar preferencias
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
