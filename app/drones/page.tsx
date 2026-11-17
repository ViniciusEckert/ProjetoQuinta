"use client";

import {
  FormEvent,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Battery,
  BatteryLow,
  Camera,
  Drone,
  Loader2,
  Lock,
  LogOut,
  MapPin,
  ShieldCheck,
  Thermometer,
  Wrench,
  X,
} from "lucide-react";

/* ───────────── Dados simulados ───────────── */

type StatusDrone = "disponivel" | "em_missao" | "bateria_baixa" | "manutencao";

interface DroneItem {
  id: string;
  tipo: string;
  status: StatusDrone;
  bateria: number;
  termico: boolean;
  base: string;
  ultima: string;
}

const DRONES: DroneItem[] = [
  {
    id: "DR-01",
    tipo: "Tipo A · RGB + térmico",
    status: "disponivel",
    bateria: 94,
    termico: true,
    base: "Base Central",
    ultima: "Ontem, 21:40",
  },
  {
    id: "DR-02",
    tipo: "Tipo B · RGB",
    status: "em_missao",
    bateria: 61,
    termico: false,
    base: "Base Norte",
    ultima: "Em andamento",
  },
  {
    id: "DR-03",
    tipo: "Tipo A · RGB + térmico",
    status: "disponivel",
    bateria: 100,
    termico: true,
    base: "Base Central",
    ultima: "Há 3 dias",
  },
  {
    id: "DR-04",
    tipo: "Tipo B · RGB",
    status: "bateria_baixa",
    bateria: 18,
    termico: false,
    base: "Base Sul",
    ultima: "Hoje, 07:15",
  },
  {
    id: "DR-05",
    tipo: "Tipo A · RGB + térmico",
    status: "manutencao",
    bateria: 0,
    termico: true,
    base: "Oficina",
    ultima: "Há 12 dias",
  },
  {
    id: "DR-06",
    tipo: "Tipo A · RGB + térmico",
    status: "disponivel",
    bateria: 78,
    termico: true,
    base: "Base Norte",
    ultima: "Ontem, 14:02",
  },
];

const STATUS: Record<
  StatusDrone,
  { label: string; classe: string; acao: string }
> = {
  disponivel: {
    label: "Disponível",
    classe: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    acao: "Acessar",
  },
  em_missao: {
    label: "Em missão",
    classe: "border-sky-500/30 bg-sky-500/10 text-sky-300",
    acao: "Acompanhar",
  },
  bateria_baixa: {
    label: "Bateria baixa",
    classe: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    acao: "Acessar",
  },
  manutencao: {
    label: "Em manutenção",
    classe: "border-slate-600 bg-slate-800 text-slate-400",
    acao: "Indisponível",
  },
};

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

// "123456" → "123 456"
function formatCodigo(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 6);
  return d.length > 3 ? `${d.slice(0, 3)} ${d.slice(3)}` : d;
}

/* ───────────── Página ───────────── */

export default function DronesPage() {
  const router = useRouter();
  const sessao = useSyncExternalStore(assinar, lerSessao, () => null);

  useEffect(() => {
    if (!lerSessao()) router.replace("/login");
  }, [router]);

  if (!sessao) return <div className="min-h-screen bg-slate-950" />;

  let cpf = "";
  try {
    cpf = JSON.parse(sessao).cpf ?? "";
  } catch {}

  return <Lista cpf={cpf} />;
}

function Lista({ cpf }: { cpf: string }) {
  const router = useRouter();

  const [hoje] = useState(() => new Date());
  const [filtro, setFiltro] = useState<"todos" | "disponiveis">("todos");
  const [selecionado, setSelecionado] = useState<DroneItem | null>(null);
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cpfMascarado = cpf ? `${cpf.slice(0, 3)}.***.***-${cpf.slice(-2)}` : "—";
  const dataTexto = hoje.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });

  // fecha o modal com Esc
  useEffect(() => {
    if (!selecionado) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !carregando) fechar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecionado, carregando]);

  useEffect(() => {
    return () => {
      if (timeout.current) clearTimeout(timeout.current);
    };
  }, []);

  function abrir(d: DroneItem) {
    if (d.status === "manutencao") return;
    setCodigo("");
    setErro("");
    setSelecionado(d);
  }

  function fechar() {
    setSelecionado(null);
    setCodigo("");
    setErro("");
  }

  function sair() {
    try {
      localStorage.removeItem(SESSAO_KEY);
      localStorage.removeItem(DRONE_KEY);
    } catch {}
    router.push("/login");
  }

  function confirmar(e: FormEvent) {
    e.preventDefault();
    if (!selecionado) return;
    setErro("");

    const digitos = codigo.replace(/\D/g, "");
    if (!digitos) {
      setErro("Informe o código temporário.");
      return;
    }
    if (digitos.length !== 6) {
      setErro("O código temporário tem 6 dígitos.");
      return;
    }

    // Sem backend: qualquer código com 6 dígitos é aceito
    setCarregando(true);
    timeout.current = setTimeout(() => {
      try {
        localStorage.setItem(
          DRONE_KEY,
          JSON.stringify({
            id: selecionado.id,
            tipo: selecionado.tipo,
            acessoEm: new Date().toISOString(),
          })
        );
      } catch {}
      router.push("/drone");
    }, 700);
  }

  const lista =
    filtro === "disponiveis"
      ? DRONES.filter((d) => d.status === "disponivel")
      : DRONES;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* ───── Cabeçalho ───── */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/70 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-sky-400/30 bg-sky-500/10">
            <Drone className="h-5 w-5 text-sky-400" />
          </div>
          <div className="leading-tight">
            <p className="font-semibold tracking-tight">DIAPB</p>
            <p className="text-xs text-slate-400">Central de operações</p>
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
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Selecione um drone
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              O acesso a cada drone exige o{" "}
              <span className="text-slate-200">código temporário</span> do dia.
            </p>
          </div>

          <div className="flex gap-1 rounded-lg bg-slate-900 p-1 text-xs">
            {(
              [
                ["todos", "Todos"],
                ["disponiveis", "Disponíveis"],
              ] as const
            ).map(([id, rotulo]) => (
              <button
                key={id}
                onClick={() => setFiltro(id)}
                className={`rounded-md px-3 py-1.5 transition ${
                  filtro === id
                    ? "bg-slate-700 text-white"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {rotulo}
              </button>
            ))}
          </div>
        </div>

        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {lista.map((d) => {
            const s = STATUS[d.status];
            const indisponivel = d.status === "manutencao";
            const BateriaIcon = d.bateria < 20 ? BatteryLow : Battery;
            return (
              <li
                key={d.id}
                className={`flex flex-col rounded-2xl border border-slate-800 bg-slate-900/60 p-4 transition ${
                  indisponivel ? "opacity-60" : "hover:border-sky-500/40"
                }`}
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-700 bg-slate-800">
                      {indisponivel ? (
                        <Wrench className="h-5 w-5 text-slate-400" />
                      ) : (
                        <Drone className="h-5 w-5 text-sky-400" />
                      )}
                    </div>
                    <div className="leading-tight">
                      <p className="font-mono text-lg font-semibold">{d.id}</p>
                      <p className="text-xs text-slate-400">{d.tipo}</p>
                    </div>
                  </div>
                  <span
                    className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${s.classe}`}
                  >
                    {s.label}
                  </span>
                </div>

                <dl className="mb-4 space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <dt className="flex items-center gap-1.5 text-slate-400">
                      <BateriaIcon
                        className={`h-4 w-4 ${
                          d.bateria < 20 && !indisponivel ? "text-amber-400" : ""
                        }`}
                      />
                      Bateria
                    </dt>
                    <dd className="font-mono">
                      {indisponivel ? "—" : `${d.bateria}%`}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="flex items-center gap-1.5 text-slate-400">
                      <Camera className="h-4 w-4" /> Sensores
                    </dt>
                    <dd className="flex items-center gap-2 text-xs">
                      <span className="rounded bg-slate-800 px-1.5 py-0.5">
                        RGB
                      </span>
                      {d.termico && (
                        <span className="flex items-center gap-1 rounded bg-orange-500/15 px-1.5 py-0.5 text-orange-300">
                          <Thermometer className="h-3 w-3" /> Térmico
                        </span>
                      )}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="flex items-center gap-1.5 text-slate-400">
                      <MapPin className="h-4 w-4" /> Base
                    </dt>
                    <dd>{d.base}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-slate-400">Última missão</dt>
                    <dd className="text-slate-300">{d.ultima}</dd>
                  </div>
                </dl>

                <button
                  onClick={() => abrir(d)}
                  disabled={indisponivel}
                  className="mt-auto flex items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
                >
                  {s.acao}
                  {!indisponivel && <ArrowRight className="h-4 w-4" />}
                </button>
              </li>
            );
          })}
        </ul>

        {lista.length === 0 && (
          <p className="py-16 text-center text-sm text-slate-500">
            Nenhum drone disponível no momento.
          </p>
        )}

        <p className="mt-8 text-center text-xs text-slate-500">
          Lista simulada para demonstração · UniSenai PR · Fundamentos de
          Engenharia de Software
        </p>
      </main>

      {/* ───── Modal: código temporário ───── */}
      {selecionado && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => !carregando && fechar()}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="titulo-codigo"
            onSubmit={confirmar}
            onClick={(e) => e.stopPropagation()}
            noValidate
            className="relative w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
          >
            <button
              type="button"
              onClick={fechar}
              disabled={carregando}
              aria-label="Fechar"
              className="absolute right-4 top-4 text-slate-400 transition hover:text-white disabled:opacity-40"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-sky-400/30 bg-sky-500/10">
              <Lock className="h-6 w-6 text-sky-400" />
            </div>

            <h2 id="titulo-codigo" className="text-lg font-semibold">
              Código temporário
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Para acessar o drone{" "}
              <span className="font-mono text-slate-100">{selecionado.id}</span>
              , informe o código de 6 dígitos do dia.
            </p>

            {selecionado.status === "bateria_baixa" && (
              <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                Atenção: bateria em {selecionado.bateria}%. O tempo de voo será
                reduzido.
              </p>
            )}

            <label
              htmlFor="codigo"
              className="mb-1.5 mt-5 block text-sm text-slate-300"
            >
              Código
            </label>
            <input
              id="codigo"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              placeholder="000 000"
              value={codigo}
              onChange={(e) => setCodigo(formatCodigo(e.target.value))}
              maxLength={7}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-3 text-center font-mono text-2xl tracking-[0.4em] text-white placeholder:text-slate-700 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/30"
            />

            <p className="mt-2 flex items-start gap-1.5 text-xs text-slate-500">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Este código muda todos os dias e é fornecido pela central. Válido
              hoje, {dataTexto}, até 23:59.
            </p>

            {erro && (
              <p
                role="alert"
                className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
              >
                {erro}
              </p>
            )}

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={fechar}
                disabled={carregando}
                className="flex-1 rounded-lg border border-slate-700 px-4 py-2.5 text-sm text-slate-300 transition hover:border-slate-500 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={carregando}
                className="flex-1 rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-medium text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {carregando ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Validando...
                  </span>
                ) : (
                  "Acessar drone"
                )}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}