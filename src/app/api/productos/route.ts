/**
 * API Route: GET /api/productos
 *
 * Devuelve todos los productos petrolíferos disponibles en la base de datos.
 * Opcionalmente filtra solo los que tienen al menos un precio registrado.
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { productos } from "@/lib/db/schema";
import { sql } from "drizzle-orm";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const soloConPrecios = searchParams.get("conPrecios") === "true";

    if (soloConPrecios) {
      // EXISTS usa el índice idx_precios_producto y corta en el primer match
      // por producto → mucho más rápido que COUNT(*) sobre 29M filas.
      const productosConPrecios = await db
        .select({
          id: productos.id,
          nombre: productos.nombre,
          abreviatura: productos.abreviatura,
        })
        .from(productos)
        .where(
          sql`EXISTS (
            SELECT 1 FROM precios
            WHERE precios.producto_id = ${productos.id}
          )`
        )
        .orderBy(productos.nombre);

      return NextResponse.json({ productos: productosConPrecios });
    }

    // Todos los productos
    const todos = await db
      .select()
      .from(productos)
      .orderBy(productos.nombre);

    return NextResponse.json({ productos: todos });
  } catch (error) {
    console.error("Error en API productos:", error);
    return NextResponse.json(
      { error: "Error al obtener productos" },
      { status: 500 }
    );
  }
}