"""Entorno para CI: variables por carpeta, pedido del runner, aprobación humana y canje sellado de un solo uso."""

import json
import os
import shutil
import subprocess
from datetime import timedelta
from pathlib import Path

import pytest
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
from sqlalchemy import create_engine, inspect, text

from llaverito.envdelivery import b64u, open_seal, seal_json
from llaverito.models import EnvRequest, utcnow
from llaverito.runtime import add_missing_columns
from test_api import SECRET, new_cred

ROOT = Path(__file__).resolve().parents[1]


def keypair() -> tuple[str, bytes]:
    private = X25519PrivateKey.generate()
    return b64u(private.public_key().public_bytes_raw()), private.private_bytes_raw()


@pytest.fixture
def project(admin, folder):
    cred = new_cred(admin, folder, name="OpenAI").json()
    r = admin.post(f"/api/folders/{folder['id']}/env/bindings", json={"env_key": "OPENAI_API_KEY", "credential_id": cred["id"]})
    assert r.status_code == 201, r.text
    return {"folder": folder, "cred": cred}


@pytest.fixture
def runner(env, admin, project):
    r = admin.post("/api/agents", json={"name": "ci", "grants": [{"folder_id": project["folder"]["id"]}]})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def ask(env, runner, folder_id, pub, **over):
    body = {"purpose": "deploy", "wrap_public_key": pub, **over}
    return env.client.post(f"/api/agent/folders/{folder_id}/env", json=body, headers=runner)


def test_hint_shows_last_four_of_long_tokens_only(admin, folder):
    assert new_cred(admin, folder).json()["hint"] == SECRET[-4:]
    pw = new_cred(admin, folder, name="db", type="password", meta={"allowed_hosts": []}, secret={"password": "una contraseña larga"})
    assert pw.json()["hint"] is None


def test_bindings_validate_name_and_folder(admin, folder, project):
    fid = folder["id"]
    bad = admin.post(f"/api/folders/{fid}/env/bindings", json={"env_key": "openai-key", "credential_id": project["cred"]["id"]})
    assert bad.status_code == 422
    dup = admin.post(f"/api/folders/{fid}/env/bindings", json={"env_key": "OPENAI_API_KEY", "credential_id": project["cred"]["id"]})
    assert dup.status_code == 409
    other = admin.post("/api/folders", json={"name": "otra"}).json()
    elsewhere = new_cred(admin, other, name="x").json()
    assert admin.post(f"/api/folders/{fid}/env/bindings", json={"env_key": "X", "credential_id": elsewhere["id"]}).status_code == 422
    env = admin.get(f"/api/folders/{fid}/env").json()
    assert [b["env_key"] for b in env["bindings"]] == ["OPENAI_API_KEY"] and env["bindings"][0]["value"] is None


def test_manifest_has_no_values_and_needs_a_grant(env, admin, project, runner):
    fid = project["folder"]["id"]
    manifest = env.client.get(f"/api/agent/folders/{fid}/env", headers=runner).json()
    assert manifest["bindings"][0]["env_key"] == "OPENAI_API_KEY" and SECRET not in json.dumps(manifest)
    stranger = admin.post("/api/agents", json={"name": "otro", "grants": []}).json()["token"]
    assert env.client.get(f"/api/agent/folders/{fid}/env", headers={"Authorization": f"Bearer {stranger}"}).status_code == 404
    assert env.client.get(f"/api/agent/folders/{fid}/env").status_code == 401


def test_full_flow_seals_values_for_the_runner_once(env, admin, project, runner):
    pub, priv = keypair()
    fid = project["folder"]["id"]
    req = ask(env, runner, fid, pub)
    assert req.status_code == 201, req.text
    rid = req.json()["id"]
    assert env.client.post(f"/api/agent/env-requests/{rid}/redeem", headers=runner).status_code == 410  # sin aprobar

    pending = admin.get("/api/env-requests", params={"status": "pending"}).json()
    assert pending[0]["id"] == rid and pending[0]["can_decide"] is True
    decided = admin.post(f"/api/env-requests/{rid}/decide", json={"approve": True})
    assert decided.status_code == 200 and SECRET not in decided.text

    out = env.client.post(f"/api/agent/env-requests/{rid}/redeem", headers=runner)
    assert out.status_code == 200, out.text
    assert SECRET not in json.dumps(out.json()["entries"])
    opened = open_seal(out.json()["sealed"], priv)
    assert opened == {"entries": [{"envKey": "OPENAI_API_KEY", "name": "OpenAI", "secret": SECRET}]}
    assert env.client.post(f"/api/agent/env-requests/{rid}/redeem", headers=runner).status_code == 410  # un solo uso
    actions = [e["action"] for e in admin.get("/api/audit").json()]
    assert {"env_request", "env_request_approve", "env_redeem"} <= set(actions)
    assert SECRET not in json.dumps(admin.get("/api/audit").json())


def test_denied_and_expired_requests_cannot_be_redeemed(env, admin, project, runner):
    pub, _ = keypair()
    fid = project["folder"]["id"]
    rid = ask(env, runner, fid, pub).json()["id"]
    admin.post(f"/api/env-requests/{rid}/decide", json={"approve": False})
    assert env.client.post(f"/api/agent/env-requests/{rid}/redeem", headers=runner).status_code == 410

    rid = ask(env, runner, fid, pub).json()["id"]
    admin.post(f"/api/env-requests/{rid}/decide", json={"approve": True})
    with env.rt.session() as s:
        s.get(EnvRequest, rid).grant_expires_at = utcnow() - timedelta(seconds=1)
    assert env.client.post(f"/api/agent/env-requests/{rid}/redeem", headers=runner).status_code == 410
    assert env.client.get(f"/api/agent/env-requests/{rid}", headers=runner).json()["status"] == "expired"


def test_repository_must_match_the_folder(env, admin, project, runner):
    fid = project["folder"]["id"]
    assert admin.put(f"/api/folders/{fid}/env", json={"github_repo": "no es un repo"}).status_code == 422
    assert admin.put(f"/api/folders/{fid}/env", json={"github_repo": "muni/app"}).status_code == 200
    pub, _ = keypair()
    assert ask(env, runner, fid, pub).status_code == 403
    assert ask(env, runner, fid, pub, repository="otro/app").status_code == 403
    assert ask(env, runner, fid, pub, repository="muni/app").status_code == 201


def test_bad_wrap_key_is_rejected(env, project, runner):
    fid = project["folder"]["id"]
    assert ask(env, runner, fid, "corta").status_code == 422
    assert ask(env, runner, fid, b64u(b"x" * 31)).status_code == 422


def test_approver_must_be_able_to_reveal(env, admin, project, runner):
    pw = env.add_user("editor@x.gov.ar", "editor")
    editor = env.login("editor@x.gov.ar", pw)
    uid = next(u["id"] for u in admin.get("/api/users").json() if u["email"] == "editor@x.gov.ar")
    fid = project["folder"]["id"]
    admin.put(f"/api/folders/{fid}/access", json=[{"user_id": uid, "level": "write"}])
    token = editor.post("/api/agents", json={"name": "ci-editor", "grants": [{"folder_id": fid}]}).json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    admin.patch(f"/api/credentials/{project['cred']['id']}", json={"allow_reveal": False})
    pub, _ = keypair()
    rid = ask(env, headers, fid, pub).json()["id"]
    assert editor.get("/api/env-requests").json()[0]["can_decide"] is False
    assert editor.post(f"/api/env-requests/{rid}/decide", json={"approve": True}).status_code == 403


def test_access_change_after_approval_blocks_redeem(env, admin, project, runner):
    pub, _ = keypair()
    fid = project["folder"]["id"]
    rid = ask(env, runner, fid, pub).json()["id"]
    admin.post(f"/api/env-requests/{rid}/decide", json={"approve": True})
    admin.patch(f"/api/credentials/{project['cred']['id']}", json={"allow_reveal": False})
    assert env.client.post(f"/api/agent/env-requests/{rid}/redeem", headers=runner).status_code == 409
    assert env.client.post(f"/api/agent/env-requests/{rid}/redeem", headers=runner).status_code == 410


def test_deleting_a_credential_removes_its_binding(admin, folder, project):
    assert admin.delete(f"/api/credentials/{project['cred']['id']}").status_code == 204
    assert admin.get(f"/api/folders/{folder['id']}/env").json()["bindings"] == []


def test_old_databases_get_the_new_columns(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE folders (id VARCHAR(32) PRIMARY KEY, name VARCHAR(120), description TEXT, created_at DATETIME)"))
    add_missing_columns(engine)
    assert "github_repo" in {c["name"] for c in inspect(engine).get_columns("folders")}


@pytest.mark.skipif(shutil.which("node") is None, reason="sin Node")
def test_node_unseal_script_opens_python_seals(tmp_path):
    pub, priv = keypair()
    from llaverito.envdelivery import parse_wrap_key

    sealed = seal_json({"entries": [{"envKey": "TOKEN", "name": "t", "secret": 'a"b\nc'}]}, parse_wrap_key(pub))
    path = tmp_path / "sealed.json"
    path.write_text(json.dumps({"sealed": sealed}))
    out = subprocess.run(
        ["node", str(ROOT / "scripts" / "unseal.mjs"), str(path)],
        env={**os.environ, "LLAVERITO_WRAP_PRIVATE_KEY": b64u(priv)},
        capture_output=True,
        text=True,
        check=True,
    )
    assert out.stdout == 'TOKEN="a\\"b\\nc"\n'
