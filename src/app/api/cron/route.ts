import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ingestEstaciones, ingestProductos } from "@/lib/miteco/ingestion";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Las 52 provincias de España (código → id CCAA)
const PROVINCIAS: Array<{ id: string; ccaaId: string }> = [
  { id: "01", ccaaId: "15" }, { id: "02", ccaaId: "08" }, { id: "03", ccaaId: "17" },
  { id: "04", ccaaId: "01" }, { id: "05", ccaaId: "07" }, { id: "06", ccaaId: "10" },
  { id: "07", ccaaId: "04" }, { id: "08", ccaaId: "09" }, { id: "09", ccaaId: "07" },
  { id: "10", ccaaId: "10" }, { id: "11", ccaaId: "01" }, { id: "12", ccaaId: "17" },
  { id: "13", ccaaId: "08" }, { id: "14", ccaaId: "01" }, { id: "15", ccaaId: "11" },
  { id: "16", ccaaId: "08" }, { id: "17", ccaaId: "09" }, { id: "18", ccaaId: "01" },
  { id: "19", ccaaId: "08" }, { id: "20", ccaaId: "15" }, { id: "21", ccaaId: "01" },
  { id: "22", ccaaId: "02" }, { id: "23", ccaaId: "01" }, { id: "24", ccaaId: "07" },
  { id: "25", ccaaId: "09" }, { id: "26", ccaaId: "16" }, { id: "27", ccaaId: "11" },
  { id: "28", ccaaId: "12" }, { id: "29", ccaaId: "01" }, { id: "30", ccaaId: "13" },
  { id: "31", ccaaId: "14" }, { id: "32", ccaaId: "11" }, { id: "33", ccaaId: "03" },
  { id: "34", ccaaId: "07" }, { id: "35", ccaaId: "05" }, { id: "36", ccaaId: "11" },
  { id: "37", ccaaId: "07" }, { id: "38", ccaaId: "05" }, { id: "39", ccaaId: "06" },
  { id: "40", ccaaId: "07" }, { id: "41", ccaaId: "01" }, { id: "42", ccaaId: "07" },
  { id: "43", ccaaId: "09" }, { id: "44", ccaaId: "02" }, { id: "45", ccaaId: "08" },
  { id: "46", ccaaId: "17" }, { id: "47", ccaaId: "07" }, { id: "48", ccaaId: "15" },
  { id: "49", ccaaId: "07" }, { id: "50", ccaaId: "02" }, { id: "51", ccaaId: "18" },
  { id: "52", ccaaId: "19" },
];

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const startTime = Date.now();
  const resultado: {
    timestamp: string;
    duracionMs: number;
    productos?: number;
    provincias?: number;
    estaciones?: number;
    errores: string[];
  } = {
    timestamp: new Date().toISOString(),
    duracionMs: 0,
    errores: [],
  };

  try {
    console.log(`[cron] Inicio: ${resultado.timestamp}`);

    const numProductos = await ingestProductos(db);
    resultado.productos = numProductos;

    // Ingerir las 52 provincias (actualizado cada 30 min por MITECO)
    let totalEstaciones = 0;
    let provinciasOK = 0;
    for (const provincia of PROVINCIAS) {
      try {
        const num = await ingestEstaciones(db, provincia.id);
        totalEstaciones += num;
        provinciasOK++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error desconocido";
        console.error(`[cron] Error provincia ${provincia.id}: ${msg}`);
        resultado.errores.push(`Provincia ${provincia.id}: ${msg}`);
      }
    }

    resultado.estaciones = totalEstaciones;
    resultado.provincias = provinciasOK;
    resultado.duracionMs = Date.now() - startTime;
    console.log(
      `[cron] OK: ${provinciasOK}/52 provincias, ${totalEstaciones} estaciones en ${resultado.duracionMs}ms`
    );

    return NextResponse.json({ success: true, ...resultado });
  } catch (error) {
    resultado.duracionMs = Date.now() - startTime;
    resultado.errores.push(
      error instanceof Error ? error.message : "Error desconocido"
    );
    console.error("[cron] Error:", error);

    return NextResponse.json({ success: false, ...resultado }, { status: 500 });
  }
}