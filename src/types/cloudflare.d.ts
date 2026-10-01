/**
 * Entorno del worker de Cloudflare (bindings).
 *
 * Usa el tipo `Env` generado por `wrangler types` en
 * `worker-configuration.d.ts` (raíz del proyecto), que declara las variables
 * y bindings reales: DATABASE_URL, DATABASE_URL_UNPOOLED, CRON_SECRET,
 * ASSETS, WORKER_SELF_REFERENCE, IMAGES, etc. Tras cambiar `wrangler.jsonc`
 * hay que regenerarlo con `npx wrangler types`.
 *
 * Ese fichero solo se incluye en `tsconfig.worker.json` (worker de
 * Cloudflare): sus runtime types chocan con `lib: dom` del tsconfig de Next.
 */
export type CloudflareEnv = Env;
