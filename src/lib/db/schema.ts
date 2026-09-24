/**
 * Esquema de base de datos para FuelTrack
 * Drizzle ORM + SQLite
 *
 * Modelo: CCAA → Provincia → Municipio → Estación → Producto → Precio
 * Fuente: MITECO (CC BY 4.0)
 */
import { sqliteTable, text, integer, real, primaryKey } from "drizzle-orm/sqlite-core";

// ─── Tabla: CCAA (Comunidades Autónomas) ────────────────────────────────────

export const ccaa = sqliteTable("ccaa", {
  /** ID de la CCAA (ej: "01" para Andalucía) */
  id: text("id").primaryKey(),
  /** Nombre de la comunidad autónoma */
  nombre: text("nombre").notNull(),
});

// ─── Tabla: Provincias ─────────────────────────────────────────────────────

export const provincias = sqliteTable("provincias", {
  /** ID de la provincia (ej: "29" para Málaga) */
  id: text("id").primaryKey(),
  /** ID de la CCAA a la que pertenece */
  ccaaId: text("ccaa_id")
    .notNull()
    .references(() => ccaa.id),
  /** Nombre de la provincia */
  nombre: text("nombre").notNull(),
});

// ─── Tabla: Municipios ─────────────────────────────────────────────────────

export const municipios = sqliteTable("municipios", {
  /** ID del municipio (ej: "4455") */
  id: text("id").primaryKey(),
  /** ID de la provincia */
  provinciaId: text("provincia_id")
    .notNull()
    .references(() => provincias.id),
  /** Nombre del municipio */
  nombre: text("nombre").notNull(),
});

// ─── Tabla: Estaciones de servicio ──────────────────────────────────────────

export const estaciones = sqliteTable("estaciones", {
  /** IDEESS - identificador estable de la estación */
  id: text("id").primaryKey(),
  /** ID del municipio */
  municipioId: text("municipio_id")
    .notNull()
    .references(() => municipios.id),
  /** ID de la provincia */
  provinciaId: text("provincia_id")
    .notNull()
    .references(() => provincias.id),
  /** ID de la CCAA */
  ccaaId: text("ccaa_id")
    .notNull()
    .references(() => ccaa.id),
  /** Nombre comercial / marca (Rótulo) */
  rotulo: text("rotulo"),
  /** Dirección postal */
  direccion: text("direccion").notNull(),
  /** Localidad */
  localidad: text("localidad").notNull(),
  /** Código postal */
  codigoPostal: text("codigo_postal").notNull(),
  /** Latitud WGS84 (decimal) */
  latitud: real("latitud").notNull(),
  /** Longitud WGS84 (decimal) */
  longitud: real("longitud").notNull(),
  /** Horario de apertura */
  horario: text("horario").notNull(),
  /** Tipo de margen (D=dir, I=indep, N=no aplica) */
  margen: text("margen").notNull(),
  /** Tipo de venta (P=público, A=auto, etc.) */
  tipoVenta: text("tipo_venta").notNull(),
  /** Porcentaje de bioetanol */
  bioetanolPct: real("bioetanol_pct").notNull().default(0),
  /** Porcentaje de éster metílico */
  esterMetilicoPct: real("ester_metilico_pct").notNull().default(0),
  /** Fecha de última actualización (ISO 8601) */
  fechaActualizacion: text("fecha_actualizacion").notNull(),
});

// ─── Tabla: Productos petrolíferos ─────────────────────────────────────────

export const productos = sqliteTable("productos", {
  /** ID del producto (ej: 1 = Gasolina 95 E5) */
  id: integer("id").primaryKey(),
  /** Nombre completo del producto */
  nombre: text("nombre").notNull(),
  /** Abreviatura (ej: G95E5) */
  abreviatura: text("abreviatura").notNull(),
});

/**
 * Tabla: Observaciones de precio ACTUALES.
 *
 * Arquitectura optimizada para cuotas (Turso Free):
 * una sola fila por (estación, producto) con el último precio válido.
 * El histórico detallado vive en `precios_historico` (ventana corta) y en
 * las tablas agregadas `hist_*` (mensuales permanentes).
 */
export const precios = sqliteTable(
  "precios",
  {
    /** IDEESS de la estación */
    estacionId: text("estacion_id")
      .notNull()
      .references(() => estaciones.id),
    /** ID del producto */
    productoId: integer("producto_id")
      .notNull()
      .references(() => productos.id),
    /** Precio en €/litro (null si no disponible) */
    precio: real("precio"),
    /** Fecha de la última observación válida (ISO yyyy-MM-dd) */
    fechaObservacion: text("fecha_observacion").notNull(),
  },
  (table) => ({
    /** Clave: estación + producto (1 fila = precio actual) */
    pk: primaryKey({
      columns: [table.estacionId, table.productoId],
    }),
  })
);

// ─── Tabla: Histórico detallado por estación (VENTANA CORTA) ────────────────

/**
 * Histórico detallado: SOLO los últimos RETENCION_DIAS_HISTORICO días
 * (~32). El mantenimiento diario borra lo más viejo → tamaño estable
 * (~1,4M filas), no crece indefinidamente.
 */
export const preciosHistorico = sqliteTable(
  "precios_historico",
  {
    estacionId: text("estacion_id").notNull(),
    productoId: integer("producto_id").notNull(),
    /** Fecha de la observación (ISO yyyy-MM-dd) */
    fecha: text("fecha").notNull(),
    precio: real("precio"),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.estacionId, table.productoId, table.fecha],
    }),
  })
);

// ─── Tabla: Agregados diarios geográficos (VENTANA ~95 días) ───────────────

/**
 * Precio medio diario por ámbito geográfico y producto.
 * ambito: 'mun' | 'prov' | 'ccaa' | 'nac'.
 * Ventana rodante ~95 días: gráficas 1m/3m a resolución diaria.
 */
export const histGeoDia = sqliteTable(
  "hist_geo_dia",
  {
    /** Tipo de ámbito: mun | prov | ccaa | nac */
    ambito: text("ambito").notNull(),
    /** ID del municipio/provincia/ccaa; 'ES' para nacional */
    geoId: text("geo_id").notNull(),
    productoId: integer("producto_id").notNull(),
    fecha: text("fecha").notNull(),
    /** Precio medio del ámbito ese día */
    precioMedio: real("precio_medio").notNull(),
    /** Estaciones con precio que sustentan la media */
    nEstaciones: integer("n_estaciones").notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.ambito, table.geoId, table.productoId, table.fecha],
    }),
  })
);

// ─── Tabla: Agregados SEMANALES geográficos PERMANENTES ────────────────────

/**
 * Precio medio semanal por ámbito geográfico y producto.
 *
 * Puente entre la ventana diaria (últimos 30 días) y las medias mensuales:
 * las gráficas de 1-6 meses usan estos puntos semanales (~13-26 puntos) en
 * lugar de 1-6 puntos mensuales. Se recalcula el bucket de la semana en curso
 * una vez al día (idempotente); las semanas cerradas ya no se tocan.
 * ambito: 'mun' | 'prov' | 'ccaa' (el nacional usa hist_nac_dia, diario y
 * permanente, que ya da mejor resolución y no necesita esta tabla).
 */
export const histGeoSemana = sqliteTable(
  "hist_geo_semana",
  {
    /** Tipo de ámbito: mun | prov | ccaa */
    ambito: text("ambito").notNull(),
    /** ID del municipio/provincia/ccaa */
    geoId: text("geo_id").notNull(),
    productoId: integer("producto_id").notNull(),
    /** Lunes de la semana (ISO yyyy-MM-dd) */
    semana: text("semana").notNull(),
    /** Precio medio de la semana */
    precioMedio: real("precio_medio").notNull(),
    /** Máximo de estaciones con precio en la semana */
    nEstaciones: integer("n_estaciones").notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.ambito, table.geoId, table.productoId, table.semana],
    }),
  })
);

// ─── Tablas: Agregados mensuales PERMANENTES ───────────────────────────────

/** Precio medio mensual por municipio y producto (~272k filas total). */
export const histMunMes = sqliteTable(
  "hist_mun_mes",
  {
    municipioId: text("municipio_id").notNull(),
    productoId: integer("producto_id").notNull(),
    /** Mes en formato yyyy-MM */
    mes: text("mes").notNull(),
    precioMedio: real("precio_medio").notNull(),
    nEstaciones: integer("n_estaciones").notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.municipioId, table.productoId, table.mes],
    }),
  })
);

/** Precio medio mensual por provincia y producto (~5k filas). */
export const histProvMes = sqliteTable(
  "hist_prov_mes",
  {
    provinciaId: text("provincia_id").notNull(),
    productoId: integer("producto_id").notNull(),
    mes: text("mes").notNull(),
    precioMedio: real("precio_medio").notNull(),
    nEstaciones: integer("n_estaciones").notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.provinciaId, table.productoId, table.mes],
    }),
  })
);

/** Precio medio mensual por comunidad y producto (~2k filas). */
export const histCcaaMes = sqliteTable(
  "hist_ccaa_mes",
  {
    ccaaId: text("ccaa_id").notNull(),
    productoId: integer("producto_id").notNull(),
    mes: text("mes").notNull(),
    precioMedio: real("precio_medio").notNull(),
    nEstaciones: integer("n_estaciones").notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.ccaaId, table.productoId, table.mes],
    }),
  })
);

/** Precio medio mensual por estación y producto (~856k filas, 4 productos). */
export const histEstacionMes = sqliteTable(
  "hist_estacion_mes",
  {
    estacionId: text("estacion_id").notNull(),
    productoId: integer("producto_id").notNull(),
    mes: text("mes").notNull(),
    precioMedio: real("precio_medio").notNull(),
    nObservaciones: integer("n_observaciones").notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.estacionId, table.productoId, table.mes],
    }),
  })
);

/**
 * Serie nacional diaria PERMANENTE (~13k filas por 2 años): gráficas
 * nacionales 1a/2a a resolución diaria con coste mínimo.
 */
export const histNacDia = sqliteTable(
  "hist_nac_dia",
  {
    productoId: integer("producto_id").notNull(),
    fecha: text("fecha").notNull(),
    precioMedio: real("precio_medio").notNull(),
    nEstaciones: integer("n_estaciones").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.productoId, table.fecha] }),
  })
);

/** Control de meses ya agregados (job mensual idempotente del cron). */
export const histMesesProcesados = sqliteTable("hist_meses_procesados", {
  mes: text("mes").primaryKey(),
  procesadoEn: text("procesado_en").notNull(),
});

/**
 * Resumen nacional PRECALCULADO (1 fila por producto, ~30 filas en total).
 *
 * Motivo de existencia: cuota de Turso. Sin esta tabla, cada render de una
 * ficha de estación o resumen nacional escanea toda `precios` (~46k filas)
 * por producto. Con ella, la consulta lee 1 fila. El cron diario la
 * refresca (1 pasada por precios/día, ~46k lecturas + ~30 escrituras).
 */
export const resumenNacional = sqliteTable("resumen_nacional", {
  productoId: integer("producto_id").primaryKey(),
  precioMedio: real("precio_medio").notNull(),
  precioMin: real("precio_min").notNull(),
  precioMax: real("precio_max").notNull(),
  totalEstaciones: integer("total_estaciones").notNull(),
  /** Fecha de la última observación del producto (yyyy-MM-dd). */
  fecha: text("fecha").notNull(),
});
