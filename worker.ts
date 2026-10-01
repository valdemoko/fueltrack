/**
 * Worker personalizado de FuelTrack (patrón oficial de OpenNext "Custom
 * Worker"): reutiliza el worker generado por `opennextjs-cloudflare build`
 * (.open-next/worker.js) y le añade el handler `scheduled` que ejecuta la
 * actualización semanal de datos cuando lo dispara el Cron Trigger de
 * Cloudflare declarado en wrangler.jsonc.
 *
 * El flujo es EXACTAMENTE el mismo que el de /api/cron (que sigue disponible
 * como vía manual protegida por CRON_SECRET): ambos llaman a
 * `ejecutarActualizacion()` de `@/lib/actualizacion`, que persiste el
 * progreso en `cron_progreso` (idempotente y reanudable). La invalidación de
 * caché vía `revalidateTag` NO se hace aquí porque es una API del request de
 * Next; las páginas de precios usan TTL como red de seguridad y el endpoint
 * manual, o la primera visita tras el cron, refrescan los datos.
 *
 * Nota de runtime: la ingesta usa `process.env` (DATABASE_URL, CRON_SECRET),
 * que OpenNext genera desde los secrets/vars del worker, y `fetch` global.
 * El driver de Neon es HTTP puro, así que no requiere APIs de Node de ficheros
 * ni sockets. El `waitUntil` garantiza que el runtime no mata la ejecución
 * mientras haya trabajo pendiente.
 *
 * Tipado: este fichero se compila con `tsconfig.worker.json` (ver abajo),
 * que incluye los runtime types de Cloudflare (`worker-configuration.d.ts`,
 * generado con `npx wrangler types`) y está excluido del tsconfig de Next
 * porque esos tipos chocan con `lib: dom`.
 */
// @ts-ignore `.open-next/worker.js` se genera en tiempo de build
import handler from "./.open-next/worker.js";
import { ejecutarActualizacion } from "./src/lib/actualizacion";
import type { CloudflareEnv } from "./src/types/cloudflare";

export default {
  fetch: handler.fetch,
  async scheduled(
    _event: ScheduledController,
    env: CloudflareEnv,
    ctx: ExecutionContext
  ): Promise<void> {
    // Inyectar las variables del entorno de Cloudflare en process.env:
    // OpenNext ya populates process.env con las vars/secrets del worker en el
    // handler fetch, pero el evento scheduled no pasa por esa inicialización.
    for (const [clave, valor] of Object.entries(env)) {
      if (typeof valor === "string" && !(clave in process.env)) {
        process.env[clave] = valor;
      }
    }

    ctx.waitUntil(
      ejecutarActualizacion()
        .then((resultado) => {
          if (resultado.errores.length > 0) {
            console.error(
              `[cron-cloudflare] FuelTrack update terminó con ${resultado.errores.length} errores:`,
              resultado.errores
            );
          } else {
            console.log(
              `[cron-cloudflare] FuelTrack update OK en ${(resultado.duracionMs / 1000).toFixed(1)}s`
            );
          }
        })
        .catch((error) => {
          console.error("[cron-cloudflare] FuelTrack update falló:", error);
        })
    );
  },
} satisfies ExportedHandler<CloudflareEnv>;

// Re-export requerido por el adaptador (DO Queue y DO Tag Cache).
// @ts-ignore `.open-next/worker.js` se genera en tiempo de build
export { DOQueueHandler, DOShardedTagCache } from "./.open-next/worker.js";
