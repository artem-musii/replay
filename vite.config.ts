import react from "@vitejs/plugin-react";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { defineConfig } from "vite";

function configuredBasePath(value = "/"): string {
  const normalized = value.trim();
  const segments = normalized.split("/");
  if (
    !/^\/(?:[A-Za-z0-9._~-]+\/)*$/.test(normalized) ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error(
      "VITE_BASE_PATH must be an absolute URL-safe path that starts and ends with '/', such as / or /replay-sol/.",
    );
  }
  return normalized;
}

const basePath = configuredBasePath(process.env.VITE_BASE_PATH);
const unusedJsPdfOptionalModules = ["canvg", "dompurify", "html2canvas"] as const;

const metaContentSecurityPolicy =
  "default-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; manifest-src 'self'";

const securityHeaders = {
  "Content-Security-Policy": `${metaContentSecurityPolicy}; frame-ancestors 'none'`,
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
let buildOutDir = "";

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    {
      name: "replay-production-security-meta",
      apply: "build",
      transformIndexHtml() {
        return [
          {
            tag: "meta",
            attrs: {
              "http-equiv": "Content-Security-Policy",
              content: metaContentSecurityPolicy,
            },
            injectTo: "head-prepend",
          },
          {
            tag: "meta",
            attrs: { name: "referrer", content: "no-referrer" },
            injectTo: "head-prepend",
          },
        ];
      },
    },
    {
      name: "replay-static-404-base-path",
      apply: "build",
      configResolved(config) {
        buildOutDir = path.resolve(config.root, config.build.outDir);
      },
      async closeBundle() {
        if (!buildOutDir) throw new Error("Vite did not resolve its release output directory.");
        const output404 = path.join(buildOutDir, "404.html");
        const source = await readFile(output404, "utf8");
        const placeholder = 'href="/" data-replay-base-path';
        if (!source.includes(placeholder)) {
          throw new Error("public/404.html is missing its base-path placeholder.");
        }
        await writeFile(output404, source.replaceAll(placeholder, `href="${basePath}"`));
      },
    },
    {
      name: "replay-no-unused-pdf-renderers",
      apply: "build",
      generateBundle(_options, bundle) {
        const accidentallyBundled = new Set<string>();
        for (const output of Object.values(bundle)) {
          if (output.type !== "chunk") continue;
          for (const moduleId of Object.keys(output.modules)) {
            for (const dependency of unusedJsPdfOptionalModules) {
              if (moduleId.includes(`/node_modules/${dependency}/`)) {
                accidentallyBundled.add(dependency);
              }
            }
          }
        }
        if (accidentallyBundled.size > 0) {
          throw new Error(
            `Unused jsPDF browser renderers entered the release bundle: ${[...accidentallyBundled].join(", ")}.`,
          );
        }
      },
    },
  ],
  build: {
    rollupOptions: {
      // REPLAY uses jsPDF's text, shape, and PNG APIs only. jsPDF recommends
      // externalizing these optional renderers when its HTML/SVG APIs are not used.
      external: [...unusedJsPdfOptionalModules],
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
