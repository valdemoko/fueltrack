/**
 * Loading UI de la jerarquía /gasolineras (App Router).
 *
 * Next.js muestra este componente automáticamente mientras se resuelve
 * la página SSR (CCAA, provincia o municipio) — así el usuario siempre
 * tiene feedback inmediato al pulsar un enlace, aunque la consulta a la
 * base de datos tarde.
 *
 * Mismo estilo visual que las páginas: spinner ámbar + texto informativo
 * en función del nivel de la ruta (prop `nivel`, opcional).
 */
export default function LoadingGasolineras({
  nivel = "pagina",
}: {
  nivel?: "pagina" | "ccaa" | "provincia" | "municipio" | "estacion";
}) {
  const mensajes: Record<string, string> = {
    pagina: "Cargando gasolineras...",
    ccaa: "Cargando comunidad autónoma...",
    provincia: "Cargando provincia...",
    municipio: "Cargando municipio...",
    estacion: "Cargando estación...",
  };

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={mensajes[nivel]}
      className="flex items-center justify-center min-h-[60vh]"
    >
      <div className="text-center">
        <div
          className="h-10 w-10 mx-auto animate-spin rounded-full border-2 border-amber-600 border-t-transparent"
          aria-hidden="true"
        />
        <p className="mt-4 text-stone-600">{mensajes[nivel]}</p>
      </div>
    </div>
  );
}
