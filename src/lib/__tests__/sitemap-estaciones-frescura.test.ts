/**
 * Validación de la selección de fichas de estación DEL SITEMAP contra datos
 * reales del snapshot local de `data/combustible.db`.
 *
 * Comprueba las invariantes que rompía el filtro de frescura de texto:
 *  1. Las fechas legacy obsoletas que el texto daba por recientes ya NO entran.
 *  2. Las fechas ISO recientes siguen entrando, hasta el tope de 800.
 *  3. Las fechas legacy que sí son recientes de verdad (p. ej. "27/08/2026")
 *     no se descartan por su formato.
 *
 * El snapshot SOLO se usa como fuente de filas de prueba: la lógica que se
 * valida es `seleccionarEstacionesFrescas()`, que es pura. Así el test no
 * necesita una base de datos viva (ni local ni de Neon) y puede correr en CI.
 * Se omite automáticamente si no hay snapshot.
 */
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { parseFechaActualizacion, diasDeAntiguedad, esFechaFresca } from "../fecha";
import { seleccionarEstacionesFrescas } from "../sitemap-estaciones";

const MAX_DIAS = 30;
const MAX_ESTACIONES = 800;
const BASE_URL = "https://fueltrack.site";
const RUTA_BD = path.resolve(process.cwd(), "data/combustible.db");
const haySnapshot = fs.existsSync(RUTA_BD);

type FilaCandidata = { id: string; fecha_actualizacion: string };

const suite = haySnapshot ? describe : describe.skip;

suite("sitemap · frescura de /estacion/ contra el snapshot local", () => {
  let bd: Database.Database;
  let urls: string[] = [];
  let fechas: Date[] = [];
  let candidatas: FilaCandidata[] = [];
  let corteTexto = "";

  beforeAll(() => {
    bd = new Database(RUTA_BD, { readonly: true });

    corteTexto = (
      bd.prepare("SELECT date('now', '-30 days') d").get() as { d: string }
    ).d;

    candidatas = bd
      .prepare(
        `SELECT e.id, e.fecha_actualizacion FROM estaciones e
         WHERE (SELECT COUNT(*) FROM estaciones e2
                WHERE e2.municipio_id = e.municipio_id) >= 3`,
      )
      .all() as FilaCandidata[];

    // Misma función que usa el sitemap, con los mismos topes.
    const seleccionadas = seleccionarEstacionesFrescas(
      candidatas,
      MAX_DIAS,
      MAX_ESTACIONES,
    );
    urls = seleccionadas.map((e) => `${BASE_URL}/estacion/${e.id}`);
    fechas = seleccionadas.map((e) => e.fecha);
  }, 60_000);

  it("todas las URLs emitidas son /estacion/{id} numérico", () => {
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url).toMatch(/^https:\/\/fueltrack\.site\/estacion\/\d{1,10}$/);
    }
  });

  it("no hay IDs duplicados", () => {
    const ids = urls.map((u) => u.split("/").pop());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("respeta el tope de 800 y lo agota cuando hay candidatas de sobra", () => {
    const frescas = candidatas.filter((c) =>
      esFechaFresca(parseFechaActualizacion(c.fecha_actualizacion), MAX_DIAS),
    );
    expect(urls.length).toBeLessThanOrEqual(MAX_ESTACIONES);
    expect(urls.length).toBe(Math.min(MAX_ESTACIONES, frescas.length));
  });

  it("el conjunto emitido coincide con las candidatas frescas más recientes", () => {
    const esperadas = candidatas
      .map((c) => ({ id: c.id, fecha: parseFechaActualizacion(c.fecha_actualizacion) }))
      .filter((c): c is { id: string; fecha: Date } => esFechaFresca(c.fecha, MAX_DIAS))
      .sort((a, b) => b.fecha.getTime() - a.fecha.getTime() || (a.id < b.id ? -1 : 1))
      .slice(0, MAX_ESTACIONES)
      .map((c) => `${BASE_URL}/estacion/${c.id}`);
    expect(urls).toEqual(esperadas);
  });

  it("todas las fechas emitidas son frescas (<= 30 días) y el orden es descendente", () => {
    const ahora = new Date();
    for (const fecha of fechas) {
      expect(Number.isNaN(fecha.getTime())).toBe(false);
      expect(esFechaFresca(fecha, MAX_DIAS, ahora)).toBe(true);
    }
    const ordenadas = [...fechas].sort((a, b) => b.getTime() - a.getTime());
    expect(fechas.map((f) => f.getTime())).toEqual(ordenadas.map((f) => f.getTime()));
  });

  it("el filtro antiguo de texto colaba fichas obsoletas, y ninguna de ellas entra ahora (regresión)", () => {
    // Reproduce la comparación antigua: `fecha_actualizacion >= date('now','-30 days')`
    // evaluada como texto.
    const coladasPorTexto = candidatas.filter((c) => c.fecha_actualizacion >= corteTexto);
    const obsoletasQuePasaban = coladasPorTexto.filter(
      (c) => !esFechaFresca(parseFechaActualizacion(c.fecha_actualizacion), MAX_DIAS),
    );

    // El bug existía: la comparación de texto aceptaba fichas claramente antiguas.
    expect(obsoletasQuePasaban.length).toBeGreaterThan(0);
    expect(
      obsoletasQuePasaban.every(
        (c) => diasDeAntiguedad(parseFechaActualizacion(c.fecha_actualizacion))! > MAX_DIAS,
      ),
    ).toBe(true);

    // Y ninguna de ellas aparece en el sitemap emitido.
    const emitidas = new Set(urls);
    for (const obsoleta of obsoletasQuePasaban) {
      expect(emitidas.has(`${BASE_URL}/estacion/${obsoleta.id}`)).toBe(false);
    }
  });

  it("las fechas legacy que sí pasan son recientes de verdad, no un artefacto del texto", () => {
    const legacyQuePasan = candidatas.filter(
      (c) =>
        /^\d{1,2}\/\d{1,2}\/\d{4}/.test(c.fecha_actualizacion) &&
        esFechaFresca(parseFechaActualizacion(c.fecha_actualizacion), MAX_DIAS),
    );
    for (const fila of legacyQuePasan) {
      expect(esFechaFresca(parseFechaActualizacion(fila.fecha_actualizacion), MAX_DIAS)).toBe(true);
      expect(diasDeAntiguedad(parseFechaActualizacion(fila.fecha_actualizacion))!).toBeLessThanOrEqual(MAX_DIAS);
    }
    // El corte de texto por sí solo no sirve para decidir: hay legacy dentro y fuera.
    expect(
      legacyQuePasan.length,
    ).toBeLessThan(
      candidatas.filter((c) => /^\d{1,2}\/\d{1,2}\/\d{4}/.test(c.fecha_actualizacion)).length,
    );
  });

  it("informe de recuentos antes/después", () => {
    const total = (bd.prepare("SELECT COUNT(*) n FROM estaciones").get() as { n: number }).n;
    const legacy = (
      bd.prepare("SELECT COUNT(*) n FROM estaciones WHERE fecha_actualizacion LIKE '__/__/____%'").get() as {
        n: number;
      }
    ).n;
    const filtroTexto = candidatas.filter((c) => c.fecha_actualizacion >= corteTexto);
    const frescas = candidatas.filter((c) =>
      esFechaFresca(parseFechaActualizacion(c.fecha_actualizacion), MAX_DIAS),
    );
    const obsoletasEnFiltroTexto = filtroTexto.filter(
      (c) => !esFechaFresca(parseFechaActualizacion(c.fecha_actualizacion), MAX_DIAS),
    ).length;

    // eslint-disable-next-line no-console
    console.log(
      [
        "",
        "─── Frescura de estaciones (snapshot local) ───",
        `estaciones en la tabla:                    ${total}`,
        `con formato legacy dd/mm/aaaa:             ${legacy}`,
        `candidatas que pasan el gate del municipio: ${candidatas.length}`,
        `ANTES  filtro de texto (pasa el corte):     ${filtroTexto.length}  (de ellas obsoletas: ${obsoletasEnFiltroTexto})`,
        `DESPUÉS timestamps reales (frescas):        ${frescas.length}`,
        `URLs /estacion/ emitidas (tope ${MAX_ESTACIONES}):  ${urls.length}`,
        `corte de texto usado por el filtro antiguo: ${corteTexto}`,
        "",
      ].join("\n"),
    );

    expect(urls.length).toBeGreaterThan(0);
  });
});
