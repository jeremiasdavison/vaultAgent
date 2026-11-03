import { useEffect, useState, type FormEvent } from "react";
import { api } from "./api";
import { KeyMark } from "./icons";
import type { User } from "./types";

type Gate = "loading" | "setup" | "login" | "offline";

export function Login({ onSuccess }: { onSuccess: (user: User) => void }) {
  const [gate, setGate] = useState<Gate>("loading");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
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
      </form>
    </main>
  );
}
