/**
 * Página de detalle de estación de servicio
 * /estacion/[id]
 *
 * Todo el contenido principal es SSR (precios, comparación, cercanas).
 * El gráfico histórico es client-side pero la página tiene resumen textual
 * del histórico para que la información esencial no dependa de JavaScript.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { TablaPrecios } from "@/components/estacion/TablaPrecios";
import { GraficoHistorico } from "@/components/estacion/GraficoHistorico";
import { BannerAd } from "@/components/ads/BannerAd";
import { ADSENSE_SLOT_ESTACION } from "@/lib/siteConfig";
import {
  getEstacionDetalle,
  getPreciosActualesEstacion,
  getComparativaZona,
  getEstacionesCercanas,
  getResumenHistoricoEstacion,
} from "@/lib/db/queries";
import { PRODUCTOS_CLAVE } from "@/lib/types/miteco";
import { SITE_URL, SITE_NAME } from "@/lib/siteConfig";
import { slugify } from "@/lib/geografia";
import { getUltimasFechasProductos } from "@/lib/db/queries-seo";

interface Props {
  params: Promise<{ id: string }>;
}

// Renderizado dinámico: los precios son por-request (SQLite) y, además,
// garantiza que notFound() emita un 404 HTTP real (no un 200 en streaming).
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const estacion = getEstacionDetalle(id);
  // notFound() también en metadata: al resolver antes del flush del shell,
  // garantiza una respuesta 404 HTTP real para IDs inexistentes.
  if (!estacion) notFound();

  const nombre = estacion.rotulo || `Estación ${estacion.id}`;
  const titulo = `${nombre} — Precios de carburantes en ${estacion.localidad}`;
  const descripcion = `Precios actuales de gasolina y gasóleo en ${nombre}, ${estacion.direccion}, ${estacion.localidad} (${estacion.provinciaNombre}). Comparativa con la zona, histórico y estaciones cercanas. Datos oficiales del MITECO.`;

  return {
    title: titulo,
    description: descripcion,
    alternates: { canonical: `/estacion/${estacion.id}` },
    openGraph: { title: titulo, description: descripcion, type: "website" },
  };
}

export default async function EstacionPage({ params }: Props) {
  const { id } = await params;
  const estacion = getEstacionDetalle(id);
  if (!estacion) notFound();

  // ─── Precios actuales (SSR, uno por producto) ─────────────────────────
  const precios = getPreciosActualesEstacion(estacion.id);
  const preciosTabla = precios.map((p) => ({
    productoId: p.productoId,
    nombre: p.nombre,
    abreviatura: p.abreviatura,
    precio: p.precio,
  }));

  // ─── Comparación con la zona (gasolina 95 como referencia) ────────────
  const comparativa95 = getComparativaZona(
    estacion.municipioId,
    PRODUCTOS_CLAVE.GASOLINA_95_E5
  );
  const mi95 = precios.find(
    (p) => p.productoId === PRODUCTOS_CLAVE.GASOLINA_95_E5
  );

  // ─── Estaciones cercanas ──────────────────────────────────────────────
  const cercanas = getEstacionesCercanas(
    estacion.id,
    estacion.latitud,
    estacion.longitud,
    PRODUCTOS_CLAVE.GASOLINA_95_E5,
    10,
    8
  );

  // ─── Resumen histórico textual (SSR, sin JS) ──────────────────────────
  const historico30 = getResumenHistoricoEstacion(
    estacion.id,
    PRODUCTOS_CLAVE.GASOLINA_95_E5,
    30
  );

  // ─── Control de datos obsoletos ──────────────────────────────────────
  // ¿Tiene esta estación precios en la última observación del producto?
  const fechasReferencia = getUltimasFechasProductos();
  const fechaG95 = fechasReferencia.get(PRODUCTOS_CLAVE.GASOLINA_95_E5);
  const ultimoPrecioG95 = precios.find(
    (p) => p.productoId === PRODUCTOS_CLAVE.GASOLINA_95_E5
  );
  const datosObsoletos95 =
    fechaG95 != null &&
    ultimoPrecioG95 != null &&
    ultimoPrecioG95.fecha < fechaG95;
  const diasSinDatos = datosObsoletos95 && ultimoPrecioG95
    ? Math.round(
        (new Date(`${fechaG95}T00:00:00Z`).getTime() -
          new Date(`${ultimoPrecioG95.fecha}T00:00:00Z`).getTime()) /
          86400000
      )
    : 0;

  const nombre = estacion.rotulo || `Estación ${estacion.id}`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "GasStation",
        "@id": `${SITE_URL}/estacion/${estacion.id}#gasstation`,
        name: nombre,
        address: {
          "@type": "PostalAddress",
          streetAddress: estacion.direccion,
          addressLocality: estacion.localidad,
          addressRegion: estacion.provinciaNombre,
          addressCountry: "ES",
        },
        geo: {
          "@type": "GeoCoordinates",
          latitude: estacion.latitud,
          longitude: estacion.longitud,
        },
        ...(estacion.horario
          ? { openingHours: estacion.horario }
          : {}),
        url: `${SITE_URL}/estacion/${estacion.id}`,
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Inicio", item: SITE_URL },
          {
            "@type": "ListItem",
            position: 2,
            name: "España",
            item: `${SITE_URL}/gasolineras`,
          },
          {
            "@type": "ListItem",
            position: 3,
            name: estacion.ccaaNombre,
            item: `${SITE_URL}/gasolineras/${slugify(estacion.ccaaNombre)}`,
          },
          {
            "@type": "ListItem",
            position: 4,
            name: estacion.provinciaNombre,
            item: `${SITE_URL}/gasolineras/${slugify(estacion.ccaaNombre)}/${slugify(estacion.provinciaNombre)}`,
          },
          {
            "@type": "ListItem",
            position: 5,
            name: estacion.municipioNombre,
            item: `${SITE_URL}/gasolineras/${slugify(estacion.ccaaNombre)}/${slugify(estacion.provinciaNombre)}/${slugify(estacion.municipioNombre)}`,
          },
          { "@type": "ListItem", position: 6, name: nombre },
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

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Breadcrumbs */}
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
          <Link
            href={`/gasolineras/${slugify(estacion.ccaaNombre)}`}
            className="hover:text-amber-600 transition-colors"
          >
            {estacion.ccaaNombre}
          </Link>
          <span className="mx-2">/</span>
          <Link
            href={`/gasolineras/${slugify(estacion.ccaaNombre)}/${slugify(estacion.provinciaNombre)}`}
            className="hover:text-amber-600 transition-colors"
          >
            {estacion.provinciaNombre}
          </Link>
          <span className="mx-2">/</span>
          <Link
            href={`/gasolineras/${slugify(estacion.ccaaNombre)}/${slugify(estacion.provinciaNombre)}/${slugify(estacion.municipioNombre)}`}
            className="hover:text-amber-600 transition-colors"
          >
            {estacion.municipioNombre}
          </Link>
          <span className="mx-2">/</span>
          <span className="text-stone-900">{nombre}</span>
        </nav>

        <h1 className="font-display text-2xl md:text-3xl font-bold text-stone-900 mb-2">
          {nombre}
        </h1>
        <p className="text-stone-600 mb-2">
          {estacion.direccion}, {estacion.codigoPostal} {estacion.localidad},{" "}
          {estacion.provinciaNombre}
        </p>
        <p className="text-xs text-stone-500 mb-4">
          <strong>Última actualización: {estacion.fechaActualizacion}</strong> ·
          Datos procedentes de la fuente oficial (MITECO, CC BY 4.0). Los
          precios pueden variar en la propia estación.
        </p>

        {datosObsoletos95 && (
          <div
            className="mb-6 border border-amber-300 bg-amber-50 text-amber-900 rounded-lg px-4 py-3 text-sm"
            role="note"
          >
            <strong>Sin datos recientes.</strong> El último precio de gasolina
            95 de esta estación es del {ultimoPrecioG95?.fecha} (hace{" "}
            {diasSinDatos} días), mientras que la última observación nacional
            disponible es del {fechaG95}. Puede que la estación haya dejado de
            comunicar precios; los datos históricos se conservan como
            referencia.
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Columna izquierda: Precios + Histórico */}
          <div className="lg:col-span-2 space-y-6">
            <TablaPrecios precios={preciosTabla} />

            {/* Comparación con la zona */}
            {comparativa95 && mi95?.precio != null && (
              <section className="card">
                <h2 className="font-display text-lg font-semibold text-stone-900 mb-4">
                  Comparación con {estacion.municipioNombre}
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="border border-stone-200 rounded-lg p-4 text-center">
                    <p className="text-xs text-stone-500 mb-1">Esta estación</p>
                    <p className="text-xl font-bold text-amber-600">
                      {mi95.precio.toFixed(3)} €/L
                    </p>
                  </div>
                  <div className="border border-stone-200 rounded-lg p-4 text-center">
                    <p className="text-xs text-stone-500 mb-1">
                      Media del municipio
                    </p>
                    <p className="text-xl font-bold text-stone-900">
                      {comparativa95.precioMedio.toFixed(3)} €/L
                    </p>
                  </div>
                  <div className="border border-stone-200 rounded-lg p-4 text-center">
                    <p className="text-xs text-stone-500 mb-1">Más barata</p>
                    <p className="text-xl font-bold text-green-600">
                      {comparativa95.precioMin.toFixed(3)} €/L
                    </p>
                  </div>
                  <div className="border border-stone-200 rounded-lg p-4 text-center">
                    <p className="text-xs text-stone-500 mb-1">Más cara</p>
                    <p className="text-xl font-bold text-red-600">
                      {comparativa95.precioMax.toFixed(3)} €/L
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-sm text-stone-600">
                  {mi95.precio < comparativa95.precioMedio
                    ? `Esta estación está ${(comparativa95.precioMedio - mi95.precio).toFixed(3)} €/L por debajo de la media de ${estacion.municipioNombre} (gasolina 95).`
                    : mi95.precio > comparativa95.precioMedio
                      ? `Esta estación está ${(mi95.precio - comparativa95.precioMedio).toFixed(3)} €/L por encima de la media de ${estacion.municipioNombre} (gasolina 95).`
                      : `El precio coincide con la media municipal.`}{" "}
                  Comparación sobre {comparativa95.totalEstaciones} estaciones
                  con precio publicado.
                </p>
              </section>
            )}

            {/* Anuncio tras la información principal (precios + comparación) */}
            {ADSENSE_SLOT_ESTACION && (
              <BannerAd slot={ADSENSE_SLOT_ESTACION} label="Publicidad" />
            )}

            {/* Resumen histórico textual (SSR) */}
            <section className="card">
              <h2 className="font-display text-lg font-semibold text-stone-900 mb-4">
                Evolución reciente (gasolina 95)
              </h2>
              {historico30 &&
              historico30.observaciones > 0 &&
              historico30.precioActual != null ? (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="border border-stone-200 rounded-lg p-4 text-center">
                      <p className="text-xs text-stone-500 mb-1">Precio actual</p>
                      <p className="text-xl font-bold text-amber-600">
                        {historico30.precioActual.toFixed(3)} €/L
                      </p>
                    </div>
                    {historico30.precioHaceX && (
                      <div className="border border-stone-200 rounded-lg p-4 text-center">
                        <p className="text-xs text-stone-500 mb-1">
                          Hace {historico30.diasPrimerDato} días
                        </p>
                        <p className="text-xl font-bold text-stone-900">
                          {historico30.precioHaceX.toFixed(3)} €/L
                        </p>
                      </div>
                    )}
                    <div className="border border-stone-200 rounded-lg p-4 text-center">
                      <p className="text-xs text-stone-500 mb-1">
                        Mínimo (30 días)
                      </p>
                      <p className="text-xl font-bold text-green-600">
                        {historico30.precioMin.toFixed(3)} €/L
                      </p>
                    </div>
                    <div className="border border-stone-200 rounded-lg p-4 text-center">
                      <p className="text-xs text-stone-500 mb-1">
                        Máximo (30 días)
                      </p>
                      <p className="text-xl font-bold text-red-600">
                        {historico30.precioMax.toFixed(3)} €/L
                      </p>
                    </div>
                  </div>
                  {historico30.variacion != null && (
                    <p className="mt-3 text-sm text-stone-600">
                      {historico30.variacion >= 0
                        ? `El precio ha subido ${historico30.variacion.toFixed(3)} €/L`
                        : `El precio ha bajado ${Math.abs(historico30.variacion).toFixed(3)} €/L`}{" "}
                      en el periodo consultado ({historico30.observaciones}{" "}
                      observaciones registradas).
                    </p>
                  )}
                  {historico30.observaciones < 5 && (
                    <p className="mt-2 text-xs text-stone-500">
                      El histórico de esta estación todavía tiene pocas
                      observaciones registradas; la serie se completa a medida
                      que el sistema captura datos diarios.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-stone-500 text-sm">
                  No hay suficientes observaciones históricas de gasolina 95
                  para esta estación. El histórico se construye con los datos
                  que la fuente oficial publica cada día; no se generan datos
                  estimados.
                </p>
              )}
            </section>

            {/* Gráfico (client-side; complementa el resumen textual) */}
            <GraficoHistorico estacionId={estacion.id} />
          </div>

          {/* Columna derecha: Info + acciones */}
          <div className="space-y-6">
            <section className="card">
              <h2 className="font-display text-lg font-semibold text-stone-900 mb-4">
                Información de la estación
              </h2>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <dt className="text-sm text-stone-500">Dirección</dt>
                  <dd className="text-sm font-medium text-stone-900">
                    {estacion.direccion}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-stone-500">Municipio</dt>
                  <dd className="text-sm font-medium text-stone-900">
                    <Link
                      href={`/gasolineras/${slugify(estacion.ccaaNombre)}/${slugify(estacion.provinciaNombre)}/${slugify(estacion.municipioNombre)}`}
                      className="text-amber-600 hover:text-amber-700"
                    >
                      {estacion.municipioNombre}
                    </Link>
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-stone-500">Código postal</dt>
                  <dd className="text-sm font-medium text-stone-900">
                    {estacion.codigoPostal}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-stone-500">Tipo de venta</dt>
                  <dd className="text-sm font-medium text-stone-900">
                    {estacion.tipoVenta === "P"
                      ? "Público"
                      : estacion.tipoVenta === "A"
                        ? "Automática"
                        : estacion.tipoVenta}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-sm text-stone-500">Horario</dt>
                  <dd className="text-sm font-medium text-stone-900">
                    {estacion.horario || "No especificado"}
                  </dd>
                </div>
              </dl>
              <div className="mt-4 pt-4 border-t border-stone-200 flex gap-3">
                <Link
                  href={`/mapa?estacion=${estacion.id}`}
                  className="text-amber-600 hover:text-amber-700 text-sm font-medium"
                >
                  Ver en el mapa →
                </Link>
                <a
                  href={`https://www.google.com/maps?q=${estacion.latitud},${estacion.longitud}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-amber-600 hover:text-amber-700 text-sm font-medium"
                >
                  Abrir en Google Maps →
                </a>
              </div>
            </section>

            {/* Estaciones cercanas */}
            {cercanas.length > 0 && (
              <section className="card">
                <h2 className="font-display text-lg font-semibold text-stone-900 mb-4">
                  Estaciones cercanas
                </h2>
                <ul className="space-y-3">
                  {cercanas.map((cercana) => (
                    <li
                      key={cercana.id}
                      className="flex items-center justify-between gap-3 pb-3 border-b border-stone-100 last:border-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <Link
                          href={`/estacion/${cercana.id}`}
                          className="text-sm font-medium text-amber-600 hover:text-amber-700 truncate block"
                        >
                          {cercana.rotulo || "Estación"}
                        </Link>
                        <p className="text-xs text-stone-500 truncate">
                          {cercana.localidad} ·{" "}
                          {cercana.distanciaKm.toFixed(1)} km
                        </p>
                      </div>
                      {cercana.precio !== null && (
                        <span className="text-sm font-bold text-stone-900 shrink-0">
                          {cercana.precio.toFixed(3)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-stone-500">
                  Precios de gasolina 95 E5 a menos de 10 km en línea recta.
                </p>
              </section>
            )}

            {/* Fuente */}
            <section className="card">
              <h2 className="font-display text-lg font-semibold text-stone-900 mb-4">
                Fuente de datos
              </h2>
              <p className="text-sm text-stone-600">
                Datos oficiales del Ministerio para la Transición Ecológica y el
                Reto Demográfico (MITECO), licencia CC BY 4.0 (EU 2023/138 / Ley
                37/2007). {SITE_NAME} los procesa y muestra sin alterar su valor.
              </p>
              <Link
                href="/metodologia"
                className="text-sm text-amber-600 hover:text-amber-700 mt-2 inline-block"
              >
                Cómo tratamos los datos →
              </Link>
            </section>

            <div className="bg-stone-100 rounded-lg p-4">
              <p className="text-xs text-stone-500">
                ID de estación (IDEESS): {estacion.id}
              </p>
              <p className="text-xs text-stone-500 mt-1">
                Última actualización: {estacion.fechaActualizacion}
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
