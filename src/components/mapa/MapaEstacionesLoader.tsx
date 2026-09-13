"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";

// Dynamic import para Leaflet (no soporta SSR)
const MapaEstaciones = dynamic(
  () => import("@/components/mapa").then((mod) => mod.MapaEstaciones),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full bg-gray-100">
        <div className="text-center">
          <div className="h-8 w-8 mx-auto animate-spin rounded-full border-2 border-amber-600 border-t-transparent" />
          <p className="mt-4 text-gray-600">Cargando mapa...</p>
        </div>
      </div>
    ),
  }
);

/**
 * El mapa lee parámetros de la URL (?municipioId=…&producto=…) mediante
 * useSearchParams, que exige un límite Suspense en páginas estáticas.
 */
export function MapaEstacionesLoader() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full bg-gray-100">
          <div className="h-8 w-8 mx-auto animate-spin rounded-full border-2 border-amber-600 border-t-transparent" />
        </div>
      }
    >
      <MapaEstaciones />
    </Suspense>
  );
}
