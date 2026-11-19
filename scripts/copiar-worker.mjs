// Copia o worker do MapLibre para /public (necessário no Next.js).
// Uso: node scripts/copiar-worker.mjs
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("public", { recursive: true });
copyFileSync(
  "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs",
  "public/maplibre-gl-worker.mjs"
);
console.log("Worker do MapLibre copiado para public/maplibre-gl-worker.mjs");