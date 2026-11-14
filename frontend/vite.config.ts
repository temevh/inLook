/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";

// The dashboard talks to two local services through this dev proxy, so neither needs CORS:
//   /api/*  -> the read-only Prisma data API in server/ (npm run api, port 3001)
//   the rest -> the FastAPI backend (SSE stream and the action endpoints, port 8000)
//   /mock/*  -> the mock backend for demo mode (npm run mock, port 8787), with /mock stripped
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const api = env.INLOOK_API_URL ?? "http://127.0.0.1:3001";
  const backend = env.INLOOK_BACKEND_URL ?? "http://127.0.0.1:8000";
  const mock = env.INLOOK_MOCK_URL ?? `http://127.0.0.1:${env.MOCK_PORT ?? 8787}`;
  const toBackend = { target: backend, changeOrigin: true };
  return {
    plugins: [vue()],
    server: {
      port: 5173,
      // The app imports the shared contract types, the backend seed and the overlay's mock scenarios.
      fs: { allow: [".."] },
      proxy: {
        "/mock/": { target: mock, changeOrigin: true, rewrite: (p) => p.replace(/^\/mock/, "") },
        "/api": { target: api, changeOrigin: true },
        "/stream": toBackend,
        "/check": toBackend,
        "/recheck": toBackend,
        "/reviews": toBackend,
        "/dev": toBackend,
        "/health": toBackend,
      },
    },
    test: { environment: "node", include: ["test/**/*.test.ts"] },
  };
});
