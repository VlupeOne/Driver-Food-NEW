import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");

  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": {
          target: env.VITE_API_TARGET || "http://localhost:3333",
          changeOrigin: true,
        },
      },
    },
    preview: {
      port: 4173,
    },
  };
});
