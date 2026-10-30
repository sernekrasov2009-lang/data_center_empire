import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Строгий CSP только в собранной сборке: в dev-режиме Vite и react-refresh
 * вставляют inline-скрипты, которые такой CSP заблокировал бы.
 */
function productionCsp(): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");

  return {
    name: "uptime-production-csp",
    apply: "build",
    transformIndexHtml(html) {
      const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}" />`;
      return html.replace("</head>", `  ${meta}\n  </head>`);
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), productionCsp()],
  build: {
    outDir: "dist",
    target: "es2022",
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: false,
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
