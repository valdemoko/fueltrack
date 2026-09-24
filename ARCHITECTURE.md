# Arquitectura — Combustible Málaga

## Visión general

Plataforma profesional de consulta de precios de carburantes en España.
Fase MVP: estaciones de servicio de la provincia de Málaga.
Arquitectura preparada para escalabilidad: Málaga → Andalucía → España.

## Stack tecnológico

| Componente | Versión | Notas |
|---|---|---|
| Next.js | 15.x | App Router, modo `src/` |
| React | 19.x | — |
| TypeScript | 5.7.x | Strict mode |
| Tailwind CSS | 3.4.x | PostCSS + Autoprefixer |
| ESLint | 9.x | Flat config, `eslint-config-next` |
| lucide-react | 1.44.x | Iconografía SVG |
| PostgreSQL en **Neon** | 18 | `@neondatabase/serverless` (HTTP) + Drizzle ORM |
| Vitest | 5.x | Pruebas unitarias |

> El motor anterior era Turso (libSQL). Se migró a Neon porque Turso cobra por
> fila escrita y **cuenta cada entrada de índice**: con claves primarias
> compuestas de 3-4 columnas, cada fila costaba entre 4 y 7 escrituras, y un
> solo trasvase de 2,5 M de filas agotó el cupo mensual del plan gratuito.
> El funcionamiento diario y las trampas de Neon están en `README.md`.

## Fuente de datos

- **API oficial**: MITECO — `https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/`
- **Licencia**: CC BY 4.0 (EU 2023/138 / Ley 37/2007) — requiere atribución
- **Endpoints relevantes**:
  - `EstacionesTerrestres/FiltroProvincia/29/` — estaciones de Málaga (IDProvincia=29)
  - `EstacionesTerrestresHist/{dd-MM-yyyy}` — histórico diario desde 01/01/2007
  - `Listados/ProductosPetroliferos/` — catálogo de 32 productos de combustible
- **Frecuencia de actualización**: cada ~30 minutos
- **Identificador estable**: IDEESS por estación
- **Formato de coordenadas**: WGS84 decimal-coma español

## Modelo de datos (conceptual)

```
CCAA (Comunidad Autónoma)
  └── Provincia
        └── Municipio
              └── Estación de servicio
                    ├── Datos fijos (IDEESS, dirección, coordenadas, horarios, márgenes)
                    └── Producto / Precio observación
                          ├── Fecha/hora de observación
                          └── Precio del combustible
```

### Expansión geográfica

- MVP: `IDProvincia = 29` (Málaga)
- Fase 2: `IDCCAA = 01` (Andalucía) — 8 provincias
- Fase 3: toda España

No se escribe código rígido por provincia. Los filtros se parametrizan desde el inicio.

## Capas de la aplicación

```
Fuente externa (MITECO REST)
        ↓
Ingesta server-side (normalize, validar, upsert)
        ↓
Base de datos (upsert por IDEESS)
        ↓
API interna (capa de datos propia)
        ↓
Interfaz de usuario (Next.js App Router)
```

**Regla**: el navegador nunca llama directamente a MITECO. Toda comunicación con la fuente oficial pasa por el servidor.

## Estructura de directorios

```
src/
├── app/                  # App Router — páginas y layouts
│   ├── layout.tsx        # Layout raíz (lang="es", metadata base)
│   ├── page.tsx          # Página principal
│   └── globals.css       # Estilos globales + Tailwind
├── components/           # Componentes reutilizables (fase 5+)
├── lib/                  # Utilidades, tipos, configuración
└── styles/               # Estilos adicionales si se necesitan
```

## Lo que NO se implementa en FASE 2

- Modelo de datos en base de datos
- Ingesta ni normalización de datos MITECO
- API interna ni rutas de datos
- Mapa interactivo
- Fichas de estaciones
- Histórico ni gráficas
- Páginas legales ni SEO
- Componentes de interfaz reutilizables
- Publicidad ni AdSense

## Fases posteriores

| Fase | Contenido |
|---|---|
| 3 | Modelo de datos + ingestión/normalización Málaga |
| 4 | Carga real de datos + verificación manual |
| 5 | Interfaz principal de precios |
| 6 | Mapa interactivo |
| 7 | Fichas de estación + rutas |
| 8 | Histórico + gráficas |
| 9 | Arquitectura SEO completa |
| 10 | Páginas legales + AdSense |
| 11 | Auditoría final |
