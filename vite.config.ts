import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// ROOK for Chrome: Vite + React. src/vendor holds pieces shared with the ROOK desktop app.
export default defineConfig({
  plugins: [react()],
  server: { port: 5180 },
  build: { target: "es2022", sourcemap: true },
});
