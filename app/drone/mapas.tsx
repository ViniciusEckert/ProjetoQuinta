"use client";

import { useEffect, useRef, useState } from "react";
import { Map as MapaGL, Marker, setWorkerUrl } from "maplibre-gl";
import type { GeoJSONSource, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Eye, EyeOff, LocateFixed, MapPin, ZoomIn, ZoomOut } from "lucide-react";

export type ParaGeo = (x: number, y: number) => [number, number];

export interface MarcadorMapa {
  id: number;
  x: number;
  y: number;
  cor: string;
  classe: string;
  curto: string;
  especial: boolean;
  confianca: number;
  ativa: boolean;
}
export interface OcultaMapa {
  id: number;
  x: number;
  y: number;
  cor: string;
}

// No Next.js o MapLibre não acha o próprio worker sozinho: ele é servido de /public
// (copiado por scripts/copiar-worker.mjs).
setWorkerUrl("/maplibre-gl-worker.mjs");

const URL_RUAS = "https://tiles.openfreemap.org/styles/liberty";
const ESTILO_SATELITE: StyleSpecification = {
  version: 8,
  sources: {
    sat: {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: "Imagens © Esri, Maxar, Earthstar Geographics",
    },
  },
  layers: [{ id: "sat", type: "raster", source: "sat" }],
};

// metros por pixel no zoom 0 (tiles de 512 px)
const MPP_Z0 = 78271.51696402048;
const zoomPara = (larguraPx: number, metros: number, lat: number) =>
  Math.log2((MPP_Z0 * Math.cos((lat * Math.PI) / 180) * larguraPx) / metros);

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/* ───────────── Vídeo: satélite centrado no drone ───────────── */

export function FeedSatelite({
  drone,
  paraGeo,
  metrosLargura,
  congelado,
  termico,
  onFalha,
}: {
  drone: { x: number; y: number };
  paraGeo: ParaGeo;
  metrosLargura: number;
  congelado: boolean;
  termico: boolean;
  onFalha: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapaGL | null>(null);
  const droneRef = useRef(drone);
  const falhaRef = useRef(onFalha);
  useEffect(() => {
    droneRef.current = drone;
    falhaRef.current = onFalha;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const d0 = droneRef.current;
    const map = new MapaGL({
      container: el,
      style: ESTILO_SATELITE,
      center: paraGeo(d0.x, d0.y),
      zoom: 19,
      interactive: false,
      attributionControl: false,
      fadeDuration: 0,
    });
    mapRef.current = map;

    const ajustar = () => {
      const d = droneRef.current;
      const [lng, lat] = paraGeo(d.x, d.y);
      map.jumpTo({
        center: [lng, lat],
        zoom: zoomPara(el.clientWidth || 800, metrosLargura, lat),
      });
    };
    ajustar();

    let erros = 0;
    map.on("error", () => {
      erros += 1;
      if (erros === 6) falhaRef.current();
    });
    const ro = new ResizeObserver(() => {
      map.resize();
      ajustar();
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // acompanha o drone a cada quadro
  useEffect(() => {
    const map = mapRef.current;
    const el = ref.current;
    if (!map || !el) return;
    const [lng, lat] = paraGeo(drone.x, drone.y);
    map.jumpTo({
      center: [lng, lat],
      zoom: zoomPara(el.clientWidth || 800, metrosLargura, lat),
    });
  }, [drone.x, drone.y, paraGeo, metrosLargura]);

  return (
    <div
      className="absolute inset-0"
      style={{
        filter: congelado
          ? "grayscale(1) brightness(0.55)"
          : termico
          ? "grayscale(1) contrast(1.5) brightness(0.75) sepia(1) hue-rotate(235deg) saturate(3)"
          : undefined,
      }}
    >
      <div ref={ref} className="h-full w-full" />
    </div>
  );
}

/* ───────────── Marcadores (HTML) ───────────── */

function glifoSvg(c: string) {
  const f = "#fff";
  const k = "#0f172a";
  switch (c) {
    case "veiculo":
      return `<rect x="-5" y="-3" width="10" height="6" rx="1.8" fill="${f}"/><rect x="-2.6" y="-2" width="5" height="4" rx=".8" fill="${k}" opacity=".55"/>`;
    case "calor":
      return `<path d="M0 -6 C3 -2 5 0 5 3 A5 5 0 0 1 -5 3 C-5 0 -2 -1 0 -6Z" fill="${f}"/>`;
    case "fumaca":
      return `<g fill="${f}"><circle cx="-2.5" cy="1" r="3"/><circle cx="2" cy="0" r="3.4"/><circle cx="0" cy="-2.2" r="2.6"/></g>`;
    case "obstaculo":
      return `<path d="M0 -6 L6 5 H-6Z" fill="${f}"/><rect x="-.6" y="-2" width="1.2" height="4" fill="${k}"/><circle cx="0" cy="3.2" r=".7" fill="${k}"/>`;
    case "ferido":
      return `<g fill="${f}"><circle cx="-4" cy="0" r="2.1"/><rect x="-2" y="-1.8" width="9" height="3.6" rx="1.8"/></g>`;
    default:
      return (
        `<g fill="${f}"><circle cx="0" cy="-3.6" r="2.2"/><path d="M-4.5 5.5 Q-4.5 -.5 0 -.5 Q4.5 -.5 4.5 5.5Z"/>` +
        (c === "armado"
          ? `<rect x="3" y=".5" width="5.5" height="1.8" fill="${k}" stroke="${f}" stroke-width=".5"/>`
          : "") +
        (c === "mandado"
          ? `<rect x="3.4" y="-6" width="4" height="4.6" fill="${k}" stroke="${f}" stroke-width=".6"/>`
          : "") +
        `</g>`
      );
  }
}

function criarElemento(m: MarcadorMapa): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText = "cursor:pointer;width:28px;height:28px;position:relative;";
  el.innerHTML =
    `<svg viewBox="-14 -14 28 28" width="28" height="28" style="overflow:visible">` +
    (m.especial
      ? `<circle r="12" fill="none" stroke="${m.cor}" stroke-width="2"><animate attributeName="r" values="10;28" dur="1.4s" repeatCount="indefinite"/><animate attributeName="opacity" values=".9;0" dur="1.4s" repeatCount="indefinite"/></circle>`
      : "") +
    `<circle r="13" fill="${m.cor}" fill-opacity=".2"/>` +
    `<circle r="${m.especial ? 10 : 8.5}" fill="${m.cor}" stroke="#0f172a" stroke-width="1.5"/>` +
    `<g transform="scale(${m.especial ? 0.95 : 0.8})">${glifoSvg(m.classe)}</g>` +
    `<circle class="anel" r="14" fill="none" stroke="#fff" stroke-width="1.5" opacity="0"/></svg>` +
    `<div class="rot" style="position:absolute;left:32px;top:-4px;white-space:nowrap;font:700 11px sans-serif;color:#fff;text-shadow:0 0 3px #0f172a,0 0 3px #0f172a"></div>`;
  return el;
}

function atualizarElemento(el: HTMLDivElement, m: MarcadorMapa) {
  el.querySelector(".anel")?.setAttribute("opacity", m.ativa ? "1" : "0");
  const rot = el.querySelector<HTMLElement>(".rot");
  if (rot) {
    rot.textContent =
      m.ativa || m.especial ? `${m.curto}${m.ativa ? " " + m.confianca + "%" : ""}` : "";
  }
}

const DRONE_SVG = `<svg viewBox="-16 -16 32 32" width="36" height="36" style="overflow:visible">
<circle r="9" fill="none" stroke="#38bdf8" stroke-width="1.5"><animate attributeName="r" values="9;22" dur="1.8s" repeatCount="indefinite"/><animate attributeName="opacity" values=".8;0" dur="1.8s" repeatCount="indefinite"/></circle>
<path d="M-9 -9 L9 9 M9 -9 L-9 9" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/>
<circle cx="-9" cy="-9" r="3.5" fill="#0f172a" stroke="#38bdf8" stroke-width="1.5"/><circle cx="9" cy="-9" r="3.5" fill="#0f172a" stroke="#38bdf8" stroke-width="1.5"/>
<circle cx="-9" cy="9" r="3.5" fill="#0f172a" stroke="#38bdf8" stroke-width="1.5"/><circle cx="9" cy="9" r="3.5" fill="#0f172a" stroke="#38bdf8" stroke-width="1.5"/>
<circle r="4.5" fill="#38bdf8" stroke="#fff" stroke-width="1.2"/></svg>`;

/* ───────────── Mapa tático real ───────────── */

export function MapaReal({
  drone,
  paraGeo,
  foot,
  rotulo,
  online,
  marcadores,
  ocultas,
  onSelecionar,
  onFalha,
}: {
  drone: { x: number; y: number };
  paraGeo: ParaGeo;
  foot: { w: number; h: number };
  rotulo: string;
  online: boolean;
  marcadores: MarcadorMapa[];
  ocultas: OcultaMapa[];
  onSelecionar: (id: number) => void;
  onFalha: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapaGL | null>(null);
  const droneMk = useRef<Marker | null>(null);
  const regs = useRef(new Map<string, { marker: Marker; el: HTMLDivElement }>());
  const estiloAtual = useRef<"ruas" | "satelite">("satelite");

  const droneRef = useRef(drone);
  const selRef = useRef(onSelecionar);
  const falhaRef = useRef(onFalha);
  const onlineRef = useRef(online);
  useEffect(() => {
    droneRef.current = drone;
    selRef.current = onSelecionar;
    falhaRef.current = onFalha;
    onlineRef.current = online;
  });

  const [estilo, setEstilo] = useState<"ruas" | "satelite">("satelite");
  const [seguir, setSeguir] = useState(true);
  const [revelar, setRevelar] = useState(false);
  const [zoom, setZoom] = useState(17.5);

  const poligono = (d: { x: number; y: number }) => ({
    type: "Feature" as const,
    properties: {},
    geometry: {
      type: "Polygon" as const,
      coordinates: [
        [
          paraGeo(d.x - foot.w / 2, d.y - foot.h / 2),
          paraGeo(d.x + foot.w / 2, d.y - foot.h / 2),
          paraGeo(d.x + foot.w / 2, d.y + foot.h / 2),
          paraGeo(d.x - foot.w / 2, d.y + foot.h / 2),
          paraGeo(d.x - foot.w / 2, d.y - foot.h / 2),
        ],
      ],
    },
  });

  /* Cria o mapa uma única vez */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const d0 = droneRef.current;
    const map = new MapaGL({
      container: el,
      style: ESTILO_SATELITE,
      center: paraGeo(d0.x, d0.y),
      zoom: 17.5,
      minZoom: 15,
      maxZoom: 20,
      maxBounds: [paraGeo(-100, 500), paraGeo(900, -100)],
      attributionControl: { compact: true },
      dragRotate: false,
    });
    mapRef.current = map;
    map.touchZoomRotate.disableRotation();

    const camadas = () => {
      if (map.getSource("pegada")) return;
      const cor = onlineRef.current ? "#38bdf8" : "#64748b";
      map.addSource("pegada", { type: "geojson", data: poligono(droneRef.current) });
      map.addLayer({
        id: "pegada-fill",
        type: "fill",
        source: "pegada",
        paint: { "fill-color": cor, "fill-opacity": 0.12 },
      });
      map.addLayer({
        id: "pegada-line",
        type: "line",
        source: "pegada",
        paint: { "line-color": cor, "line-width": 2, "line-dasharray": [3, 2] },
      });
    };
    map.on("style.load", camadas);
    map.on("dragstart", () => setSeguir(false));
    map.on("zoom", () => setZoom(map.getZoom()));

    let erros = 0;
    map.on("error", () => {
      erros += 1;
      if (erros === 6) falhaRef.current();
    });

    const elDrone = document.createElement("div");
    elDrone.innerHTML = DRONE_SVG;
    droneMk.current = new Marker({ element: elDrone })
      .setLngLat(paraGeo(d0.x, d0.y))
      .addTo(map);

    /* Teclado: setas movem o mapa, J aproxima, K afasta */
    const teclas = new Set<string>();
    const down = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const alvo = e.target as HTMLElement | null;
      if (alvo && (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA")) return;
      const k = e.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", "j", "k"].includes(k)) {
        if (k.startsWith("arrow")) e.preventDefault();
        teclas.add(k);
      }
    };
    const up = (e: KeyboardEvent) => teclas.delete(e.key.toLowerCase());
    const limpar = () => teclas.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", limpar);

    let raf = 0;
    let ultimo = performance.now();
    const loop = (agora: number) => {
      const dt = Math.min(0.05, (agora - ultimo) / 1000);
      ultimo = agora;
      const dx = (teclas.has("arrowright") ? 1 : 0) - (teclas.has("arrowleft") ? 1 : 0);
      const dy = (teclas.has("arrowdown") ? 1 : 0) - (teclas.has("arrowup") ? 1 : 0);
      const dz = (teclas.has("j") ? 1 : 0) - (teclas.has("k") ? 1 : 0);
      if (dx || dy) {
        setSeguir(false);
        map.panBy([dx * 420 * dt, dy * 420 * dt], { animate: false });
      }
      if (dz) map.jumpTo({ zoom: clamp(map.getZoom() + dz * dt * 1.6, 15, 20) });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const registros = regs.current;
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", limpar);
      registros.forEach((r) => r.marker.remove());
      registros.clear();
      droneMk.current?.remove();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Troca de estilo (ruas / satélite) */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || estiloAtual.current === estilo) return;
    estiloAtual.current = estilo;
    map.setStyle(estilo === "ruas" ? URL_RUAS : ESTILO_SATELITE);
  }, [estilo]);

  /* Drone, área da câmera e câmera do mapa */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const ll = paraGeo(drone.x, drone.y);
    droneMk.current?.setLngLat(ll);
    try {
      (map.getSource("pegada") as GeoJSONSource | undefined)?.setData(poligono(drone));
    } catch {}
    if (seguir) map.jumpTo({ center: ll });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drone.x, drone.y, seguir]);

  /* Cor da área da câmera quando a conexão cai */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    try {
      if (map.getLayer("pegada-line")) {
        const cor = online ? "#38bdf8" : "#64748b";
        map.setPaintProperty("pegada-line", "line-color", cor);
        map.setPaintProperty("pegada-fill", "fill-color", cor);
      }
    } catch {}
  }, [online]);

  /* Marcadores das detecções e das entidades ocultas */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const vivos = new Set<string>();

    marcadores.forEach((m) => {
      const k = `d${m.id}`;
      vivos.add(k);
      let r = regs.current.get(k);
      if (!r) {
        const el = criarElemento(m);
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          selRef.current(m.id);
        });
        r = { marker: new Marker({ element: el }).setLngLat(paraGeo(m.x, m.y)).addTo(map), el };
        regs.current.set(k, r);
      }
      r.marker.setLngLat(paraGeo(m.x, m.y));
      atualizarElemento(r.el, m);
    });

    if (revelar) {
      ocultas.forEach((o) => {
        const k = `o${o.id}`;
        vivos.add(k);
        let r = regs.current.get(k);
        if (!r) {
          const el = document.createElement("div");
          el.style.pointerEvents = "none";
          el.innerHTML = `<svg viewBox="-8 -8 16 16" width="16" height="16"><circle r="6" fill="none" stroke="${o.cor}" stroke-width="1.5" stroke-dasharray="3 2"/></svg>`;
          r = { marker: new Marker({ element: el }).setLngLat(paraGeo(o.x, o.y)).addTo(map), el };
          regs.current.set(k, r);
        }
        r.marker.setLngLat(paraGeo(o.x, o.y));
      });
    }

    regs.current.forEach((r, k) => {
      if (!vivos.has(k)) {
        r.marker.remove();
        regs.current.delete(k);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marcadores, ocultas, revelar]);

  const kbd =
    "rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-200";
  const botao =
    "flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-black/60 text-slate-200 backdrop-blur transition hover:bg-white/10";

  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <MapPin className="h-4 w-4 text-sky-400" /> Mapa tático
          <span className="text-xs font-normal text-slate-500">{rotulo} · MapLibre</span>
        </h3>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex overflow-hidden rounded-md border border-slate-700 text-[11px]">
            {(["satelite", "ruas"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setEstilo(s)}
                className={`px-2 py-1 transition ${
                  estilo === s ? "bg-sky-500 text-slate-950" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {s === "ruas" ? "Ruas" : "Satélite"}
              </button>
            ))}
          </div>
          <button
            onClick={() => setRevelar((r) => !r)}
            className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition ${
              revelar
                ? "border-violet-400/50 bg-violet-500/15 text-violet-200"
                : "border-slate-700 text-slate-400 hover:text-slate-200"
            }`}
          >
            {revelar ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            Entidades ocultas
          </button>
          <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <kbd className={kbd}>←↑↓→</kbd> mover · <kbd className={kbd}>J</kbd> aproximar ·{" "}
            <kbd className={kbd}>K</kbd> afastar
          </p>
        </div>
      </div>

      <div className="relative h-80 lg:h-[26rem]">
        <div className="absolute inset-0">
          <div ref={ref} className="h-full w-full" />
        </div>

        <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-black/60 px-2 py-1 font-mono text-[11px] text-slate-200 backdrop-blur">
          zoom {zoom.toFixed(1)}
          {seguir && <span className="text-sky-300"> · seguindo drone</span>}
        </div>

        <div className="absolute right-3 top-3 flex flex-col gap-1.5">
          <button aria-label="Aproximar" onClick={() => mapRef.current?.zoomTo(zoom + 0.5)} className={botao}>
            <ZoomIn className="h-4 w-4" />
          </button>
          <button aria-label="Afastar" onClick={() => mapRef.current?.zoomTo(zoom - 0.5)} className={botao}>
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            aria-label="Seguir o drone"
            onClick={() => setSeguir(true)}
            className={`${botao} ${seguir ? "!border-sky-400/60 !bg-sky-500/30 text-sky-200" : ""}`}
          >
            <LocateFixed className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}