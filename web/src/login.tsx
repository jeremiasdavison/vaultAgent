import { useState, type FormEvent } from "react";
import { api } from "./api";
import type { User } from "./types";

export function Login({ onSuccess }: { onSuccess: (user: User) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      onSuccess(await api<User>("/auth/login", { method: "POST", body: { email, password } }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo entrar");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="login-screen">
      <form className="login-card" onSubmit={(event) => void submit(event)}>
        <KeyMark />
        <p className="eyebrow">Bóveda municipal</p>
        <h1>Llaverito</h1>
        <p className="lede">Entrá para ver las llaves y desencriptarlas. El valor solo aparece si lo pedís, y queda en la auditoría.</p>
        <label>
          Email
          <input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label>
          Contraseña
          <input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {error ? <p className="alert" role="alert">{error}</p> : null}
        <button className="btn" type="submit" disabled={pending}>{pending ? "Entrando…" : "Entrar"}</button>
      </form>
    </main>
  );
}

export function KeyMark() {
  return (
    <svg className="mark" viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="18" cy="18" r="10" fill="none" stroke="currentColor" strokeWidth="3" />
      <circle cx="18" cy="18" r="3.5" fill="currentColor" />
      <path d="M26 22 L42 38 M34 38 H42 V30" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
