# FuelTrack — precios de carburantes en España

Consulta de precios oficiales de carburantes (MITECO, CC BY 4.0) para toda
España: ~13.000 estaciones, histórico diario, agregados geográficos y mapa.

- **Framework**: Next.js 15 (App Router) + React 19 + TypeScript estricto
- **Datos**: PostgreSQL en **Neon** vía `@neondatabase/serverless` (HTTP) + Drizzle ORM
- **Actualización**: un único cron diario en Vercel (`/api/cron`, 08:00 UTC)

## Arranque en local

```bash
npm install
cp .env.example .env.local     # y rellena DATABASE_URL / DATABASE_URL_UNPOOLED
npm run dev
```

No hay modo «sin base de datos»: el driver es HTTP y no abre ficheros, así que
sin `DATABASE_URL` el sitio compila pero falla al consultar. Es deliberado — un
error claro al consultar es más fácil de diagnosticar que un fallo en el build.

## Base de datos

### Poner el esquema y los datos

```bash
npm run db:generate          # 1. escribe el SQL en ./drizzle (REVÍSALO antes)
npm run db:migrate           # 2. lo aplica y lo registra en __drizzle_migrations
npm run db:smoke             # 3. comprueba que la capa de datos responde
```

`db:migrate` usa el migrador de Drizzle (aplica solo los `.sql` de `./drizzle`
y los marca como aplicados). **No uses `drizzle-kit push`**: compara y aplica a
ciegas, y puede emitir un `DROP TABLE` si no reconoce algo.

Para traer datos de un volcado SQLite (`data/combustible.db`):

```bash
npm run db:migrar:sqlite                  # inventario: no escribe nada
npm run db:migrar:sqlite -- --ejecutar    # migra y verifica (recuento + suma)
```

El script es reconciliante (`INSERT` por lotes, salta tablas ya completas,
aborta si una tabla quedó a medias) y **solo copia la ventana de retención**
de `precios_historico`, `hist_geo_dia` y `hist_geo_semana`: las filas más
antiguas se borrarían en la primera purga. Con `--todo` las copia todas.

### Mantenimiento diario

El cron hace, en este orden: catálogo de productos → ingesta de las 52
provincias → agregados del día (`hist_geo_dia`, `hist_geo_semana`,
`hist_nac_dia`, `resumen_nacional`) → retención (solo lunes) → cierre mensual
(solo el día 1).

Ventanas de retención (`src/lib/db/mantenimiento.ts`):

| Tabla | Ventana | Motivo |
|---|---|---|
| `precios_historico` | 30 días | detalle por estación para gráficas de 1 mes |
| `hist_geo_dia` | 30 días | agregados diarios por ámbito |
| `hist_geo_semana` | 200 días | gráficas de 1-6 meses a resolución semanal |
| `hist_*_mes`, `hist_nac_dia` | permanentes | histórico largo |

Para dispararlo a mano (sin el límite de 60 s de Vercel):

```bash
npm run db:ingerir                       # las 52 provincias + mantenimiento
npm run db:ingerir -- --provincia 29     # solo una, para probar
npm run db:ingerir -- --sin-mantenimiento
```

### Comprobar la base de datos

```bash
npm run db:smoke                  # tablas, tamaño, tipos y consultas de las páginas
npm run db:smoke -- --mantenimiento   # + ejecuta el mantenimiento y lo compara con el volcado SQLite
npm run db:smoke -- --cierre          # + valida retención y cierre mensual
```

### Pruebas destructivas (siempre en una rama de Neon)

`scripts/probar-mantenimiento.ts` purga datos y reescribe medias mensuales, así
que se niega a correr contra `DATABASE_URL`. Usa una **rama** de Neon (copia
instantánea por referencia, no duplica el almacenamiento):

```bash
neon branches create --project-id <id> --name pruebas --parent production
PRUEBA_DATABASE_URL="<connection string de la rama>" npx tsx scripts/probar-mantenimiento.ts --si
neon branches delete pruebas --project-id <id>
```

## Trampas de Neon (por qué el código es como es)

Estas cinco cosas no son estilo: cada una rompió algo.

1. **Límite de tamaño de 512 MB en Free, y avisa tarde.** Medido: el volcado
   completo del SQLite lo superaba y las escrituras empezaron a fallar con
   `project size limit exceeded`. Por eso se migra solo la ventana de retención
   y por eso `db:smoke` imprime el tamaño en cada ejecución.
2. **`numeric` y `bigint` llegan como TEXTO al driver HTTP.** `ROUND(AVG(x), 4)`
   necesita `::float8` (y no basta `::numeric`) para que JavaScript reciba un
   número; `COUNT(*)` necesita `::int`. Sin el cast, un `?.toFixed()` revienta y
   una suma concatena cadenas.
3. **Postgres no es SQLite en SQL.** No admite el alias de salida en `HAVING`
   ni dentro de una expresión del `ORDER BY`, y la versión escalar de `MIN(a,b)`
   se llama `LEAST(a,b)`. Los tres casos están corregidos y comentados in situ.
4. **El cómputo se cobra por tiempo despierto, no por consulta.** Consultar la
   BD en cada petición mantiene el compute encendido 24/7 y agota el plan Free
   (100 CU-horas). Por eso `src/middleware.ts` carga los IDs de estación y los
   slugs geográficos **una vez por proceso** (TTL 6 h) y responde de memoria:
   un request normal no toca la base de datos.
5. **`DELETE` no libera espacio; `TRUNCATE` sí.** En una base con límite de
   tamaño eso decide si caben los datos. Por eso `db:migrar:sqlite --rehacer`
   usa `TRUNCATE`.

## Despliegue en Vercel

1. **Variables de entorno** del proyecto (Production y Preview):
   `DATABASE_URL` (con pooler), `DATABASE_URL_UNPOOLED`, `CRON_SECRET`
   (`openssl rand -hex 32`), `NEXT_PUBLIC_SITE_URL` y las de AdSense/analítica
   que ya usaras. `CRON_SECRET` es obligatorio: sin él el endpoint responde 401
   y no habrá actualización diaria.
2. **Cron**: lo define `vercel.json` (`0 8 * * *`). Vercel envía solo
   `Authorization: Bearer $CRON_SECRET` cuando la variable existe.
3. **Redeploy** tras cambiar variables (las `NEXT_PUBLIC_*` se incrustan en el
   build).
4. **Comprueba** con `npm run db:smoke` contra las credenciales de producción y
   con una llamada manual a `/api/cron`.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` / `build` / `start` | desarrollo, build, producción |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest (`src/**/*.test.ts`) |
| `npm run db:generate` | genera SQL de migración desde `schema.ts` |
| `npm run db:migrate` | aplica las migraciones pendientes |
| `npm run db:smoke` | comprobación de humo de la base de datos |
| `npm run db:migrar:sqlite` | migra datos de `data/combustible.db` |
| `npm run db:ingerir` | ingesta manual de hoy (sin límite de 60 s) |
| `npm run db:reconstruir` | rellena días perdidos y reconstruye agregados |
| `npm run db:seed:spain` | ingesta masiva del país desde MITECO (desde cero) |

## Otros documentos

- `ARCHITECTURE.md` — visión general, fuente de datos y modelo conceptual
- `DESIGN.md` — decisiones de diseño de interfaz
