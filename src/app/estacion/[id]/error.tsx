"use client";

import Link from "next/link";

export default function EstacionError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-green-600 text-white shadow-md">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <nav className="text-sm text-green-100 mb-2" aria-label="Breadcrumb">
            <Link href="/" className="hover:text-white transition-colors">
              Inicio
            </Link>
            <span className="mx-2">/</span>
            <Link href="/mapa" className="hover:text-white transition-colors">
              Mapa
            </Link>
            <span className="mx-2">/</span>
            <span className="text-white">Error</span>
          </nav>
          <h1 className="text-2xl font-bold">Error en la estación</h1>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="bg-white rounded-lg shadow p-6 text-center max-w-md mx-auto">
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            Error al cargar la estación
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
              href="/mapa"
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
            >
              Volver al mapa
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
