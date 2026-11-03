import { useEffect, useState } from "react";
import { api } from "./api";
import { Icon } from "./icons";
import type { Approval, EnvRequest } from "./types";

const STATUS_LABEL: Record<string, string> = {
  pending: "pendiente",
  approved: "aprobado",
  denied: "rechazado",
  consumed: "entregado",
  expired: "vencido",
};

function when(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function Requests({
  onError,
  onNotice,
  onCount,
}: {
  onError: (cause: unknown) => void;
  onNotice: (message: string) => void;
  onCount: (count: number) => void;
}) {
  const [envRequests, setEnvRequests] = useState<EnvRequest[] | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);

  async function load() {
    const [nextEnv, nextApprovals] = await Promise.all([
      api<EnvRequest[]>("/env-requests"),
      api<Approval[]>("/approvals"),
    ]);
    setEnvRequests(nextEnv);
    setApprovals(nextApprovals);
    onCount(nextEnv.filter((row) => row.status === "pending").length + nextApprovals.filter((row) => row.status === "pending").length);
  }

  useEffect(() => {
    void load().catch(onError);
  }, []);

  async function decideEnv(id: string, approve: boolean) {
    try {
      await api(`/env-requests/${id}/decide`, { method: "POST", body: { approve } });
      onNotice(approve ? "Aprobado. El runner tiene 2 minutos para canjearlo una vez." : "Pedido rechazado.");
      await load();
    } catch (cause) {
      onError(cause);
    }
  }

  async function decideApproval(id: string, approve: boolean) {
    try {
      await api(`/approvals/${id}/decide`, { method: "POST", body: { approve } });
      onNotice(approve ? "Acción aprobada." : "Acción rechazada.");
      await load();
    } catch (cause) {
      onError(cause);
    }
  }

  if (envRequests === null) return <section className="panel glass"><p className="empty">Cargando…</p></section>;

  return (
    <div className="requests">
      <section className="panel glass" aria-labelledby="env-requests-title">
        <header className="panel-head">
          <h2 id="env-requests-title">Entornos para CI</h2>
          <p>Un runner pide las variables de una carpeta. Aprobar no muestra ningún valor: se lo entrega sellado al runner.</p>
        </header>
        {envRequests.length === 0 ? (
          <div className="empty"><Icon.terminal /><p>No hay pedidos de entorno.</p></div>
        ) : (
          <ul className="rows">
            {envRequests.map((row) => (
              <li key={row.id} className="request">
                <span className="glyph ssh"><Icon.terminal /></span>
                <span className="row-main">
                  <strong>{row.purpose}</strong>
                  <span className="muted">
                    {row.agent} pide {row.folder}{row.repository ? ` desde ${row.repository}` : ""}, {when(row.created_at)}
                  </span>
                  <span className="env-keys">{row.entries.map((entry) => <code key={entry.env_key}>{entry.env_key}</code>)}</span>
                </span>
                <span className="request-actions">
                  <span className={row.status === "pending" ? "tag warn" : "tag"}>{STATUS_LABEL[row.status] ?? row.status}</span>
                  {row.status === "pending" && row.can_decide ? (
                    <>
                      <button className="btn ghost small" type="button" onClick={() => void decideEnv(row.id, false)}>Rechazar</button>
                      <button className="btn small" type="button" onClick={() => void decideEnv(row.id, true)}>Aprobar</button>
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel glass" aria-labelledby="approvals-title">
        <header className="panel-head">
          <h2 id="approvals-title">Acciones de agentes</h2>
          <p>Pedidos HTTP o comandos SSH que un agente MCP quiere hacer con una llave y necesitan tu visto bueno.</p>
        </header>
        {approvals.length === 0 ? (
          <div className="empty"><Icon.key /><p>No hay acciones esperando aprobación.</p></div>
        ) : (
          <ul className="rows">
            {approvals.map((row) => (
              <li key={row.id} className="request">
                <span className="glyph"><Icon.key /></span>
                <span className="row-main">
                  <strong>{row.summary}</strong>
                  <span className="muted">{row.agent} con <code>{row.credential}</code>{row.reason ? `: ${row.reason}` : ""}, {when(row.requested_at)}</span>
                </span>
                <span className="request-actions">
                  <span className={row.status === "pending" ? "tag warn" : "tag"}>{STATUS_LABEL[row.status] ?? row.status}</span>
                  {row.status === "pending" ? (
                    <>
                      <button className="btn ghost small" type="button" onClick={() => void decideApproval(row.id, false)}>Rechazar</button>
                      <button className="btn small" type="button" onClick={() => void decideApproval(row.id, true)}>Aprobar</button>
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
