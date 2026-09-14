/**
 * Página de provincia: /gasolineras/[ccaa]/[provincia]
 *
 * Superficie SEO principal:
 *  - Gasolineras por municipio (siempre).
 *  - Variantes indexables por combustible (?producto=<id>) con canonical
 *    propio, solo para productos con cobertura real en la provincia:
 *    responden a búsquedas tipo "precio gasóleo Málaga".
 *  - Top de gasolineras más baratas + resumen histórico textual (SSR).
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCcaaBySlug, getProvinciaBySlug, slugify } from "@/lib/geografia";
import {
  getMunicipiosDeProvincia,
  getEstacionesBaratas,
} from "@/lib/db/queries";
import {
  getCoberturaProductos,
  getHistoricoAmbito,
  getProductoById,
} from "@/lib/db/queries-seo";
import { CtaMapaMunicipio } from "@/components/precios/CtaMapaMunicipio";
import { SelectorCombustible } from "@/components/precios/SelectorCombustible";
import { PRODUCTOS_CLAVE } from "@/lib/types/miteco";

// ISR (revalidación horaria): protege la cuota de lectura de Turso.
export const revalidate = 3600;

interface Props {
  params: Promise<{ ccaa: string; provincia: string }>;
  searchParams: Promise<{ producto?: string }>;
}

/** Cobertura mínima (estaciones) para variante indexable de combustible. */
const MIN_COBERTURA_PROVINCIA = 50;

function formatearFechaCorta(fecha: string | null): string {
  if (!fecha) return "";
  const [y, m, d] = fecha.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { ccaa: ccaaSlug, provincia: provinciaSlug } = await params;
  const { producto: productoParam } = await searchParams;

  const ccaa = await getCcaaBySlug(ccaaSlug);
  if (!ccaa) return { title: "Provincia no encontrada" };
  const provincia = await getProvinciaBySlug(provinciaSlug, ccaa.id);
  if (!provincia) return { title: "Provincia no encontrada" };

  const productoId = Number(productoParam);
  const producto = Number.isInteger(productoId)
    ? await getProductoById(productoId)
    : null;

  const base = `gasolineras/${ccaaSlug}/${provinciaSlug}`;
  let titulo: string;
  let descripcion: string;
  let canonical = `/${base}`;

  if (producto) {
    titulo = `Precio ${producto.nombre.toLowerCase()} en ${provincia.nombre} — Medias y gasolineras baratas`;
    descripcion = `Precio medio, mínimo y máximo de ${producto.nombre.toLowerCase()} en la provincia de ${provincia.nombre}. Gasolineras más baratas por municipio. Datos oficiales del MITECO.`;
    canonical = `/${base}?producto=${producto.id}`;
  } else {
    titulo = `Gasolineras en ${provincia.nombre} — Precios de carburantes por municipio`;
    descripcion = `Estaciones de servicio en la provincia de ${provincia.nombre} por municipio. Precios medios, mínimos y máximos de gasolina y gasóleo. Datos oficiales del MITECO.`;
  }

  return {
    title: titulo,
    description: descripcion,
    alternates: { canonical },
    openGraph: { title: titulo, description: descripcion, type: "website" },
  };
}

export default async function ProvinciaPage({ params, searchParams }: Props) {
  const { ccaa: ccaaSlug, provincia: provinciaSlug } = await params;
  const { producto: productoParam } = await searchParams;

  const ccaa = await getCcaaBySlug(ccaaSlug);
  if (!ccaa) notFound();
  const provincia = await getProvinciaBySlug(provinciaSlug, ccaa.id);
  if (!provincia) notFound();

  const base = `gasolineras/${ccaaSlug}/${provinciaSlug}`;

  // ─── Cobertura de productos de la provincia (variantes indexables) ─────
  const cobertura = await getCoberturaProductos(
    { provinciaId: provincia.id },
    MIN_COBERTURA_PROVINCIA
  );

  const productoParamNum = Number(productoParam);
  const productoSeleccionado =
    Number.isInteger(productoParamNum) &&
    cobertura.some((c) => c.productoId === productoParamNum)
      ? cobertura.find((c) => c.productoId === productoParamNum)!
      : null;

  const productoActivoId =
    productoSeleccionado?.productoId ?? PRODUCTOS_CLAVE.GASOLINA_95_E5;

  const municipios = await getMunicipiosDeProvincia(provincia.id, productoActivoId);
  const baratas = await getEstacionesBaratas(productoActivoId, 5, {
    provinciaId: provincia.id,
  });

  // Histórico agregado de la provincia (SSR textual)
  const historico = await getHistoricoAmbito(productoActivoId, 90, {
    provinciaId: provincia.id,
  });

  const nombreProducto = productoSeleccionado?.nombre ?? "Gasolina 95 E5";
  const totalEstaciones = municipios.reduce(
    (acc, m) => acc + m.totalEstaciones,
    0
  );

  // Municipio más poblado de estaciones para el CTA del mapa
  const municipioPrincipal = [...municipios].sort(
    (a, b) => b.totalEstaciones - a.totalEstaciones
  )[0];

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        name: `Gasolineras en ${provincia.nombre}`,
        description: `Estaciones de servicio en la provincia de ${provincia.nombre} por municipio.`,
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
          { "@type": "ListItem", position: 4, name: provincia.nombre },
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
          <span className="text-stone-900">{provincia.nombre}</span>
        </nav>

        <h1 className="font-display text-3xl md:text-4xl font-bold text-stone-900 mb-3">
          {productoSeleccionado
            ? `${nombreProducto} en ${provincia.nombre}`
            : `Gasolineras en ${provincia.nombre}`}
        </h1>
        <p className="text-stone-600 max-w-3xl mb-4">
          {totalEstaciones.toLocaleString("es-ES")} estaciones de servicio en{" "}
          {municipios.length} municipios. Precios de {nombreProducto.toLowerCase()}{" "}
          actualizados con datos oficiales del MITECO
          {productoSeleccionado?.fecha
            ? ` (última observación: ${formatearFechaCorta(productoSeleccionado.fecha)})`
            : ""}
          .
        </p>

        {/* Selector de combustible + CTA mapa */}
        <div className="flex flex-wrap items-center gap-4 mb-8">
          {cobertura.length > 0 && (
            <SelectorCombustible
              productos={cobertura.map((c) => ({
                productoId: c.productoId,
                nombre: c.nombre,
                estacionesConPrecio: c.estacionesConPrecio,
              }))}
              seleccionado={productoSeleccionado?.productoId ?? null}
              basePath={`/${base}`}
            />
          )}
          {municipioPrincipal && (
            <CtaMapaMunicipio
              municipioId={municipioPrincipal.municipioId}
              municipioNombre={municipioPrincipal.municipioNombre}
              productoId={productoActivoId}
            />
          )}
        </div>

        {/* Resumen de precios de la provincia */}
        <section className="card mb-8">
          <h2 className="font-display text-xl font-semibold text-stone-900 mb-4">
            Precios de {nombreProducto.toLowerCase()} en {provincia.nombre}
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="border border-stone-200 rounded-lg p-4 text-center">
              <p className="text-sm text-stone-500 mb-1">Precio medio</p>
              <p className="text-2xl font-bold text-amber-600">
                {productoSeleccionado?.precioMedio?.toFixed(3) ?? "—"} €/L
              </p>
            </div>
            <div className="border border-stone-200 rounded-lg p-4 text-center">
              <p className="text-sm text-stone-500 mb-1">Estaciones con precio</p>
              <p className="text-2xl font-bold text-stone-900">
                {productoSeleccionado?.estacionesConPrecio.toLocaleString("es-ES") ?? "—"}
              </p>
            </div>
            <div className="border border-stone-200 rounded-lg p-4 text-center">
              <p className="text-sm text-stone-500 mb-1">Municipios</p>
              <p className="text-2xl font-bold text-stone-900">
                {municipios.length}
              </p>
            </div>
            <div className="border border-stone-200 rounded-lg p-4 text-center">
              <p className="text-sm text-stone-500 mb-1">Horquilla provincial</p>
              <p className="text-2xl font-bold text-stone-900">
                {productoSeleccionado
                  ? `${productoSeleccionado.precioMedio !== null ? "" : ""}`
                  : ""}
                {baratas[0]?.precio?.toFixed(3) ?? "—"}
              </p>
              <p className="text-xs text-stone-400 mt-1">mínimo provincial</p>
            </div>
          </div>

          {/* Histórico textual SSR */}
          {historico && historico.serie.length > 5 && (
            <div className="mt-6 pt-6 border-t border-stone-200">
              <h3 className="font-display text-lg font-semibold text-stone-900 mb-3">
                Evolución reciente de {nombreProducto.toLowerCase()} en{" "}
                {provincia.nombre}
              </h3>
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
                  {provincia.nombre} es de{" "}
                  <strong>{historico.precioActual?.toFixed(3)} €/L</strong>{" "}
                  {historico.variacion30 >= 0
                    ? `y ha subido ${Math.abs(historico.variacion30).toFixed(3)} €/L`
                    : `y ha bajado ${Math.abs(historico.variacion30).toFixed(3)} €/L`}{" "}
                  respecto a hace un mes.
                </p>
              )}
            </div>
          )}
        </section>

        {/* Estaciones más baratas de la provincia */}
        {baratas.length > 0 && (
          <section className="card mb-8">
            <h2 className="font-display text-xl font-semibold text-stone-900 mb-4">
              {nombreProducto} más barata en {provincia.nombre}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              {baratas.map((estacion, index) => (
                <Link
                  key={estacion.id}
                  href={`/estacion/${estacion.id}`}
                  className="border border-amber-200 rounded-lg p-4 bg-amber-50 hover:shadow-md transition-shadow"
                >
                  <p className="text-xs text-amber-700 font-semibold mb-1">
                    #{index + 1}
                  </p>
                  <p className="text-xl font-bold text-amber-600">
                    {estacion.precio?.toFixed(3)} €/L
                  </p>
                  <p className="text-sm font-medium text-stone-900 mt-1 truncate">
                    {estacion.rotulo || "Estación"}
                  </p>
                  <p className="text-xs text-stone-500 truncate">
                    {estacion.localidad}
                  </p>
                </Link>
              ))}
            </div>
            <p className="mt-3 text-xs text-stone-500">
              Precios de {nombreProducto.toLowerCase()} de la última observación
              disponible. Fuente: MITECO (CC BY 4.0).
            </p>
          </section>
        )}

        {/* Municipios */}
        <section>
          <h2 className="font-display text-2xl font-bold text-stone-900 mb-4">
            Estaciones por municipio
          </h2>
          {municipios.length === 0 ? (
            <p className="text-stone-500">
              No hay datos de estaciones disponibles para esta provincia.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {municipios.map((municipio) => (
                <Link
                  key={municipio.municipioId}
                  href={`/gasolineras/${ccaaSlug}/${provinciaSlug}/${slugify(municipio.municipioNombre)}`}
                  className="card-interactive"
                >
                  <h3 className="font-display font-semibold text-stone-900">
                    {municipio.municipioNombre}
                  </h3>
                  <p className="text-sm text-stone-500 mt-1">
                    {municipio.totalEstaciones}{" "}
                    {municipio.totalEstaciones === 1 ? "estación" : "estaciones"}
                    {municipio.precioMedio !== null && (
                      <> · media {municipio.precioMedio.toFixed(3)} €/L</>
                    )}
                  </p>
                  <span className="mt-3 inline-block text-amber-600 text-sm font-medium">
                    Ver estaciones →
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
