import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, ApiError } from "./api";
import { KeyMark } from "./login";
import { TYPE_LABEL, asString, asStringList, type Credential, type CredType, type Folder, type User } from "./types";

const SHARED = "__shared__";
const HIDE_AFTER_MS = 3 * 60 * 1000;

const TYPES: { id: CredType; label: string; http: boolean }[] = [
  { id: "api_key", label: "API key", http: true },
  { id: "bearer_token", label: "Token Bearer", http: true },
  { id: "basic_auth", label: "Usuario y contraseña (HTTP Basic)", http: true },
  { id: "password", label: "Contraseña", http: true },
  { id: "ssh_password", label: "SSH con contraseña", http: false },
  { id: "ssh_key", label: "SSH con clave privada", http: false },
];

type Draft = {
  folderId: string;
  name: string;
  type: CredType;
  description: string;
  hosts: string;
  username: string;
  host: string;
  port: string;
  secret: string;
  extra: string;
};

const emptyDraft = (folderId: string): Draft => ({
  folderId,
  name: "",
  type: "api_key",
  description: "",
  hosts: "",
  username: "",
  host: "",
  port: "22",
  secret: "",
  extra: "",
});

export function Vault({
  user,
  onLogout,
  onSessionLost,
}: {
  user: User;
  onLogout: () => void;
  onSessionLost: () => void;
}) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [items, setItems] = useState<Credential[]>([]);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [secret, setSecret] = useState<Record<string, string> | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(""));
  const [folderName, setFolderName] = useState("");

  async function load(nextFolder = folderId) {
    const params = new URLSearchParams();
    if (nextFolder === SHARED) params.set("shared", "true");
    else if (nextFolder) params.set("folder_id", nextFolder);
    const [nextFolders, nextItems] = await Promise.all([
      api<Folder[]>("/folders"),
      api<Credential[]>(`/credentials?${params}`),
    ]);
    setFolders(nextFolders);
    setItems(nextItems);
  }

  useEffect(() => {
    void load(null).catch(fail);
  }, []);

  useEffect(() => {
    if (!secret) return;
    const timer = window.setTimeout(() => setSecret(null), HIDE_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [secret]);

  useEffect(() => {
    if (selectedId && !items.some((item) => item.id === selectedId)) {
      setSelectedId(null);
      setSecret(null);
    }
  }, [items, selectedId]);

  function fail(cause: unknown) {
    if (cause instanceof ApiError && cause.status === 401) {
      onSessionLost();
      return;
    }
    setError(cause instanceof Error ? cause.message : "Error inesperado");
  }

  function chooseFolder(id: string | null) {
    setFolderId(id);
    setSelectedId(null);
    setSecret(null);
    setPassword("");
    void load(id).catch(fail);
  }

  function chooseItem(id: string) {
    setSelectedId(id);
    setSecret(null);
    setPassword("");
    setError(null);
  }

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) =>
      `${item.name} ${item.ref} ${item.folder} ${asString(item.meta.description)}`.toLowerCase().includes(needle),
    );
  }, [items, query]);

  const selected = items.find((item) => item.id === selectedId) ?? null;
  const writable = folders.filter((folder) => folder.level === "write");

  async function reveal(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setError(null);
    try {
      const data = await api<{ secret: Record<string, string> }>(`/credentials/${selected.id}/reveal`, {
        method: "POST",
        body: { password },
      });
      setSecret(data.secret);
      setPassword("");
      setNotice("Desencriptada. Se oculta sola en 3 minutos.");
    } catch (cause) {
      fail(cause);
    }
  }

  async function copyValue(value: string) {
    await navigator.clipboard.writeText(value);
    setNotice("Copiado. No lo pegues en un chat ni en un archivo del repo.");
  }

  async function createFolder(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const created = await api<Folder>("/folders", { method: "POST", body: { name: folderName, description: "" } });
      setFolderName("");
      setFolderId(created.id);
      await load(created.id);
      setNotice(`Carpeta ${created.name} creada`);
    } catch (cause) {
      fail(cause);
    }
  }

  async function createItem(event: FormEvent) {
    event.preventDefault();
    const kind = TYPES.find((entry) => entry.id === draft.type);
    if (!kind) return;
    const meta: Record<string, unknown> = { description: draft.description };
    const secretBody: Record<string, string> = {};
    if (kind.http) {
      meta.allowed_hosts = draft.hosts.split(/[\n,]/).map((line) => line.trim()).filter(Boolean);
      meta.username = draft.username;
      if (draft.type === "api_key") meta.inject_mode = "header";
      if (draft.type === "bearer_token") meta.inject_mode = "bearer";
      if (draft.type === "basic_auth") meta.inject_mode = "basic";
      if (draft.type === "password") meta.inject_mode = "none";
      if (draft.type === "basic_auth" || draft.type === "password") secretBody.password = draft.secret;
      else secretBody.secret = draft.secret;
    } else {
      meta.host = draft.host.trim();
      meta.port = Number(draft.port || 22);
      meta.username = draft.username.trim();
      if (draft.type === "ssh_key") {
        secretBody.private_key = draft.secret;
        if (draft.extra.trim()) secretBody.passphrase = draft.extra;
      } else secretBody.password = draft.secret;
    }
    setError(null);
    try {
      const created = await api<Credential>("/credentials", {
        method: "POST",
        body: {
          folder_id: draft.folderId,
          name: draft.name,
          type: draft.type,
          meta,
          secret: secretBody,
          sensitive: false,
          allow_reveal: true,
        },
      });
      setCreating(false);
      setDraft(emptyDraft(draft.folderId));
      setFolderId(created.folder_id);
      await load(created.folder_id);
      setSelectedId(created.id);
      setNotice("Guardada cifrada. La lista no muestra el valor.");
    } catch (cause) {
      fail(cause);
    }
  }

  const canReveal = selected
    ? selected.allow_reveal && (selected.access === "shared" ? selected.share_level === "reveal" : user.role !== "viewer")
    : false;
  const http = selected ? TYPES.find((entry) => entry.id === selected.type)?.http !== false && !String(selected.type).startsWith("ssh") : false;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <KeyMark />
          <div>
            <strong>Llaverito</strong>
            <span>Llaves</span>
          </div>
        </div>
        <p className="who">
          {user.name}
          <span>{user.email}</span>
        </p>
        <a className="text-link" href="/classic/">Consola clásica</a>
        <button className="btn ghost" type="button" onClick={onLogout}>Salir</button>
      </header>

      <div className="workbench">
        <aside className="rail">
          <p className="eyebrow">Carpetas</p>
          <button className={folderId ? "nav" : "nav on"} type="button" onClick={() => chooseFolder(null)}>Todas</button>
          <button className={folderId === SHARED ? "nav on" : "nav"} type="button" onClick={() => chooseFolder(SHARED)}>Compartidas conmigo</button>
          {folders.map((folder) => (
            <button key={folder.id} className={folderId === folder.id ? "nav on" : "nav"} type="button" onClick={() => chooseFolder(folder.id)}>
              <span>{folder.name}</span>
              <small>{folder.level === "write" ? "escritura" : "lectura"}</small>
            </button>
          ))}
          {user.role === "admin" ? (
            <form className="mini" onSubmit={(event) => void createFolder(event)}>
              <label>
                Nueva carpeta
                <input value={folderName} onChange={(event) => setFolderName(event.target.value)} maxLength={120} required placeholder="Nombre" />
              </label>
              <button className="btn" type="submit">Crear</button>
            </form>
          ) : null}
        </aside>

        <section className="list">
          <div className="list-head">
            <div>
              <h1>Llaves</h1>
              <p>{visible.length} en esta vista. El valor cifrado no viaja hasta que lo desencriptás.</p>
            </div>
            <button
              className="btn"
              type="button"
              disabled={writable.length === 0}
              title={writable.length === 0 ? "Creá una carpeta primero" : undefined}
              onClick={() => {
                setDraft(emptyDraft(writable.find((folder) => folder.id === folderId)?.id ?? writable[0]?.id ?? ""));
                setCreating(true);
                setError(null);
              }}
            >
              Nueva llave
            </button>
          </div>
          <label className="search">
            Buscar
            <input type="search" value={query} placeholder="Nombre, carpeta o referencia" onChange={(event) => setQuery(event.target.value)} />
          </label>
          {error && !creating && !selected ? <p className="alert" role="alert">{error}</p> : null}
          {visible.length === 0 ? (
            <div className="empty">
              <KeyMark />
              <p>Todavía no hay llaves en esta vista.</p>
            </div>
          ) : (
            <ul className="cards">
              {visible.map((item) => (
                <li key={item.id}>
                  <button className={item.id === selectedId ? "card on" : "card"} type="button" onClick={() => chooseItem(item.id)}>
                    <span className="kind">{TYPE_LABEL[item.type] ?? item.type}</span>
                    <strong>{item.name}</strong>
                    <span className="meta">{item.folder}{item.sensitive ? " · sensible" : ""}</span>
                    <code>{item.ref}</code>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="detail" aria-live="polite">
          {!selected ? (
            <div className="empty">
              <p>Elegí una llave para ver el detalle y desencriptarla.</p>
            </div>
          ) : (
            <>
              <p className="eyebrow">{TYPE_LABEL[selected.type] ?? selected.type}</p>
              <h2>{selected.name}</h2>
              <dl>
                <div><dt>Referencia</dt><dd><code>{selected.ref}</code></dd></div>
                <div><dt>Carpeta</dt><dd>{selected.folder}</dd></div>
                <div><dt>Descripción</dt><dd>{asString(selected.meta.description) || "—"}</dd></div>
                {http ? (
                  <div><dt>Hosts</dt><dd>{asStringList(selected.meta.allowed_hosts).join(", ") || "Ninguno"}</dd></div>
                ) : (
                  <div><dt>Destino</dt><dd>{asString(selected.meta.username)}@{asString(selected.meta.host)}:{String(selected.meta.port ?? "")}</dd></div>
                )}
                <div><dt>Versión</dt><dd>{selected.version}</dd></div>
              </dl>

              {secret ? (
                <div className="secret">
                  <div className="secret-head">
                    <h3>Valor desencriptado</h3>
                    <button className="btn ghost" type="button" onClick={() => { setSecret(null); setNotice(null); }}>Ocultar</button>
                  </div>
                  {Object.entries(secret).map(([key, value]) => (
                    <div key={key} className="secret-field">
                      <span>{key}</span>
                      <pre>{value}</pre>
                      <button className="btn ghost" type="button" onClick={() => void copyValue(value)}>Copiar</button>
                    </div>
                  ))}
                </div>
              ) : canReveal ? (
                <form className="reveal" onSubmit={(event) => void reveal(event)}>
                  <h3>Desencriptar</h3>
                  <p>Confirmá tu contraseña. Esta acción queda auditada y el valor no se guarda en el navegador.</p>
                  <label>
                    Contraseña
                    <input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
                  </label>
                  <button className="btn" type="submit">Desencriptar</button>
                </form>
              ) : (
                <p className="note">Esta llave no se puede revelar con tu acceso.</p>
              )}
              {error ? <p className="alert" role="alert">{error}</p> : null}
              {notice ? <p className="note" role="status">{notice}</p> : null}
            </>
          )}
        </section>
      </div>

      {creating ? (
        <div className="modal-bg">
          <form className="modal" onSubmit={(event) => void createItem(event)}>
            <h2>Nueva llave</h2>
            <label>
              Carpeta
              <select value={draft.folderId} onChange={(event) => setDraft({ ...draft, folderId: event.target.value })}>
                {writable.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
              </select>
            </label>
            <label>
              Nombre
              <input required maxLength={120} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </label>
            <label>
              Tipo
              <select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as CredType })}>
                {TYPES.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
              </select>
            </label>
            <label>
              Descripción
              <input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
            </label>
            {TYPES.find((entry) => entry.id === draft.type)?.http ? (
              <label>
                Hosts permitidos
                <textarea value={draft.hosts} placeholder={"api.ejemplo.com\n*.ejemplo.com"} onChange={(event) => setDraft({ ...draft, hosts: event.target.value })} />
              </label>
            ) : (
              <>
                <label>
                  Host
                  <input required value={draft.host} onChange={(event) => setDraft({ ...draft, host: event.target.value })} />
                </label>
                <label>
                  Puerto
                  <input required type="number" min={1} max={65535} value={draft.port} onChange={(event) => setDraft({ ...draft, port: event.target.value })} />
                </label>
              </>
            )}
            <label>
              Usuario
              <input
                required={!TYPES.find((entry) => entry.id === draft.type)?.http || draft.type === "basic_auth"}
                value={draft.username}
                onChange={(event) => setDraft({ ...draft, username: event.target.value })}
              />
            </label>
            <label>
              {draft.type === "ssh_key" ? "Clave privada" : draft.type === "bearer_token" || draft.type === "api_key" ? "Secreto" : "Contraseña"}
              <textarea required minLength={6} spellCheck={false} autoComplete="off" value={draft.secret} onChange={(event) => setDraft({ ...draft, secret: event.target.value })} />
            </label>
            {draft.type === "ssh_key" ? (
              <label>
                Passphrase, opcional
                <input type="password" autoComplete="new-password" value={draft.extra} onChange={(event) => setDraft({ ...draft, extra: event.target.value })} />
              </label>
            ) : null}
            {error ? <p className="alert" role="alert">{error}</p> : null}
            <div className="actions">
              <button className="btn ghost" type="button" onClick={() => { setCreating(false); setDraft(emptyDraft("")); setError(null); }}>Cancelar</button>
              <button className="btn" type="submit">Guardar cifrada</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
