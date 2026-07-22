import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const repositoryName = String(process.env.GITHUB_REPOSITORY || "").split("/").pop();
const pagesBase = process.env.VITE_BASE_PATH
  || (process.env.GITHUB_ACTIONS === "true" && repositoryName ? `/${repositoryName}/` : "./");

export default defineConfig({
  base: pagesBase,
  plugins: [react()],
  build: {
    target: "es2022",
    sourcemap: false,
  },
});
