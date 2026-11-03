import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, ApiError } from "./api";
import { EnvPanel } from "./envpanel";
import { Icon, KeyMark } from "./icons";
import { Requests } from "./requests";
import { TYPE_LABEL, asString, asStringList, type Credential, type CredType, type Folder, type User } from "./types";

const SHARED = "__shared__";
const HIDE_AFTER_MS = 3 * 60 * 1000;
const NOTICE_MS = 4000;

const TYPES: { id: CredType; label: string; http: boolean }[] = [
  { id: "api_key", label: "API key", http: true },
  { id: "bearer_token", label: "Token Bearer", http: true },
  { id: "basic_auth", label: "HTTP Basic", http: true },
  { id: "password", label: "Contraseña", http: true },
  { id: "ssh_password", label: "SSH con contraseña", http: false },
  { id: "ssh_key", label: "SSH con clave", http: false },
];

const ROLE_LABEL: Record<string, string> = { admin: "Administración", editor: "Edición", viewer: "Lectura" };

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

const isSsh = (type: string) => type.startsWith("ssh");

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

function updatedLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("es-AR", { day: "numeric", month: "short" });
}

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
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [secret, setSecret] = useState<Record<string, string> | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(""));
  const [folderName, setFolderName] = useState("");
  const [view, setView] = useState<"keys" | "requests">("keys");
  const [pendingCount, setPendingCount] = useState(0);
  const [envOpen, setEnvOpen] = useState(false);

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
    void Promise.all([
      api<unknown[]>("/env-requests?status=pending"),
      api<unknown[]>("/approvals?status=pending"),
    ])
      .then(([envPending, approvalsPending]) => setPendingCount(envPending.length + approvalsPending.length))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!secret) return;
    const timer = window.setTimeout(() => setSecret(null), HIDE_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [secret]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

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
    setView("keys");
    setFolderId(id);
    setSelectedId(null);
    setSecret(null);
    setPassword("");
    setTypeFilter(null);
    setError(null);
    void load(id).catch(fail);
  }

  function chooseItem(id: string) {
    setSelectedId(id);
    setSecret(null);
    setPassword("");
    setError(null);
  }

  const matching = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) =>
      `${item.name} ${item.ref} ${item.folder} ${asString(item.meta.description)}`.toLowerCase().includes(needle),
    );
  }, [items, query]);

  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of matching) counts.set(item.type, (counts.get(item.type) ?? 0) + 1);
    return counts;
  }, [matching]);

  const visible = typeFilter ? matching.filter((item) => item.type === typeFilter) : matching;
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const writable = folders.filter((folder) => folder.level === "write");
  const currentFolder = folders.find((folder) => folder.id === folderId);
  const viewTitle = folderId === SHARED ? "Compartidas conmigo" : currentFolder?.name ?? "Todas las llaves";

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

  function openCreate() {
    setDraft(emptyDraft(writable.find((folder) => folder.id === folderId)?.id ?? writable[0]?.id ?? ""));
    setCreating(true);
    setError(null);
  }

  const passwordless = user.auth_source === "github";
  const canReveal = selected && !passwordless
    ? selected.allow_reveal && (selected.access === "shared" ? selected.share_level === "reveal" : user.role !== "viewer")
    : false;
  const http = selected ? TYPES.find((entry) => entry.id === selected.type)?.http !== false && !isSsh(String(selected.type)) : false;
  const draftHttp = TYPES.find((entry) => entry.id === draft.type)?.http ?? true;

  return (
    <div className="shell">
      <aside className="sidebar glass">
        <div className="brand">
          <KeyMark />
          <div>
            <strong>Llaverito</strong>
            <span>Bóveda municipal</span>
          </div>
        </div>

        <nav className="nav-group" aria-label="Vistas">
          <button className={view === "keys" && !folderId ? "nav on" : "nav"} type="button" onClick={() => chooseFolder(null)}>
            <Icon.stack />
            <span>Todas las llaves</span>
          </button>
          <button className={view === "keys" && folderId === SHARED ? "nav on" : "nav"} type="button" onClick={() => chooseFolder(SHARED)}>
            <Icon.shared />
            <span>Compartidas conmigo</span>
          </button>
          <button className={view === "requests" ? "nav on" : "nav"} type="button" onClick={() => { setView("requests"); setSelectedId(null); setSecret(null); }}>
            <Icon.check />
            <span>Solicitudes</span>
            {pendingCount > 0 ? <b className="count" aria-label={`${pendingCount} pendientes`}>{pendingCount}</b> : null}
          </button>
        </nav>

        <nav className="nav-group folders" aria-label="Carpetas">
          <p className="nav-title">Carpetas</p>
          {folders.length === 0 ? <p className="nav-title">Sin carpetas todavía.</p> : null}
          {folders.map((folder) => (
            <button key={folder.id} className={view === "keys" && folderId === folder.id ? "nav on" : "nav"} type="button" onClick={() => chooseFolder(folder.id)}>
              <Icon.folder />
              <span>{folder.name}</span>
              <small>{folder.level === "write" ? "escritura" : "lectura"}</small>
            </button>
          ))}
          {user.role === "admin" ? (
            <form className="new-folder" onSubmit={(event) => void createFolder(event)}>
              <input
                aria-label="Nombre de la nueva carpeta"
                value={folderName}
                onChange={(event) => setFolderName(event.target.value)}
                maxLength={120}
                required
                placeholder="Nueva carpeta"
              />
              <button className="icon-btn" type="submit" title="Crear carpeta" aria-label="Crear carpeta">
                <Icon.plus />
              </button>
            </form>
          ) : null}
        </nav>

        <div className="account">
          <span className="avatar" aria-hidden="true">{initials(user.name)}</span>
          <div>
            <strong>{user.name}</strong>
            <span>{ROLE_LABEL[user.role] ?? user.role} · {user.email}</span>
          </div>
          <button className="icon-btn" type="button" onClick={onLogout} title="Salir" aria-label="Salir">
            <Icon.logout />
          </button>
        </div>
      </aside>

      <main className="main">
        {view === "requests" ? (
          <>
            <header className="topline">
              <div className="title">
                <h1>Solicitudes</h1>
                <p>Lo que tus agentes y runners piden usar. Nada se entrega sin que alguien lo apruebe.</p>
              </div>
              <a className="classic" href="/classic/#/agentes">Agentes y tokens</a>
            </header>
            <Requests onError={fail} onNotice={setNotice} onCount={setPendingCount} />
          </>
        ) : (
        <>
        <header className="topline">
          <div className="title">
            <h1>{viewTitle}</h1>
            <p>
              {visible.length === 1 ? "1 llave" : `${visible.length} llaves`}. El valor cifrado no viaja hasta que lo desencriptás.
            </p>
          </div>
          <a className="classic" href="/classic/">Consola clásica</a>
          {currentFolder ? (
            <button className="btn ghost" type="button" onClick={() => setEnvOpen(true)}>
              <Icon.terminal />
              Variables de entorno
            </button>
          ) : null}
          <button
            className="btn"
            type="button"
            disabled={writable.length === 0}
            title={writable.length === 0 ? "Creá una carpeta primero" : undefined}
            onClick={openCreate}
          >
            <Icon.plus />
            Nueva llave
          </button>
        </header>

        <div className="toolbar">
          <label className="search glass">
            <Icon.search />
            <input
              type="search"
              aria-label="Buscar llaves"
              value={query}
              placeholder="Buscar por nombre, carpeta o referencia"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {typeCounts.size > 1 ? (
            <div className="chips" role="group" aria-label="Filtrar por tipo">
              <button className={typeFilter ? "chip" : "chip on"} type="button" aria-pressed={!typeFilter} onClick={() => setTypeFilter(null)}>
                Todos<b>{matching.length}</b>
              </button>
              {[...typeCounts.entries()].map(([type, count]) => (
                <button
                  key={type}
                  className={typeFilter === type ? "chip on" : "chip"}
                  type="button"
                  aria-pressed={typeFilter === type}
                  onClick={() => setTypeFilter(typeFilter === type ? null : type)}
                >
                  {TYPE_LABEL[type] ?? type}<b>{count}</b>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="workbench">
          <section className="panel glass" aria-label="Llaves">
            {error && !creating && !selected ? <p className="alert" role="alert">{error}</p> : null}
            {visible.length === 0 ? (
              <div className="empty">
                <KeyMark />
                <strong>{query || typeFilter ? "Nada coincide con la búsqueda" : "Esta vista no tiene llaves"}</strong>
                <p>
                  {query || typeFilter
                    ? "Probá con otro nombre o quitá el filtro de tipo."
                    : writable.length > 0
                      ? "Guardá la primera con Nueva llave. Queda cifrada desde el primer momento."
                      : "Pedile a un administrador acceso de escritura a una carpeta."}
                </p>
              </div>
            ) : (
              <ul className="rows">
                {visible.map((item) => (
                  <li key={item.id}>
                    <button className={item.id === selectedId ? "row on" : "row"} type="button" onClick={() => chooseItem(item.id)}>
                      <span className={isSsh(String(item.type)) ? "glyph ssh" : "glyph"}>
                        {isSsh(String(item.type)) ? <Icon.terminal /> : <Icon.key />}
                      </span>
                      <span className="row-main">
                        <strong>{item.name}</strong>
                        <code>{item.ref}{item.hint ? `  ••••${item.hint}` : ""}</code>
                      </span>
                      <span className="row-side">
                        <span className="tag">{TYPE_LABEL[item.type] ?? item.type}</span>
                        <span>
                          {item.access === "shared" ? "compartida" : item.folder}
                          {item.sensitive ? ", sensible" : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="detail panel glass" aria-live="polite" aria-label="Detalle">
            {!selected ? (
              <div className="empty">
                <Icon.lock />
                <strong>Ninguna llave elegida</strong>
                <p>Elegí una de la lista para ver sus datos y desencriptarla.</p>
              </div>
            ) : (
              <>
                <div className="detail-head">
                  <span className={isSsh(String(selected.type)) ? "glyph ssh" : "glyph"}>
                    {isSsh(String(selected.type)) ? <Icon.terminal /> : <Icon.key />}
                  </span>
                  <div>
                    <h2>{selected.name}</h2>
                    <p>{TYPE_LABEL[selected.type] ?? selected.type}, versión {selected.version}{updatedLabel(selected.updated_at) ? `, actualizada ${updatedLabel(selected.updated_at)}` : ""}</p>
                  </div>
                </div>

                <dl className="facts">
                  <div><dt>Referencia</dt><dd><code>{selected.ref}</code></dd></div>
                  {selected.hint ? <div><dt>Termina en</dt><dd><code>••••{selected.hint}</code></dd></div> : null}
                  <div><dt>Carpeta</dt><dd>{selected.folder}</dd></div>
                  <div><dt>Descripción</dt><dd>{asString(selected.meta.description) || "Sin descripción"}</dd></div>
                  {http ? (
                    <div><dt>Hosts</dt><dd>{asStringList(selected.meta.allowed_hosts).join(", ") || "Ninguno"}</dd></div>
                  ) : (
                    <div><dt>Destino</dt><dd>{asString(selected.meta.username)}@{asString(selected.meta.host)}:{String(selected.meta.port ?? "")}</dd></div>
                  )}
                  {selected.access === "shared" ? (
                    <div>
                      <dt>Acceso</dt>
                      <dd>
                        <span className="tag share">{selected.share_level === "reveal" ? "puede ver el valor" : "solo uso"}</span>
                      </dd>
                    </div>
                  ) : null}
                  {selected.sensitive ? (
                    <div><dt>Marca</dt><dd><span className="tag warn">sensible</span></dd></div>
                  ) : null}
                </dl>

                {secret ? (
                  <div className="seal open">
                    <div className="seal-head">
                      <h3><Icon.unlock />Valor desencriptado</h3>
                      <button className="btn ghost small" type="button" onClick={() => { setSecret(null); setNotice(null); }}>Ocultar</button>
                    </div>
                    <div className="fuse" title="Se oculta solo en 3 minutos"><i key={selected.id} /></div>
                    {Object.entries(secret).map(([key, value]) => (
                      <div key={key} className="secret-field">
                        <span>{key}</span>
                        <div className="secret-value">
                          <pre>{value}</pre>
                          <button className="icon-btn" type="button" title={`Copiar ${key}`} aria-label={`Copiar ${key}`} onClick={() => void copyValue(value)}>
                            <Icon.copy />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : canReveal ? (
                  <form className="seal" onSubmit={(event) => void reveal(event)}>
                    <h3><Icon.lock />Desencriptar</h3>
                    <p>Confirmá tu contraseña. Queda registrado en la auditoría y el valor no se guarda en el navegador.</p>
                    <label>
                      Tu contraseña
                      <input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
                    </label>
                    <button className="btn" type="submit">Desencriptar</button>
                  </form>
                ) : (
                  <p className="locked">
                    <Icon.lock />
                    {passwordless
                      ? "Entraste con GitHub: para desencriptar hace falta una cuenta con contraseña."
                      : "Tu acceso no permite ver el valor de esta llave."}
                  </p>
                )}
                {error ? <p className="alert" role="alert">{error}</p> : null}
              </>
            )}
          </section>
        </div>
        </>
        )}
      </main>

      {envOpen && currentFolder ? (
        <EnvPanel
          folderId={currentFolder.id}
          credentials={items}
          canWrite={currentFolder.level === "write"}
          isAdmin={user.role === "admin"}
          onClose={() => setEnvOpen(false)}
          onError={fail}
        />
      ) : null}

      {notice ? (
        <p className="toast glass" role="status">
          <Icon.check />
          {notice}
        </p>
      ) : null}

      {creating ? (
        <div className="modal-bg">
          <form className="modal glass" role="dialog" aria-modal="true" aria-labelledby="new-key-title" onSubmit={(event) => void createItem(event)}>
            <div className="modal-head">
              <h2 id="new-key-title">Nueva llave</h2>
              <p>Se guarda cifrada. Después solo la ve quien la desencripte con su contraseña.</p>
            </div>
            <div className="grid-2">
              <label>
                Nombre
                <input required maxLength={120} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
              </label>
              <label>
                Carpeta
                <select value={draft.folderId} onChange={(event) => setDraft({ ...draft, folderId: event.target.value })}>
                  {writable.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                </select>
              </label>
            </div>
            <div role="radiogroup" aria-label="Tipo" className="types">
              {TYPES.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="radio"
                  aria-checked={draft.type === entry.id}
                  className={draft.type === entry.id ? "type-option on" : "type-option"}
                  onClick={() => setDraft({ ...draft, type: entry.id })}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <label>
              Descripción
              <input value={draft.description} placeholder="Para qué sirve y quién la usa" onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
            </label>
            {draftHttp ? (
              <label>
                Hosts permitidos
                <textarea value={draft.hosts} placeholder={"api.ejemplo.com\n*.ejemplo.com"} onChange={(event) => setDraft({ ...draft, hosts: event.target.value })} />
              </label>
            ) : (
              <div className="grid-port">
                <label>
                  Host
                  <input required value={draft.host} onChange={(event) => setDraft({ ...draft, host: event.target.value })} />
                </label>
                <label>
                  Puerto
                  <input required type="number" min={1} max={65535} value={draft.port} onChange={(event) => setDraft({ ...draft, port: event.target.value })} />
                </label>
              </div>
            )}
            <label>
              Usuario
              <input
                required={!draftHttp || draft.type === "basic_auth"}
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
