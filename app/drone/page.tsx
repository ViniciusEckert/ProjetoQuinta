"use client";

import { memo, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  Battery,
  Bot,
  Camera,
  Check,
  Clock,
  Construction,
  Drone,
  Flame,
  Gamepad2,
  Gauge,
  Info,
  Loader2,
  LocateFixed,
  LogOut,
  MapPin,
  Mountain,
  Radio,
  Repeat,
  Thermometer,
  Undo2,
  User,
  Wifi,
  WifiOff,
  Wind,
  X,
  ZoomIn,
  ZoomOut,
  ArrowLeft,
} from "lucide-react";

/* ───────────── Tipos ───────────── */

type Classe = "pessoa" | "fumaca" | "calor" | "obstaculo";
type Prioridade = "critica" | "media" | "baixa";
type Status = "pendente" | "confirmado" | "descartado";
type Conexao = "online" | "perdida" | "sincronizando";
type Modo = "rgb" | "termico";
type ModoVoo = "manual" | "patrulha" | "base";

interface Deteccao {
  id: number;
  classe: Classe;
  x: number; // centro, em % da área da câmera na posição inicial do drone
  y: number;
  w: number; // tamanho da caixa, em % do vídeo
  h: number;
  confianca: number;
  prioridade: Prioridade;
  hora: Date;
  texto: string;
  status: Status;
  sincronizado?: boolean;
}

interface Voo {
  x: number; // posição no mundo (1 unidade = 1 metro)
  y: number;
  vx: number; // velocidade (m/s)
  vy: number;
  th: number; // ângulo da órbita (modo patrulha)
  modo: ModoVoo;
}

/* ───────────── Configuração ───────────── */

const MODELO_IA = "diapb-vision v0.3 (simulado)";

const CLASSES: Record<
  Classe,
  {
    label: string;
    Icon: LucideIcon;
    cor: string;
    fonte: string;
    ancora: { x: number; y: number; w: number; h: number };
  }
> = {
  pessoa: {
    label: "Pessoa",
    Icon: User,
    cor: "#38bdf8",
    fonte: "Câmera RGB",
    ancora: { x: 55, y: 62, w: 7, h: 15 },
  },
  calor: {
    label: "Foco de calor",
    Icon: Flame,
    cor: "#fb923c",
    fonte: "Sensor térmico",
    ancora: { x: 72, y: 38, w: 13, h: 22 },
  },
  fumaca: {
    label: "Fumaça",
    Icon: Wind,
    cor: "#cbd5e1",
    fonte: "Câmera RGB",
    ancora: { x: 72, y: 18, w: 18, h: 22 },
  },
  obstaculo: {
    label: "Obstáculo",
    Icon: Construction,
    cor: "#facc15",
    fonte: "Câmera RGB",
    ancora: { x: 25, y: 48, w: 9, h: 16 },
  },
};

const PRIORIDADES: Record<Prioridade, { label: string; classe: string }> = {
  critica: {
    label: "Crítica",
    classe: "bg-red-500/15 text-red-300 border-red-500/30",
  },
  media: {
    label: "Média",
    classe: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  },
  baixa: {
    label: "Baixa",
    classe: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  },
};

const TEXTOS: Record<Classe, ((q: string) => string)[]> = {
  pessoa: [
    (q) =>
      `Possível pessoa no setor ${q}. Movimento detectado; confirme visualmente antes de qualquer abordagem.`,
    (q) =>
      `Possível presença humana no setor ${q}, parcialmente encoberta. Recomenda-se revisão do operador.`,
    (q) =>
      `Forma compatível com pessoa no setor ${q}. Condição de iluminação pode afetar a precisão.`,
  ],
  calor: [
    (q) =>
      `Possível foco de calor no setor ${q}. Temperatura acima do entorno no sensor térmico.`,
    (q) =>
      `Região com assinatura térmica elevada no setor ${q}. Pode indicar combustão ativa ou superfície aquecida.`,
    (q) => `Variação térmica crescente no setor ${q} nos últimos segundos.`,
  ],
  fumaca: [
    (q) => `Possível fumaça no setor ${q}. Visibilidade reduzida nessa área.`,
    (q) =>
      `Coluna de fumaça provável no setor ${q}. Não é possível estimar a origem apenas pela imagem.`,
    (q) =>
      `Área com baixa visibilidade no setor ${q}, compatível com fumaça ou poeira.`,
  ],
  obstaculo: [
    (q) =>
      `Possível obstáculo no setor ${q} da rota. Verifique a altura antes de descer.`,
    (q) =>
      `Estrutura vertical detectada no setor ${q}. Mantenha distância segura.`,
  ],
};

const ROTULO_MODO: Record<ModoVoo, string> = {
  manual: "MANUAL",
  patrulha: "PATRULHA AUTOMÁTICA",
  base: "RETORNANDO À BASE",
};

/* ───────────── Utilidades ───────────── */

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

const hhmmss = (d: Date) => d.toLocaleTimeString("pt-BR");

function quadrante(x: number, y: number) {
  const v = y < 40 ? "norte" : y > 60 ? "sul" : "";
  const h = x < 40 ? "oeste" : x > 60 ? "leste" : "";
  const mapa: Record<string, string> = {
    "norte-leste": "nordeste",
    "norte-oeste": "noroeste",
    "sul-leste": "sudeste",
    "sul-oeste": "sudoeste",
  };
  if (!v && !h) return "central";
  if (v && h) return mapa[`${v}-${h}`];
  return v || h;
}

function criarDeteccao(
  id: number,
  classe: Classe,
  opts: { hora?: Date; confianca?: number; sincronizado?: boolean } = {},
): Deteccao {
  const c = CLASSES[classe];
  const jitter = () => (Math.random() - 0.5) * 6;
  const x = clamp(c.ancora.x + jitter(), 8, 92);
  const y = clamp(c.ancora.y + jitter(), 10, 90);
  const confianca = opts.confianca ?? Math.round(62 + Math.random() * 34);
  const textos = TEXTOS[classe];
  const texto = textos[Math.floor(Math.random() * textos.length)](
    quadrante(x, y),
  );
  const prioridade: Prioridade =
    classe === "pessoa"
      ? "critica"
      : classe === "calor"
        ? confianca >= 80
          ? "critica"
          : "media"
        : classe === "fumaca"
          ? "media"
          : "baixa";

  return {
    id,
    classe,
    x,
    y,
    w: c.ancora.w,
    h: c.ancora.h,
    confianca,
    prioridade,
    hora: opts.hora ?? new Date(),
    texto,
    status: "pendente",
    sincronizado: opts.sincronizado,
  };
}

function classeAleatoria(): Classe {
  const r = Math.random();
  if (r < 0.3) return "pessoa";
  if (r < 0.55) return "calor";
  if (r < 0.8) return "fumaca";
  return "obstaculo";
}

/* ───────────── Mundo simulado (usado pelo mapa E pelo vídeo) ───────────── */

const MAP_W = 800;
const MAP_H = 400;
const HOME = { x: 400, y: 200 }; // base / ponto de decolagem
const FOOT = { w: 80, h: 45 }; // área vista pela câmera, em unidades do mundo
const LAT0 = -25.4284;
const LNG0 = -49.2733;
const K = 111000; // graus → unidades (1 unidade ≈ 1 metro)
const ZOOM_MIN = 1;
const ZOOM_MAX = 5;
const V_MAX = 12; // velocidade máxima do drone (m/s)
const ORB = { rx: 72, ry: 36 }; // raio da patrulha automática

// coordenadas geográficas a partir da posição no mundo
function latLng(x: number, y: number) {
  return {
    lat: LAT0 - (y - HOME.y) / K,
    lng: LNG0 + (x - HOME.x) / K,
  };
}

// posição fixa de uma detecção no mundo
function mundoDe(d: Deteccao) {
  return {
    x: HOME.x - FOOT.w / 2 + (d.x / 100) * FOOT.w,
    y: HOME.y - FOOT.h / 2 + (d.y / 100) * FOOT.h,
  };
}

// onde essa detecção aparece no vídeo (em %), dado onde o drone está
function posNoVideo(d: Deteccao, drone: { x: number; y: number }) {
  const m = mundoDe(d);
  return {
    x: ((m.x - (drone.x - FOOT.w / 2)) / FOOT.w) * 100,
    y: ((m.y - (drone.y - FOOT.h / 2)) / FOOT.h) * 100,
  };
}

// posição fixa dos objetos de cena (ancoragens das classes)
function ancoraMundo(c: Classe) {
  const a = CLASSES[c].ancora;
  return {
    x: HOME.x - FOOT.w / 2 + (a.x / 100) * FOOT.w,
    y: HOME.y - FOOT.h / 2 + (a.y / 100) * FOOT.h,
  };
}

interface Paleta {
  fundo: string;
  rua: string;
  centro: string;
  predio: string;
  topo?: string;
  borda?: string;
  parque: string;
  arvore: string;
}

const PALETA_MAPA: Paleta = {
  fundo: "#0f1f18",
  rua: "#273244",
  centro: "#475569",
  predio: "#1b2636",
  borda: "#2a3a50",
  parque: "#143325",
  arvore: "#1a4a33",
};
const PALETA_RGB: Paleta = {
  fundo: "#27402f",
  rua: "#4b5563",
  centro: "#9ca3af",
  predio: "#6b7280",
  topo: "#94a3b8",
  parque: "#2f4d38",
  arvore: "#1f5130",
};
const PALETA_TERMICA: Paleta = {
  fundo: "#0b0820",
  rua: "#1b1740",
  centro: "#241f55",
  predio: "#2a1f5e",
  topo: "#33266f",
  parque: "#120c33",
  arvore: "#16123d",
};

const RUAS = [
  { x1: 0, y1: 130, x2: MAP_W, y2: 130, w: 16 },
  { x1: 0, y1: 260, x2: MAP_W, y2: 260, w: 16 },
  { x1: 240, y1: 0, x2: 240, y2: MAP_H, w: 16 },
  { x1: 560, y1: 0, x2: 560, y2: MAP_H, w: 16 },
  // ruas do bairro monitorado (centro do mapa)
  { x1: 252, y1: 232, x2: 548, y2: 232, w: 7 },
  { x1: 335, y1: 142, x2: 335, y2: 248, w: 6 },
  { x1: 475, y1: 142, x2: 475, y2: 248, w: 6 },
];

// Quadras gerais (todas as células, exceto a central, que é detalhada à mão)
const COLS = [
  [8, 232],
  [248, 552],
  [568, 792],
];
const ROWS = [
  [8, 122],
  [138, 252],
  [268, 392],
];
const QUADRAS: {
  x: number;
  y: number;
  w: number;
  h: number;
  verde: boolean;
}[] = [];
COLS.forEach(([x0, x1], ci) =>
  ROWS.forEach(([y0, y1], ri) => {
    if (ci === 1 && ri === 1) return;
    const w = x1 - x0;
    const h = y1 - y0;
    const seed = ci * 3 + ri;
    const cut = 0.4 + ((seed * 37) % 30) / 100;
    const parque = seed === 0 || seed === 8;
    QUADRAS.push({
      x: x0 + 4,
      y: y0 + 4,
      w: w * cut - 8,
      h: h - 8,
      verde: parque,
    });
    QUADRAS.push({
      x: x0 + w * cut + 4,
      y: y0 + 4,
      w: w * (1 - cut) - 8,
      h: (h - 8) * 0.55,
      verde: false,
    });
    QUADRAS.push({
      x: x0 + w * cut + 4,
      y: y0 + h * 0.6 + 4,
      w: w * (1 - cut) - 8,
      h: h * 0.4 - 8,
      verde: false,
    });
  }),
);

// Prédios e árvores do bairro monitorado: [x, y, largura, altura]
const PREDIOS_LOCAIS: [number, number, number, number][] = [
  [350, 160, 22, 18],
  [404, 182, 28, 20], // prédio com foco de calor
  [440, 156, 26, 16],
  [352, 205, 24, 19],
  [440, 204, 28, 20],
  [262, 150, 38, 30],
  [306, 150, 22, 26],
  [262, 190, 34, 36],
  [300, 192, 28, 32],
  [484, 150, 46, 34],
  [486, 192, 30, 32],
  [524, 192, 21, 34],
];
const ARVORES: [number, number][] = [
  [345, 154],
  [392, 162],
  [388, 226],
  [428, 214],
  [432, 163],
  [454, 196],
  [360, 190],
  [395, 176],
  [455, 185],
  [480, 240],
  [326, 240],
  [372, 236],
];

const Mundo = memo(function Mundo({
  p,
  grade,
}: {
  p: Paleta;
  grade?: boolean;
}) {
  return (
    <g>
      <rect x="0" y="0" width={MAP_W} height={MAP_H} fill={p.fundo} />

      {grade &&
        Array.from({ length: MAP_W / 40 + 1 }, (_, i) => (
          <line
            key={`gx${i}`}
            x1={i * 40}
            y1="0"
            x2={i * 40}
            y2={MAP_H}
            stroke="#1e293b"
            strokeWidth="0.4"
            opacity="0.6"
          />
        ))}
      {grade &&
        Array.from({ length: MAP_H / 40 + 1 }, (_, i) => (
          <line
            key={`gy${i}`}
            x1="0"
            y1={i * 40}
            x2={MAP_W}
            y2={i * 40}
            stroke="#1e293b"
            strokeWidth="0.4"
            opacity="0.6"
          />
        ))}

      {RUAS.map((r, i) => (
        <g key={i}>
          <line
            x1={r.x1}
            y1={r.y1}
            x2={r.x2}
            y2={r.y2}
            stroke={p.rua}
            strokeWidth={r.w}
          />
          <line
            x1={r.x1}
            y1={r.y1}
            x2={r.x2}
            y2={r.y2}
            stroke={p.centro}
            strokeWidth={r.w * 0.05}
            strokeDasharray={`${r.w * 0.4} ${r.w * 0.4}`}
          />
        </g>
      ))}

      {QUADRAS.map((q, i) => (
        <g key={i}>
          <rect
            x={q.x}
            y={q.y}
            width={q.w}
            height={q.h}
            rx="2"
            fill={q.verde ? p.parque : p.predio}
            stroke={p.borda}
            strokeWidth={p.borda ? 0.8 : 0}
          />
          {p.topo && !q.verde && (
            <rect
              x={q.x + 2}
              y={q.y + 2}
              width={q.w - 4}
              height={q.h - 4}
              fill={p.topo}
            />
          )}
        </g>
      ))}

      {PREDIOS_LOCAIS.map(([x, y, w, h], i) => (
        <g key={i}>
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            fill={p.predio}
            stroke={p.borda}
            strokeWidth={p.borda ? 0.6 : 0}
          />
          {p.topo && (
            <rect
              x={x + 1}
              y={y + 1}
              width={w - 2}
              height={h - 2}
              fill={p.topo}
            />
          )}
        </g>
      ))}

      {ARVORES.map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="3.5" fill={p.arvore} />
      ))}
    </g>
  );
});

/* ───────────── Física simples do voo ───────────── */

function passoVoo(v: Voo, dx: number, dy: number, dt: number): Voo {
  // parado e sem comando: nada a atualizar
  if (v.modo === "manual" && !dx && !dy && Math.hypot(v.vx, v.vy) < 0.01) {
    return v.vx || v.vy ? { ...v, vx: 0, vy: 0 } : v;
  }

  let alvoVx = 0;
  let alvoVy = 0;
  let modo = v.modo;
  let th = v.th;

  if (modo === "manual") {
    const len = Math.hypot(dx, dy);
    if (len > 0) {
      alvoVx = (dx / len) * V_MAX;
      alvoVy = (dy / len) * V_MAX;
    }
  } else {
    let tx: number;
    let ty: number;
    if (modo === "patrulha") {
      th += dt * 0.08;
      tx = HOME.x + ORB.rx * Math.cos(th);
      ty = HOME.y + ORB.ry * Math.sin(th);
    } else {
      tx = HOME.x;
      ty = HOME.y;
    }
    const ex = tx - v.x;
    const ey = ty - v.y;
    const dist = Math.hypot(ex, ey);

    if (modo === "base" && dist < 1 && Math.hypot(v.vx, v.vy) < 1) {
      modo = "manual"; // chegou: devolve o controle ao operador
    } else if (dist > 0) {
      const vel = Math.min(V_MAX, dist * 1.5);
      alvoVx = (ex / dist) * vel;
      alvoVy = (ey / dist) * vel;
    }
  }

  // aceleração suave (inércia)
  const a = Math.min(1, dt * 4);
  const vx = v.vx + (alvoVx - v.vx) * a;
  const vy = v.vy + (alvoVy - v.vy) * a;

  return {
    x: clamp(v.x + vx * dt, FOOT.w / 2, MAP_W - FOOT.w / 2),
    y: clamp(v.y + vy * dt, FOOT.h / 2, MAP_H - FOOT.h / 2),
    vx,
    vy,
    th,
    modo,
  };
}

/* ───────────── Vídeo: visão aérea recortada na posição do drone ───────────── */

function Cena({
  modo,
  congelado,
  drone,
}: {
  modo: Modo;
  congelado: boolean;
  drone: { x: number; y: number };
}) {
  const t = modo === "termico";
  const p = t ? PALETA_TERMICA : PALETA_RGB;
  const calor = ancoraMundo("calor");
  const fumaca = ancoraMundo("fumaca");
  const pessoa = ancoraMundo("pessoa");
  const antena = ancoraMundo("obstaculo");

  return (
    <svg
      viewBox={`0 0 ${FOOT.w} ${FOOT.h}`}
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 h-full w-full"
      style={{
        filter: congelado ? "grayscale(1) brightness(0.55)" : undefined,
      }}
    >
      <defs>
        <radialGradient id="heat">
          <stop offset="0%" stopColor="#fff7ae" />
          <stop offset="35%" stopColor="#fb923c" />
          <stop offset="100%" stopColor="#7c2d12" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="smoke">
          <stop offset="0%" stopColor="#d1d5db" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#d1d5db" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="body">
          <stop offset="0%" stopColor="#fef3c7" />
          <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* o mundo inteiro desliza conforme o drone se move */}
      <g
        style={{
          transform: `translate(${FOOT.w / 2 - drone.x}px, ${FOOT.h / 2 - drone.y}px)`,
        }}
      >
        <Mundo p={p} />

        {/* obstáculo (antena) */}
        <rect
          x={antena.x - 0.9}
          y={antena.y - 3}
          width="1.8"
          height="6"
          fill={t ? "#3a2c80" : "#9ca3af"}
        />
        <rect
          x={antena.x - 2}
          y={antena.y - 3.5}
          width="4"
          height="0.8"
          fill={t ? "#3a2c80" : "#d1d5db"}
        />

        {/* foco de calor */}
        <circle
          cx={calor.x}
          cy={calor.y}
          r={t ? 8.5 : 3.5}
          fill="url(#heat)"
          opacity={t ? 1 : 0.6}
        />

        {/* fumaça */}
        <ellipse
          cx={fumaca.x}
          cy={fumaca.y - 6}
          rx="9.5"
          ry="4.5"
          fill="url(#smoke)"
          opacity={t ? 0.1 : 0.85}
        />

        {/* pessoa */}
        <circle cx={pessoa.x} cy={pessoa.y} r={t ? 2.5 : 0} fill="url(#body)" />
        <ellipse
          cx={pessoa.x}
          cy={pessoa.y + 0.5}
          rx="0.7"
          ry="1.3"
          fill={t ? "#fde68a" : "#fca5a5"}
        />
        <circle
          cx={pessoa.x}
          cy={pessoa.y - 1.2}
          r="0.55"
          fill={t ? "#fef3c7" : "#fecaca"}
        />
      </g>
    </svg>
  );
}

/* ───────────── Mapa tático (simulado) ───────────── */

function ajustarCam(cx: number, cy: number, z: number) {
  const zz = clamp(z, ZOOM_MIN, ZOOM_MAX);
  const w = MAP_W / zz;
  const h = MAP_H / zz;
  return {
    z: zz,
    cx: clamp(cx, w / 2, MAP_W - w / 2),
    cy: clamp(cy, h / 2, MAP_H - h / 2),
  };
}

function MapaTatico({
  drone,
  online,
  deteccoes,
  selecionada,
  onSelecionar,
}: {
  drone: { x: number; y: number };
  online: boolean;
  deteccoes: Deteccao[];
  selecionada: number | null;
  onSelecionar: (id: number) => void;
}) {
  const [cam, setCam] = useState({
    ...ajustarCam(HOME.x, HOME.y, 2.5),
    seguir: true,
  });

  // guarda a posição mais recente do drone para o loop de teclado
  const droneRef = useRef(drone);
  useEffect(() => {
    droneRef.current = drone;
  });

  /* Teclado: setas movem o mapa, J aproxima, K afasta */
  useEffect(() => {
    const teclas = new Set<string>();

    const down = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const alvo = e.target as HTMLElement | null;
      if (alvo && (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA"))
        return;
      const k = e.key.toLowerCase();
      if (
        ["arrowup", "arrowdown", "arrowleft", "arrowright", "j", "k"].includes(
          k,
        )
      ) {
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

      const dx =
        (teclas.has("arrowright") ? 1 : 0) - (teclas.has("arrowleft") ? 1 : 0);
      const dy =
        (teclas.has("arrowdown") ? 1 : 0) - (teclas.has("arrowup") ? 1 : 0);
      const dz = (teclas.has("j") ? 1 : 0) - (teclas.has("k") ? 1 : 0);

      if (dx || dy || dz) {
        const d = droneRef.current;
        setCam((c) => {
          const mexeu = dx !== 0 || dy !== 0;
          const baseX = c.seguir ? d.x : c.cx;
          const baseY = c.seguir ? d.y : c.cy;
          const v = (240 / c.z) * dt;
          return {
            ...ajustarCam(
              mexeu ? baseX + dx * v : c.cx,
              mexeu ? baseY + dy * v : c.cy,
              c.z * Math.exp(dz * dt * 1.1),
            ),
            seguir: mexeu ? false : c.seguir,
          };
        });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", limpar);
    };
  }, []);

  // câmera efetiva: segue o drone ou fica onde o operador deixou
  const vista = cam.seguir ? ajustarCam(drone.x, drone.y, cam.z) : cam;
  const vw = MAP_W / vista.z;
  const vh = MAP_H / vista.z;
  const vx = vista.cx - vw / 2;
  const vy = vista.cy - vh / 2;
  const esc = 1 / vista.z; // mantém ícones com tamanho constante na tela
  const corDrone = online ? "#38bdf8" : "#64748b";

  const kbd =
    "rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-200";
  const botao =
    "flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-black/60 text-slate-200 backdrop-blur transition hover:bg-white/10";

  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <MapPin className="h-4 w-4 text-sky-400" /> Mapa tático
          <span className="text-xs font-normal text-slate-500">
            esquemático · simulado
          </span>
        </h3>
        <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
          <span className="flex gap-1">
            <kbd className={kbd}>←</kbd>
            <kbd className={kbd}>↑</kbd>
            <kbd className={kbd}>↓</kbd>
            <kbd className={kbd}>→</kbd>
          </span>
          mover mapa ·<kbd className={kbd}>J</kbd> aproximar ·
          <kbd className={kbd}>K</kbd> afastar
        </p>
      </div>

      <div className="relative h-72 bg-[#0f1f18] lg:h-80">
        <svg
          viewBox={`${vx} ${vy} ${vw} ${vh}`}
          preserveAspectRatio="xMidYMid slice"
          className="absolute inset-0 h-full w-full"
        >
          <Mundo p={PALETA_MAPA} grade />

          {/* área vista pela câmera */}
          <g style={{ transform: `translate(${drone.x}px, ${drone.y}px)` }}>
            <rect
              x={-FOOT.w / 2}
              y={-FOOT.h / 2}
              width={FOOT.w}
              height={FOOT.h}
              fill={corDrone}
              fillOpacity="0.1"
              stroke={corDrone}
              strokeWidth="1.2"
              strokeDasharray="5 4"
              vectorEffect="non-scaling-stroke"
            />
          </g>

          {/* detecções */}
          {deteccoes.map((d) => {
            const c = CLASSES[d.classe];
            const m = mundoDe(d);
            const ativa = selecionada === d.id;
            return (
              <g
                key={d.id}
                onClick={() => onSelecionar(d.id)}
                style={{
                  transform: `translate(${m.x}px, ${m.y}px)`,
                  transition: "transform 1s linear",
                  cursor: "pointer",
                }}
              >
                <g transform={`scale(${esc})`}>
                  <circle
                    r={d.classe === "calor" ? 16 : 11}
                    fill={c.cor}
                    fillOpacity="0.18"
                  />
                  <circle
                    r="5"
                    fill={c.cor}
                    stroke="#0f172a"
                    strokeWidth="1.5"
                  />
                  {ativa && (
                    <>
                      <circle
                        r="10"
                        fill="none"
                        stroke="#fff"
                        strokeWidth="1.5"
                      />
                      <text
                        x="14"
                        y="-12"
                        fontSize="11"
                        fontWeight="600"
                        fill="#fff"
                        stroke="#0f172a"
                        strokeWidth="3"
                        paintOrder="stroke"
                      >
                        {c.label} {d.confianca}%
                      </text>
                    </>
                  )}
                </g>
              </g>
            );
          })}

          {/* drone */}
          <g style={{ transform: `translate(${drone.x}px, ${drone.y}px)` }}>
            <g transform={`scale(${esc})`}>
              {online && (
                <circle r="8" fill="none" stroke="#38bdf8" strokeWidth="1.5">
                  <animate
                    attributeName="r"
                    values="8;20"
                    dur="1.8s"
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="opacity"
                    values="0.8;0"
                    dur="1.8s"
                    repeatCount="indefinite"
                  />
                </circle>
              )}
              <path
                d="M-9 -9 L9 9 M9 -9 L-9 9"
                stroke={corDrone}
                strokeWidth="2"
                strokeLinecap="round"
              />
              {[
                [-9, -9],
                [9, -9],
                [-9, 9],
                [9, 9],
              ].map(([cx, cy], i) => (
                <circle
                  key={i}
                  cx={cx}
                  cy={cy}
                  r="3.5"
                  fill="#0f172a"
                  stroke={corDrone}
                  strokeWidth="1.5"
                />
              ))}
              <circle r="4.5" fill={corDrone} stroke="#fff" strokeWidth="1.2" />
              <text
                x="14"
                y="18"
                fontSize="10"
                fontWeight="600"
                fill="#e2e8f0"
                stroke="#0f172a"
                strokeWidth="3"
                paintOrder="stroke"
              >
                DR-01{online ? "" : " · última posição"}
              </text>
            </g>
          </g>
        </svg>

        {/* sobreposições */}
        <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-md bg-black/60 px-2 py-1 font-mono text-[11px] text-slate-200 backdrop-blur">
          zoom {vista.z.toFixed(1)}x
          {cam.seguir && <span className="text-sky-300">· seguindo drone</span>}
        </div>

        <div className="absolute right-3 top-3 flex flex-col gap-1.5">
          <button
            aria-label="Aproximar"
            title="Aproximar (J)"
            onClick={() =>
              setCam((c) => ({ ...c, ...ajustarCam(c.cx, c.cy, c.z * 1.25) }))
            }
            className={botao}
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            aria-label="Afastar"
            title="Afastar (K)"
            onClick={() =>
              setCam((c) => ({ ...c, ...ajustarCam(c.cx, c.cy, c.z / 1.25) }))
            }
            className={botao}
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            aria-label="Seguir o drone"
            title="Seguir o drone"
            onClick={() => setCam((c) => ({ ...c, seguir: true }))}
            className={`${botao} ${cam.seguir ? "!border-sky-400/60 !bg-sky-500/30 text-sky-200" : ""}`}
          >
            <LocateFixed className="h-4 w-4" />
          </button>
        </div>

        <div className="pointer-events-none absolute bottom-3 right-3 flex flex-col items-center text-[10px] font-semibold text-slate-300">
          N
          <span className="block h-4 w-px bg-slate-300" />
        </div>
      </div>

      {/* legenda */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-800 px-3 py-2 text-[11px] text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-sky-400 ring-2 ring-sky-400/30" />
          Drone
        </span>
        {(Object.keys(CLASSES) as Classe[]).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: CLASSES[k].cor }}
            />
            {CLASSES[k].label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-3.5 rounded-sm border border-dashed border-sky-400" />
          Área da câmera
        </span>
      </div>
    </div>
  );
}

/* ───────────── Sessão (localStorage) ───────────── */

const SESSAO_KEY = "diapb_sessao";

function assinar(cb: () => void) {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
}

function lerSessao() {
  try {
    return localStorage.getItem(SESSAO_KEY);
  } catch {
    return null;
  }
}

const DRONE_KEY = "diapb_drone";

function lerDrone() {
  try {
    return localStorage.getItem(DRONE_KEY);
  } catch {
    return null;
  }
}

/* ───────────── Página: verifica o login e renderiza o painel ───────────── */

export default function DronePage() {
  const router = useRouter();
  const sessao = useSyncExternalStore(assinar, lerSessao, () => null);
  const selecao = useSyncExternalStore(assinar, lerDrone, () => null);

  useEffect(() => {
    if (!lerSessao()) router.replace("/login");
    else if (!lerDrone()) router.replace("/drones");
  }, [router]);

  if (!sessao || !selecao) return <div className="min-h-screen bg-slate-950" />;

  let cpf = "";
  try {
    cpf = JSON.parse(sessao).cpf ?? "";
  } catch {}

  let droneId = "DR-01";
  let droneTipo = "";
  try {
    const s = JSON.parse(selecao);
    droneId = s.id ?? droneId;
    droneTipo = s.tipo ?? "";
  } catch {}

  return <Painel cpf={cpf} droneId={droneId} droneTipo={droneTipo} />;
}

/* ───────────── Painel do drone ───────────── */

function Painel({
  cpf,
  droneId,
  droneTipo,
}: {
  cpf: string;
  droneId: string;
  droneTipo: string;
}) {
  const router = useRouter();

  const [agora, setAgora] = useState<Date>(() => new Date());

  const [modo, setModo] = useState<Modo>("rgb");
  const [conexao, setConexao] = useState<Conexao>("online");
  const [semDados, setSemDados] = useState(0);
  const [pendentesBuffer, setPendentesBuffer] = useState(0);

  // estado de voo: posição, velocidade e modo de pilotagem
  const [voo, setVoo] = useState<Voo>({
    x: HOME.x,
    y: HOME.y,
    vx: 0,
    vy: 0,
    th: 0,
    modo: "manual",
  });
  const [pressionadas, setPressionadas] = useState<string[]>([]);

  const [telem, setTelem] = useState({
    bateria: 87,
    altitude: 42,
    latencia: 142,
  });

  const [deteccoes, setDeteccoes] = useState<Deteccao[]>(() => {
    const base = Date.now();
    return [
      criarDeteccao(4, "obstaculo", {
        hora: new Date(base - 1000),
        confianca: 73,
      }),
      criarDeteccao(3, "pessoa", {
        hora: new Date(base - 4000),
        confianca: 84,
      }),
      criarDeteccao(2, "calor", { hora: new Date(base - 9000), confianca: 91 }),
      criarDeteccao(1, "fumaca", {
        hora: new Date(base - 14000),
        confianca: 78,
      }),
    ];
  });
  const [selecionada, setSelecionada] = useState<number | null>(null);
  const [filtro, setFiltro] = useState<"todos" | "pendentes">("todos");

  const proxId = useRef(100);
  const contador = useRef(0);
  const teclas = useRef(new Set<string>());
  const syncTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Limpa o timeout de sincronização ao sair da página */
  useEffect(() => {
    return () => {
      if (syncTimeout.current) clearTimeout(syncTimeout.current);
    };
  }, []);

  /* Teclado: W A S D pilotam o drone */
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const alvo = e.target as HTMLElement | null;
      if (alvo && (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA"))
        return;
      const k = e.key.toLowerCase();
      if (!["w", "a", "s", "d"].includes(k)) return;
      teclas.current.add(k);
      setPressionadas(Array.from(teclas.current));
      // qualquer comando do operador retoma o controle manual
      setVoo((v) => (v.modo === "manual" ? v : { ...v, modo: "manual" }));
    };
    const up = (e: KeyboardEvent) => {
      teclas.current.delete(e.key.toLowerCase());
      setPressionadas(Array.from(teclas.current));
    };
    const limpar = () => {
      teclas.current.clear();
      setPressionadas([]);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", limpar);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", limpar);
    };
  }, []);

  /* Loop de voo (~30 quadros/s). Sem conexão, o drone mantém a posição. */
  useEffect(() => {
    if (conexao !== "online") return;
    let raf = 0;
    let ultimo = performance.now();
    let acc = 0;
    const loop = (agoraMs: number) => {
      acc += Math.min(0.1, (agoraMs - ultimo) / 1000);
      ultimo = agoraMs;
      if (acc >= 1 / 30) {
        const passo = acc;
        acc = 0;
        const t = teclas.current;
        const dx = (t.has("d") ? 1 : 0) - (t.has("a") ? 1 : 0);
        const dy = (t.has("s") ? 1 : 0) - (t.has("w") ? 1 : 0);
        setVoo((v) => passoVoo(v, dx, dy, passo));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [conexao]);

  /* Relógio / telemetria / IA simuladas (1 Hz) */
  useEffect(() => {
    const id = setInterval(() => {
      contador.current += 1;
      const n = contador.current;
      setAgora(new Date());

      if (conexao === "online") {
        setTelem((t) => ({
          bateria: Math.max(0, t.bateria - 0.04),
          altitude: 42 + Math.sin(n / 5) * 2.5,
          latencia: Math.round(110 + Math.random() * 80),
        }));

        // as detecções oscilam levemente em torno do alvo
        setDeteccoes((prev) =>
          prev.map((d) => {
            const a = CLASSES[d.classe].ancora;
            return {
              ...d,
              x: clamp(
                d.x + (a.x - d.x) * 0.08 + (Math.random() - 0.5) * 0.9,
                8,
                92,
              ),
              y: clamp(
                d.y + (a.y - d.y) * 0.08 + (Math.random() - 0.5) * 0.9,
                10,
                90,
              ),
            };
          }),
        );

        if (n % 7 === 0) {
          const nova = criarDeteccao(proxId.current++, classeAleatoria());
          setDeteccoes((prev) => [nova, ...prev].slice(0, 30));
        }
      } else if (conexao === "perdida") {
        setSemDados((s) => s + 1);
        if (n % 7 === 0) setPendentesBuffer((p) => p + 1);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [conexao]);

  /* Ações */
  function sair() {
    try {
      localStorage.removeItem(SESSAO_KEY);
    } catch {}
    router.push("/login");
  }

  function trocarDrone() {
    try {
      localStorage.removeItem(DRONE_KEY);
    } catch {}
    router.push("/drones");
  }

  function simularQueda() {
    setSemDados(0);
    setPendentesBuffer(0);
    setConexao("perdida");
  }

  function restaurar() {
    const qtd = Math.min(Math.max(pendentesBuffer, 1), 3);
    setConexao("sincronizando");
    syncTimeout.current = setTimeout(() => {
      const recuperadas = Array.from({ length: qtd }, () =>
        criarDeteccao(proxId.current++, classeAleatoria(), {
          sincronizado: true,
        }),
      );
      setDeteccoes((prev) => [...recuperadas, ...prev].slice(0, 30));
      setPendentesBuffer(0);
      setSemDados(0);
      setConexao("online");
    }, 3000);
  }

  function definirModoVoo(m: ModoVoo) {
    setVoo((v) => ({
      ...v,
      modo: m,
      // a patrulha parte do ponto da órbita mais próximo do drone
      th: Math.atan2((v.y - HOME.y) / ORB.ry, (v.x - HOME.x) / ORB.rx),
    }));
  }

  function apertar(k: string) {
    teclas.current.add(k);
    setPressionadas(Array.from(teclas.current));
    setVoo((v) => (v.modo === "manual" ? v : { ...v, modo: "manual" }));
  }

  function soltar(k: string) {
    teclas.current.delete(k);
    setPressionadas(Array.from(teclas.current));
  }

  function definirStatus(id: number, status: Status) {
    setDeteccoes((prev) =>
      prev.map((d) => (d.id === id ? { ...d, status } : d)),
    );
  }

  function selecionar(id: number) {
    setSelecionada(id);
    document
      .getElementById(`det-${id}`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  const online = conexao === "online";
  const drone = { x: voo.x, y: voo.y };
  const { lat, lng } = latLng(voo.x, voo.y);
  const velocidade = Math.hypot(voo.vx, voo.vy);
  const qtdPendentes = deteccoes.filter((d) => d.status === "pendente").length;
  const naoDescartadas = deteccoes.filter((d) => d.status !== "descartado");
  const marcadores = naoDescartadas.slice(0, 8);

  // só aparecem no vídeo as detecções que estão dentro da área da câmera
  const caixas = naoDescartadas
    .map((d) => ({ d, p: posNoVideo(d, drone) }))
    .filter(({ p }) => p.x > -10 && p.x < 110 && p.y > -10 && p.y < 110)
    .slice(0, 5);

  const lista =
    filtro === "pendentes"
      ? deteccoes.filter((d) => d.status === "pendente")
      : deteccoes;

  const cpfMascarado = cpf
    ? `${cpf.slice(0, 3)}.***.***-${cpf.slice(-2)}`
    : "—";

  const banner = {
    online: {
      cor: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
      Icon: Wifi,
      texto: `Conectado · latência ${telem.latencia} ms · dados em tempo real`,
    },
    perdida: {
      cor: "border-red-500/40 bg-red-500/10 text-red-300",
      Icon: WifiOff,
      texto: `Conexão perdida há ${semDados}s. Drone mantendo posição. Registros no buffer local: ${pendentesBuffer}.`,
    },
    sincronizando: {
      cor: "border-amber-500/40 bg-amber-500/10 text-amber-300",
      Icon: Loader2,
      texto: "Reconectado. Sincronizando registros do buffer local...",
    },
  }[conexao];

  const tecla = (k: string, rotulo: string) => (
    <button
      key={k}
      disabled={!online}
      aria-label={`Mover ${rotulo}`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        apertar(k);
      }}
      onPointerUp={() => soltar(k)}
      onPointerCancel={() => soltar(k)}
      className={`h-10 w-10 touch-none select-none rounded-lg border font-mono text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
        pressionadas.includes(k)
          ? "border-sky-400 bg-sky-500 text-slate-950"
          : "border-slate-600 bg-slate-800 text-slate-200 hover:border-slate-500"
      }`}
    >
      {k.toUpperCase()}
    </button>
  );

  const MODOS: { id: ModoVoo; rotulo: string; Icon: LucideIcon }[] = [
    { id: "manual", rotulo: "Manual", Icon: Gamepad2 },
    { id: "patrulha", rotulo: "Patrulha", Icon: Repeat },
    { id: "base", rotulo: "Retornar à base", Icon: Undo2 },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100 lg:h-screen">
      {/* ───── Cabeçalho ───── */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/70 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-sky-400/30 bg-sky-500/10">
            <Drone className="h-5 w-5 text-sky-400" />
          </div>
          <div className="leading-tight">
            <p className="font-semibold tracking-tight">DIAPB</p>
            <p className="text-xs text-slate-400">
              Missão #0147 · {droneId}
              {droneTipo ? ` · ${droneTipo}` : ""}
            </p>
          </div>
          <span className="ml-2 rounded-full border border-violet-400/30 bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-300">
            Simulado
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="hidden text-slate-400 sm:inline">
            Operador{" "}
            <span className="font-mono text-slate-200">{cpfMascarado}</span>
          </span>
          <button
            onClick={sair}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-slate-300 transition hover:border-slate-500 hover:text-white"
          >
            <LogOut className="h-4 w-4" /> Sair
          </button>
          <button
            onClick={trocarDrone}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-slate-300 transition hover:border-slate-500 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" /> Trocar drone
          </button>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_390px]">
        {/* ───── Coluna principal: visão do drone ───── */}
        <section className="min-h-0 space-y-4 overflow-y-auto p-4">
          {/* Faixa de conexão */}
          <div
            className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${banner.cor}`}
          >
            <span className="flex items-center gap-2">
              <banner.Icon
                className={`h-4 w-4 shrink-0 ${
                  conexao === "sincronizando" ? "animate-spin" : ""
                }`}
              />
              {banner.texto}
            </span>
            {online && (
              <button
                onClick={simularQueda}
                className="rounded-md border border-emerald-400/20 px-2.5 py-1 text-xs text-emerald-200/80 transition hover:bg-emerald-400/10"
              >
                Simular queda de conexão
              </button>
            )}
            {conexao === "perdida" && (
              <button
                onClick={restaurar}
                className="rounded-md bg-red-500/20 px-2.5 py-1 text-xs font-medium text-red-100 transition hover:bg-red-500/30"
              >
                Restaurar conexão
              </button>
            )}
          </div>

          {/* Vídeo */}
          <div
            className="relative mx-auto aspect-video w-full overflow-hidden rounded-xl border border-slate-800 bg-black"
            style={{ maxWidth: "calc(62vh * 16 / 9)" }}
          >
            <Cena modo={modo} congelado={!online} drone={drone} />

            {/* scanlines + vinheta */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-30"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(0deg, rgba(0,0,0,.35) 0 1px, transparent 1px 3px)",
              }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,.55) 100%)",
              }}
            />
            {/* mira central */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
            >
              <div className="relative h-8 w-8 opacity-60">
                <span className="absolute left-1/2 top-0 h-2 w-px bg-white" />
                <span className="absolute bottom-0 left-1/2 h-2 w-px bg-white" />
                <span className="absolute left-0 top-1/2 h-px w-2 bg-white" />
                <span className="absolute right-0 top-1/2 h-px w-2 bg-white" />
              </div>
            </div>

            {/* Caixas de detecção (acompanham o terreno) */}
            {caixas.map(({ d, p }) => {
              const c = CLASSES[d.classe];
              const ativa = selecionada === d.id;
              return (
                <button
                  key={d.id}
                  onClick={() => selecionar(d.id)}
                  aria-label={`${c.label}, confiança ${d.confianca}%`}
                  className="absolute cursor-pointer"
                  style={{
                    left: `${p.x - d.w / 2}%`,
                    top: `${p.y - d.h / 2}%`,
                    width: `${d.w}%`,
                    height: `${d.h}%`,
                    border: `${ativa ? 3 : 2}px solid ${c.cor}`,
                    borderRadius: 4,
                    boxShadow: ativa
                      ? `0 0 0 2px #fff, 0 0 18px ${c.cor}`
                      : undefined,
                    opacity: online ? 1 : 0.6,
                  }}
                >
                  <span
                    className="absolute -top-5 left-[-2px] whitespace-nowrap rounded-sm px-1.5 py-0.5 text-[10px] font-semibold leading-none text-slate-950"
                    style={{ background: c.cor }}
                  >
                    {c.label} {d.confianca}%
                  </span>
                </button>
              );
            })}

            {/* HUD superior */}
            <div className="absolute left-3 top-3 flex items-center gap-2 rounded-md bg-black/55 px-2 py-1 text-xs font-medium backdrop-blur">
              <span
                className={`h-2 w-2 rounded-full ${
                  online ? "animate-pulse bg-red-500" : "bg-slate-500"
                }`}
              />
              {online ? "AO VIVO" : "SEM SINAL"}
            </div>

            <div className="absolute right-3 top-3 flex overflow-hidden rounded-md border border-white/10 bg-black/55 text-xs backdrop-blur">
              <button
                onClick={() => setModo("rgb")}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 transition ${
                  modo === "rgb"
                    ? "bg-sky-500 text-slate-950"
                    : "text-slate-300 hover:bg-white/10"
                }`}
              >
                <Camera className="h-3.5 w-3.5" /> RGB
              </button>
              <button
                onClick={() => setModo("termico")}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 transition ${
                  modo === "termico"
                    ? "bg-orange-400 text-slate-950"
                    : "text-slate-300 hover:bg-white/10"
                }`}
              >
                <Thermometer className="h-3.5 w-3.5" /> Térmico
              </button>
            </div>

            {/* HUD inferior */}
            <div className="absolute bottom-3 left-3 rounded-md bg-black/55 px-2 py-1 font-mono text-[11px] text-slate-200 backdrop-blur">
              {hhmmss(agora)} · {lat.toFixed(5)}, {lng.toFixed(5)}
            </div>
            <div className="absolute bottom-3 right-3 rounded-md bg-black/55 px-2 py-1 text-[11px] font-semibold tracking-wide text-sky-300 backdrop-blur">
              {ROTULO_MODO[voo.modo]}
            </div>

            {!online && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                <span className="rounded-lg border border-red-500/40 bg-black/70 px-4 py-2 text-sm font-medium text-red-300">
                  {conexao === "perdida"
                    ? "Sinal perdido · imagem congelada"
                    : "Sincronizando..."}
                </span>
              </div>
            )}
          </div>

          {/* Controle do drone */}
          <div
            className="mx-auto w-full rounded-xl border border-slate-800 bg-slate-900/60 p-3"
            style={{ maxWidth: "calc(62vh * 16 / 9)" }}
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-[14rem] flex-1">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <Gamepad2 className="h-4 w-4 text-sky-400" /> Controle do
                  drone
                </h3>
                <div className="flex gap-1 rounded-lg bg-slate-950 p-1 text-xs">
                  {MODOS.map(({ id, rotulo, Icon }) => (
                    <button
                      key={id}
                      disabled={!online}
                      onClick={() => definirModoVoo(id)}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 transition disabled:cursor-not-allowed disabled:opacity-40 ${
                        voo.modo === id
                          ? "bg-sky-500 font-medium text-slate-950"
                          : "text-slate-300 hover:bg-slate-800"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" /> {rotulo}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  {online
                    ? "Pilote com W A S D (ou segure os botões ao lado). Qualquer comando retoma o controle manual."
                    : "Comandos indisponíveis sem conexão. O drone mantém a posição até o link voltar."}
                </p>
              </div>

              {/* Teclas W A S D */}
              <div className="flex flex-col items-center gap-1">
                {tecla("w", "para o norte")}
                <div className="flex gap-1">
                  {tecla("a", "para o oeste")}
                  {tecla("s", "para o sul")}
                  {tecla("d", "para o leste")}
                </div>
              </div>

              <div className="min-w-[8rem] space-y-1 font-mono text-xs text-slate-400">
                <p>
                  Velocidade{" "}
                  <span className="text-slate-100">
                    {velocidade.toFixed(1)} m/s
                  </span>
                </p>
                <p>
                  Posição{" "}
                  <span className="text-slate-100">
                    {voo.x.toFixed(0)}, {voo.y.toFixed(0)} m
                  </span>
                </p>
                <p>
                  Base{" "}
                  <span className="text-slate-100">
                    {Math.hypot(voo.x - HOME.x, voo.y - HOME.y).toFixed(0)} m
                  </span>
                </p>
              </div>
            </div>
          </div>

          {/* Mapa tático */}
          <div
            className="mx-auto w-full"
            style={{ maxWidth: "calc(62vh * 16 / 9)" }}
          >
            <MapaTatico
              drone={drone}
              online={online}
              deteccoes={marcadores}
              selecionada={selecionada}
              onSelecionar={selecionar}
            />
          </div>

          {/* Telemetria */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {[
              {
                Icon: Battery,
                label: "Bateria",
                valor: `${telem.bateria.toFixed(0)}%`,
                alerta: telem.bateria < 20,
              },
              {
                Icon: Mountain,
                label: "Altitude",
                valor: `${telem.altitude.toFixed(1)} m`,
              },
              {
                Icon: Gauge,
                label: "Velocidade",
                valor: `${velocidade.toFixed(1)} m/s`,
              },
              {
                Icon: MapPin,
                label: "Coordenadas",
                valor: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
                pequeno: true,
              },
              {
                Icon: Radio,
                label: "Latência",
                valor: online ? `${telem.latencia} ms` : "—",
              },
              {
                Icon: Clock,
                label: "Último dado",
                valor: online ? hhmmss(agora) : `há ${semDados}s`,
              },
            ].map(({ Icon, label, valor, alerta, pequeno }) => (
              <div
                key={label}
                className={`rounded-lg border bg-slate-900/60 p-3 ${
                  alerta ? "border-red-500/40" : "border-slate-800"
                } ${online ? "" : "opacity-50"}`}
              >
                <div className="mb-1 flex items-center gap-1.5 text-xs text-slate-400">
                  <Icon
                    className={`h-3.5 w-3.5 ${alerta ? "text-red-400" : ""}`}
                  />
                  {label}
                </div>
                <p
                  className={`font-mono font-medium ${
                    pequeno ? "text-xs" : "text-lg"
                  } ${alerta ? "text-red-300" : "text-slate-100"}`}
                >
                  {valor}
                </p>
              </div>
            ))}
          </div>
          {!online && (
            <p className="text-xs text-slate-500">
              Telemetria desatualizada: os valores acima são do último pacote
              recebido.
            </p>
          )}
        </section>

        {/* ───── Painel lateral: comentários da IA ───── */}
        <aside className="flex h-[34rem] min-h-0 flex-col border-t border-slate-800 bg-slate-900/40 lg:h-auto lg:border-l lg:border-t-0">
          <div className="space-y-3 border-b border-slate-800 p-4">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-medium">
                <Bot className="h-5 w-5 text-sky-400" /> Análise da IA
              </h2>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  qtdPendentes > 0
                    ? "bg-amber-500/15 text-amber-300"
                    : "bg-slate-800 text-slate-400"
                }`}
              >
                {qtdPendentes} pendente{qtdPendentes === 1 ? "" : "s"}
              </span>
            </div>

            <p className="flex gap-2 rounded-lg border border-sky-500/20 bg-sky-500/5 p-2.5 text-xs leading-relaxed text-sky-200/90">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Indicações automatizadas, não confirmações. A decisão final é do
              profissional responsável.
            </p>

            <div className="flex gap-1 rounded-lg bg-slate-950 p-1 text-xs">
              {(["todos", "pendentes"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFiltro(f)}
                  className={`flex-1 rounded-md py-1.5 capitalize transition ${
                    filtro === f
                      ? "bg-slate-800 text-white"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          <ul className="flex-1 space-y-3 overflow-y-auto p-4">
            {lista.length === 0 && (
              <li className="py-10 text-center text-sm text-slate-500">
                Nenhuma indicação pendente.
              </li>
            )}

            {lista.map((d) => {
              const c = CLASSES[d.classe];
              const p = PRIORIDADES[d.prioridade];
              const ativa = selecionada === d.id;
              return (
                <li
                  key={d.id}
                  id={`det-${d.id}`}
                  onClick={() => setSelecionada(d.id)}
                  className={`cursor-pointer rounded-xl border p-3 transition ${
                    ativa
                      ? "border-sky-400/60 bg-slate-800/80"
                      : "border-slate-800 bg-slate-900/70 hover:border-slate-700"
                  } ${d.status === "descartado" ? "opacity-50" : ""}`}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="flex h-7 w-7 items-center justify-center rounded-full"
                        style={{ background: `${c.cor}22`, color: c.cor }}
                      >
                        <c.Icon className="h-4 w-4" />
                      </span>
                      <span className="text-sm font-medium">{c.label}</span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${p.classe}`}
                      >
                        {p.label}
                      </span>
                    </div>
                    <span className="font-mono text-[11px] text-slate-400">
                      {hhmmss(d.hora)}
                    </span>
                  </div>

                  <p className="mb-3 text-sm leading-relaxed text-slate-300">
                    {d.texto}
                  </p>

                  <div className="mb-2">
                    <div className="mb-1 flex items-center justify-between text-[11px] text-slate-400">
                      <span>Confiança</span>
                      <span className="font-mono text-slate-200">
                        {d.confianca}%
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${d.confianca}%`, background: c.cor }}
                      />
                    </div>
                    {d.confianca < 70 && (
                      <p className="mt-1 text-[11px] text-amber-300/90">
                        Confiança baixa: verifique com atenção.
                      </p>
                    )}
                  </div>

                  <p className="mb-3 text-[11px] text-slate-500">
                    {c.fonte} · {MODELO_IA}
                    {d.sincronizado && (
                      <span className="ml-1.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-300">
                        sincronizado do buffer
                      </span>
                    )}
                  </p>

                  {d.status === "pendente" ? (
                    <div className="flex gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          definirStatus(d.id, "confirmado");
                        }}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-500/15 py-1.5 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/25"
                      >
                        <Check className="h-3.5 w-3.5" /> Confirmar
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          definirStatus(d.id, "descartado");
                        }}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-slate-800 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-slate-700"
                      >
                        <X className="h-3.5 w-3.5" /> Descartar
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between text-xs">
                      <span
                        className={
                          d.status === "confirmado"
                            ? "text-emerald-300"
                            : "text-slate-400"
                        }
                      >
                        {d.status === "confirmado"
                          ? "Confirmado pelo operador"
                          : "Descartado pelo operador"}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          definirStatus(d.id, "pendente");
                        }}
                        className="text-sky-300 hover:underline"
                      >
                        Desfazer
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </aside>
      </main>
    </div>
  );
}
