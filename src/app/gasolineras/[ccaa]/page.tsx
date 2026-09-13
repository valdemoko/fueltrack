/**
 * Página de comunidad autónoma: /gasolineras/[ccaa]
 *
 * Nivel intermedio del enlazado España → CCAA → Provincia.
 * Incluye resumen nacional de la CCAA y enlace al mapa.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCcaaBySlug, slugify } from "@/lib/geografia";
import {
  getProvinciasDeCcaa,
  getResumenProductosPrincipales,
} from "@/lib/db/queries";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ ccaa: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { ccaa: ccaaSlug } = await params;
  const ccaa = getCcaaBySlug(ccaaSlug);
  if (!ccaa) return { title: "Comunidad no encontrada" };

  const titulo = `Gasolineras en ${ccaa.nombre} — Estaciones y precios por provincia`;
  const descripcion = `Estaciones de servicio en ${ccaa.nombre} por provincia: número de gasolineras, precios medios de gasolina y gasóleo. Datos oficiales del MITECO.`;

  return {
    title: titulo,
    description: descripcion,
    alternates: { canonical: `/gasolineras/${ccaaSlug}` },
    openGraph: { title: titulo, description: descripcion, type: "website" },
  };
}

export default async function CcaaPage({ params }: Props) {
  const { ccaa: ccaaSlug } = await params;

  const ccaa = getCcaaBySlug(ccaaSlug);
  if (!ccaa) notFound();

  const provincias = getProvinciasDeCcaa(ccaa.id);
  const resumen = getResumenProductosPrincipales({ ccaaId: ccaa.id });
  const totalEstaciones = provincias.reduce(
    (acc, p) => acc + p.totalEstaciones,
    0
  );

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        name: `Gasolineras en ${ccaa.nombre}`,
        description: `Estaciones de servicio en ${ccaa.nombre} por provincia.`,
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Inicio", item: "/" },
          {
            "@type": "ListItem",
            position: 2,
            name: "España",
            item: "/gasolineras",
          },
          {
            "@type": "ListItem",
            position: 3,
            name: ccaa.nombre,
          },
        ],
      },
    ],
  };

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
          <Link
            href="/gasolineras"
            className="hover:text-amber-600 transition-colors"
          >
            España
          </Link>
          <span className="mx-2">/</span>
          <span className="text-stone-900">{ccaa.nombre}</span>
        </nav>

        <h1 className="font-display text-3xl md:text-4xl font-bold text-stone-900 mb-3">
          Gasolineras en {ccaa.nombre}
        </h1>
        <p className="text-stone-600 max-w-3xl mb-8">
          {totalEstaciones.toLocaleString("es-ES")} estaciones de servicio
          distribuidas por {provincias.length} provincias. Datos oficiales del
          MITECO.
        </p>

        {/* Precios medios de la CCAA */}
        {resumen.length > 0 && (
          <section className="card mb-8">
            <h2 className="font-display text-xl font-semibold text-stone-900 mb-4">
              Precios medios en {ccaa.nombre}
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
              última fecha de observación de cada producto.
            </p>
          </section>
        )}

        <section>
          <h2 className="font-display text-2xl font-bold text-stone-900 mb-4">
            Provincias de {ccaa.nombre}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {provincias.map((provincia) => (
              <Link
                key={provincia.id}
                href={`/gasolineras/${slugify(ccaa.nombre)}/${slugify(provincia.nombre)}`}
                className="card-interactive"
              >
                <h3 className="font-display font-semibold text-stone-900">
                  {provincia.nombre}
                </h3>
                <p className="text-sm text-stone-500 mt-1">
                  {provincia.totalEstaciones.toLocaleString("es-ES")}{" "}
                  {provincia.totalEstaciones === 1
                    ? "estación"
                    : "estaciones"}
                </p>
                <span className="mt-3 inline-block text-amber-600 text-sm font-medium">
                  Ver municipios →
                </span>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
