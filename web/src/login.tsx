import { useEffect, useState, type FormEvent } from "react";
import { api } from "./api";
import { Icon, KeyMark } from "./icons";
import type { User } from "./types";

type Gate = "loading" | "setup" | "login" | "offline";

const GITHUB_ERRORS: Record<string, string> = {
  github_state: "El inicio con GitHub venció o se abrió en otra pestaña. Volvé a intentarlo.",
  github_rejected: "GitHub no confirmó tu cuenta. Volvé a intentarlo.",
  github_inactive: "Tu cuenta de GitHub está deshabilitada en Llaverito. Pedile a un administrador que la active.",
};

function takeLoginError(): string | null {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("login_error");
  if (!code) return null;
  params.delete("login_error");
  const query = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  return GITHUB_ERRORS[code] ?? "No se pudo entrar con GitHub.";
}

export function Login({ onSuccess }: { onSuccess: (user: User) => void }) {
  const [gate, setGate] = useState<Gate>("loading");
  const [github, setGithub] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(takeLoginError);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<{ github_enabled?: boolean }>("/auth/config")
      .then((config) => {
        if (!cancelled) setGithub(Boolean(config.github_enabled));
      })
      .catch(() => undefined);
    api<{ needs_setup: boolean }>("/auth/setup")
      .then((status) => {
        if (!cancelled) setGate(status.needs_setup ? "setup" : "login");
      })
      .catch(() => {
        if (!cancelled) setGate("offline");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (gate === "setup" && password !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setPending(true);
    try {
      const path = gate === "setup" ? "/auth/setup" : "/auth/login";
      const body = gate === "setup" ? { email, name, password } : { email, password };
      onSuccess(await api<User>(path, { method: "POST", body }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo entrar");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="login-screen">
      <form className="login-card glass" onSubmit={(event) => void submit(event)}>
        <div className="login-brand">
          <KeyMark />
          <div>
            <h1>Llaverito</h1>
            <span>Bóveda de credenciales municipal</span>
          </div>
        </div>
        {gate === "loading" ? <p className="lede">Abriendo…</p> : null}
        {gate === "offline" ? (
          <p className="alert" role="alert">No llego al servidor. En la carpeta del proyecto ejecutá <code>llaverito serve</code> y recargá esta página.</p>
        ) : null}
        {gate === "setup" ? (
          <>
            <p className="lede">Todavía no hay ninguna cuenta. Creá el administrador para entrar. La contraseña pide 12 caracteres o más.</p>
            <label>
              Nombre
              <input required value={name} autoComplete="name" onChange={(event) => setName(event.target.value)} />
            </label>
            <label>
              Email
              <input type="email" required autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label>
              Contraseña
              <input type="password" required minLength={12} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
            <label>
              Repetir contraseña
              <input type="password" required minLength={12} autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
            </label>
          </>
        ) : null}
        {gate === "login" ? (
          <>
            <p className="lede">Entrá para ver las llaves y desencriptarlas. El valor solo aparece si lo pedís, y queda en la auditoría.</p>
            <label>
              Email
              <input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label>
              Contraseña
              <input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
          </>
        ) : null}
        {error ? <p className="alert" role="alert">{error}</p> : null}
        {gate === "setup" || gate === "login" ? (
          <button className="btn" type="submit" disabled={pending}>
            {pending ? "Entrando…" : gate === "setup" ? "Crear administrador" : "Entrar"}
          </button>
        ) : null}
        {gate === "login" && github ? (
          <>
            <p className="divider"><span>o</span></p>
            <a className="btn ghost" href="/api/auth/github/start">
              <Icon.github />
              Entrar con GitHub
            </a>
            <p className="note">Las cuentas de GitHub entran con permiso de lectura y no pueden desencriptar llaves.</p>
          </>
        ) : null}
      </form>
    </main>
  );
}
