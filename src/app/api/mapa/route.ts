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
    parseInt(searchParams.get("limite") || "15000", 10),
    15000
  );

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
    const filas = (await db
      .all(sql`
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
      `) as Array<{
      id: string;
      rotulo: string | null;
      localidad: string;
      latitud: number;
      longitud: number;
      precio: number | null;
    }>);

    // Estadísticas para colores
    const preciosValidos = filas
      .map((e) => e.precio)
      .filter((p): p is number => p !== null);

    const minPrecio = preciosValidos.length > 0 ? Math.min(...preciosValidos) : 0;
    const maxPrecio = preciosValidos.length > 0 ? Math.max(...preciosValidos) : 0;
    const avgPrecio =
      preciosValidos.length > 0
        ? preciosValidos.reduce((a, b) => a + b, 0) / preciosValidos.length
        : 0;

    return NextResponse.json({
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
    });
  } catch (error) {
    console.error("Error al obtener datos del mapa:", error);
    return NextResponse.json(
      { error: "Error al obtener datos del mapa" },
      { status: 500 }
    );
  }
}