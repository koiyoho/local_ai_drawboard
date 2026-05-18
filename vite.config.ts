import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    define: {
      __AIBOARD_API_BASE_URL__: JSON.stringify(env.VITE_API_BASE_URL ?? ""),
      __AIBOARD_TLDRAW_LICENSE_KEY__: JSON.stringify(
        env.VITE_TLDRAW_LICENSE_KEY ?? env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY ?? "",
      ),
    },
    build: {
      outDir: "dist/client",
    },
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
        "lucide-react": path.resolve(__dirname, "node_modules/lucide-react/dist/cjs/lucide-react.js"),
      },
    },
  };
});
