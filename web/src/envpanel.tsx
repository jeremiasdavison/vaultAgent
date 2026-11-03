import { useEffect, useState, type FormEvent } from "react";
import { api } from "./api";
import { Icon } from "./icons";
import type { Credential, FolderEnv } from "./types";

export function EnvPanel({
  folderId,
  credentials,
  canWrite,
  isAdmin,
  onClose,
  onError,
}: {
  folderId: string;
  credentials: Credential[];
  canWrite: boolean;
  isAdmin: boolean;
  onClose: () => void;
  onError: (cause: unknown) => void;
}) {
  const [env, setEnv] = useState<FolderEnv | null>(null);
  const [envKey, setEnvKey] = useState("");
  const [credentialId, setCredentialId] = useState("");
  const [repo, setRepo] = useState("");
  const [error, setError] = useState<string | null>(null);

  const own = credentials.filter((item) => item.folder_id === folderId);

  function show(next: FolderEnv) {
    setEnv(next);
    setRepo(next.github_repo ?? "");
  }

  useEffect(() => {
    api<FolderEnv>(`/folders/${folderId}/env`).then(show).catch(onError);
  }, [folderId]);

  async function run(action: () => Promise<FolderEnv>) {
    setError(null);
    try {
      show(await action());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar");
    }
  }

  function addBinding(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const next = await api<FolderEnv>(`/folders/${folderId}/env/bindings`, {
        method: "POST",
        body: { env_key: envKey.trim().toUpperCase(), credential_id: credentialId },
      });
      setEnvKey("");
      return next;
    });
  }

  function saveRepo(event: FormEvent) {
    event.preventDefault();
    void run(() => api<FolderEnv>(`/folders/${folderId}/env`, { method: "PUT", body: { github_repo: repo.trim() || null } }));
  }

  return (
    <div className="modal-bg">
      <section className="modal glass" role="dialog" aria-modal="true" aria-labelledby="env-title">
        <div className="modal-head">
          <h2 id="env-title">Variables de entorno{env ? `: ${env.folder}` : ""}</h2>
          <p>
            Un runner de CI con token de agente pide estas variables, una persona aprueba y el runner las recibe en un
            sobre sellado que solo él abre. Ver <code>scripts/unseal.mjs</code>.
          </p>
        </div>

        {env === null ? (
          <p className="note">Cargando…</p>
        ) : env.bindings.length === 0 ? (
          <p className="locked"><Icon.terminal />Esta carpeta todavía no exporta variables.</p>
        ) : (
          <ul className="bindings">
            {env.bindings.map((binding) => (
              <li key={binding.id}>
                <code>{binding.env_key}</code>
                <span>{binding.credential}</span>
                {canWrite ? (
                  <button
                    className="btn ghost small"
                    type="button"
                    onClick={() => void run(() => api<FolderEnv>(`/folders/${folderId}/env/bindings/${binding.id}`, { method: "DELETE" }))}
                  >
                    Quitar
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {canWrite && own.length > 0 ? (
          <form className="grid-2" onSubmit={addBinding}>
            <label>
              Variable
              <input required value={envKey} placeholder="OPENAI_API_KEY" pattern="[A-Za-z][A-Za-z0-9_]{0,63}" onChange={(event) => setEnvKey(event.target.value)} />
            </label>
            <label>
              Credencial
              <select required value={credentialId} onChange={(event) => setCredentialId(event.target.value)}>
                <option value="" disabled>Elegí una</option>
                {own.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <div className="actions">
              <button className="btn" type="submit"><Icon.plus />Agregar variable</button>
            </div>
          </form>
        ) : null}

        {isAdmin ? (
          <form className="grid-2" onSubmit={saveRepo}>
            <label>
              Repositorio de GitHub, opcional
              <input value={repo} placeholder="owner/repo" onChange={(event) => setRepo(event.target.value)} />
            </label>
            <div className="actions">
              <button className="btn ghost" type="submit">Guardar repositorio</button>
            </div>
          </form>
        ) : env?.github_repo ? (
          <p className="note">Solo se entrega a runners de <code>{env.github_repo}</code>.</p>
        ) : null}

        {error ? <p className="alert" role="alert">{error}</p> : null}
        <div className="actions">
          <button className="btn ghost" type="button" onClick={onClose}>Cerrar</button>
        </div>
      </section>
    </div>
  );
}
