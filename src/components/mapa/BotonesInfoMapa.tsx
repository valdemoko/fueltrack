"use client";

import { Info, ArrowUp } from "lucide-react";

/**
 * La página /mapa bloquea el scroll de la página (el mapa ocupa toda la
 * pantalla) mediante CSS en globals.css: `html:has(.mapa-pantalla-completa)`.
 * Estos botones liberan / restablecen ese bloqueo para mostrar la sección
 * "Cómo usar el mapa" y el footer solo cuando el usuario lo pide.
 */

/** Botón flotante sobre el mapa: abre la ayuda "Cómo usar el mapa". */
export function BotonInfoMapa() {
  const irAInfo = () => {
    // 1) Liberar el scroll (si no, el navegador no puede bajar)
    document.documentElement.classList.add("mapa-scroll-liberado");
    // 2) Bajar a la sección de ayuda cuando el scroll ya esté disponible
    requestAnimationFrame(() => {
      document
        .getElementById("como-usar-mapa")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  return (
    <button
      onClick={irAInfo}
      title="Cómo se usa el mapa de gasolineras"
      aria-label="Cómo se usa el mapa de gasolineras"
      className="absolute bottom-12 right-4 z-[1100] flex items-center gap-1.5 rounded-full bg-white/95 shadow-lg border border-stone-200 px-3.5 py-2 text-sm font-medium text-stone-700 hover:bg-white hover:shadow-xl transition-shadow"
    >
      <Info className="w-4 h-4 text-amber-600" aria-hidden="true" />
      <span>Cómo se usa</span>
    </button>
  );
}

/** Botón dentro de la sección de ayuda: vuelve al mapa y re-bloquea el scroll. */
export function BotonVolverAlMapa() {
  const volver = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    // Re-bloquear el scroll al terminar de subir (si se cortara el scroll
    // suave antes de llegar arriba, el navegador recorta a la posición 0,
    // que es exactamente el mapa)
    window.setTimeout(() => {
      document.documentElement.classList.remove("mapa-scroll-liberado");
    }, 600);
  };

  return (
    <button
      onClick={volver}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-600 hover:text-amber-700"
    >
      <ArrowUp className="w-4 h-4" aria-hidden="true" />
      Volver al mapa
    </button>
  );
}
