import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Optimizaciones de producción
  reactStrictMode: true,

  // Headers de seguridad
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(self)",
          },
        ],
      },
    ];
  },

  // Compresión
  compress: true,

  // Optimizaciones de imagen
  images: {
    formats: ["image/avif", "image/webp"],
  },
};

export default nextConfig;
