import { describe, it, expect } from "vitest";
import {
  parseFechaActualizacion,
  diasDeAntiguedad,
  esFechaFresca,
} from "../fecha";

describe("parseFechaActualizacion — formato ISO", () => {
  it("interpreta una fecha ISO sin hora", () => {
    const fecha = parseFechaActualizacion("2026-09-22");
    expect(fecha).not.toBeNull();
    expect(fecha!.toISOString()).toBe("2026-09-22T00:00:00.000Z");
  });

  it("interpreta una fecha ISO con hora", () => {
    const fecha = parseFechaActualizacion("2026-09-22 06:30:15");
    expect(fecha!.toISOString()).toBe("2026-09-22T06:30:15.000Z");
  });

  it("interpreta una fecha ISO con 'T' y milisegundos", () => {
    const fecha = parseFechaActualizacion("2026-09-22T06:30:15.123Z");
    expect(fecha!.toISOString()).toBe("2026-09-22T06:30:15.123Z");
  });
});

describe("parseFechaActualizacion — formato legacy dd/mm/aaaa", () => {
  it("interpreta dd/mm/aaaa con hora", () => {
    const fecha = parseFechaActualizacion("31/03/2025 0:00:00");
    expect(fecha).not.toBeNull();
    expect(fecha!.toISOString()).toBe("2025-03-31T00:00:00.000Z");
  });

  it("interpreta dd/mm/aaaa sin hora", () => {
    expect(parseFechaActualizacion("06/01/2026")!.toISOString()).toBe(
      "2026-01-06T00:00:00.000Z",
    );
  });

  it("no confunde día y mes", () => {
    // 06/01/2026 es 6 de enero, no 1 de junio.
    expect(parseFechaActualizacion("06/01/2026 0:00:00")!.getUTCMonth()).toBe(0);
    expect(parseFechaActualizacion("06/01/2026 0:00:00")!.getUTCDate()).toBe(6);
  });

  it("interpreta correctamente '01/01/2016 0:00:00'", () => {
    expect(parseFechaActualizacion("01/01/2016 0:00:00")!.toISOString()).toBe(
      "2016-01-01T00:00:00.000Z",
    );
  });
});

describe("parseFechaActualizacion — valores no utilizables", () => {
  it("devuelve null para nulos, vacíos y no-strings", () => {
    expect(parseFechaActualizacion(null)).toBeNull();
    expect(parseFechaActualizacion(undefined)).toBeNull();
    expect(parseFechaActualizacion("")).toBeNull();
    expect(parseFechaActualizacion("   ")).toBeNull();
    expect(parseFechaActualizacion(20260922)).toBeNull();
    expect(parseFechaActualizacion({})).toBeNull();
  });

  it("devuelve null para formatos desconocidos", () => {
    expect(parseFechaActualizacion("ayer")).toBeNull();
    expect(parseFechaActualizacion("22-09-2026")).toBeNull();
    expect(parseFechaActualizacion("2026/09/22")).toBeNull();
    expect(parseFechaActualizacion("31/03/25")).toBeNull();
  });

  it("devuelve null para fechas imposibles", () => {
    expect(parseFechaActualizacion("2026-13-01")).toBeNull();
    expect(parseFechaActualizacion("2026-02-31")).toBeNull();
    expect(parseFechaActualizacion("32/01/2026")).toBeNull();
    expect(parseFechaActualizacion("31/02/2026 0:00:00")).toBeNull();
    expect(parseFechaActualizacion("2026-09-22 25:00:00")).toBeNull();
  });
});

describe("diasDeAntiguedad", () => {
  const referencia = new Date("2026-09-22T15:00:00Z");

  it("devuelve null para fechas no interpretables", () => {
    expect(diasDeAntiguedad(null, referencia)).toBeNull();
  });

  it("cuenta días de calendario, no horas", () => {
    expect(diasDeAntiguedad(parseFechaActualizacion("2026-09-22"), referencia)).toBe(0);
    expect(diasDeAntiguedad(parseFechaActualizacion("2026-09-21"), referencia)).toBe(1);
    expect(diasDeAntiguedad(parseFechaActualizacion("2026-08-23"), referencia)).toBe(30);
    expect(diasDeAntiguedad(parseFechaActualizacion("01/01/2016 0:00:00"), referencia)).toBe(3917);
  });

  it("devuelve un valor negativo para fechas futuras", () => {
    expect(diasDeAntiguedad(parseFechaActualizacion("2026-09-25"), referencia)).toBe(-3);
  });
});

describe("esFechaFresca — regresión del bug de comparación de texto", () => {
  const referencia = new Date("2026-09-22T12:00:00Z");
  const MAX_DIAS = 30;

  it("rechaza una fecha legacy antigua que la comparación de texto daba por reciente", () => {
    // "31/03/2025 0:00:00" >= "2026-08-23" es TRUE como texto (porque "3" > "2"),
    // que es exactamente lo que colaba fichas de 2025 en el sitemap.
    const legacy = "31/03/2025 0:00:00";
    expect(legacy >= "2026-08-23").toBe(true);

    // Con el parser real, 540 días de antigüedad: no es fresca.
    const fecha = parseFechaActualizacion(legacy);
    expect(diasDeAntiguedad(fecha, referencia)).toBe(540);
    expect(esFechaFresca(fecha, MAX_DIAS, referencia)).toBe(false);
  });

  it("rechaza otras fechas legacy antiguas conocidas", () => {
    for (const valor of [
      "01/01/2016 0:00:00",
      "06/01/2026 0:00:00",
      "01/12/2015 0:00:00",
      "01/08/2009 0:00:00",
    ]) {
      expect(esFechaFresca(parseFechaActualizacion(valor), MAX_DIAS, referencia)).toBe(false);
    }
  });

  it("mantiene las fechas ISO recientes", () => {
    expect(esFechaFresca(parseFechaActualizacion("2026-09-22"), MAX_DIAS, referencia)).toBe(true);
    expect(esFechaFresca(parseFechaActualizacion("2026-09-13"), MAX_DIAS, referencia)).toBe(true);
  });

  it("trata el límite de 30 días como inclusivo, igual que date('now','-30 days')", () => {
    expect(esFechaFresca(parseFechaActualizacion("2026-08-23"), MAX_DIAS, referencia)).toBe(true);
    expect(esFechaFresca(parseFechaActualizacion("2026-08-22"), MAX_DIAS, referencia)).toBe(false);
  });

  it("excluye las ISO antiguas", () => {
    expect(esFechaFresca(parseFechaActualizacion("2026-01-05"), MAX_DIAS, referencia)).toBe(false);
  });

  it("nunca considera fresca una fecha no interpretable", () => {
    for (const valor of [null, undefined, "", "   ", "ayer", "2026-13-45"]) {
      expect(esFechaFresca(parseFechaActualizacion(valor), MAX_DIAS, referencia)).toBe(false);
    }
  });
});
