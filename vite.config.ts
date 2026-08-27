import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const securityHeaders = {
  "Content-Security-Policy":
    "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; manifest-src 'self'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Origin-Agent-Cluster": "?1",
  "Permissions-Policy":
    "tools=(self), camera=(), microphone=(), geolocation=(), payment=(), usb=()",
};

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? "/",
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler"))
            return "react-vendor";
          if (id.includes("node_modules/lucide-react")) return "icons";
          if (id.includes("node_modules/dexie")) return "local-vault";
          return undefined;
        },
      },
    },
  },
  server: {
    headers: {
      "Origin-Agent-Cluster": "?1",
      "Permissions-Policy": "tools=(self)",
    },
  },
  preview: {
    headers: securityHeaders,
  },
});
