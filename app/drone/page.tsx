"use client";

import { memo, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeft,
  Battery,
  Bot,
  Camera,
  Car,
  Check,
  Clock,
  Construction,
  Crosshair,
  Drone,
  Eye,
  EyeOff,
  Flame,
  Gamepad2,
  Gauge,
  Gavel,
  HeartPulse,
  Info,
  Loader2,
  LocateFixed,
  LogOut,
  MapPin,
  Mountain,
  Plus,
  Radio,
  Repeat,
  ShieldAlert,
  Siren,
  Thermometer,
  Trash2,
  Undo2,
  User,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  Wind,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

/* ───────────── Tipos ───────────── */

type TipoEntidade = "pessoa" | "veiculo" | "armado" | "mandado" | "ferido";
type Classe = "fumaca" | "calor" | "obstaculo" | TipoEntidade;
type Prioridade = "critica" | "media" | "baixa";
type Status = "pendente" | "confirmado" | "descartado";
type Conexao = "online" | "perdida" | "sincronizando";
type Modo = "rgb" | "termico";
type ModoVoo = "manual" | "patrulha" | "base" | "seguir";

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
  entidadeId?: number; // entidade em movimento acompanhada por esta detecção
  setor?: string;
  ref?: string; // referência simulada (alvo com mandado)
}

interface Entidade {
  id: number;
  tipo: TipoEntidade;
  rua: number; // índice em RUAS
  dir: 1 | -1;
  v: number; // velocidade (m/s)
  off: number; // deslocamento lateral na rua
  x: number;
  y: number;
  detectada: boolean;
}

interface Voo {
  x: number; // posição no mundo (1 unidade = 1 metro)
  y: number;
  vx: number; // velocidade (m/s)
  vy: number;
  th: number; // ângulo da órbita (modo patrulha)
  modo: ModoVoo;
  alvoId: number | null; // entidade seguida (modo seguir)
}

interface Alerta {
  detId: number;
  entidadeId: number;
  classe: Classe;
  setor: string;
}

/* ───────────── Configuração ───────────── */

const MODELO_IA = "diapb-vision v0.3 (simulado)";
const MAX_ENT = 14;
const LARGURA = { maxWidth: "calc(62vh * 16 / 9)" };

const CLASSES: Record<
  Classe,
  {
    label: string;
    curto: string;
    Icon: LucideIcon;
    cor: string;
    fonte: string;
    especial?: boolean;
    ancora: { x: number; y: number; w: number; h: number };
  }
> = {
  pessoa: {
    label: "Pessoa",
    curto: "Pessoa",
    Icon: User,
    cor: "#38bdf8",
    fonte: "Câmera RGB",
    ancora: { x: 55, y: 62, w: 6, h: 13 },
  },
  calor: {
    label: "Foco de calor",
    curto: "Calor",
    Icon: Flame,
    cor: "#fb923c",
    fonte: "Sensor térmico",
    ancora: { x: 72, y: 38, w: 13, h: 22 },
  },
  fumaca: {
    label: "Fumaça",
    curto: "Fumaça",
    Icon: Wind,
    cor: "#cbd5e1",
    fonte: "Câmera RGB",
    ancora: { x: 72, y: 18, w: 18, h: 22 },
  },
  obstaculo: {
    label: "Obstáculo",
    curto: "Obstáculo",
    Icon: Construction,
    cor: "#facc15",
    fonte: "Câmera RGB",
    ancora: { x: 25, y: 48, w: 9, h: 16 },
  },
  veiculo: {
    label: "Veículo",
    curto: "Veículo",
    Icon: Car,
    cor: "#a3e635",
    fonte: "Câmera RGB",
    ancora: { x: 50, y: 50, w: 10, h: 11 },
  },
  armado: {
    label: "Possível pessoa armada",
    curto: "ARMADA",
    Icon: ShieldAlert,
    cor: "#ef4444",
    fonte: "Câmera RGB · classificador de objetos",
    especial: true,
    ancora: { x: 50, y: 50, w: 6, h: 13 },
  },
  mandado: {
    label: "Possível mandado em aberto",
    curto: "MANDADO",
    Icon: Gavel,
    cor: "#d946ef",
    fonte: "Consulta simulada à central",
    especial: true,
    ancora: { x: 50, y: 50, w: 6, h: 13 },
  },
  ferido: {
    label: "Possível pessoa ferida",
    curto: "FERIDO",
    Icon: HeartPulse,
    cor: "#22d3ee",
    fonte: "Câmera RGB + sensor térmico",
    especial: true,
    ancora: { x: 50, y: 50, w: 7, h: 11 },
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

const PRIORIDADE_ENT: Record<TipoEntidade, Prioridade> = {
  armado: "critica",
  ferido: "critica",
  mandado: "media",
  pessoa: "media",
  veiculo: "baixa",
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
  veiculo: [
    (q) =>
      `Veículo em movimento no setor ${q}. Placa não legível nesta altitude.`,
    (q) => `Veículo detectado no setor ${q}, circulando pela via.`,
  ],
  armado: [
    (q) =>
      `Possível pessoa armada no setor ${q}. Objeto compatível com arma de fogo na mão. Mantenha distância e confirme visualmente antes de acionar a equipe.`,
    (q) =>
      `Indivíduo com objeto alongado semelhante a arma no setor ${q}. Pode ser falso positivo (ferramenta, guarda-chuva). Exige confirmação humana.`,
  ],
  mandado: [
    (q) =>
      `Possível correspondência com mandado em aberto no setor ${q}. O vínculo vem de uma consulta simulada à central; a imagem não identifica ninguém. Exige validação humana e confirmação formal antes de qualquer abordagem.`,
  ],
  ferido: [
    (q) =>
      `Pessoa imóvel no solo no setor ${q}, possivelmente ferida. Priorize a verificação visual e acione apoio de resgate se confirmado.`,
  ],
};

const ROTULO_MODO: Record<ModoVoo, string> = {
  manual: "MANUAL",
  patrulha: "PATRULHA AUTOMÁTICA",
  base: "RETORNANDO À BASE",
  seguir: "SEGUINDO ALVO",
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

// Detecção de objetos fixos da cena (fumaça, calor, antena, pessoa inicial)
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

/* ───────────── Alerta sonoro ───────────── */

let audioCtx: AudioContext | null = null;

function bipe(urgente: boolean) {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    audioCtx = audioCtx ?? new Ctx();
    const ctx = audioCtx;
    if (ctx.state === "suspended") ctx.resume();
    const t0 = ctx.currentTime;
    [0, 0.22, 0.44].forEach((off) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "square";
      o.frequency.value = urgente ? 880 : 620;
      g.gain.setValueAtTime(0.0001, t0 + off);
      g.gain.exponentialRampToValueAtTime(0.1, t0 + off + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + off + 0.18);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(t0 + off);
      o.stop(t0 + off + 0.2);
    });
  } catch {}
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

// posição fixa de uma detecção "estática" no mundo
function mundoDe(d: Deteccao) {
  return {
    x: HOME.x - FOOT.w / 2 + (d.x / 100) * FOOT.w,
    y: HOME.y - FOOT.h / 2 + (d.y / 100) * FOOT.h,
  };
}

// onde um ponto do mundo aparece no vídeo (em %), dado onde o drone está
function posNoVideo(
  m: { x: number; y: number },
  drone: { x: number; y: number },
) {
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
  calcada: string;
  faixa: string;
  agua: string;
  copa: string;
  sombra: string;
}

const PALETA_MAPA: Paleta = {
  fundo: "#0f1f18",
  rua: "#273244",
  centro: "#566377",
  predio: "#1b2636",
  borda: "#2a3a50",
  parque: "#143325",
  arvore: "#14452f",
  calcada: "#334155",
  faixa: "#64748b",
  agua: "#0b3b5a",
  copa: "#1f6b47",
  sombra: "rgba(0,0,0,0.35)",
};
const PALETA_RGB: Paleta = {
  fundo: "#35523a",
  rua: "#3d424b",
  centro: "#e4c34a",
  predio: "#6b7280",
  topo: "#94a3b8",
  parque: "#3c6b45",
  arvore: "#1f5130",
  calcada: "#9a9a94",
  faixa: "#d1d5db",
  agua: "#3b82a6",
  copa: "#2f7a45",
  sombra: "rgba(0,0,0,0.38)",
};
const PALETA_TERMICA: Paleta = {
  fundo: "#0b0820",
  rua: "#17133a",
  centro: "#241f55",
  predio: "#2a1f5e",
  topo: "#33266f",
  parque: "#120c33",
  arvore: "#16123d",
  calcada: "#1d1848",
  faixa: "#2c2766",
  agua: "#09163a",
  copa: "#1b1648",
  sombra: "rgba(0,0,0,0.3)",
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
  // passagem de pedestres atravessando a praça central
  { x1: 396, y1: 142, x2: 396, y2: 248, w: 4 },
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
  [388, 162],
  [388, 226],
  [428, 214],
  [432, 163],
  [454, 196],
  [360, 190],
  [455, 185],
  [480, 240],
  [326, 240],
  [372, 236],
];

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// árvores dos dois parques (geradas uma vez)
const ARVORES_PARQUE: [number, number, number][] = [];
[
  [14, 14, 92, 116],
  [574, 274, 710, 386],
].forEach(([x0, y0, x1, y1], pi) => {
  for (let i = 0; i < 18; i++) {
    const x = x0 + 6 + hash(pi * 100 + i) * (x1 - x0 - 12);
    const y = y0 + 6 + hash(pi * 100 + i + 50) * (y1 - y0 - 12);
    if (pi === 0 && ((x - 52) / 24) ** 2 + ((y - 72) / 16) ** 2 < 1) continue; // lago
    ARVORES_PARQUE.push([x, y, 2.6 + hash(i + pi * 7) * 1.8]);
  }
});

// prédios de cada quadra, divididos ao longo do lado maior
const PREDIOS_QUADRA: {
  x: number;
  y: number;
  w: number;
  h: number;
  i: number;
}[] = [];
QUADRAS.forEach((q, qi) => {
  if (q.verde) return;
  const horiz = q.w >= q.h;
  const n = clamp(Math.round((horiz ? q.w : q.h) / 34), 1, 5);
  for (let k = 0; k < n; k++) {
    if (horiz) {
      const w = q.w / n;
      PREDIOS_QUADRA.push({
        x: q.x + k * w + 0.7,
        y: q.y,
        w: w - 1.4,
        h: q.h,
        i: qi * 7 + k,
      });
    } else {
      const h = q.h / n;
      PREDIOS_QUADRA.push({
        x: q.x,
        y: q.y + k * h + 0.7,
        w: q.w,
        h: h - 1.4,
        i: qi * 7 + k,
      });
    }
  }
});

const ZEBRAS = [
  [240, 130],
  [560, 130],
  [240, 260],
  [560, 260],
];

function Predio({
  x,
  y,
  w,
  h,
  i,
  p,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  i: number;
  p: Paleta;
}) {
  const s = 1.8 * (0.7 + hash(i) * 1.1); // sombra proporcional à "altura"
  return (
    <g>
      <rect x={x + s} y={y + s} width={w} height={h} fill={p.sombra} />
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill={p.predio}
        stroke={p.borda}
        strokeWidth={p.borda ? 0.5 : 0}
      />
      {p.topo && (
        <rect
          x={x + 0.8}
          y={y + 0.8}
          width={w - 1.6}
          height={h - 1.6}
          fill={p.topo}
        />
      )}
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill="#000"
        opacity={0.03 + hash(i + 9) * 0.16}
      />
      <rect
        x={x + w * 0.18}
        y={y + h * 0.22}
        width={Math.min(4, w * 0.28)}
        height={Math.min(3, h * 0.24)}
        fill={p.predio}
        stroke="#0004"
        strokeWidth="0.3"
      />
    </g>
  );
}

function Arvore({
  x,
  y,
  r,
  p,
}: {
  x: number;
  y: number;
  r: number;
  p: Paleta;
}) {
  return (
    <g>
      <ellipse
        cx={x + r * 0.45}
        cy={y + r * 0.45}
        rx={r}
        ry={r * 0.9}
        fill={p.sombra}
      />
      <circle cx={x} cy={y} r={r} fill={p.arvore} />
      <circle cx={x - r * 0.15} cy={y - r * 0.15} r={r * 0.78} fill={p.copa} />
    </g>
  );
}

const Mundo = memo(function Mundo({
  p,
  grade,
  rotulos,
}: {
  p: Paleta;
  grade?: boolean;
  rotulos?: boolean;
}) {
  const txt = {
    fill: "#e2e8f0",
    stroke: "#0f172a",
    strokeWidth: 1.6,
    paintOrder: "stroke",
    fontWeight: 600,
  } as const;

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

      {/* lotes e parques */}
      {QUADRAS.map((q, i) => (
        <rect
          key={i}
          x={q.x}
          y={q.y}
          width={q.w}
          height={q.h}
          rx="2"
          fill={q.verde ? p.parque : p.calcada}
          stroke={p.borda}
          strokeWidth={p.borda ? 0.6 : 0}
        />
      ))}

      {/* lago */}
      <ellipse cx="52" cy="72" rx="22" ry="14" fill={p.agua} />
      <ellipse
        cx="52"
        cy="72"
        rx="22"
        ry="14"
        fill="none"
        stroke={p.copa}
        strokeWidth="1"
        opacity="0.5"
      />
      <ellipse cx="46" cy="68" rx="9" ry="4" fill="#fff" opacity="0.12" />

      {/* calçadas */}
      {RUAS.map((r, i) => (
        <line
          key={`c${i}`}
          x1={r.x1}
          y1={r.y1}
          x2={r.x2}
          y2={r.y2}
          stroke={p.calcada}
          strokeWidth={r.w + 5}
        />
      ))}

      {/* asfalto, bordas e faixa central */}
      {RUAS.map((r, i) => {
        const h = ehHoriz(r);
        const o = r.w / 2 - 0.9;
        const l1 = h
          ? { x1: r.x1, y1: r.y1 - o, x2: r.x2, y2: r.y2 - o }
          : { x1: r.x1 - o, y1: r.y1, x2: r.x2 - o, y2: r.y2 };
        const l2 = h
          ? { x1: r.x1, y1: r.y1 + o, x2: r.x2, y2: r.y2 + o }
          : { x1: r.x1 + o, y1: r.y1, x2: r.x2 + o, y2: r.y2 };
        return (
          <g key={`r${i}`}>
            <line
              x1={r.x1}
              y1={r.y1}
              x2={r.x2}
              y2={r.y2}
              stroke={p.rua}
              strokeWidth={r.w}
            />
            {r.w >= 6 && (
              <>
                <line {...l1} stroke={p.faixa} strokeWidth="0.35" />
                <line {...l2} stroke={p.faixa} strokeWidth="0.35" />
              </>
            )}
            <line
              x1={r.x1}
              y1={r.y1}
              x2={r.x2}
              y2={r.y2}
              stroke={p.centro}
              strokeWidth={Math.max(0.3, r.w * 0.04)}
              strokeDasharray={`${r.w * 0.4} ${r.w * 0.4}`}
            />
          </g>
        );
      })}

      {/* faixas de pedestres nos cruzamentos */}
      {ZEBRAS.map(([cx, cy], zi) => (
        <g key={zi} fill={p.faixa} opacity="0.85">
          {[-1, 1].flatMap((s) =>
            Array.from({ length: 5 }, (_, k) => (
              <g key={`${s}${k}`}>
                <rect
                  x={cx + s * 12 - 1}
                  y={cy - 5 + k * 2.4}
                  width="2"
                  height="1.2"
                />
                <rect
                  x={cx - 5 + k * 2.4}
                  y={cy + s * 12 - 1}
                  width="1.2"
                  height="2"
                />
              </g>
            )),
          )}
        </g>
      ))}

      {/* prédios */}
      {PREDIOS_QUADRA.map((b) => (
        <Predio key={`q${b.i}`} {...b} p={p} />
      ))}
      {PREDIOS_LOCAIS.map(([x, y, w, h], i) => (
        <Predio key={`l${i}`} x={x} y={y} w={w} h={h} i={100 + i} p={p} />
      ))}

      {/* hospital (cruz no telhado) */}
      <rect
        x="615"
        y="54"
        width="22"
        height="22"
        rx="2"
        fill="#fff"
        opacity="0.9"
      />
      <rect x="624" y="57" width="4" height="16" fill="#dc2626" />
      <rect x="618" y="63" width="16" height="4" fill="#dc2626" />

      {/* heliponto da base */}
      <circle
        cx={HOME.x}
        cy={HOME.y}
        r="5"
        fill="#1f2937"
        stroke="#facc15"
        strokeWidth="0.5"
      />
      <text
        x={HOME.x}
        y={HOME.y + 2}
        textAnchor="middle"
        fontSize="6"
        fontWeight="700"
        fill="#facc15"
      >
        H
      </text>

      {/* árvores */}
      {ARVORES.map(([x, y], i) => (
        <Arvore key={`a${i}`} x={x} y={y} r={3.5} p={p} />
      ))}
      {ARVORES_PARQUE.map(([x, y, r], i) => (
        <Arvore key={`p${i}`} x={x} y={y} r={r} p={p} />
      ))}

      {/* nomes (só no mapa) */}
      {rotulos && (
        <g fontSize="6" letterSpacing="0.6">
          <text x="140" y="132" {...txt}>
            AV. CENTRAL
          </text>
          <text x="660" y="132" {...txt}>
            AV. CENTRAL
          </text>
          <text x="150" y="262" {...txt}>
            R. DAS FLORES
          </text>
          <text x="640" y="262" {...txt}>
            R. DAS FLORES
          </text>
          <text
            transform="translate(242 60) rotate(-90)"
            textAnchor="middle"
            {...txt}
          >
            R. PARANÁ
          </text>
          <text
            transform="translate(242 330) rotate(-90)"
            textAnchor="middle"
            {...txt}
          >
            R. PARANÁ
          </text>
          <text
            transform="translate(562 60) rotate(-90)"
            textAnchor="middle"
            {...txt}
          >
            AV. BRASIL
          </text>
          <text
            transform="translate(562 330) rotate(-90)"
            textAnchor="middle"
            {...txt}
          >
            AV. BRASIL
          </text>
          <g fontSize="5">
            <text x="626" y="88" textAnchor="middle" {...txt}>
              Hospital Municipal
            </text>
            <text x="68" y="332" textAnchor="middle" {...txt}>
              Escola Municipal
            </text>
            <text x="52" y="100" textAnchor="middle" {...txt}>
              Parque
            </text>
            <text x={HOME.x} y={HOME.y - 8} textAnchor="middle" {...txt}>
              Base DIAPB
            </text>
          </g>
        </g>
      )}
    </g>
  );
});

/* ───────────── Entidades (pessoas, veículos e alvos especiais) ───────────── */

const ehHoriz = (r: (typeof RUAS)[number]) => r.y1 === r.y2;

function posRua(r: (typeof RUAS)[number], along: number, off: number) {
  return ehHoriz(r) ? { x: along, y: r.y1 + off } : { x: r.x1 + off, y: along };
}

// escolhe um ponto aleatório numa rua a até `raio` metros de `ref`
function pontoNaRua(
  ref: { x: number; y: number },
  raio: number,
  larguraMin = 0,
) {
  const candidatas: { i: number; min: number; max: number }[] = [];
  RUAS.forEach((r, i) => {
    if (r.w < larguraMin) return;
    const horiz = ehHoriz(r);
    const eixoRef = horiz ? ref.x : ref.y;
    const cruz = horiz ? Math.abs(ref.y - r.y1) : Math.abs(ref.x - r.x1);
    if (cruz > raio) return;
    const meio = Math.sqrt(raio * raio - cruz * cruz);
    const ini = horiz ? r.x1 : r.y1;
    const fim = horiz ? r.x2 : r.y2;
    const min = Math.max(ini + 4, eixoRef - meio);
    const max = Math.min(fim - 4, eixoRef + meio);
    if (max > min) candidatas.push({ i, min, max });
  });
  if (!candidatas.length) return null;
  const c = candidatas[Math.floor(Math.random() * candidatas.length)];
  return { rua: c.i, along: c.min + Math.random() * (c.max - c.min) };
}

function criarEntidade(
  id: number,
  tipo: TipoEntidade,
  ref: { x: number; y: number },
  visivel: boolean, // true: já dentro da área da câmera; false: fora dela
): Entidade {
  const larguraMin = tipo === "veiculo" ? 6 : 0;
  let ponto: { rua: number; along: number } | null = null;

  for (let i = 0; i < 14 && !ponto; i++) {
    const p = pontoNaRua(ref, visivel ? 40 : 110, larguraMin);
    if (!p) continue;
    const q = posRua(RUAS[p.rua], p.along, 0);
    const dentro =
      Math.abs(q.x - ref.x) < FOOT.w / 2 - 6 &&
      Math.abs(q.y - ref.y) < FOOT.h / 2 - 5;
    const fora =
      Math.abs(q.x - ref.x) > FOOT.w / 2 + 6 ||
      Math.abs(q.y - ref.y) > FOOT.h / 2 + 6;
    if (visivel ? dentro : fora) ponto = p;
  }
  if (!ponto) {
    ponto = pontoNaRua(ref, 120, larguraMin) ??
      pontoNaRua(ref, 1000, larguraMin) ?? { rua: 0, along: 100 };
  }

  const r = RUAS[ponto.rua];
  const lado = Math.random() < 0.5 ? -1 : 1;
  const off =
    tipo === "veiculo" ? lado * r.w * 0.2 : lado * Math.max(0.5, r.w / 2 - 1.2);
  const v =
    tipo === "ferido"
      ? 0
      : tipo === "veiculo"
        ? 6 + Math.random() * 3
        : tipo === "armado"
          ? 1.7 + Math.random() * 0.6
          : 1.2 + Math.random() * 0.6;
  const pos = posRua(r, ponto.along, off);

  return {
    id,
    tipo,
    rua: ponto.rua,
    dir: Math.random() < 0.5 ? 1 : -1,
    v,
    off,
    x: pos.x,
    y: pos.y,
    detectada: false,
  };
}

function moverEntidade(e: Entidade, dt: number): Entidade {
  if (e.v === 0) return e;
  const r = RUAS[e.rua];
  const horiz = ehHoriz(r);
  const ini = (horiz ? r.x1 : r.y1) + 2;
  const fim = (horiz ? r.x2 : r.y2) - 2;
  let along = (horiz ? e.x : e.y) + e.dir * e.v * dt;
  let dir = e.dir;
  if (along < ini) {
    along = ini;
    dir = 1;
  } else if (along > fim) {
    along = fim;
    dir = -1;
  } else if (e.tipo !== "veiculo" && Math.random() < dt * 0.04) {
    dir = dir === 1 ? -1 : 1; // pedestre muda de sentido de vez em quando
  }
  return horiz ? { ...e, x: along, dir } : { ...e, y: along, dir };
}

function tipoAleatorio(): TipoEntidade {
  const r = Math.random();
  if (r < 0.4) return "pessoa";
  if (r < 0.65) return "veiculo";
  if (r < 0.77) return "armado";
  if (r < 0.89) return "mandado";
  return "ferido";
}

function dentroDaCamera(
  e: { x: number; y: number },
  v: { x: number; y: number },
  f = 0.92,
) {
  return (
    Math.abs(e.x - v.x) < (FOOT.w / 2) * f &&
    Math.abs(e.y - v.y) < (FOOT.h / 2) * f
  );
}

// comentário da IA gerado quando uma entidade entra na área da câmera
function criarDeteccaoEntidade(
  id: number,
  e: Entidade,
  drone: { x: number; y: number },
): Deteccao {
  const c = CLASSES[e.tipo];
  const vp = posNoVideo(e, drone);
  const setor = quadrante(vp.x, vp.y);
  const textos = TEXTOS[e.tipo];
  return {
    id,
    classe: e.tipo,
    x: ((e.x - (HOME.x - FOOT.w / 2)) / FOOT.w) * 100,
    y: ((e.y - (HOME.y - FOOT.h / 2)) / FOOT.h) * 100,
    w: c.ancora.w,
    h: c.ancora.h,
    confianca: Math.round(
      (e.tipo === "mandado" ? 60 : 64) +
        Math.random() * (e.tipo === "mandado" ? 25 : 30),
    ),
    prioridade: PRIORIDADE_ENT[e.tipo],
    hora: new Date(),
    texto: textos[Math.floor(Math.random() * textos.length)](setor),
    status: "pendente",
    entidadeId: e.id,
    setor,
    ref:
      e.tipo === "mandado"
        ? `SIM-${1000 + Math.floor(Math.random() * 9000)}`
        : undefined,
  };
}

// posição atual de uma detecção: da entidade (se existir) ou fixa
function posDet(d: Deteccao, ents: Map<number, Entidade>) {
  const e = d.entidadeId != null ? ents.get(d.entidadeId) : undefined;
  return e ? { x: e.x, y: e.y } : mundoDe(d);
}

/* ───────────── Física simples do voo ───────────── */

function passoVoo(
  v: Voo,
  dx: number,
  dy: number,
  dt: number,
  alvoPos: { x: number; y: number } | null,
): Voo {
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
    let alvo: { x: number; y: number } | null = null;
    if (modo === "patrulha") {
      th += dt * 0.08;
      alvo = {
        x: HOME.x + ORB.rx * Math.cos(th),
        y: HOME.y + ORB.ry * Math.sin(th),
      };
    } else if (modo === "base") {
      alvo = HOME;
    } else if (modo === "seguir") {
      alvo = alvoPos; // some quando a entidade deixa de existir
    }

    if (!alvo) {
      modo = "manual";
    } else {
      const ex = alvo.x - v.x;
      const ey = alvo.y - v.y;
      const dist = Math.hypot(ex, ey);

      if (modo === "base" && dist < 1 && Math.hypot(v.vx, v.vy) < 1) {
        modo = "manual"; // chegou: devolve o controle ao operador
      } else if (dist > 0) {
        const vel = Math.min(V_MAX, dist * 1.5);
        alvoVx = (ex / dist) * vel;
        alvoVy = (ey / dist) * vel;
      }
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
    alvoId: v.alvoId,
  };
}

/* ───────────── Vídeo: visão aérea recortada na posição do drone ───────────── */

const CARROS = [
  "#e5e7eb",
  "#b91c1c",
  "#1d4ed8",
  "#facc15",
  "#1f2937",
  "#16a34a",
];
const CAMISAS = [
  "#ef4444",
  "#3b82f6",
  "#22c55e",
  "#f59e0b",
  "#a855f7",
  "#e5e7eb",
];
const CABELOS = ["#1f2937", "#78350f", "#d6b88a", "#111827"];

function EntidadeSvg({
  e,
  t,
  pausado,
}: {
  e: Entidade;
  t: boolean;
  pausado: boolean;
}) {
  const horiz = ehHoriz(RUAS[e.rua]);
  const ang = horiz ? (e.dir === 1 ? 0 : 180) : e.dir === 1 ? 90 : 270;

  /* ── Veículo, visto de cima ── */
  if (e.tipo === "veiculo") {
    const van = e.id % 4 === 3;
    const L = van ? 5.6 : 4.4;
    const W = van ? 2.4 : 2.1;
    const cor = t ? "#3b2f7a" : CARROS[e.id % CARROS.length];
    return (
      <g transform={`translate(${e.x} ${e.y}) rotate(${ang})`}>
        <rect
          x={-L / 2 + 0.5}
          y={-W / 2 + 0.5}
          width={L}
          height={W}
          rx="0.6"
          fill="rgba(0,0,0,0.35)"
        />
        <rect x={-L / 2} y={-W / 2} width={L} height={W} rx="0.7" fill={cor} />
        {!t && (
          <>
            <rect
              x={L * 0.08}
              y={-W / 2 + 0.25}
              width={L * 0.2}
              height={W - 0.5}
              rx="0.3"
              fill="#0f172a"
              opacity="0.75"
            />
            <rect
              x={-L * 0.34}
              y={-W / 2 + 0.3}
              width={L * 0.18}
              height={W - 0.6}
              rx="0.3"
              fill="#0f172a"
              opacity="0.6"
            />
            <rect
              x={-L * 0.12}
              y={-W / 2 + 0.2}
              width={L * 0.18}
              height={W - 0.4}
              fill="#fff"
              opacity="0.12"
            />
            <rect
              x={L / 2 - 0.35}
              y={-W / 2 + 0.2}
              width="0.35"
              height="0.45"
              fill="#fef9c3"
            />
            <rect
              x={L / 2 - 0.35}
              y={W / 2 - 0.65}
              width="0.35"
              height="0.45"
              fill="#fef9c3"
            />
            <rect
              x={-L / 2}
              y={-W / 2 + 0.2}
              width="0.3"
              height="0.45"
              fill="#ef4444"
            />
            <rect
              x={-L / 2}
              y={W / 2 - 0.65}
              width="0.3"
              height="0.45"
              fill="#ef4444"
            />
          </>
        )}
        {t && <circle cx={L * 0.3} cy="0" r="1.8" fill="url(#body)" />}
      </g>
    );
  }

  /* ── Pessoa, vista de cima ── */
  const deitado = e.tipo === "ferido";
  const andando = !deitado && e.v > 0;
  const camisa = t
    ? "#fb923c"
    : e.tipo === "armado"
      ? "#1f2937"
      : CAMISAS[e.id % CAMISAS.length];
  const cabelo = t ? "#fff7ae" : CABELOS[e.id % CABELOS.length];
  const pele = t ? "#fde68a" : "#e8b894";
  const ani = (reverso: boolean) => ({
    animation: `swing 0.7s ease-in-out infinite alternate${reverso ? "-reverse" : ""}`,
    animationPlayState: pausado ? ("paused" as const) : ("running" as const),
  });

  return (
    <g
      transform={`translate(${e.x} ${e.y}) rotate(${deitado ? 20 : ang}) scale(1.3)`}
    >
      {t && <circle r="2.6" fill="url(#body)" />}
      {deitado ? (
        <>
          <ellipse
            cx="0.3"
            cy="0.3"
            rx="1.0"
            ry="0.42"
            fill="rgba(0,0,0,0.35)"
          />
          <ellipse rx="1.0" ry="0.42" fill={camisa} />
          <circle cx="-1.05" r="0.46" fill={cabelo} />
        </>
      ) : (
        <>
          <ellipse
            cx="0.35"
            cy="0.35"
            rx="0.55"
            ry="1.05"
            fill="rgba(0,0,0,0.35)"
          />
          {andando && (
            <>
              <ellipse
                cy="-0.3"
                rx="0.35"
                ry="0.2"
                fill="#111827"
                style={ani(true)}
              />
              <ellipse
                cy="0.3"
                rx="0.35"
                ry="0.2"
                fill="#111827"
                style={ani(false)}
              />
              <ellipse
                cy="-0.95"
                rx="0.42"
                ry="0.18"
                fill={pele}
                style={ani(false)}
              />
              <ellipse
                cy="0.95"
                rx="0.42"
                ry="0.18"
                fill={pele}
                style={ani(true)}
              />
            </>
          )}
          <ellipse rx="0.42" ry="0.95" fill={camisa} />
          <circle cx="0.12" r="0.46" fill={cabelo} />
          {e.tipo === "armado" && (
            <g fill="#0b0f19">
              <rect x="0.3" y="0.55" width="1.2" height="0.28" />
              <rect x="0.3" y="0.3" width="0.3" height="0.4" />
            </g>
          )}
        </>
      )}
    </g>
  );
}

function Cena({
  modo,
  congelado,
  drone,
  entidades,
}: {
  modo: Modo;
  congelado: boolean;
  drone: { x: number; y: number };
  entidades: Entidade[];
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
        <style>{`@keyframes swing{from{transform:translateX(-0.5px)}to{transform:translateX(0.5px)}}`}</style>
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

        {/* pessoa fixa da cena */}
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

        {/* entidades em movimento */}
        {entidades.map((e) => (
          <EntidadeSvg key={e.id} e={e} t={t} pausado={congelado} />
        ))}
      </g>
    </svg>
  );
}

function Glifo({ classe }: { classe: Classe }) {
  const f = "#fff";
  const k = "#0f172a";
  switch (classe) {
    case "veiculo":
      return (
        <g>
          <rect x="-5" y="-3" width="10" height="6" rx="1.8" fill={f} />
          <rect
            x="-2.6"
            y="-2"
            width="5"
            height="4"
            rx="0.8"
            fill={k}
            opacity="0.55"
          />
        </g>
      );
    case "calor":
      return (
        <path
          d="M0 -6 C3 -2 5 0 5 3 A5 5 0 0 1 -5 3 C-5 0 -2 -1 0 -6Z"
          fill={f}
        />
      );
    case "fumaca":
      return (
        <g fill={f}>
          <circle cx="-2.5" cy="1" r="3" />
          <circle cx="2" cy="0" r="3.4" />
          <circle cx="0" cy="-2.2" r="2.6" />
        </g>
      );
    case "obstaculo":
      return (
        <g>
          <path d="M0 -6 L6 5 H-6Z" fill={f} />
          <rect x="-0.6" y="-2" width="1.2" height="4" fill={k} />
          <circle cx="0" cy="3.2" r="0.7" fill={k} />
        </g>
      );
    case "ferido":
      return (
        <g fill={f}>
          <circle cx="-4" cy="0" r="2.1" />
          <rect x="-2" y="-1.8" width="9" height="3.6" rx="1.8" />
        </g>
      );
    default:
      return (
        <g fill={f}>
          <circle cx="0" cy="-3.6" r="2.2" />
          <path d="M-4.5 5.5 Q-4.5 -0.5 0 -0.5 Q4.5 -0.5 4.5 5.5Z" />
          {classe === "armado" && (
            <rect
              x="3"
              y="0.5"
              width="5.5"
              height="1.8"
              fill={k}
              stroke={f}
              strokeWidth="0.5"
            />
          )}
          {classe === "mandado" && (
            <rect
              x="3.4"
              y="-6"
              width="4"
              height="4.6"
              fill={k}
              stroke={f}
              strokeWidth="0.6"
            />
          )}
        </g>
      );
  }
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

interface Marcador {
  d: Deteccao;
  pos: { x: number; y: number };
  movel: boolean;
}

function MapaTatico({
  drone,
  rotulo,
  online,
  marcadores,
  ocultas,
  selecionada,
  onSelecionar,
}: {
  drone: { x: number; y: number };
  rotulo: string;
  online: boolean;
  marcadores: Marcador[];
  ocultas: Entidade[];
  selecionada: number | null;
  onSelecionar: (id: number) => void;
}) {
  const [cam, setCam] = useState({
    ...ajustarCam(HOME.x, HOME.y, 2.5),
    seguir: true,
  });
  const [revelar, setRevelar] = useState(false);
  const [estilo, setEstilo] = useState<"ruas" | "satelite">("ruas");

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
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex overflow-hidden rounded-md border border-slate-700 text-[11px]">
            {(["ruas", "satelite"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setEstilo(s)}
                className={`px-2 py-1 capitalize transition ${
                  estilo === s
                    ? "bg-sky-500 text-slate-950"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {s === "ruas" ? "Ruas" : "Satélite"}
              </button>
            ))}
          </div>
          <button
            onClick={() => setRevelar((r) => !r)}
            title="Mostra no mapa as entidades que o drone ainda não detectou (modo demonstração)"
            className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition ${
              revelar
                ? "border-violet-400/50 bg-violet-500/15 text-violet-200"
                : "border-slate-700 text-slate-400 hover:text-slate-200"
            }`}
          >
            {revelar ? (
              <Eye className="h-3.5 w-3.5" />
            ) : (
              <EyeOff className="h-3.5 w-3.5" />
            )}
            Entidades ocultas
          </button>
          <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
            <span className="flex gap-1">
              <kbd className={kbd}>←</kbd>
              <kbd className={kbd}>↑</kbd>
              <kbd className={kbd}>↓</kbd>
              <kbd className={kbd}>→</kbd>
            </span>
            mover ·<kbd className={kbd}>J</kbd> aproximar ·
            <kbd className={kbd}>K</kbd> afastar
          </p>
        </div>
      </div>

      <div className="relative h-72 bg-[#0f1f18] lg:h-80">
        <svg
          viewBox={`${vx} ${vy} ${vw} ${vh}`}
          preserveAspectRatio="xMidYMid slice"
          className="absolute inset-0 h-full w-full"
        >
          <Mundo
            p={estilo === "ruas" ? PALETA_MAPA : PALETA_RGB}
            grade={estilo === "ruas"}
            rotulos
          />

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

          {/* entidades ainda não detectadas (modo demonstração) */}
          {revelar &&
            ocultas.map((e) => (
              <g
                key={`o${e.id}`}
                style={{ transform: `translate(${e.x}px, ${e.y}px)` }}
              >
                <g transform={`scale(${esc})`}>
                  <circle
                    r="5"
                    fill="none"
                    stroke={CLASSES[e.tipo].cor}
                    strokeWidth="1.5"
                    strokeDasharray="3 2"
                  />
                </g>
              </g>
            ))}

          {/* detecções */}
          {marcadores.map(({ d, pos, movel }) => {
            const c = CLASSES[d.classe];
            const ativa = selecionada === d.id;
            return (
              <g
                key={d.id}
                onClick={() => onSelecionar(d.id)}
                style={{
                  transform: `translate(${pos.x}px, ${pos.y}px)`,
                  transition: movel ? undefined : "transform 1s linear",
                  cursor: "pointer",
                }}
              >
                <g transform={`scale(${esc})`}>
                  {c.especial && (
                    <circle r="12" fill="none" stroke={c.cor} strokeWidth="2">
                      <animate
                        attributeName="r"
                        values="10;30"
                        dur="1.4s"
                        repeatCount="indefinite"
                      />
                      <animate
                        attributeName="opacity"
                        values="0.9;0"
                        dur="1.4s"
                        repeatCount="indefinite"
                      />
                    </circle>
                  )}
                  <circle
                    r={d.classe === "calor" ? 18 : 13}
                    fill={c.cor}
                    fillOpacity="0.18"
                  />
                  <circle
                    r={c.especial ? 10 : 8.5}
                    fill={c.cor}
                    stroke="#0f172a"
                    strokeWidth="1.5"
                  />
                  <g transform={`scale(${c.especial ? 0.95 : 0.8})`}>
                    <Glifo classe={d.classe} />
                  </g>
                  {ativa && (
                    <circle
                      r="14"
                      fill="none"
                      stroke="#fff"
                      strokeWidth="1.5"
                    />
                  )}
                  {(ativa || c.especial) && (
                    <text
                      x="16"
                      y="-14"
                      fontSize="11"
                      fontWeight="700"
                      fill="#fff"
                      stroke="#0f172a"
                      strokeWidth="3"
                      paintOrder="stroke"
                    >
                      {ativa ? `${c.curto} ${d.confianca}%` : c.curto}
                    </text>
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
                {rotulo}
                {online ? "" : " · última posição"}
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
            {CLASSES[k].curto}
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
const DRONE_KEY = "diapb_drone";

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

function lerDrone() {
  try {
    return localStorage.getItem(DRONE_KEY);
  } catch {
    return null;
  }
}

/* ───────────── Página: verifica login e drone escolhido ───────────── */

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

const GERAR: { tipo: TipoEntidade; rotulo: string }[] = [
  { tipo: "armado", rotulo: "Pessoa armada" },
  { tipo: "mandado", rotulo: "Mandado em aberto" },
  { tipo: "ferido", rotulo: "Pessoa ferida" },
  { tipo: "veiculo", rotulo: "Veículo" },
  { tipo: "pessoa", rotulo: "Pessoa" },
];

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
    alvoId: null,
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

  // entidades em movimento (a "verdade" do cenário simulado)
  const [entidades, setEntidades] = useState<Entidade[]>(() => [
    criarEntidade(1, "pessoa", HOME, true),
    criarEntidade(2, "veiculo", HOME, false),
    criarEntidade(3, "pessoa", HOME, true),
  ]);
  const [autoSpawn, setAutoSpawn] = useState(true);
  const [som, setSom] = useState(true);
  const [alerta, setAlerta] = useState<Alerta | null>(null);

  const [selecionada, setSelecionada] = useState<number | null>(null);
  const [filtro, setFiltro] = useState<"todos" | "pendentes">("todos");

  const proxId = useRef(100);
  const proxEnt = useRef(10);
  const contador = useRef(0);
  const teclas = useRef(new Set<string>());
  const syncTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alertaTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // espelhos do estado mais recente, lidos por timers e loops
  const vooRef = useRef(voo);
  const entRef = useRef(entidades);
  const somRef = useRef(som);
  useEffect(() => {
    vooRef.current = voo;
    entRef.current = entidades;
    somRef.current = som;
  });

  /* Limpa timeouts ao sair da página */
  useEffect(() => {
    return () => {
      if (syncTimeout.current) clearTimeout(syncTimeout.current);
      if (alertaTimeout.current) clearTimeout(alertaTimeout.current);
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

  /* Loop de voo e movimento das entidades (~30 quadros/s). Sem conexão, tudo congela. */
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

        const alvoId = vooRef.current.alvoId;
        const alvo =
          alvoId != null
            ? entRef.current.find((e) => e.id === alvoId)
            : undefined;
        const alvoPos = alvo ? { x: alvo.x, y: alvo.y } : null;

        setVoo((v) => passoVoo(v, dx, dy, passo, alvoPos));
        setEntidades((es) =>
          es.some((e) => e.v > 0) ? es.map((e) => moverEntidade(e, passo)) : es,
        );
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [conexao]);

  /* Relógio / telemetria / spawn / descoberta pela IA (1 Hz) */
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

        // objetos fixos da cena oscilam levemente em torno do alvo
        setDeteccoes((prev) =>
          prev.map((d) => {
            if (d.entidadeId != null) return d;
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

        const v = vooRef.current;

        // spawn automático: novas entidades surgem fora da área da câmera
        if (autoSpawn && n % 6 === 0 && entRef.current.length < MAX_ENT) {
          const nova = criarEntidade(
            proxEnt.current++,
            tipoAleatorio(),
            v,
            false,
          );
          setEntidades((es) => [...es, nova]);
        }

        // a IA só comenta uma entidade quando ela entra na área da câmera
        const novas = entRef.current.filter(
          (e) => !e.detectada && dentroDaCamera(e, v),
        );
        if (novas.length) {
          const dets = novas.map((e) =>
            criarDeteccaoEntidade(proxId.current++, e, v),
          );
          const ids = new Set(novas.map((e) => e.id));
          setDeteccoes((prev) => [...dets, ...prev].slice(0, 40));
          setEntidades((es) =>
            es.map((e) => (ids.has(e.id) ? { ...e, detectada: true } : e)),
          );

          // alerta visual e sonoro para alvos especiais
          const esp = dets.find((d) => CLASSES[d.classe].especial);
          if (esp && esp.entidadeId != null) {
            setAlerta({
              detId: esp.id,
              entidadeId: esp.entidadeId,
              classe: esp.classe,
              setor: esp.setor ?? "central",
            });
            if (alertaTimeout.current) clearTimeout(alertaTimeout.current);
            alertaTimeout.current = setTimeout(() => setAlerta(null), 10000);
            if (somRef.current) bipe(esp.classe === "armado");
          }
        }
      } else if (conexao === "perdida") {
        setSemDados((s) => s + 1);
        if (n % 7 === 0) setPendentesBuffer((p) => p + 1);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [conexao, autoSpawn]);

  /* Ações */
  function sair() {
    try {
      localStorage.removeItem(SESSAO_KEY);
      localStorage.removeItem(DRONE_KEY);
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
      setDeteccoes((prev) => [...recuperadas, ...prev].slice(0, 40));
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

  function seguirAlvo(entId: number) {
    setVoo((v) => ({ ...v, modo: "seguir", alvoId: entId }));
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

  // gera uma entidade já dentro da área da câmera (demonstração)
  function gerar(tipo: TipoEntidade) {
    const nova = criarEntidade(
      proxEnt.current++,
      tipo,
      { x: voo.x, y: voo.y },
      true,
    );
    setEntidades((es) =>
      es.length >= MAX_ENT ? [...es.slice(1), nova] : [...es, nova],
    );
  }

  function limparEntidades() {
    setEntidades([]);
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

  const entPorId = new Map(entidades.map((e) => [e.id, e] as const));
  const qtdPendentes = deteccoes.filter((d) => d.status === "pendente").length;
  const especiaisPendentes = deteccoes.filter(
    (d) => CLASSES[d.classe].especial && d.status === "pendente",
  ).length;
  const naoDescartadas = deteccoes.filter((d) => d.status !== "descartado");

  const marcadores: Marcador[] = naoDescartadas.slice(0, 10).map((d) => {
    const e = d.entidadeId != null ? entPorId.get(d.entidadeId) : undefined;
    return { d, pos: e ? { x: e.x, y: e.y } : mundoDe(d), movel: !!e };
  });
  const ocultas = entidades.filter((e) => !e.detectada);
  const detectadas = entidades.length - ocultas.length;

  // só aparecem no vídeo as detecções que estão dentro da área da câmera
  const caixas = naoDescartadas
    .map((d) => ({ d, p: posNoVideo(posDet(d, entPorId), drone) }))
    .filter(({ p }) => p.x > -10 && p.x < 110 && p.y > -10 && p.y < 110)
    .slice(0, 8);

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

  const tecla = (k: string, rotuloTecla: string) => (
    <button
      key={k}
      disabled={!online}
      aria-label={`Mover ${rotuloTecla}`}
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

  const classeAlerta = alerta ? CLASSES[alerta.classe] : null;

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
        <div className="flex items-center gap-3 text-sm">
          <span className="hidden text-slate-400 sm:inline">
            Operador{" "}
            <span className="font-mono text-slate-200">{cpfMascarado}</span>
          </span>
          <button
            onClick={trocarDrone}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-slate-300 transition hover:border-slate-500 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" /> Trocar drone
          </button>
          <button
            onClick={sair}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-slate-300 transition hover:border-slate-500 hover:text-white"
          >
            <LogOut className="h-4 w-4" /> Sair
          </button>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_390px]">
        {/* ───── Coluna principal: visão do drone ───── */}
        <section className="min-h-0 space-y-4 overflow-y-auto p-4">
          {/* Alerta de alvo especial */}
          {alerta && classeAlerta && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm"
              style={{
                borderColor: `${classeAlerta.cor}99`,
                background: `${classeAlerta.cor}1f`,
              }}
            >
              <span className="flex items-center gap-2.5">
                <Siren
                  className="h-5 w-5 shrink-0 animate-pulse"
                  style={{ color: classeAlerta.cor }}
                />
                <span>
                  <span
                    className="font-bold tracking-wide"
                    style={{ color: classeAlerta.cor }}
                  >
                    ALVO ESPECIAL
                  </span>{" "}
                  · {classeAlerta.label} · setor {alerta.setor}
                  <span className="block text-xs text-slate-300/80">
                    Indicação automatizada: exige avaliação humana antes de
                    qualquer ação.
                  </span>
                </span>
              </span>
              <span className="flex gap-2">
                <button
                  onClick={() => selecionar(alerta.detId)}
                  className="rounded-md border border-white/15 px-2.5 py-1 text-xs transition hover:bg-white/10"
                >
                  Ver comentário
                </button>
                <button
                  onClick={() => seguirAlvo(alerta.entidadeId)}
                  className="flex items-center gap-1 rounded-md bg-white/15 px-2.5 py-1 text-xs font-medium transition hover:bg-white/25"
                >
                  <Crosshair className="h-3.5 w-3.5" /> Seguir alvo
                </button>
                <button
                  onClick={() => setAlerta(null)}
                  aria-label="Fechar alerta"
                  className="rounded-md px-1.5 text-slate-300 transition hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </span>
            </div>
          )}

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
            style={LARGURA}
          >
            <Cena
              modo={modo}
              congelado={!online}
              drone={drone}
              entidades={entidades}
            />

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
                  className={`absolute cursor-pointer ${
                    c.especial && !ativa ? "animate-pulse" : ""
                  }`}
                  style={{
                    left: `${p.x - d.w / 2}%`,
                    top: `${p.y - d.h / 2}%`,
                    width: `${d.w}%`,
                    height: `${d.h}%`,
                    border: `${ativa || c.especial ? 3 : 2}px solid ${c.cor}`,
                    borderRadius: 4,
                    boxShadow: ativa
                      ? `0 0 0 2px #fff, 0 0 18px ${c.cor}`
                      : c.especial
                        ? `0 0 14px ${c.cor}`
                        : undefined,
                    opacity: online ? 1 : 0.6,
                  }}
                >
                  <span
                    className="absolute -top-5 left-[-3px] whitespace-nowrap rounded-sm px-1.5 py-0.5 text-[10px] font-bold leading-none text-slate-950"
                    style={{ background: c.cor }}
                  >
                    {c.curto} {d.confianca}%
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
            style={LARGURA}
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
                  {!online
                    ? "Comandos indisponíveis sem conexão. O drone mantém a posição até o link voltar."
                    : voo.modo === "seguir"
                      ? "Seguindo um alvo. Pressione W A S D para assumir o controle manual."
                      : "Pilote com W A S D (ou segure os botões ao lado). Qualquer comando retoma o controle manual."}
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

          {/* Simulação de cenário */}
          <div
            className="mx-auto w-full rounded-xl border border-slate-800 bg-slate-900/60 p-3"
            style={LARGURA}
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-medium">
                <Siren className="h-4 w-4 text-sky-400" /> Simulação de cenário
                <span className="text-xs font-normal text-slate-500">
                  demonstração
                </span>
              </h3>
              <p className="font-mono text-xs text-slate-400">
                Entidades {entidades.length}/{MAX_ENT} · detectadas {detectadas}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {GERAR.map(({ tipo, rotulo }) => {
                const c = CLASSES[tipo];
                return (
                  <button
                    key={tipo}
                    disabled={!online}
                    onClick={() => gerar(tipo)}
                    className="flex items-center gap-1.5 rounded-lg border bg-slate-950/60 px-3 py-1.5 text-xs font-medium transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                    style={{ borderColor: `${c.cor}66`, color: c.cor }}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <c.Icon className="h-3.5 w-3.5" />
                    {rotulo}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-300">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={autoSpawn}
                  onChange={(e) => setAutoSpawn(e.target.checked)}
                  className="accent-sky-500"
                />
                Geração automática
              </label>
              <button
                onClick={() => setSom((s) => !s)}
                className="flex items-center gap-1.5 transition hover:text-white"
              >
                {som ? (
                  <Volume2 className="h-3.5 w-3.5" />
                ) : (
                  <VolumeX className="h-3.5 w-3.5" />
                )}
                Alerta sonoro {som ? "ligado" : "desligado"}
              </button>
              <button
                onClick={limparEntidades}
                className="flex items-center gap-1.5 text-slate-400 transition hover:text-red-300"
              >
                <Trash2 className="h-3.5 w-3.5" /> Limpar entidades
              </button>
            </div>

            <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
              Pessoas e veículos circulam pelas ruas. O drone só gera um
              comentário quando a entidade entra na área da câmera. Alvos
              especiais disparam alerta visual e sonoro.
            </p>
          </div>

          {/* Mapa tático */}
          <div className="mx-auto w-full" style={LARGURA}>
            <MapaTatico
              drone={drone}
              rotulo={droneId}
              online={online}
              marcadores={marcadores}
              ocultas={ocultas}
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
            ].map(({ Icon, label, valor, alerta: alertaBat, pequeno }) => (
              <div
                key={label}
                className={`rounded-lg border bg-slate-900/60 p-3 ${
                  alertaBat ? "border-red-500/40" : "border-slate-800"
                } ${online ? "" : "opacity-50"}`}
              >
                <div className="mb-1 flex items-center gap-1.5 text-xs text-slate-400">
                  <Icon
                    className={`h-3.5 w-3.5 ${alertaBat ? "text-red-400" : ""}`}
                  />
                  {label}
                </div>
                <p
                  className={`font-mono font-medium ${
                    pequeno ? "text-xs" : "text-lg"
                  } ${alertaBat ? "text-red-300" : "text-slate-100"}`}
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 font-medium">
                <Bot className="h-5 w-5 text-sky-400" /> Análise da IA
              </h2>
              <span className="flex items-center gap-2">
                {especiaisPendentes > 0 && (
                  <span className="flex animate-pulse items-center gap-1 rounded-full bg-red-500/20 px-2.5 py-0.5 text-xs font-semibold text-red-300">
                    <Siren className="h-3 w-3" />
                    {especiaisPendentes} alvo
                    {especiaisPendentes === 1 ? "" : "s"} especia
                    {especiaisPendentes === 1 ? "l" : "is"}
                  </span>
                )}
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    qtdPendentes > 0
                      ? "bg-amber-500/15 text-amber-300"
                      : "bg-slate-800 text-slate-400"
                  }`}
                >
                  {qtdPendentes} pendente{qtdPendentes === 1 ? "" : "s"}
                </span>
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
              const seguivel =
                d.entidadeId != null && entPorId.has(d.entidadeId);
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
                  style={
                    c.especial
                      ? {
                          borderColor: ativa ? c.cor : `${c.cor}88`,
                          boxShadow: `0 0 0 1px ${c.cor}33`,
                        }
                      : undefined
                  }
                >
                  {c.especial && (
                    <span
                      className="mb-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide"
                      style={{
                        color: c.cor,
                        background: `${c.cor}1f`,
                        borderColor: `${c.cor}55`,
                      }}
                    >
                      <Siren className="h-3 w-3" /> ALVO ESPECIAL
                    </span>
                  )}

                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
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
                    {d.ref && (
                      <span className="mt-1 block text-fuchsia-300/80">
                        Referência simulada {d.ref} · não é identificação por
                        imagem
                      </span>
                    )}
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
                      {seguivel && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            seguirAlvo(d.entidadeId as number);
                          }}
                          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-sky-500/15 py-1.5 text-xs font-medium text-sky-300 transition hover:bg-sky-500/25"
                        >
                          <Crosshair className="h-3.5 w-3.5" /> Seguir
                        </button>
                      )}
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
