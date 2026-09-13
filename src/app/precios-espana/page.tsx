/**
 * Dashboard nacional: /precios-espana
 *
 * "Precios de combustibles en España hoy": medias nacionales por combustible,
 * variación reciente, comparativa por comunidades autónomas y evolución.
 * Todo SSR con datos reales (última observación de cada producto).
 */
import type { Metadata } from "next";
import Link from "next/link";
import {
  getCoberturaProductos,
  getHistoricoAmbito,
} from "@/lib/db/queries-seo";
import {
  getCcaaConEstaciones,
  getResumenProducto,
} from "@/lib/db/queries";
import { slugify } from "@/lib/geografia";
import { PRODUCTOS_CLAVE } from "@/lib/types/miteco";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Precios de combustibles en España hoy — Medias nacionales",
  description:
    "Precio medio nacional de gasolina 95, gasolina 98, gasóleo A y gasóleo premium, variación mensual y comparativa por comunidades autónomas. Datos oficiales del MITECO.",
  alternates: { canonical: "/precios-espana" },
  openGraph: {
    title: "Precios de combustibles en España hoy",
    description:
      "Medias nacionales y por comunidad autónoma de gasolina y gasóleo. Datos oficiales del MITECO.",
    type: "website",
  },
};

function formatearFechaCorta(fecha: string | null): string {
  if (!fecha) return "";
  const [y, m, d] = fecha.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export default async function PreciosEspanaPage() {
  // Medias nacionales de los 4 productos principales (última observación)
  const idsPrincipales: number[] = [
    PRODUCTOS_CLAVE.GASOLINA_95_E5,
    PRODUCTOS_CLAVE.GASOLINA_98_E5,
    PRODUCTOS_CLAVE.GASOLEO_A,
    PRODUCTOS_CLAVE.GASOLEO_PREMIUM,
  ];
  const idsHistorico: number[] = [
    PRODUCTOS_CLAVE.GASOLINA_95_E5,
    PRODUCTOS_CLAVE.GASOLINA_98_E5,
    PRODUCTOS_CLAVE.GASOLEO_A,
  ];
  const nacionales = await getCoberturaProductos({}, 1);
  const principales = nacionales.filter((c) => idsPrincipales.includes(c.productoId));

  // Histórico nacional (90 días) por producto principal
  const historicosEntries = await Promise.all(
    idsHistorico.map(async (id) => [id, await getHistoricoAmbito(id, 90)] as const)
  );
  const historicos = new Map(historicosEntries.filter(([, h]) => h !== null));

  // Comparativa por CCAA del producto principal (gasolina 95)
  const ccaaList = await getCcaaConEstaciones();
  const comparativaCCAA = (
    await Promise.all(
      ccaaList.map(async (c) => ({
        ...c,
        resumen95: await getResumenProducto(PRODUCTOS_CLAVE.GASOLINA_95_E5, {
          ccaaId: c.id,
        }),
      }))
    )
  )
    .filter((c) => c.resumen95 !== null)
    .sort((a, b) => (a.resumen95!.precioMedio ?? 0) - (b.resumen95!.precioMedio ?? 0));

  const fechaDatos = principales[0]?.fecha ?? null;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Precios de combustibles en España",
    description:
      "Medias nacionales de gasolina y gasóleo con datos oficiales del MITECO.",
  };

  return (
    <div className="min-h-screen bg-surface-primary">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <main className="max-w-6xl mx-auto px-4 py-8 md:py-12">
        <nav className="text-sm text-stone-500 mb-6" aria-label="Breadcrumb">
          <Link href="/" className="hover:text-amber-600 transition-colors">
            Inicio
          </Link>
          <span className="mx-2">/</span>
          <span className="text-stone-900">Precios en España</span>
        </nav>

        <h1 className="font-display text-3xl md:text-4xl font-bold text-stone-900 mb-3">
          Precios de combustibles en España hoy
        </h1>
        <p className="text-stone-600 max-w-3xl mb-2">
          Medias nacionales de los principales carburantes, calculadas sobre las
          estaciones con precio publicado en la última observación oficial
          {fechaDatos ? ` (${formatearFechaCorta(fechaDatos)})` : ""}. Fuente:
          MITECO, licencia CC BY 4.0.
        </p>
        <p className="text-xs text-stone-500 mb-8">
          La media nacional no incluye estimaciones: solo precios reales
          comunicados. Cada producto usa su propia última fecha de observación.
        </p>

        {/* Medias nacionales */}
        <section className="card mb-8">
          <h2 className="font-display text-xl font-semibold text-stone-900 mb-4">
            Precio medio nacional por combustible
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {principales.map((c) => {
              const h = historicos.get(c.productoId);
              const variacion = h?.variacion30 ?? null;
              return (
                <div
                  key={c.productoId}
                  className="border border-stone-200 rounded-lg p-4 text-center"
                >
                  <p className="text-sm text-stone-500 mb-1">{c.nombre}</p>
                  <p className="text-2xl font-bold text-amber-600">
                    {c.precioMedio?.toFixed(3)} €/L
                  </p>
                  {variacion !== null && (
                    <p
                      className={`text-xs mt-1 font-medium ${
                        variacion >= 0 ? "text-red-600" : "text-green-600"
                      }`}
                    >
                      {variacion >= 0 ? "▲ +" : "▼ "}
                      {variacion.toFixed(3)} €/L vs hace ~30 días
                    </p>
                  )}
                  <p className="text-xs text-stone-400 mt-1">
                    {c.estacionesConPrecio.toLocaleString("es-ES")} estaciones
                  </p>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-stone-500">
            ¿Qué significa la variación? Diferencia entre la media nacional de
            hoy y la de hace aproximadamente 30 días (serie real de observaciones
            diarias, sin interpolación).
          </p>
        </section>

        {/* Evolución nacional textual */}
        {historicos.size > 0 && (
          <section className="card mb-8">
            <h2 className="font-display text-xl font-semibold text-stone-900 mb-4">
              Evolución nacional (últimos 3 meses)
            </h2>
            <div className="space-y-4 text-sm text-stone-600 leading-relaxed">
              {idsHistorico.map((id) => {
                const producto = principales.find((p) => p.productoId === id);
                const h = historicos.get(id);
                if (!producto || !h) return null;
                return (
                  <p key={id}>
                    <strong>{producto.nombre}:</strong> el precio medio nacional
                    es de{" "}
                    <strong>{h.precioActual?.toFixed(3)} €/L</strong>
                    {h.variacion30 !== null && (
                      <>
                        , {h.variacion30 >= 0 ? "un aumento" : "una bajada"} de{" "}
                        {Math.abs(h.variacion30).toFixed(3)} €/L respecto a hace
                        un mes
                      </>
                    )}
                    . En el último trimestre la media diaria ha oscilado entre{" "}
                    {h.precioMin?.toFixed(3)} y {h.precioMax?.toFixed(3)} €/L.
                  </p>
                );
              })}
            </div>
            <p className="mt-4 text-xs text-stone-500">
              Consulta la evolución por zona en{" "}
              <Link href="/precios" className="text-amber-600 hover:text-amber-700">
                la herramienta interactiva de precios
              </Link>{" "}
              o la{" "}
              <Link href="/metodologia" className="text-amber-600 hover:text-amber-700">
                metodología de cálculo
              </Link>
              .
            </p>
          </section>
        )}

        {/* Comparativa por CCAA */}
        {comparativaCCAA.length > 0 && (
          <section className="card mb-8">
            <h2 className="font-display text-xl font-semibold text-stone-900 mb-4">
              Gasolina 95 por comunidad autónoma (de más barata a más cara)
            </h2>
            <div className="overflow-x-auto -mx-4 px-4">
              <table className="min-w-full divide-y divide-stone-200">
                <thead className="bg-stone-50">
                  <tr>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">
                      Comunidad
                    </th>
                    <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-stone-500 uppercase tracking-wider">
                      Precio medio (€/L)
                    </th>
                    <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-stone-500 uppercase tracking-wider">
                      Mínimo
                    </th>
                    <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-stone-500 uppercase tracking-wider">
                      Máximo
                    </th>
                    <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-stone-500 uppercase tracking-wider">
                      Estaciones
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-stone-200">
                  {comparativaCCAA.map((c) => (
                    <tr key={c.id} className="hover:bg-stone-50">
                      <td className="px-4 py-3">
                        <Link
                          href={`/gasolineras/${slugify(c.nombre)}`}
                          className="text-sm font-medium text-amber-600 hover:text-amber-700"
                        >
                          {c.nombre}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-bold text-stone-900">
                        {c.resumen95!.precioMedio?.toFixed(3)}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-green-600">
                        {c.resumen95!.precioMin?.toFixed(3)}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-red-600">
                        {c.resumen95!.precioMax?.toFixed(3)}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-stone-500">
                        {c.resumen95!.totalEstaciones.toLocaleString("es-ES")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Enlazado interno */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link href="/gasolineras" className="card-interactive">
            <h3 className="font-display font-semibold text-stone-900">
              Buscar por zona
            </h3>
            <p className="text-sm text-stone-500 mt-1">
              Gasolineras por comunidad, provincia y municipio.
            </p>
          </Link>
          <Link href="/mapa" className="card-interactive">
            <h3 className="font-display font-semibold text-stone-900">
              Mapa de España
            </h3>
            <p className="text-sm text-stone-500 mt-1">
              Encuentra la estación más barata cerca de ti.
            </p>
          </Link>
          <Link href="/precios" className="card-interactive">
            <h3 className="font-display font-semibold text-stone-900">
              Histórico interactivo
            </h3>
            <p className="text-sm text-stone-500 mt-1">
              Gráficos de evolución por producto y zona.
            </p>
          </Link>
        </section>
      </main>
    </div>
  );
}
