import { defineConfig } from "vite";
import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    server: {
        host: true,
        fs: {
            // shared/work-steps.json はプロジェクトルート外にあるため明示的に許可する
            allow: [path.resolve(__dirname), path.resolve(__dirname, "../shared")],
        },
        proxy: {
            "/api": {
                target: "https://localhost:8443",
                changeOrigin: true,
                secure: false, // 自己署名証明書を許可
            },
        },
    },
});
