const Database = require("better-sqlite3");

// Limpiar espacios finales en nombres de municipios
const db2 = new Database("./data/combustible.db");
db2.pragma("journal_mode = WAL");
const r = db2.prepare("UPDATE municipios SET nombre = TRIM(nombre)").run();
console.log("Municipios actualizados (TRIM):", r.changes);
const sucios = db2.prepare("SELECT COUNT(*) AS n FROM municipios WHERE nombre != TRIM(nombre)").get();
console.log("Municipios con espacios finales restantes:", sucios.n);

// Verificación de búsqueda geografia?q=
const t0 = Date.now();
const q = "malaga";
const res = db2.prepare(`SELECT m.id, m.nombre, m.provincia_id, COUNT(e.id) AS numEstaciones FROM municipios m LEFT JOIN estaciones e ON m.id = e.municipio_id WHERE m.nombre LIKE ? GROUP BY m.id, m.nombre, m.provincia_id ORDER BY m.nombre LIMIT 10`).all(`%${q}%`);
console.log("Busqueda 'malaga' en", Date.now() - t0, "ms:", res);

const malagaMun = db2.prepare("SELECT COUNT(*) AS n FROM municipios WHERE provincia_id = '29'").get();
console.log("Municipios provincia 29:", malagaMun.n);

db2.close();