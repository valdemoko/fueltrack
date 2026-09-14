/**
 * Preparación de la cuenta NUEVA de Turso — SIN ejecutar la migración.
 *
 * Usa la Turso Platform API v2 (https://api.turso.tech/v2) con un API token
 * que TÚ generas (dashboard → Account → API Tokens). El token NUNCA se
 * imprime: se lee de .env.local (TURSO_API_TOKEN) o del entorno.
 *
 * Comandos:
 *   node scripts/turso-cuenta-nueva.mjs whoami   # ¿qué cuenta es? (API token)
 *   node scripts/turso-cuenta-nueva.mjs list     # bases visibles (API token)
 *   node scripts/turso-cuenta-nueva.mjs crear    # crea fueltrack si NO existe (API token)
 *   node scripts/turso-cuenta-nueva.mjs token    # escribe credenciales en .env.local (API token)
 *   node scripts/turso-cuenta-nueva.mjs verificar # prueba SOLO LECTURA con TURSO_DATABASE_URL/TOKEN
 *
 * Seguridad:
 *  - Nunca imprime tokens (solo longitudes/últimos 4 chars).
 *  - `crear` es idempotente: si fueltrack ya existe, NO la toca.
 *  - `token` hace backup de .env.local antes de escribir y conserva las
 *    claves antiguas bajo nombres _OLD (no las sobrescribe sin aviso).
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";

// ─── env ────────────────────────────────────────────────────────────────────
function cargarEnvLocal() {
  if (!existsSync(".env.local")) return;
  for (const linea of readFileSync(".env.local", "utf-8").split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
cargarEnvLocal();

const API = "https://api.turso.tech/v2";
const TOKEN = process.env.TURSO_API_TOKEN;
const DB_NAME = "fueltrack";
const HOST_ANTIGUO = "fueltrack-valdemoko";

async function api(path, method = "GET", body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function faltaToken() {
  console.error(
    "Falta TURSO_API_TOKEN en .env.local.\n" +
      "Genera uno en https://dashboard.turso.tech → Account → API Tokens\n" +
      "y añádelo a .env.local como:  TURSO_API_TOKEN=eyJ...  (no lo pegues en el chat)."
  );
  process.exit(1);
}

function resumirToken(t) {
  return `(presente, ${t.length} chars, ...${t.slice(-4)})`;
}

// ─── comandos ───────────────────────────────────────────────────────────────

async function whoami() {
  if (!TOKEN) faltaToken();
  // /v2/auth/validate devuelve la organización del token
  const { status, json } = await api("/auth/validate");
  if (status !== 200) {
    console.error(`Token NO válido (HTTP ${status}). ¿Copiaste bien el API token?`);
    process.exit(1);
  }
  const org = json?.org ?? json?.organization ?? json;
  console.log("✅ Token válido.");
  console.log("   Cuenta/organización:", JSON.stringify(org));
  // Comprobar si parece la cuenta antigua
  const s = JSON.stringify(org).toLowerCase();
  if (s.includes("valdemoko")) {
    console.log(
      "⚠️  OJO: el nombre contiene 'valdemoko'. Confirma en el dashboard que esta",
      "\n   organización es la cuenta NUEVA y no la antigua bloqueada."
    );
  }
}

async function listar() {
  if (!TOKEN) faltaToken();
  const { status, json } = await api("/databases");
  if (status !== 200) {
    console.error(`No se pudieron listar bases (HTTP ${status}):`, JSON.stringify(json).slice(0, 200));
    process.exit(1);
  }
  const dbs = json?.databases ?? json?.instances ?? [];
  console.log(`Bases visibles: ${dbs.length}`);
  for (const d of dbs) {
    const host = d.hostname ?? d.Host ?? "";
    const marca = host.includes(HOST_ANTIGUO) ? "  ⚠️ ANTIGUA" : "";
    console.log(`  - ${d.name}  (${host})${marca}`);
  }
  return dbs;
}

async function crear() {
  const dbs = await listar();
  const existente = dbs.find((d) => d.name === DB_NAME);
  if (existente) {
    console.log(
      `\nℹ️  '${DB_NAME}' YA existe en esta cuenta (hostname ${existente.hostname ?? "?"}).`
    );
    console.log("   No se toca nada. Siguiente paso: node scripts/turso-cuenta-nueva.mjs token");
    return;
  }
  console.log(`\nCreando base '${DB_NAME}' en la organización del token…`);
  // Región Madrid si está disponible; si no, la default del plan
  const { status, json } = await api("/databases", "POST", {
    name: DB_NAME,
    group: "default",
  });
  if (status !== 200 && status !== 201) {
    // Reintentar sin group (algunas cuentas no tienen group default)
    const r2 = await api("/databases", "POST", { name: DB_NAME });
    if (r2.status !== 200 && r2.status !== 201) {
      console.error(`No se pudo crear (HTTP ${status}):`, JSON.stringify(json).slice(0, 300));
      process.exit(1);
    }
  }
  console.log(`✅ Base '${DB_NAME}' creada.`);
  console.log("   Siguiente paso: node scripts/turso-cuenta-nueva.mjs token");
}

async function token() {
  if (!TOKEN) faltaToken();
  // Necesitamos el slug de la organización para pedir el token de la DB
  const orgRes = await api("/auth/validate");
  const orgSlug =
    orgRes.json?.org?.slug ?? orgRes.json?.org ?? process.env.TURSO_ORG;
  if (!orgSlug || typeof orgSlug !== "string") {
    console.error(
      "No se pudo determinar la organización. Pásala con TURSO_ORG=<slug>."
    );
    process.exit(1);
  }
  const { status, json } = await api(
    `/organizations/${encodeURIComponent(orgSlug)}/databases/${DB_NAME}/auth/tokens`,
    "POST"
  );
  if (status !== 200 && status !== 201) {
    console.error(`No se pudo crear el token de DB (HTTP ${status}):`, JSON.stringify(json).slice(0, 300));
    process.exit(1);
  }
  const dbToken = json?.token ?? json?.jwt;
  if (!dbToken) {
    console.error("Respuesta sin token:", JSON.stringify(json).slice(0, 200));
    process.exit(1);
  }

  // URL de la DB
  const dbs = await listar();
  const db = dbs.find((d) => d.name === DB_NAME);
  const url = db?.hostname ? `libsql://${db.hostname}` : null;
  if (!url) {
    console.error("No se encontró la URL de la base recién creada.");
    process.exit(1);
  }

  // Escribir .env.local con backup, sin imprimir el token
  const RUTA = ".env.local";
  const previo = existsSync(RUTA) ? readFileSync(RUTA, "utf-8") : "";
  copyFileSync(RUTA, RUTA + ".backup");

  const quitar = (texto, clave) =>
    texto
      .split(/\r?\n/)
      .filter((l) => !new RegExp(`^\\s*${clave}=`, ).test(l))
      .join("\n");

  let nuevo = previo;
  // Conservar antiguas como _OLD solo si existen y no hay ya backup
  const mOldUrl = previo.match(/^TURSO_URL=(.*)$/m);
  const mOldTok = previo.match(/^TURSO_TOKEN=(.*)$/m);
  if (mOldUrl && !/^TURSO_URL_OLD=/m.test(nuevo)) {
    nuevo = nuevo.replace(mOldUrl[0], `${mOldUrl[0]}\nTURSO_URL_OLD=${mOldUrl[1]}`);
  }
  if (mOldTok && !/^TURSO_TOKEN_OLD=/m.test(nuevo)) {
    nuevo = nuevo.replace(mOldTok[0], `${mOldTok[0]}\nTURSO_TOKEN_OLD=${mOldTok[1]}`);
  }
  nuevo = quitar(nuevo, "TURSO_DATABASE_URL");
  nuevo = quitar(nuevo, "TURSO_AUTH_TOKEN");
  nuevo = nuevo.trimEnd() + `\nTURSO_DATABASE_URL=${url}\nTURSO_AUTH_TOKEN=${dbToken}\n`;

  writeFileSync(RUTA, nuevo);
  console.log("✅ .env.local actualizado (backup en .env.local.backup):");
  console.log(`   TURSO_DATABASE_URL=${url}`);
  console.log(`   TURSO_AUTH_TOKEN=${resumirToken(dbToken)}`);
  console.log("   (Las credenciales antiguas se conservan como TURSO_URL_OLD/TURSO_TOKEN_OLD)");
  if (url.includes(HOST_ANTIGUO)) {
    console.log("⚠️  ¡La URL contiene el host ANTIGUO! Revisa la cuenta.");
  }
}

/** Prueba de conexión SOLO LECTURA contra TURSO_DATABASE_URL (creada desde el dashboard). */
async function verificar() {
  const url = process.env.TURSO_DATABASE_URL;
  const tok = process.env.TURSO_AUTH_TOKEN;
  if (!url || !tok) {
    console.error(
      "Faltan TURSO_DATABASE_URL / TURSO_AUTH_TOKEN en .env.local. " +
        "Cópialos del dashboard (base fueltrack → Connect → copia URL y token)."
    );
    process.exit(1);
  }
  if (url.startsWith(HOST_ANTIGUO)) {
    console.error("❌ La URL apunta a la base ANTIGUA. No se toca nada.");
    process.exit(3);
  }
  const { createClient } = await import("@libsql/client");
  const c = createClient({ url, authToken: tok });
  console.log("Probando conexión de SOLO LECTURA contra", url);
  try {
    const r = await c.execute("SELECT COUNT(*) AS n FROM precios");
    const n = Number(r.rows[0].n);
    console.log(`✅ Conexión OK. Tabla precios: ${n.toLocaleString("es-ES")} filas.`);
    if (n > 1_000_000) {
      console.log("⚠️ La base YA contiene muchos datos — NO está vacía.");
    } else if (n === 0) {
      console.log("✅ Base vacía (0 precios) — lista para migrar.");
    } else {
      console.log("Base con datos previos menores.");
    }
    for (const t2 of ["estaciones", "hist_mun_mes"]) {
      try {
        const r2 = await c.execute(`SELECT COUNT(*) AS n FROM ${t2}`);
        console.log(`   ${t2}: ${Number(r2.rows[0].n).toLocaleString("es-ES")} filas`);
      } catch {
        console.log(`   ${t2}: (sin tabla — vacía)`);
      }
    }
  } catch (e) {
    const msg = String(e.message).slice(0, 120);
    if (/no such table/i.test(msg)) {
      console.log("✅ Conexión OK y base VACÍA (sin tabla precios).");
    } else {
      console.error("❌ Conexión fallida:", msg);
      process.exit(1);
    }
  }
}

const cmd = process.argv[2];
const acciones = { whoami, list: listar, crear, token, verificar };
if (!acciones[cmd]) {
  console.log("Uso: node scripts/turso-cuenta-nueva.mjs <whoami|list|crear|token>");
  process.exit(1);
}
await acciones[cmd]();
