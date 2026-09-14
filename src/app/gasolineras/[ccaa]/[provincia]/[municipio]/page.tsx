/**
 * Página de municipio: /gasolineras/[ccaa]/[provincia]/[municipio]
 *
 * Contenido principal SSR (indexable):
 *  - Tabla de gasolineras del combustible seleccionado (o gasolina 95 por
 *    defecto), ordenada de más barata a más cara.
 *  - URLs indexables por combustible: ?producto=<id> con canonical propio,
 *    solo para productos con cobertura real en el municipio.
 *
 * Interactivo (client): selector de combustible, CTA al mapa preseleccionado.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getCcaaBySlug,
  getProvinciaBySlug,
  getMunicipioBySlug,
  tituloMunicipio,
} from "@/lib/geografia";
import {
  getCoberturaProductos,
  getEstacionesMunicipioProducto,
  getMunicipiosCercanos,
  getHistoricoAmbito,
  getProductoById,
} from "@/lib/db/queries-seo";
import { SelectorCombustible } from "@/components/precios/SelectorCombustible";
import { CtaMapaMunicipio } from "@/components/precios/CtaMapaMunicipio";
import { BannerAd } from "@/components/ads/BannerAd";
import { ADSENSE_SLOT_LISTADO } from "@/lib/siteConfig";
import { PRODUCTOS_CLAVE } from "@/lib/types/miteco";

// ISR (revalidación horaria): protege la cuota de lectura de Turso.
export const revalidate = 3600;

interface Props {
  params: Promise<{
    ccaa: string;
    provincia: string;
    municipio: string;
  }>;
  searchParams: Promise<{ producto?: string }>;
}

/** Cobertura mínima para que un producto tenga URL indexable propia. */
const MIN_ESTACIONES_PRODUCTO = 3;

function formatearFechaCorta(fecha: string | null): string {
  if (!fecha) return "";
  const [y, m, d] = fecha.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { ccaa: ccaaSlug, provincia: provinciaSlug, municipio: municipioSlug } =
    await params;
  const { producto: productoParam } = await searchParams;

  const ccaa = await getCcaaBySlug(ccaaSlug);
  if (!ccaa) return { title: "Municipio no encontrado" };
  const provincia = await getProvinciaBySlug(provinciaSlug, ccaa.id);
  if (!provincia) return { title: "Municipio no encontrado" };
  const municipio = await getMunicipioBySlug(municipioSlug, provincia.id);
  if (!municipio) return { title: "Municipio no encontrado" };

  const productoId = Number(productoParam);
  const producto = Number.isInteger(productoId)
    ? await getProductoById(productoId)
    : null;

  const municipioDisplay = tituloMunicipio(municipio.nombre);

  const base = `gasolineras/${ccaaSlug}/${provinciaSlug}/${municipioSlug}`;
  let titulo: string;
  let descripcion: string;
  let canonical = `/${base}`;

  if (producto) {
    titulo = `Precio ${producto.nombre.toLowerCase()} en ${municipioDisplay} — Gasolineras más baratas`;
    descripcion = `Gasolineras de ${municipioDisplay} (${provincia.nombre}) con el precio más barato de ${producto.nombre.toLowerCase()}, ordenadas de más barata a más cara. Comparativa con la media y datos oficiales del MITECO.`;
    canonical = `/${base}?producto=${producto.id}`;
  } else {
    titulo = `Gasolineras en ${municipioDisplay} — Precios de carburantes hoy`;
    descripcion = `Estaciones de servicio en ${municipioDisplay} (${provincia.nombre}): precios actuales de gasolina 95, gasolina 98 y gasóleo A, ordenados de más barato a más caro. Datos oficiales del MITECO.`;
  }

  return {
    title: titulo,
    description: descripcion,
    alternates: { canonical },
    openGraph: { title: titulo, description: descripcion, type: "website" },
  };
}

export default async function MunicipioPage({ params, searchParams }: Props) {
  const { ccaa: ccaaSlug, provincia: provinciaSlug, municipio: municipioSlug } =
    await params;
  const { producto: productoParam } = await searchParams;

  const ccaa = await getCcaaBySlug(ccaaSlug);
  if (!ccaa) notFound();
  const provincia = await getProvinciaBySlug(provinciaSlug, ccaa.id);
  if (!provincia) notFound();
  const municipio = await getMunicipioBySlug(municipioSlug, provincia.id);
  if (!municipio) notFound();

  const municipioDisplay = tituloMunicipio(municipio.nombre);

  const base = `gasolineras/${ccaaSlug}/${provinciaSlug}/${municipioSlug}`;

  // ─── Cobertura real de productos del municipio ────────────────────────
  const cobertura = await getCoberturaProductos(
    { municipioId: municipio.id },
    MIN_ESTACIONES_PRODUCTO
  );

  // Producto seleccionado: ?producto=N si existe cobertura; si no, gasolina 95.
  const productoParamNum = Number(productoParam);
  const productoSeleccionado =
    Number.isInteger(productoParamNum) &&
    cobertura.some((c) => c.productoId === productoParamNum)
      ? cobertura.find((c) => c.productoId === productoParamNum)!
      : (cobertura.find((c) => c.productoId === PRODUCTOS_CLAVE.GASOLINA_95_E5) ??
        cobertura[0] ??
        null);

  // ─── Datos SSR ────────────────────────────────────────────────────────
  const estaciones = await getEstacionesMunicipioProducto(
    municipio.id,
    productoSeleccionado?.productoId ?? PRODUCTOS_CLAVE.GASOLINA_95_E5
  );
  const conPrecio = estaciones.filter((e) => e.precio !== null);
  const sinPrecio = estaciones.length - conPrecio.length;

  const preciosValidos = conPrecio
    .map((e) => e.precio as number)
    .filter((p) => Number.isFinite(p));
  const precioMin = preciosValidos.length ? Math.min(...preciosValidos) : null;
  const precioMax = preciosValidos.length ? Math.max(...preciosValidos) : null;
  const precioMedio =
    preciosValidos.length > 0
      ? preciosValidos.reduce((a, b) => a + b, 0) / preciosValidos.length
      : null;

  // Estaciones "obsoletas": su último precio del producto es anterior a la
  // última observación global del producto (control de datos desactualizados)
  const fechaReferencia = conPrecio[0]?.fechaReferencia ?? null;
  const estacionesObsoletas = conPrecio.filter(
    (e) =>
      fechaReferencia &&
      e.fechaUltimoPrecio &&
      e.fechaUltimoPrecio < fechaReferencia
  ).length;

  // Histórico agregado del municipio (SSR textual)
  const historico = await getHistoricoAmbito(
    productoSeleccionado?.productoId ?? PRODUCTOS_CLAVE.GASOLINA_95_E5,
    90,
    { municipioId: municipio.id }
  );

  const cercanos = await getMunicipiosCercanos(municipio.id, 8, 30);

  const nombreProducto = productoSeleccionado?.nombre ?? "gasolina 95";
  const fechaUltima =
    productoSeleccionado?.fecha ??
    conPrecio[0]?.fechaReferencia ??
    historico?.serie[historico.serie.length - 1]?.fecha ??
    null;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        name: `Gasolineras en ${municipioDisplay}`,
        description: `Estaciones de servicio en ${municipioDisplay} con precios actualizados.`,
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Inicio", item: "/" },
          { "@type": "ListItem", position: 2, name: "España", item: "/gasolineras" },
          {
            "@type": "ListItem",
            position: 3,
            name: ccaa.nombre,
            item: `/gasolineras/${ccaaSlug}`,
          },
          {
            "@type": "ListItem",
            position: 4,
            name: provincia.nombre,
            item: `/gasolineras/${ccaaSlug}/${provinciaSlug}`,
          },
          { "@type": "ListItem", position: 5, name: municipioDisplay },
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
          <Link href="/gasolineras" className="hover:text-amber-600 transition-colors">
            España
          </Link>
          <span className="mx-2">/</span>
          <Link
            href={`/gasolineras/${ccaaSlug}`}
            className="hover:text-amber-600 transition-colors"
          >
            {ccaa.nombre}
          </Link>
          <span className="mx-2">/</span>
          <Link
            href={`/gasolineras/${ccaaSlug}/${provinciaSlug}`}
            className="hover:text-amber-600 transition-colors"
          >
            {provincia.nombre}
          </Link>
          <span className="mx-2">/</span>
          <span className="text-stone-900">{municipioDisplay}</span>
        </nav>

        <h1 className="font-display text-3xl md:text-4xl font-bold text-stone-900 mb-3">
          {productoSeleccionado
            ? `${nombreProducto} en ${municipioDisplay}`
            : `Gasolineras en ${municipioDisplay}`}
        </h1>
        <p className="text-stone-600 max-w-3xl mb-2">
          {estaciones.length} estaciones de servicio con precios de{" "}
          {nombreProducto.toLowerCase()}, ordenadas de más barata a más cara.
        </p>
        {fechaUltima && (
          <p className="text-xs text-stone-500 mb-6">
            Última actualización de precios:{" "}
            <strong>{formatearFechaCorta(fechaUltima)}</strong> · Datos
            procedentes de la fuente oficial (MITECO). Los precios pueden variar
            en la estación.
          </p>
        )}

        {/* Selector de combustible + CTA mapa (interactivo) */}
        <div className="flex flex-wrap items-center gap-4 mb-8">
          <SelectorCombustible
            productos={cobertura.map((c) => ({
              productoId: c.productoId,
              nombre: c.nombre,
              estacionesConPrecio: c.estacionesConPrecio,
            }))}
            seleccionado={productoSeleccionado?.productoId ?? null}
            basePath={`/${base}`}
          />
          <CtaMapaMunicipio
            municipioId={municipio.id}
            municipioNombre={municipioDisplay}
            productoId={productoSeleccionado?.productoId ?? PRODUCTOS_CLAVE.GASOLINA_95_E5}
          />
        </div>

        {/* Resumen del municipio (producto seleccionado) */}
        {precioMedio !== null && (
          <section className="card mb-8">
            <h2 className="font-display text-xl font-semibold text-stone-900 mb-4">
              Precios de {nombreProducto.toLowerCase()} en {municipioDisplay}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="border border-stone-200 rounded-lg p-4 text-center">
                <p className="text-sm text-stone-500 mb-1">Precio medio</p>
                <p className="text-2xl font-bold text-amber-600">
                  {precioMedio.toFixed(3)} €/L
                </p>
              </div>
              <div className="border border-stone-200 rounded-lg p-4 text-center">
                <p className="text-sm text-stone-500 mb-1">Más barata</p>
                <p className="text-2xl font-bold text-green-600">
                  {precioMin?.toFixed(3)} €/L
                </p>
              </div>
              <div className="border border-stone-200 rounded-lg p-4 text-center">
                <p className="text-sm text-stone-500 mb-1">Más cara</p>
                <p className="text-2xl font-bold text-red-600">
                  {precioMax?.toFixed(3)} €/L
                </p>
              </div>
              <div className="border border-stone-200 rounded-lg p-4 text-center">
                <p className="text-sm text-stone-500 mb-1">Estaciones</p>
                <p className="text-2xl font-bold text-stone-900">
                  {estaciones.length}
                </p>
              </div>
            </div>
          </section>
        )}

        {/* Tabla de estaciones (SSR, más barata primero) */}
        <section className="card mb-8">
          <h2 className="font-display text-xl font-semibold text-stone-900 mb-4">
            Todas las estaciones ({nombreProducto.toLowerCase()})
          </h2>
          {estaciones.length === 0 ? (
            <p className="text-stone-500">
              No hay estaciones con precios disponibles para este municipio.
            </p>
          ) : (
            <div className="overflow-x-auto -mx-4 px-4">
              <table className="min-w-full divide-y divide-stone-200">
                <thead className="bg-stone-50">
                  <tr>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">
                      Estación
                    </th>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">
                      Dirección
                    </th>
                    <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-stone-500 uppercase tracking-wider">
                      {nombreProducto} (€/L)
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-stone-200">
                  {estaciones.map((estacion) => (
                    <tr key={estacion.id} className="hover:bg-stone-50">
                      <td className="px-4 py-3">
                        <Link
                          href={`/estacion/${estacion.id}`}
                          className="text-sm font-medium text-amber-600 hover:text-amber-700"
                        >
                          {estacion.rotulo || "Estación"}
                        </Link>
                        <p className="text-xs text-stone-400">{estacion.localidad}</p>
                      </td>
                      <td className="px-4 py-3 text-sm text-stone-600">
                        {estacion.direccion}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {estacion.precio !== null ? (
                          estacion.fechaUltimoPrecio &&
                          fechaReferencia &&
                          estacion.fechaUltimoPrecio < fechaReferencia ? (
                            <span
                              className="text-sm text-stone-500"
                              title={`Último dato conocido: ${formatearFechaCorta(estacion.fechaUltimoPrecio)}`}
                            >
                              {estacion.precio?.toFixed(3)}{" "}
                              <span className="text-xs font-medium text-stone-400">
                                (sin datos recientes)
                              </span>
                            </span>
                          ) : (
                            <span className="text-sm font-bold text-amber-600">
                              {estacion.precio?.toFixed(3)}
                            </span>
                          )
                        ) : (
                          <span className="text-sm text-stone-400">Sin dato</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {sinPrecio > 0 && (
            <p className="mt-4 text-xs text-stone-500">
              {sinPrecio} estación(es) sin precio publicado de{" "}
              {nombreProducto.toLowerCase()}.
            </p>
          )}
          {estacionesObsoletas > 0 && (
            <p className="mt-2 text-xs text-stone-500">
              {estacionesObsoletas} estación(es) figura(n) como «sin datos
              recientes»: su último precio conocido es anterior a la última
              observación del producto.
            </p>
          )}
          <p className="mt-4 text-xs text-stone-500">
            Precios de {nombreProducto.toLowerCase()} de la última observación
            disponible{fechaUltima ? ` (${formatearFechaCorta(fechaUltima)})` : ""}.
            Fuente: MITECO, licencia CC BY 4.0.
          </p>
        </section>

        {/* Histórico agregado del municipio (SSR textual) */}
        {historico && historico.serie.length > 5 && (
          <section className="card mb-8">
            <h2 className="font-display text-xl font-semibold text-stone-900 mb-4">
              Evolución de {nombreProducto.toLowerCase()} en {municipioDisplay}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="border border-stone-200 rounded-lg p-4 text-center">
                <p className="text-xs text-stone-500 mb-1">Precio medio actual</p>
                <p className="text-xl font-bold text-amber-600">
                  {historico.precioActual?.toFixed(3)} €/L
                </p>
              </div>
              {historico.precioHace30 !== null && (
                <div className="border border-stone-200 rounded-lg p-4 text-center">
                  <p className="text-xs text-stone-500 mb-1">Hace ~30 días</p>
                  <p className="text-xl font-bold text-stone-900">
                    {historico.precioHace30.toFixed(3)} €/L
                  </p>
                </div>
              )}
              <div className="border border-stone-200 rounded-lg p-4 text-center">
                <p className="text-xs text-stone-500 mb-1">Mínimo (3 meses)</p>
                <p className="text-xl font-bold text-green-600">
                  {historico.precioMin?.toFixed(3)} €/L
                </p>
              </div>
              <div className="border border-stone-200 rounded-lg p-4 text-center">
                <p className="text-xs text-stone-500 mb-1">Máximo (3 meses)</p>
                <p className="text-xl font-bold text-red-600">
                  {historico.precioMax?.toFixed(3)} €/L
                </p>
              </div>
            </div>
            {historico.variacion30 !== null && (
              <p className="mt-3 text-sm text-stone-600">
                El precio medio de {nombreProducto.toLowerCase()} en{" "}
                {municipioDisplay} es de{" "}
                <strong>{historico.precioActual?.toFixed(3)} €/L</strong>{" "}
                {historico.variacion30 >= 0
                  ? `y ha subido ${Math.abs(historico.variacion30).toFixed(3)} €/L`
                  : `y ha bajado ${Math.abs(historico.variacion30).toFixed(3)} €/L`}{" "}
                respecto a hace un mes (serie real de{" "}
                {historico.observaciones} observaciones diarias).
              </p>
            )}
          </section>
        )}

        {/* Anuncio tras el contenido principal (listado) */}
        {ADSENSE_SLOT_LISTADO && (
          <div className="mb-8">
            <BannerAd slot={ADSENSE_SLOT_LISTADO} label="Publicidad" />
          </div>
        )}

        {/* Enlazado: productos con cobertura + municipios cercanos */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
          {cobertura.length > 1 && (
            <div className="card">
              <h2 className="font-display text-lg font-semibold text-stone-900 mb-4">
                Otros combustibles en {municipioDisplay}
              </h2>
              <ul className="space-y-2 text-sm">
                {cobertura
                  .filter((c) => c.productoId !== productoSeleccionado?.productoId)
                  .map((c) => (
                    <li key={c.productoId}>
                      <Link
                        href={`/${base}?producto=${c.productoId}`}
                        className="text-amber-600 hover:text-amber-700 font-medium"
                      >
                        {c.nombre} en {municipioDisplay}
                      </Link>
                      <span className="text-stone-400">
                        {" "}
                        · {c.estacionesConPrecio} estaciones
                        {c.precioMedio !== null &&
                          ` · media ${c.precioMedio.toFixed(3)} €/L`}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          )}
          {cercanos.length > 0 && (
            <div className="card">
              <h2 className="font-display text-lg font-semibold text-stone-900 mb-4">
                Municipios cercanos
              </h2>
              <ul className="space-y-2 text-sm">
                {cercanos.map((m) => (
                  <li key={m.id}>
                    <Link
                      href={`/gasolineras/${m.ccaaSlug}/${m.provinciaSlug}/${m.municipioSlug}`}
                      className="text-amber-600 hover:text-amber-700 font-medium"
                    >
                      Gasolineras en {m.nombre}
                    </Link>
                    <span className="text-stone-400">
                      {" "}
                      · {m.totalEstaciones} estaciones ·{" "}
                      {m.distanciaKm.toFixed(0)} km
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
