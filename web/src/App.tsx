import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { Login } from "./login";
import type { User } from "./types";
import { Vault } from "./vault";

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<User>("/auth/me")
      .then((me) => {
        if (!cancelled) setUser(me);
      })
      .catch((error: unknown) => {
        if (!cancelled && !(error instanceof ApiError && error.status === 401)) {
          setUser(null);
        }
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function logout() {
    await api("/auth/logout", { method: "POST" });
    setUser(null);
  }

  if (!ready) {
    return (
      <main className="boot">
        <p>Abriendo la bóveda…</p>
      </main>
    );
  }

  if (!user) return <Login onSuccess={setUser} />;

  return <Vault user={user} onLogout={() => void logout()} onSessionLost={() => setUser(null)} />;
}
