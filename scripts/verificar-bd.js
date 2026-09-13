// Verificación rápida de la BD tras ingesta actual
const Database = require("better-sqlite3");
const db = new Database("./data/combustible.db", { readonly: true });

// 1. Última fecha disponible por producto
const maxFechas = db
  .prepare(
    "SELECT producto_id, MAX(fecha_observacion) AS max_fecha FROM precios WHERE producto_id IN (1,4) GROUP BY producto_id"
  )
  .all();
console.log("Max fecha por producto:", maxFechas);

// 2. Caso verificado antes: estación 7386, producto 1 (Gasolina 95 E5)
const p7386 = db
  .prepare(
    "SELECT precio, fecha_observacion FROM precios WHERE estacion_id='7386' AND producto_id=1 ORDER BY fecha_observacion DESC LIMIT 3"
  )
  .all();
console.log("Estacion 7386 G95E5 ultimas:", p7386);

// 3. Estación 7386 gasóleo A (producto 4)
const g7386 = db
  .prepare(
    "SELECT precio, fecha_observacion FROM precios WHERE estacion_id='7386' AND producto_id=4 ORDER BY fecha_observacion DESC LIMIT 3"
  )
  .all();
console.log("Estacion 7386 Gasoleo A ultimas:", g7386);

// 4. Timing de la query del mapa (subquery correlacionada, 15000 estaciones)
const t0 = Date.now();
const filas = db
  .prepare(
    `SELECT e.id, e.latitud, e.longitud, e.localidad,
  (SELECT p.precio FROM precios p WHERE p.estacion_id = e.id AND p.producto_id = 1 ORDER BY p.fecha_observacion DESC LIMIT 1) AS precio
  FROM estaciones e
  WHERE e.latitud IS NOT NULL AND e.longitud IS NOT NULL
  ORDER BY e.localidad ASC, e.id ASC LIMIT 15000`
  )
  .all();
console.log("Mapa query:", filas.length, "filas en", Date.now() - t0, "ms");
console.log(
  "Con precio:",
  filas.filter((f) => f.precio !== null).length,
  "| sin precio:",
  filas.filter((f) => f.precio === null).length
);

// 5. Timing productos con precios (EXISTS)
const t1 = Date.now();
const prods = db
  .prepare(
    "SELECT id, nombre FROM productos WHERE EXISTS (SELECT 1 FROM precios WHERE precios.producto_id = productos.id) ORDER BY nombre"
  )
  .all();
console.log("Productos con precios:", prods.length, "en", Date.now() - t1, "ms");
console.log(prods.map((p) => p.id + ":" + p.nombre).join(" | "));

// 6. Timing busqueda municipios q=
const t2 = Date.now();
const mun = db
  .prepare(
    "SELECT m.id, m.nombre, count(e.id) AS n FROM municipios m LEFT JOIN estaciones e ON m.id=e.municipio_id WHERE m.nombre LIKE '%malaga%' GROUP BY m.id ORDER BY m.nombre LIMIT 10"
  )
  .all();
console.log("Busqueda municipio:", mun, "en", Date.now() - t2, "ms");