import type { Metadata } from "next";
import Link from "next/link";
import {
  getCcaaConEstaciones,
  getResumenProductosPrincipales,
} from "@/lib/db/queries";
import { slugify } from "@/lib/geografia";

// ISR (revalidación horaria): protege la cuota de lectura de Turso.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Gasolineras en España — Estaciones por comunidad autónoma",
  description:
    "Explora las estaciones de servicio de toda España por comunidad autónoma. Número de estaciones, precios medios de gasolina y gasóleo. Datos oficiales del MITECO.",
  alternates: { canonical: "/gasolineras" },
  openGraph: {
    title: "Gasolineras en España — Estaciones por comunidad autónoma",
    description:
      "Número de estaciones y precios medios de carburantes por comunidad autónoma. Datos del MITECO.",
    type: "website",
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  name: "Gasolineras en España por comunidad autónoma",
  description:
    "Listado de comunidades autónomas con estaciones de servicio y precios de carburantes.",
};

export default async function GasolinerasEspanaPage() {
  const ccaaList = await getCcaaConEstaciones();
  const resumen = await getResumenProductosPrincipales();
  const totalEstaciones = ccaaList.reduce((acc, c) => acc + c.totalEstaciones, 0);
  const gasolina95 = resumen.find((r) => r.productoId === 1);
  const gasoleoA = resumen.find((r) => r.productoId === 4);

  return (
    <div className="min-h-screen bg-surface-primary">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <main className="max-w-7xl mx-auto px-4 py-8 md:py-12">
        <nav className="text-sm text-stone-500 mb-6" aria-label="Breadcrumb">
          <Link href="/" className="hover:text-amber-600 transition-colors">
            Inicio
          </Link>
          <span className="mx-2">/</span>
          <span className="text-stone-900">Gasolineras en España</span>
        </nav>

        <h1 className="font-display text-3xl md:text-4xl font-bold text-stone-900 mb-3">
          Gasolineras en España
        </h1>
        <p className="text-stone-600 max-w-3xl mb-8">
          La base de datos recopila{" "}
          <strong>{totalEstaciones.toLocaleString("es-ES")} estaciones de servicio</strong>{" "}
          de toda España con sus precios oficiales actualizados
          {gasolina95?.fecha
            ? ` (última actualización: ${gasolina95.fecha})`
            : ""}
          . Datos procedentes del Ministerio para la Transición Ecológica y el
          Reto Demográfico (MITECO).
        </p>

        {/* Resumen nacional */}
        {resumen.length > 0 && (
          <section className="card mb-8">
            <h2 className="font-display text-xl font-semibold text-stone-900 mb-4">
              Precios medios nacionales
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {resumen.map((r) => (
                <div
                  key={r.productoId}
                  className="border border-stone-200 rounded-lg p-4 text-center"
                >
                  <p className="text-sm text-stone-500 mb-1">{r.nombre}</p>
                  <p className="text-2xl font-bold text-amber-600">
                    {r.precioMedio?.toFixed(3)} €/L
                  </p>
                  <p className="text-xs text-stone-400 mt-1">
                    {r.totalEstaciones.toLocaleString("es-ES")} estaciones
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-stone-500">
              Medias calculadas sobre las estaciones con precio disponible en la
              última fecha de observación
              {gasolina95?.fecha ? ` (${gasolina95.fecha})` : ""}.
            </p>
          </section>
        )}

        {/* Comunidades autónomas */}
        <section>
          <h2 className="font-display text-2xl font-bold text-stone-900 mb-4">
            Estaciones por comunidad autónoma
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {ccaaList.map((ccaa) => (
              <Link
                key={ccaa.id}
                href={`/gasolineras/${slugify(ccaa.nombre)}`}
                className="card-interactive"
              >
                <h3 className="font-display font-semibold text-stone-900">
                  {ccaa.nombre}
                </h3>
                <p className="text-sm text-stone-500 mt-1">
                  {ccaa.totalEstaciones.toLocaleString("es-ES")}{" "}
                  {ccaa.totalEstaciones === 1 ? "estación" : "estaciones"}
                </p>
                <span className="mt-3 inline-block text-amber-600 text-sm font-medium">
                  Ver provincias →
                </span>
              </Link>
            ))}
          </div>
        </section>

        {gasolina95 && gasoleoA && (
          <p className="mt-8 text-xs text-stone-500">
            Gasolina 95 media: {gasolina95.precioMedio?.toFixed(3)} €/L · Gasóleo
            A media: {gasoleoA.precioMedio?.toFixed(3)} €/L · Fuente: MITECO (CC
            BY 4.0). Los datos se muestran tal y como los publica el ministerio.
          </p>
        )}
      </main>
    </div>
  );
}
