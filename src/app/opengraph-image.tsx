/**
 * OG image de marca para todo el sitio (1200×630).
 * Generada en build/edge con la API nativa de Next (next/og):
 * sin librerías externas y sin consultas a la base de datos.
 * Una sola imagen de marca común para todas las páginas (suficiente
 * para la metadata OG; ver auditoría I9).
 */
import { ImageResponse } from "next/og";

export const runtime = "edge";
// Caché larga: la imagen es estática de marca (revalidación mensual).
export const revalidate = 2592000;

export const alt = "FuelTrack — Precios de carburantes en España";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          background: "linear-gradient(135deg, #1c1917 0%, #292524 60%, #1c1917 100%)",
          padding: "80px",
          position: "relative",
        }}
      >
        {/* Acento ámbar superior */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 12,
            background: "linear-gradient(90deg, #d97706, #f59e0b, #d97706)",
            display: "flex",
          }}
        />
        {/* Marca */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 24,
            marginBottom: 36,
          }}
        >
          <div
            style={{
              width: 84,
              height: 84,
              borderRadius: 20,
              background: "#d97706",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="52" height="52" viewBox="0 0 24 24" fill="none">
              <path
                d="M5 3h11l3 3v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V3z"
                stroke="#fff"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
              <path d="M14 3v5h5" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" />
              <path d="M8 14h8" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
              <path d="M8 17.5h5" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <div
            style={{
              fontSize: 76,
              fontWeight: 700,
              color: "#ffffff",
              letterSpacing: -2,
              display: "flex",
            }}
          >
            FuelTrack
          </div>
        </div>
        {/* Claim */}
        <div
          style={{
            fontSize: 44,
            color: "#d6d3d1",
            display: "flex",
            maxWidth: 940,
            lineHeight: 1.3,
          }}
        >
          Precios de gasolina y gasóleo en las estaciones de servicio de toda España
        </div>
        {/* Footer */}
        <div
          style={{
            position: "absolute",
            bottom: 64,
            left: 80,
            display: "flex",
            alignItems: "center",
            gap: 16,
            fontSize: 28,
            color: "#a8a29e",
          }}
        >
          <div
            style={{
              padding: "8px 20px",
              borderRadius: 999,
              background: "rgba(217, 119, 6, 0.15)",
              border: "1px solid rgba(217, 119, 6, 0.4)",
              color: "#fbbf24",
              display: "flex",
            }}
          >
            Datos oficiales del MITECO
          </div>
          <div style={{ display: "flex" }}>fueltrack.site</div>
        </div>
      </div>
    ),
    { ...size }
  );
}
