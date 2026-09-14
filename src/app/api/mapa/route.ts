/**
 * API Route: GET /api/mapa
 *
 * Endpoint optimizado para el mapa interactivo.
 * Devuelve estaciones con coordenadas + el ÚLTIMO precio registrado
 * del producto seleccionado (para coloreado).
 *
 * Optimizado: una sola query con subquery correlacionada (último precio
 * por estación+producto) en lugar de N+1 consultas.
 *
 * Query params opcionales:
 *   - producto: ID de producto (default: 1 = Gasolina 95 E5)
 *   - municipioId: filtrar por ID de municipio (preferente)
 *   - municipio: filtrar por nombre de localidad (compatibilidad)
 *   - provinciaId: filtrar por provincia
 *   - ccaaId: filtrar por comunidad autónoma
 *   - limite: máx estaciones (default: 15000 — toda España)
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql, and, type SQL } from "drizzle-orm";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const producto = parseInt(searchParams.get("producto") || "1", 10);
  const municipioId = searchParams.get("municipioId");
  const municipio = searchParams.get("municipio");
  const provinciaId = searchParams.get("provinciaId");
  const ccaaId = searchParams.get("ccaaId");
  const limite = Math.min(
    parseInt(searchParams.get("limite") || "500", 10),
    3000,
  );
  // Viewport del mapa (bounding box): el cliente pide solo lo que ve.
  // CUANTIZACIÓN: se redondea el bbox a una rejilla de 0,05° (~5 km) ANTES
  // de usarlo. Los arrastres/zooms de distintos usuarios así comparten la
  // misma clave de caché del CDN en vez de generar consultas únicas
  // (cada viewport único = un escaneo a la BD). El usuario no nota nada:
  // el margen extra del bbox redondeado está fuera de su vista.
  const bbox = searchParams.get("bbox");
  const CUANTIZACION = 0.05;
  const cuantizar = (v: number) =>
    Math.round(v / CUANTIZACION) * CUANTIZACION;
  let bboxConds: SQL[] = [];
  if (bbox) {
    const partes = bbox.split(",").map(Number);
    if (
      partes.length === 4 &&
      partes.every((n) => Number.isFinite(n)) &&
      partes[2] > partes[0] &&
      partes[3] > partes[1]
    ) {
      const [latS, lonO, latN, lonE] = partes;
      const s = cuantizar(latS);
      const o = cuantizar(lonO);
      const n = cuantizar(latN);
      const e = cuantizar(lonE);
      bboxConds = [
        sql`e.latitud BETWEEN ${s} AND ${n}`,
        sql`e.longitud BETWEEN ${o} AND ${e}`,
      ];
    }
  }

  try {
    // Fecha del último precio registrado para el producto (cabecera del mapa)
    const maxFechaRow = (await db
      .select({ fecha: sql<string>`MAX(fecha_observacion)` })
      .from(sql`precios`)
      .where(sql`producto_id = ${producto}`)
      .get()) as { fecha: string } | undefined;

    const fechaPrecios = maxFechaRow?.fecha ?? null;

    // Condiciones de filtro (parámetros vinculados, sin inyección)
    const condiciones: SQL[] = [
      sql`e.latitud IS NOT NULL`,
      sql`e.longitud IS NOT NULL`,
    ];
    if (municipioId) {
      condiciones.push(sql`e.municipio_id = ${municipioId}`);
    }
    if (municipio) {
      condiciones.push(sql`e.localidad LIKE ${`%${municipio}%`}`);
    }
    condiciones.push(...bboxConds);
    if (provinciaId) {
      condiciones.push(sql`e.provincia_id = ${provinciaId}`);
    } else if (ccaaId) {
      condiciones.push(sql`e.ccaa_id = ${ccaaId}`);
    }
    const where = sql`WHERE ${and(...condiciones)}`;

    // Query agregada: estaciones + último precio del producto (subquery correlacionada).
    // El PK (estacion_id, producto_id, fecha_observacion) sirve el ORDER BY DESC
    // por rango de índice → seek directo al último precio.
    // Payload mínimo: solo los campos que el pin/popup necesitan.
    // (direccion y horario se consultan en la página de la estación)
    const filas = (await db.all(sql`
        SELECT
          e.id,
          e.rotulo,
          e.localidad,
          e.latitud,
          e.longitud,
          (
            SELECT p.precio
            FROM precios p
            WHERE p.estacion_id = e.id AND p.producto_id = ${producto}
            ORDER BY p.fecha_observacion DESC
            LIMIT 1
          ) AS precio
        FROM estaciones e
        ${where}
        ORDER BY e.localidad ASC, e.id ASC
        LIMIT ${limite}
      `)) as Array<{
      id: string;
      rotulo: string | null;
      localidad: string;
      latitud: number;
      longitud: number;
      precio: number | null;
    }>;

    // Estadísticas para colores
    const preciosValidos = filas
      .map((e) => e.precio)
      .filter((p): p is number => p !== null);

    const minPrecio =
      preciosValidos.length > 0 ? Math.min(...preciosValidos) : 0;
    const maxPrecio =
      preciosValidos.length > 0 ? Math.max(...preciosValidos) : 0;
    const avgPrecio =
      preciosValidos.length > 0
        ? preciosValidos.reduce((a, b) => a + b, 0) / preciosValidos.length
        : 0;

    return NextResponse.json(
      {
        fecha: fechaPrecios,
        producto,
        total: filas.length,

        estadisticas: {
          min: minPrecio,
          max: maxPrecio,
          promedio: Math.round(avgPrecio * 1000) / 1000,
          conPrecio: preciosValidos.length,
          sinPrecio: filas.length - preciosValidos.length,
        },
        estaciones: filas,
      },
      {
        // Cache en el borde de Vercel: N usuarios del mismo viewport →
        // 1 consulta a Turso. s-max 1 h (los precios cambian 1 vez al día;
        // con bbox cuantizado, la clave de caché se comparte entre
        // usuarios). stale-while-revalidate refresca en segundo plano.
        headers: {
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
        },
      },
    );
  } catch (error) {
    console.error("Error al obtener datos del mapa:", error);
    return NextResponse.json(
      { error: "Error al obtener datos del mapa" },
      { status: 500 },
    );
  }
}
