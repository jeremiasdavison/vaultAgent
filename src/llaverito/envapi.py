"""Endpoints del entorno para CI: variables por carpeta (personas) y pedido/canje sellado (runners con token)."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.orm import Session, joinedload

from . import audit
from .api import DB, RT, Admin, CurrentUser, ip_of, log
from .broker import Broker, Unauthorized
from .envdelivery import ENV_KEY_RE, GRANT_TTL, PENDING_TTL, REPO_RE, parse_wrap_key, seal_json
from .models import Agent, Credential, EnvBinding, EnvRequest, Folder, User, utcnow
from .vault import VaultError, credential_access, folder_level, open_secret, primary_value, reveal_allowed

router = APIRouter(prefix="/api")


# ------------------------------------------------------------------ esquemas


class EnvSettingsIn(BaseModel):
    github_repo: str | None = Field(default=None, max_length=140)


class BindingIn(BaseModel):
    env_key: str
    credential_id: str


class EnvRequestIn(BaseModel):
    purpose: str = Field(min_length=1, max_length=255)
    wrap_public_key: str = Field(max_length=64)
    repository: str | None = Field(default=None, max_length=140)


class EnvDecideIn(BaseModel):
    approve: bool


# ------------------------------------------------------------------ helpers


def binding_out(b: EnvBinding) -> dict:
    return {"id": b.id, "env_key": b.env_key, "credential_id": b.credential_id, "credential": b.credential.name, "value": None}


def bindings_of(db: Session, folder_id: str) -> list[EnvBinding]:
    return list(
        db.scalars(
            select(EnvBinding).options(joinedload(EnvBinding.credential)).where(EnvBinding.folder_id == folder_id).order_by(EnvBinding.env_key)
        )
    )


def env_out(folder: Folder, bindings: list[EnvBinding]) -> dict:
    return {"folder_id": folder.id, "folder": folder.name, "github_repo": folder.github_repo, "bindings": [binding_out(b) for b in bindings]}


def readable_folder(db: Session, user: User, folder_id: str, need: str = "read") -> Folder:
    folder = db.get(Folder, folder_id)
    level = folder_level(db, user, folder_id) if folder else None
    if folder is None or level is None:
        raise HTTPException(404, "Carpeta no encontrada")
    if need == "write" and level != "write":
        raise HTTPException(403, "Sin permiso de escritura en esa carpeta")
    return folder


def refresh_status(r: EnvRequest) -> str:
    now = utcnow()
    if r.status == "pending" and r.created_at + PENDING_TTL <= now:
        r.status = "expired"
    elif r.status == "approved" and r.grant_expires_at and r.grant_expires_at <= now:
        r.status = "expired"
    return r.status


def request_out(r: EnvRequest, can_decide: bool = False) -> dict:
    return {
        "id": r.id,
        "status": r.status,
        "purpose": r.purpose,
        "repository": r.repository,
        "folder_id": r.folder_id,
        "folder": r.folder.name if r.folder else None,
        "agent": r.agent.name if r.agent else None,
        "entries": [{"env_key": e["env_key"], "credential": e.get("credential", "")} for e in r.entries],
        "created_at": r.created_at.isoformat(),
        "grant_expires_at": r.grant_expires_at.isoformat() if r.grant_expires_at else None,
        "can_decide": can_decide,
    }


def agent_log(db: Session, agent: Agent, request: Request, action: str, outcome: str = "ok", **kw) -> None:
    audit.record(db, actor_type="agent", actor_id=agent.id, actor_name=agent.name, action=action, outcome=outcome, ip=ip_of(request), **kw)


def get_broker(request: Request) -> Broker:
    return request.app.state.broker


def current_agent(request: Request, db: DB) -> Agent:
    auth = request.headers.get("authorization", "")
    token = auth[7:].strip() if auth.lower().startswith("bearer ") else None
    try:
        agent = get_broker(request).authenticate(db, token)
    except Unauthorized as exc:
        raise HTTPException(401, str(exc), headers={"WWW-Authenticate": 'Bearer realm="llaverito"'}) from None
    if not get_broker(request).limiter.allow(agent.id):
        raise HTTPException(429, "Demasiados pedidos del agente. Esperá un minuto.")
    return agent


CurrentAgent = Annotated[Agent, Depends(current_agent)]


def agent_folder(db: Session, request: Request, agent: Agent, folder_id: str) -> tuple[Folder, list[EnvBinding]]:
    """Carpeta y variables que este agente puede pedir: cada credencial tiene que estar en sus grants."""
    folder = db.get(Folder, folder_id)
    if folder is None:
        raise HTTPException(404, "Carpeta no encontrada")
    bindings = bindings_of(db, folder.id)
    broker = get_broker(request)
    if not bindings or not all(broker._granted(db, agent, b.credential) for b in bindings):
        # Sin distinguir "no existe" de "no autorizado": no revela qué carpetas hay.
        raise HTTPException(404, "Carpeta no encontrada o sin variables autorizadas para este agente")
    return folder, bindings


def may_decide(db: Session, user: User, r: EnvRequest) -> bool:
    """Admin, o dueño del agente con permiso de revelar cada credencial del pedido."""
    if user.role == "viewer" or r.agent is None:
        return False
    if user.role != "admin" and r.agent.owner_id != user.id:
        return False
    for entry in r.entries:
        cred = db.get(Credential, entry["credential_id"])
        if cred is None:
            return False
        level, share = credential_access(db, user, cred)
        if not reveal_allowed(user, cred, level, share):
            return False
    return True


# ------------------------------------------------------------------ personas: variables por carpeta


@router.get("/folders/{folder_id}/env")
def get_env(folder_id: str, user: CurrentUser, db: DB) -> dict:
    folder = readable_folder(db, user, folder_id)
    return env_out(folder, bindings_of(db, folder.id))


@router.put("/folders/{folder_id}/env")
def set_env_settings(folder_id: str, body: EnvSettingsIn, admin: Admin, request: Request, db: DB) -> dict:
    folder = readable_folder(db, admin, folder_id, "write")
    repo = (body.github_repo or "").strip() or None
    if repo and not REPO_RE.fullmatch(repo):
        raise HTTPException(422, "El repositorio tiene que verse como owner/repo")
    folder.github_repo = repo
    log(db, admin, request, "env_settings", target=folder.name, detail={"github_repo": repo})
    db.commit()
    return env_out(folder, bindings_of(db, folder.id))


@router.post("/folders/{folder_id}/env/bindings", status_code=201)
def add_binding(folder_id: str, body: BindingIn, user: CurrentUser, request: Request, db: DB) -> dict:
    folder = readable_folder(db, user, folder_id, "write")
    key = body.env_key.strip()
    if not ENV_KEY_RE.fullmatch(key):
        raise HTTPException(422, "La variable tiene que verse como OPENAI_API_KEY: mayúsculas, números y _")
    cred = db.get(Credential, body.credential_id)
    if cred is None or cred.folder_id != folder.id:
        raise HTTPException(422, "La credencial tiene que estar en esta carpeta")
    if db.scalar(select(EnvBinding.id).where(EnvBinding.folder_id == folder.id, EnvBinding.env_key == key)):
        raise HTTPException(409, f"{key} ya está definida en esta carpeta")
    binding = EnvBinding(folder_id=folder.id, credential_id=cred.id, env_key=key)
    db.add(binding)
    db.flush()
    log(db, user, request, "env_bind", credential=cred, detail={"env_key": key})
    db.commit()
    return env_out(folder, bindings_of(db, folder.id))


@router.delete("/folders/{folder_id}/env/bindings/{binding_id}")
def remove_binding(folder_id: str, binding_id: int, user: CurrentUser, request: Request, db: DB) -> dict:
    folder = readable_folder(db, user, folder_id, "write")
    binding = db.get(EnvBinding, binding_id)
    if binding is None or binding.folder_id != folder.id:
        raise HTTPException(404, "Variable no encontrada")
    log(db, user, request, "env_unbind", credential=binding.credential, detail={"env_key": binding.env_key})
    db.delete(binding)
    db.commit()
    return env_out(folder, bindings_of(db, folder.id))


# ------------------------------------------------------------------ personas: pedidos de entorno


def load_request(db: Session, request_id: str) -> EnvRequest | None:
    return db.scalar(
        select(EnvRequest).options(joinedload(EnvRequest.agent), joinedload(EnvRequest.folder)).where(EnvRequest.id == request_id)
    )


@router.get("/env-requests")
def list_env_requests(user: CurrentUser, db: DB, status: str | None = None) -> list[dict]:
    stmt = (
        select(EnvRequest)
        .options(joinedload(EnvRequest.agent), joinedload(EnvRequest.folder))
        .order_by(EnvRequest.created_at.desc())
        .limit(200)
    )
    if user.role != "admin":
        stmt = stmt.join(Agent, EnvRequest.agent_id == Agent.id).where(Agent.owner_id == user.id)
    out = []
    for r in db.scalars(stmt).unique():
        refresh_status(r)
        if status is None or r.status == status:
            out.append(request_out(r, r.status == "pending" and may_decide(db, user, r)))
    db.commit()
    return out


@router.post("/env-requests/{request_id}/decide")
def decide_env_request(request_id: str, body: EnvDecideIn, user: CurrentUser, request: Request, db: DB) -> dict:
    r = load_request(db, request_id)
    if r is None or (user.role != "admin" and (r.agent is None or r.agent.owner_id != user.id)):
        raise HTTPException(404, "Pedido no encontrado")
    if refresh_status(r) != "pending":
        db.commit()
        raise HTTPException(409, "El pedido ya no está pendiente")
    if not may_decide(db, user, r):
        raise HTTPException(403, "Para aprobar tenés que poder revelar cada credencial del pedido")
    now = utcnow()
    r.status = "approved" if body.approve else "denied"
    r.decided_by, r.decided_at = user.id, now
    if body.approve:
        r.grant_expires_at = now + GRANT_TTL
    log(
        db,
        user,
        request,
        "env_request_approve" if body.approve else "env_request_deny",
        target=r.folder.name if r.folder else None,
        detail={"request_id": r.id, "agent": r.agent.name, "vars": [e["env_key"] for e in r.entries]},
    )
    db.commit()
    return request_out(r)


# ------------------------------------------------------------------ runners (token de agente)


@router.get("/agent/folders/{folder_id}/env")
def agent_manifest(folder_id: str, agent: CurrentAgent, request: Request, db: DB) -> dict:
    folder, bindings = agent_folder(db, request, agent, folder_id)
    db.commit()
    return env_out(folder, bindings)


@router.post("/agent/folders/{folder_id}/env", status_code=201)
def agent_request_env(folder_id: str, body: EnvRequestIn, agent: CurrentAgent, request: Request, db: DB) -> dict:
    folder, bindings = agent_folder(db, request, agent, folder_id)
    try:
        parse_wrap_key(body.wrap_public_key)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    repo = (body.repository or "").strip() or None
    if folder.github_repo and repo != folder.github_repo:
        agent_log(db, agent, request, "env_request", "denied", target=folder.name, detail={"reason": "repository_mismatch", "repository": repo})
        db.commit()
        raise HTTPException(403, "El repositorio no coincide con el de la carpeta")
    r = EnvRequest(
        agent_id=agent.id,
        folder_id=folder.id,
        purpose=body.purpose.strip(),
        repository=repo,
        wrap_public_key=body.wrap_public_key,
        entries=[{"credential_id": b.credential_id, "credential": b.credential.name, "env_key": b.env_key} for b in bindings],
    )
    db.add(r)
    db.flush()
    agent_log(db, agent, request, "env_request", "pending", target=folder.name, detail={"request_id": r.id, "vars": len(bindings)})
    db.commit()
    r = load_request(db, r.id)
    return {**request_out(r), "confirmation": "Quedó pendiente. Una persona tiene que aprobarlo en Llaverito."}


def agent_request(db: Session, agent: Agent, request_id: str) -> EnvRequest:
    r = load_request(db, request_id)
    if r is None or r.agent_id != agent.id:
        raise HTTPException(404, "Pedido no encontrado")
    return r


@router.get("/agent/env-requests/{request_id}")
def agent_request_status(request_id: str, agent: CurrentAgent, db: DB) -> dict:
    r = agent_request(db, agent, request_id)
    refresh_status(r)
    db.commit()
    return request_out(r)


@router.post("/agent/env-requests/{request_id}/redeem")
def agent_redeem(request_id: str, agent: CurrentAgent, request: Request, db: DB) -> dict:
    r = agent_request(db, agent, request_id)
    if refresh_status(r) != "approved":
        db.commit()
        raise HTTPException(410, "El pedido no está aprobado, venció o ya se canjeó")
    # Se consume primero y de forma atómica: dos canjes simultáneos no pueden pasar los dos.
    consumed = db.execute(
        update(EnvRequest)
        .where(EnvRequest.id == r.id, EnvRequest.status == "approved", EnvRequest.consumed_at.is_(None))
        .values(status="consumed", consumed_at=utcnow())
    )
    if consumed.rowcount != 1:
        db.rollback()
        raise HTTPException(410, "El pedido no está aprobado, venció o ya se canjeó")
    db.commit()
    broker = get_broker(request)
    entries = []
    for entry in r.entries:
        cred = db.get(Credential, entry["credential_id"])
        if cred is None or not cred.allow_reveal or not broker._granted(db, agent, cred):
            agent_log(db, agent, request, "env_redeem", "denied", target=r.folder.name, detail={"request_id": r.id, "reason": "access_changed"})
            db.commit()
            raise HTTPException(409, "Cambió el acceso a una credencial del pedido. Se consumió sin entregar nada.")
        try:
            value = primary_value(cred.type, open_secret(broker.rt.cipher, cred))
        except VaultError as exc:
            db.commit()
            raise HTTPException(409, str(exc)) from None
        entries.append({"envKey": entry["env_key"], "name": cred.name, "secret": value})
    sealed = seal_json({"entries": entries}, parse_wrap_key(r.wrap_public_key))
    agent_log(db, agent, request, "env_redeem", target=r.folder.name, detail={"request_id": r.id, "vars": [e["envKey"] for e in entries]})
    db.commit()
    return {"sealed": sealed, "entries": [{"envKey": e["envKey"], "name": e["name"]} for e in entries]}


@router.delete("/agent/env-requests/{request_id}", status_code=204)
def agent_cancel(request_id: str, agent: CurrentAgent, request: Request, db: DB) -> Response:
    r = agent_request(db, agent, request_id)
    if refresh_status(r) in ("pending", "approved"):
        r.status = "denied"
        agent_log(db, agent, request, "env_request_cancel", target=r.folder.name, detail={"request_id": r.id})
    db.commit()
    return Response(status_code=204)
