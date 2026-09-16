import type { Metadata } from "next";
import Link from "next/link";
import { getUltimaFechaGlobal } from "@/lib/db/queries";
import { SITE_NAME, SITE_URL } from "@/lib/siteConfig";

// ISR (revalidación horaria): protege la cuota de lectura de Turso.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Metodología — De dónde salen los datos y cómo se procesan",
  description:
    "Metodología completa de tratamiento de datos de carburantes: fuente oficial MITECO, ingesta, normalización, validación, actualización automática, cálculo de estadísticas y limitaciones.",
  alternates: { canonical: "/metodologia" },
};

export default async function MetodologiaPage() {
  const ultimaFecha = await getUltimaFechaGlobal();

  return (
    <div className="min-h-screen bg-surface-primary">
      <main className="max-w-4xl mx-auto px-4 py-8 md:py-12">
        <nav className="text-sm text-stone-500 mb-6" aria-label="Breadcrumb">
          <Link href="/" className="hover:text-amber-600 transition-colors">
            Inicio
          </Link>
          <span className="mx-2">/</span>
          <span className="text-stone-900">Metodología</span>
        </nav>

        <h1 className="font-display text-3xl md:text-4xl font-bold text-stone-900 mb-4">
          Metodología de datos
        </h1>

        <p className="text-stone-600 leading-relaxed mb-8">
          {SITE_NAME} es una plataforma de consulta de precios de carburantes.
          No recogemos precios manualmente ni estimamos valores: toda la
          información mostrada procede de la fuente oficial descrita a continuación
          y se procesa de forma automatizada. Esta página explica
          exactamente cómo funciona ese proceso.
        </p>

        <div className="card p-6 md:p-8 space-y-10 prose prose-stone max-w-none">
          <section>
            <h2>1. Fuente de datos</h2>
            <p>
              Los precios y las estaciones provienen de los servicios REST
              públicos del{" "}
              <strong>
                Ministerio para la Transición Ecológica y el Reto Demográfico
                (MITECO)
              </strong>
              , que publica los precios comunicados por cada estación de
              servicio conforme a la normativa vigente:
            </p>
            <ul>
              <li>
                <a
                  href="https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Servicios REST de Carburantes del MITECO ↗
                </a>
              </li>
            </ul>
            <p>
              Los datos se reutilizan bajo licencia{" "}
              <strong>CC BY 4.0</strong> (Directiva (UE) 2019/1024 / Ley
              37/2007 de reutilización de la información del sector público).
              No modificamos los valores de origen.
            </p>
          </section>

          <section>
            <h2>2. Cómo se obtienen los datos</h2>
            <p>
              Un proceso automático consulta la API del MITECO provincia por
              provincia (las 52 de España). Cada respuesta incluye el listado
              de estaciones de esa provincia con sus precios comunicados y la
              fecha de la observación. La consulta se realiza desde el
              servidor; el navegador del usuario nunca contacta directamente
              con el MITECO.
            </p>
          </section>

          <section>
            <h2>3. Normalización</h2>
            <p>Antes de guardarse, cada registro se normaliza:</p>
            <ul>
              <li>
                <strong>Precios:</strong> el formato español con coma decimal
                (&quot;1,789&quot;) se convierte a número (1.789). Los valores
                vacíos, &quot;-&quot; o no numéricos se guardan como ausentes,
                nunca como cero.
              </li>
              <li>
                <strong>Coordenadas:</strong> latitud y longitud se convierten
                a decimal WGS84. Las estaciones sin coordenadas válidas no se
                muestran en el mapa.
              </li>
              <li>
                <strong>Fechas:</strong> el formato &quot;dd/MM/yyyy HH:mm:ss&quot;
                de la fuente se convierte a fecha ISO (yyyy-MM-dd).
              </li>
              <li>
                <strong>Identificadores:</strong> cada estación conserva su
                <strong> IDEESS</strong>, el identificador estable que asigna el
                ministerio. Ese ID es el que forma las URLs de estación, por lo
                que no cambian aunque la estación cambie de nombre o de rótulo.
              </li>
            </ul>
          </section>

          <section>
            <h2>4. Validación</h2>
            <p>
              Se descartan registros inválidos antes de escribir en la base de
              datos: precios no numéricos, estaciones sin identificador y
              coordenadas imposibles. Si una provincia falla durante la
              actualización (por ejemplo, si la API oficial no responde), esa
              provincia no se actualiza y los datos válidos anteriores
              se conservan. La web muestra siempre el último conjunto de datos
              válido disponible, nunca datos a medias.
            </p>
          </section>

          <section>
            <h2>5. Actualización automática</h2>
            <p>
              La actualización se ejecuta de forma programada una vez al día
              (a las 06:00 UTC, mediante Vercel Cron), justo después de que la
              fuente oficial publica los precios del día. El proceso recorre
              las 52 provincias; si alguna falla, se registra el error y se
              continua con las demás en la siguiente ejecución. Cada ejecución
              es un <em>upsert</em>: las estaciones nuevas se añaden, las
              existentes se actualizan y los precios de cada día se almacenan
              como observaciones históricas. No se eliminan datos anteriores
              válidos.
            </p>
          </section>

          <section>
            <h2>6. Cómo se calculan las estadísticas</h2>
            <ul>
              <li>
                <strong>Precio medio:</strong> media aritmética de los precios
                de las estaciones con precio publicado en la última fecha de
                observación del producto consultado.
              </li>
              <li>
                <strong>Precio mínimo / máximo:</strong> valores extremos del
                mismo conjunto.
              </li>
              <li>
                <strong>Comparación con la zona:</strong> el precio de una
                estación se compara con la media de su municipio (misma fecha,
                mismo producto).
              </li>
              <li>
                <strong>Estaciones cercanas:</strong> estaciones a menos de 10
                km en línea recta (distancia haversine sobre las coordenadas
                oficiales).
              </li>
              <li>
                <strong>Histórico:</strong> serie real de observaciones
                registradas por el sistema. Si una estación tiene pocas
                observaciones, se indica claramente. No se interpolan ni se
                estiman precios.
              </li>
            </ul>
          </section>

          <section>
            <h2>7. Qué significa la fecha de actualización</h2>
            <p>
              Cada página muestra la fecha de la última observación registrada
              en la base de datos
              {ultimaFecha ? (
                <>
                  {" "}
                  (actualmente: <strong>{ultimaFecha}</strong>)
                </>
              ) : null}
              . Esa fecha es la que publica la fuente oficial, no el momento en
              que usted visita la página. Las estaciones de servicio están
              obligadas a comunicar sus precios y el ministerio los agrega; un
              retraso en esa comunicación se refleja en la fecha mostrada.
            </p>
          </section>

          <section>
            <h2>8. Limitaciones de los datos</h2>
            <ul>
              <li>
                Los precios los comunica cada estación: pueden no estar
                actualizados en el momento exacto de su visita o diferir
                ligeramente en el surtidor.
              </li>
              <li>
                La fuente oficial puede sufrir retrasos o incidencias; en ese
                caso la web sigue mostrando el último dato válido.
              </li>
              <li>
                Algunos productos (biocarburantes, gases, aviación) solo están
                disponibles en un número reducido de estaciones.
              </li>
              <li>
                No ofrecemos garantía sobre decisiones de compra basadas en
                estos datos; son informativos.
              </li>
            </ul>
          </section>

          <section>
            <h2>9. Si encuentra un dato incorrecto</h2>
            <p>
              Si detecta un precio o un dato de estación erróneo, puede
              avisarnos en la{" "}
              <Link href="/contacto">página de contacto</Link>. Revisaremos el
              registro. Tenga en cuenta que la corrección definitiva corresponde
              a la estación y al ministerio: nosotros reflejamos la fuente
              oficial, no la modificamos.
            </p>
          </section>

          <section>
            <h2>10. Más información</h2>
            <ul>
              <li>
                <Link href="/aviso-legal">Aviso legal</Link>
              </li>
              <li>
                <Link href="/politica-privacidad">
                  Política de privacidad
                </Link>
              </li>
              <li>
                <Link href="/politica-cookies">Política de cookies</Link>
              </li>
            </ul>
          </section>
        </div>

        <p className="mt-8 text-xs text-stone-400">
          Última revisión de esta página: {new Date().getFullYear()} ·{" "}
          {SITE_URL}
        </p>
      </main>
    </div>
  );
}
