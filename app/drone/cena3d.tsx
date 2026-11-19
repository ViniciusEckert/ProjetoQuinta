"use client";

import { Component, useRef, type ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { DoubleSide } from "three";
import type { Group, Mesh } from "three";

/* ───────────── Tipos ───────────── */

export type TipoEnt3D = "pessoa" | "veiculo" | "armado" | "mandado" | "ferido";

export interface Ent3D {
  id: number;
  tipo: TipoEnt3D;
  x: number; // posição no mundo (1 unidade = 1 metro)
  y: number;
  ang: number; // direção do movimento, em graus (x = leste, y = sul)
  v: number; // velocidade (m/s); 0 = parado
  detectada: boolean;
}

interface Props {
  drone: { x: number; y: number };
  foot: { w: number; h: number };
  entidades: Ent3D[];
  termico: boolean;
  congelado: boolean;
  obstaculo: { x: number; y: number } | null;
  cores: Partial<Record<TipoEnt3D, string>>; // cor do anel dos alvos especiais
  onErro: () => void;
}

/* ───────────── Utilidades ───────────── */

export function webglOk() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

const ALTURA_CAMERA = 140; // metros acima do solo (só define a perspectiva)
const ESCALA_PESSOA = 2.6; // pessoas são ampliadas para aparecerem nesta altitude

const CARROS = ["#e5e7eb", "#b91c1c", "#1d4ed8", "#facc15", "#475569", "#16a34a"];
const CAMISAS = ["#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#e5e7eb"];
const CALCAS = ["#1e3a5f", "#374151", "#3f3f46", "#44403c"];
const CABELOS = ["#1f2937", "#78350f", "#d6b88a", "#111827"];
const PELES = ["#e8b894", "#c68b63", "#8d5a3b", "#f1c9a5"];

// cores do modo térmico: corpos quentes brilham, o resto fica frio
const FRIO = "#2e2470";
const QUENTE = "#ffe9a8";
const MOTOR = "#fb923c";

/* ───────────── Material ───────────── */

function Mat({
  cor,
  t,
  quente,
  cinza,
}: {
  cor: string;
  t: boolean;
  quente?: string;
  cinza?: boolean;
}) {
  if (t) return <meshBasicMaterial color={quente ?? (cinza ? "#3a2f85" : FRIO)} />;
  return <meshStandardMaterial color={cor} roughness={0.65} metalness={0.1} />;
}

/* ───────────── Carro (visto de cima, perspectiva leve) ───────────── */

function Carro({ id, t }: { id: number; t: boolean }) {
  const van = id % 4 === 3;
  const cor = CARROS[id % CARROS.length];
  const L = van ? 5.4 : 4.4;
  const W = van ? 2.1 : 1.9;
  const alt = van ? 1.5 : 0.75;
  const roda = (x: number, z: number) => (
    <mesh key={`${x}${z}`} position={[x, 0.36, z]} rotation={[Math.PI / 2, 0, 0]} castShadow>
      <cylinderGeometry args={[0.36, 0.36, 0.26, 14]} />
      <Mat cor="#0b0f19" t={t} />
    </mesh>
  );

  return (
    <group>
      {/* rodas */}
      {roda(L * 0.31, W / 2 - 0.1)}
      {roda(L * 0.31, -W / 2 + 0.1)}
      {roda(-L * 0.31, W / 2 - 0.1)}
      {roda(-L * 0.31, -W / 2 + 0.1)}

      {/* carroceria */}
      <mesh position={[0, 0.35 + alt / 2, 0]} castShadow>
        <boxGeometry args={[L, alt, W]} />
        <Mat cor={cor} t={t} />
      </mesh>

      {van ? (
        <>
          {/* para-brisa e teto da van */}
          <mesh position={[L * 0.3, 0.35 + alt + 0.02, 0]}>
            <boxGeometry args={[L * 0.32, 0.06, W * 0.86]} />
            <Mat cor="#1e293b" t={t} cinza />
          </mesh>
        </>
      ) : (
        <>
          {/* cabine de vidro + teto */}
          <mesh position={[-L * 0.06, 0.35 + alt + 0.28, 0]} castShadow>
            <boxGeometry args={[L * 0.5, 0.56, W * 0.88]} />
            <Mat cor="#1e293b" t={t} cinza />
          </mesh>
          <mesh position={[-L * 0.06, 0.35 + alt + 0.58, 0]} castShadow>
            <boxGeometry args={[L * 0.4, 0.07, W * 0.8]} />
            <Mat cor={cor} t={t} />
          </mesh>
        </>
      )}

      {/* faróis, lanternas e calor do motor */}
      {!t ? (
        <>
          {[-1, 1].map((s) => (
            <group key={s}>
              <mesh position={[L / 2 + 0.01, 0.75, s * W * 0.32]}>
                <boxGeometry args={[0.08, 0.2, 0.42]} />
                <meshBasicMaterial color="#fef9c3" />
              </mesh>
              <mesh position={[-L / 2 - 0.01, 0.75, s * W * 0.32]}>
                <boxGeometry args={[0.08, 0.2, 0.42]} />
                <meshBasicMaterial color="#ef4444" />
              </mesh>
            </group>
          ))}
        </>
      ) : (
        <mesh position={[L * 0.3, 0.35 + alt + 0.04, 0]}>
          <boxGeometry args={[L * 0.3, 0.05, W * 0.6]} />
          <meshBasicMaterial color={MOTOR} />
        </mesh>
      )}
    </group>
  );
}

/* ───────────── Pessoa (com animação de caminhada) ───────────── */

function Pessoa({ e, t }: { e: Ent3D; t: boolean }) {
  const pernaE = useRef<Group>(null);
  const pernaD = useRef<Group>(null);
  const bracoE = useRef<Group>(null);
  const bracoD = useRef<Group>(null);

  const deitado = e.tipo === "ferido";
  const armado = e.tipo === "armado";
  const andando = !deitado && e.v > 0;

  const camisa = armado ? "#1f2937" : CAMISAS[e.id % CAMISAS.length];
  const calca = CALCAS[e.id % CALCAS.length];
  const cabelo = CABELOS[e.id % CABELOS.length];
  const pele = PELES[e.id % PELES.length];

  useFrame(({ clock }) => {
    if (!andando) return;
    const a = Math.sin(clock.elapsedTime * (4 + e.v * 3) + e.id) * 0.75;
    if (pernaE.current) pernaE.current.rotation.z = a;
    if (pernaD.current) pernaD.current.rotation.z = -a;
    if (bracoE.current) bracoE.current.rotation.z = -a * 0.9;
    if (bracoD.current && !armado) bracoD.current.rotation.z = a * 0.9;
  });

  // a pessoa ferida fica deitada de costas, com a cabeça apontando para trás
  return (
    <group
      scale={ESCALA_PESSOA}
      position={[0, deitado ? 0.2 : 0, 0]}
      rotation={[0, 0, deitado ? Math.PI / 2 : 0]}
    >
      {/* pernas (pivô no quadril) */}
      {[
        { r: pernaE, z: -0.11 },
        { r: pernaD, z: 0.11 },
      ].map(({ r, z }) => (
        <group key={z} ref={r} position={[0, 0.9, z]}>
          <mesh position={[0, -0.45, 0]} castShadow>
            <boxGeometry args={[0.15, 0.9, 0.16]} />
            <Mat cor={calca} t={t} quente={QUENTE} />
          </mesh>
        </group>
      ))}

      {/* tronco */}
      <mesh position={[0, 1.2, 0]} castShadow>
        <boxGeometry args={[0.26, 0.56, 0.44]} />
        <Mat cor={camisa} t={t} quente={QUENTE} />
      </mesh>

      {/* braços */}
      <group ref={bracoE} position={[0, 1.42, -0.27]}>
        <mesh position={[0, -0.3, 0]} castShadow>
          <boxGeometry args={[0.11, 0.6, 0.11]} />
          <Mat cor={camisa} t={t} quente={QUENTE} />
        </mesh>
      </group>
      <group
        ref={bracoD}
        position={[0, 1.42, 0.27]}
        rotation={[0, 0, armado ? Math.PI / 2.1 : 0]}
      >
        <mesh position={[0, -0.3, 0]} castShadow>
          <boxGeometry args={[0.11, 0.6, 0.11]} />
          <Mat cor={camisa} t={t} quente={QUENTE} />
        </mesh>
        {armado && (
          <group>
            <mesh position={[0, -0.72, 0]} castShadow>
              <boxGeometry args={[0.07, 0.36, 0.07]} />
              <Mat cor="#0b0f19" t={t} cinza />
            </mesh>
            <mesh position={[0.05, -0.6, 0]} castShadow>
              <boxGeometry args={[0.07, 0.12, 0.06]} />
              <Mat cor="#0b0f19" t={t} cinza />
            </mesh>
          </group>
        )}
      </group>

      {/* cabeça e cabelo */}
      <mesh position={[0, 1.68, 0]} castShadow>
        <sphereGeometry args={[0.13, 14, 12]} />
        <Mat cor={pele} t={t} quente="#fff7ae" />
      </mesh>
      <mesh position={[-0.02, 1.72, 0]} castShadow>
        <sphereGeometry args={[0.135, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
        <Mat cor={cabelo} t={t} quente="#fff7ae" />
      </mesh>
    </group>
  );
}

/* ───────────── Anel pulsante dos alvos especiais ───────────── */

function Anel({ cor }: { cor: string }) {
  const ref = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const k = (clock.elapsedTime * 0.9) % 1;
    m.scale.setScalar(0.55 + k * 1.0);
    (m.material as { opacity: number }).opacity = 0.95 * (1 - k);
  });
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
        <ringGeometry args={[2.3, 2.6, 40]} />
        <meshBasicMaterial color={cor} transparent opacity={0.85} side={DoubleSide} depthWrite={false} />
      </mesh>
      <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.07, 0]}>
        <ringGeometry args={[2.3, 2.6, 40]} />
        <meshBasicMaterial color={cor} transparent opacity={0.9} side={DoubleSide} depthWrite={false} />
      </mesh>
    </>
  );
}

/* ───────────── Entidade posicionada no mundo ───────────── */

function Entidade3D({
  e,
  t,
  cor,
}: {
  e: Ent3D;
  t: boolean;
  cor?: string;
}) {
  return (
    <group position={[e.x, 0, e.y]} rotation={[0, (-e.ang * Math.PI) / 180, 0]}>
      {e.tipo === "veiculo" ? <Carro id={e.id} t={t} /> : <Pessoa e={e} t={t} />}
      {cor && e.detectada && <Anel cor={cor} />}
    </group>
  );
}

/* ───────────── Obstáculo: antena com cones e barreiras ───────────── */

function Antena({ x, y, t }: { x: number; y: number; t: boolean }) {
  const luz = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (luz.current) luz.current.visible = Math.floor(clock.elapsedTime * 1.6) % 2 === 0;
  });

  const cones = Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    return [Math.cos(a) * 3.6, Math.sin(a) * 3.6] as const;
  });

  return (
    <group position={[x, 0, y]}>
      {/* base */}
      <mesh position={[0, 0.3, 0]} castShadow receiveShadow>
        <boxGeometry args={[3, 0.6, 3]} />
        <Mat cor="#9ca3af" t={t} cinza />
      </mesh>

      {/* mastro listrado */}
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} position={[0, 0.6 + i * 3 + 1.5, 0]} castShadow>
          <cylinderGeometry args={[0.3 - i * 0.03, 0.34 - i * 0.03, 3, 10]} />
          <Mat cor={i % 2 === 0 ? "#dc2626" : "#f3f4f6"} t={t} cinza />
        </mesh>
      ))}

      {/* braços de antena */}
      <mesh position={[0, 10.2, 0]} castShadow>
        <boxGeometry args={[4.4, 0.18, 0.18]} />
        <Mat cor="#d1d5db" t={t} cinza />
      </mesh>
      <mesh position={[0, 8.2, 0]} castShadow>
        <boxGeometry args={[0.18, 0.18, 3.2]} />
        <Mat cor="#d1d5db" t={t} cinza />
      </mesh>

      {/* luz de obstáculo piscando */}
      <mesh ref={luz} position={[0, 12.9, 0]}>
        <sphereGeometry args={[0.35, 10, 8]} />
        <meshBasicMaterial color="#ff2d2d" />
      </mesh>

      {/* cones de sinalização */}
      {cones.map(([cx, cz], i) => (
        <group key={i} position={[cx, 0, cz]}>
          <mesh position={[0, 0.4, 0]} castShadow>
            <coneGeometry args={[0.28, 0.8, 12]} />
            <Mat cor="#f97316" t={t} cinza />
          </mesh>
          <mesh position={[0, 0.42, 0]}>
            <cylinderGeometry args={[0.17, 0.2, 0.14, 12]} />
            <Mat cor="#f8fafc" t={t} cinza />
          </mesh>
        </group>
      ))}

      {/* barreiras */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 3.2, 0.4, s * -3.6]} rotation={[0, s * 0.5, 0]} castShadow>
          <boxGeometry args={[2.4, 0.8, 0.5]} />
          <Mat cor={s < 0 ? "#dc2626" : "#f3f4f6"} t={t} cinza />
        </mesh>
      ))}
    </group>
  );
}

/* ───────────── Cena ───────────── */

function Escena({
  drone,
  foot,
  entidades,
  termico: t,
  obstaculo,
  cores,
}: Omit<Props, "congelado" | "onErro">) {
  const meio = Math.max(foot.w, foot.h) * 0.8;
  return (
    <>
      <ambientLight intensity={t ? 0 : 1.7} />
      <directionalLight
        position={[-30, 55, -20]}
        intensity={t ? 0 : 2.6}
        castShadow={!t}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-meio}
        shadow-camera-right={meio}
        shadow-camera-top={meio}
        shadow-camera-bottom={-meio}
        shadow-camera-near={1}
        shadow-camera-far={200}
        shadow-bias={-0.0004}
      />

      {/* chão invisível que só recebe sombra */}
      {!t && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} receiveShadow>
          <planeGeometry args={[meio * 2.4, meio * 2.4]} />
          <shadowMaterial opacity={0.42} />
        </mesh>
      )}

      {/* o mundo desliza em torno da câmera, que fica fixa sobre o drone */}
      <group position={[-drone.x, 0, -drone.y]}>
        {obstaculo && <Antena x={obstaculo.x} y={obstaculo.y} t={t} />}
        {entidades.map((e) => (
          <Entidade3D key={e.id} e={e} t={t} cor={cores[e.tipo]} />
        ))}
      </group>
    </>
  );
}

/* ───────────── Fallback se o WebGL falhar ───────────── */

class Limite extends Component<
  { onErro: () => void; children: ReactNode },
  { erro: boolean }
> {
  state = { erro: false };
  static getDerivedStateFromError() {
    return { erro: true };
  }
  componentDidCatch() {
    this.props.onErro();
  }
  render() {
    return this.state.erro ? null : this.props.children;
  }
}

/* ───────────── Componente exportado ───────────── */

export default function Cena3D({ congelado, onErro, ...resto }: Props) {
  const fov = (2 * Math.atan(resto.foot.h / 2 / ALTURA_CAMERA) * 180) / Math.PI;
  return (
    <Limite onErro={onErro}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          filter: congelado ? "grayscale(1) brightness(0.55)" : undefined,
        }}
      >
        <Canvas
          shadows="percentage"
          dpr={[1, 2]}
          frameloop={congelado ? "never" : "always"}
          gl={{ alpha: true, antialias: true }}
          camera={{
            position: [0, ALTURA_CAMERA, 0],
            rotation: [-Math.PI / 2, 0, 0], // olhando para baixo, norte para cima
            fov,
            near: 1,
            far: 400,
          }}
          onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
        >
          <Escena {...resto} />
        </Canvas>
      </div>
    </Limite>
  );
}