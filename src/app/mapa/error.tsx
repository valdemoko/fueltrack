"use client";

import Link from "next/link";

export default function MapaError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="h-screen flex flex-col">
      <header className="bg-green-600 text-white px-4 py-3 shadow-md">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <h1 className="text-lg font-bold">Mapa de estaciones</h1>
          <Link
            href="/"
            className="text-sm text-green-100 hover:text-white transition-colors"
          >
            ← Volver al inicio
          </Link>
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-md">
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            Error al cargar el mapa
          </h2>
          <p className="text-gray-600 mb-4">
            {error.message || "Ha ocurrido un error inesperado."}
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={reset}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              Reintentar
            </button>
            <Link
              href="/"
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
            >
              Inicio
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
