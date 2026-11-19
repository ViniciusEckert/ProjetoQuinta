// Uso (na raiz do projeto): node scripts/baixar-ruas.mjs [lat] [lng]
import { writeFileSync } from "node:fs";

const LAT0 = Number(process.argv[2] ?? -25.4284);
const LNG0 = Number(process.argv[3] ?? -49.2733);
const K = 111000;
const cos = Math.cos((LAT0 * Math.PI) / 180);
const HOME = { x: 400, y: 200 };
const W = 800;
const H = 400;

const dLat = H / 2 / K;
const dLng = W / 2 / (K * cos);
const bbox = [LAT0 - dLat, LNG0 - dLng, LAT0 + dLat, LNG0 + dLng].join(",");

const larguras = {
  motorway: 14, trunk: 14, primary: 14, secondary: 12, tertiary: 10,
  unclassified: 8, residential: 8, living_street: 6, service: 5,
  pedestrian: 4, footway: 3, path: 3, cycleway: 3,
};
const tipos = Object.keys(larguras).join("|");
const query = `[out:json][timeout:30];way["highway"~"^(${tipos})$"](${bbox});out geom;`;

const res = await fetch("https://overpass-api.de/api/interpreter", {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": "diapb-trabalho-academico",
  },
  body: "data=" + encodeURIComponent(query),
});
if (!res.ok) throw new Error(`Overpass respondeu ${res.status}`);
const dados = await res.json();

const toXY = (p) => [
  +(HOME.x + (p.lon - LNG0) * K * cos).toFixed(1),
  +(HOME.y - (p.lat - LAT0) * K).toFixed(1),
];
const dentro = ([x, y]) => x >= 0 && x <= W && y >= 0 && y <= H;

const ruas = [];
for (const e of dados.elements) {
  if (e.type !== "way" || !e.geometry || e.geometry.length < 2) continue;
  const w = larguras[e.tags?.highway] ?? 6;
  let trecho = [];
  for (const p of e.geometry.map(toXY)) {
    if (dentro(p)) trecho.push(p);
    else {
      if (trecho.length >= 2) ruas.push({ w, pts: trecho });
      trecho = [];
    }
  }
  if (trecho.length >= 2) ruas.push({ w, pts: trecho });
}

writeFileSync("app/drone/ruas.json", JSON.stringify(ruas));
console.log(`${ruas.length} trechos de rua salvos em app/drone/ruas.json`);