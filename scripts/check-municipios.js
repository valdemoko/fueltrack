const Database = require("better-sqlite3");
const db = new Database("./data/combustible.db", { readonly: true });

// Formato de municipio_id en estaciones
const muestras = db
  .prepare(
    "SELECT DISTINCT municipio_id, localidad, provincia_id FROM estaciones WHERE municipio_id IS NOT NULL LIMIT 8"
  )
  .all();
console.log("Muestras municipio_id:", muestras);

// Cuántos municipios distintos hay en la tabla estaciones
console.log(
  "Distintos municipio_id en estaciones:",
  db.prepare("SELECT COUNT(DISTINCT municipio_id) AS n FROM estaciones WHERE municipio_id IS NOT NULL").get()
);