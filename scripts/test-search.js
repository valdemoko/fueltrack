const Database = require("better-sqlite3");
const db = new Database("./data/combustible.db", { readonly: true });

// Check if accented names exist
const m1 = db.prepare("SELECT id, nombre FROM municipios WHERE nombre LIKE '%laga%' LIMIT 10").all();
console.log("LIKE '%laga%':", m1);

// Check accent-insensitive search
const m2 = db.prepare("SELECT id, nombre FROM municipios WHERE nombre LIKE '%Málaga%' LIMIT 10").all();
console.log("LIKE '%Málaga%':", m2);

// Check: all search must use both variants for accent handling
console.log("Total municipios:", db.prepare("SELECT COUNT(*) AS n FROM municipios").get());
