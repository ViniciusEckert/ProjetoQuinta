"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Drone, Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";

// Aplica a máscara 000.000.000-00 enquanto o usuário digita
function formatCpf(value: string) {
  const d = value.replace(/\D/g, "").slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1-$2");
}

export default function LoginPage() {
  const router = useRouter();
  const [cpf, setCpf] = useState("");
  const [senha, setSenha] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErro("");

    const cpfNumeros = cpf.replace(/\D/g, "");

    if (!cpfNumeros || !senha) {
      setErro("Preencha o CPF e a senha.");
      return;
    }
    if (cpfNumeros.length !== 11) {
      setErro("O CPF deve ter 11 dígitos.");
      return;
    }

    // Sem backend: qualquer CPF (com 11 dígitos) e senha são aceitos
    setCarregando(true);
    setTimeout(() => {
      try {
        localStorage.setItem(
          "diapb_sessao",
          JSON.stringify({ cpf, entrouEm: new Date().toISOString() })
        );
      } catch {}
      router.push("/drone");
    }, 700);
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-4">
      {/* Fundo em grade, estilo central de comando */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(#38bdf8 1px, transparent 1px), linear-gradient(90deg, #38bdf8 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-sky-500/20 blur-3xl"
      />

      <div className="relative w-full max-w-md">
        {/* Marca */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-sky-400/30 bg-sky-500/10">
            <Drone className="h-7 w-7 text-sky-400" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            DIAPB
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Drone Inteligente de Apoio a Policiais e Bombeiros
          </p>
        </div>

        {/* Card */}
        <form
          onSubmit={handleSubmit}
          noValidate
          className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl backdrop-blur"
        >
          <div className="mb-1 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-sky-400" />
            <h2 className="text-lg font-medium text-white">Acesso restrito</h2>
          </div>
          <p className="mb-6 text-sm text-slate-400">
            Entre com seu CPF e senha para acessar a central.
          </p>

          <label htmlFor="cpf" className="mb-1.5 block text-sm text-slate-300">
            CPF
          </label>
          <input
            id="cpf"
            type="text"
            inputMode="numeric"
            autoComplete="username"
            placeholder="000.000.000-00"
            value={cpf}
            onChange={(e) => setCpf(formatCpf(e.target.value))}
            maxLength={14}
            className="mb-4 w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 font-mono text-white placeholder:text-slate-600 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/30"
          />

          <label
            htmlFor="senha"
            className="mb-1.5 block text-sm text-slate-300"
          >
            Senha
          </label>
          <div className="relative mb-4">
            <input
              id="senha"
              type={mostrarSenha ? "text" : "password"}
              autoComplete="current-password"
              placeholder="••••••••"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2.5 pl-3.5 pr-11 text-white placeholder:text-slate-600 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/30"
            />
            <button
              type="button"
              onClick={() => setMostrarSenha((v) => !v)}
              aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
              className="absolute inset-y-0 right-0 px-3.5 text-slate-400 hover:text-sky-300"
            >
              {mostrarSenha ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>

          {erro && (
            <p
              role="alert"
              className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
            >
              {erro}
            </p>
          )}

          <button
            type="submit"
            disabled={carregando}
            className="w-full rounded-lg bg-sky-500 px-4 py-2.5 font-medium text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {carregando ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Autenticando...
              </span>
            ) : (
              "Entrar"
            )}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-500">
          Protótipo acadêmico · UniSenai PR · Fundamentos de Engenharia de
          Software
        </p>
      </div>
    </main>
  );
}