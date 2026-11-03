from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient

from conftest import ADMIN_EMAIL, CSRF, Env, make_settings
from llaverito.app import create_app
from llaverito.ghauth import GitHubClient, GitHubFailed, GitHubIdentity, parse_user
from llaverito.models import User


class FakeGitHub(GitHubClient):
    """Reemplaza las llamadas HTTP a GitHub: cada código conocido devuelve una identidad."""

    def __init__(self, settings):
        super().__init__(settings)
        self.codes: dict[str, GitHubIdentity] = {}
        self.redirects: list[str] = []

    def identify(self, code, redirect_uri):
        self.redirects.append(redirect_uri)
        if code not in self.codes:
            raise GitHubFailed("GitHub rechazó el código de autorización")
        return self.codes[code]


@pytest.fixture
def gh_env(tmp_path):
    settings = make_settings(tmp_path, github_client_id="Iv1.test", github_client_secret="test-secret")
    app = create_app(settings)
    with TestClient(app):
        e = Env(app)
        e.rt.github = FakeGitHub(settings)
        yield e


def browser(env) -> TestClient:
    return TestClient(env.app, base_url="http://testserver", headers=CSRF, follow_redirects=False)


def github_login(env, code: str) -> TestClient:
    c = browser(env)
    r = c.get("/api/auth/github/start")
    assert r.status_code == 303
    state = parse_qs(urlparse(r.headers["location"]).query)["state"][0]
    r = c.get("/api/auth/github/callback", params={"code": code, "state": state})
    assert r.status_code == 303
    return c


def test_disabled_by_default(env):
    assert env.client.get("/api/auth/config").json()["github_enabled"] is False
    assert browser(env).get("/api/auth/github/start").status_code == 404


def test_start_redirects_to_github_with_state(gh_env):
    assert gh_env.client.get("/api/auth/config").json()["github_enabled"] is True
    r = browser(gh_env).get("/api/auth/github/start")
    assert r.status_code == 303
    target = urlparse(r.headers["location"])
    query = parse_qs(target.query)
    assert target.netloc == "github.com" and query["client_id"] == ["Iv1.test"]
    assert query["redirect_uri"] == ["http://testserver/api/auth/github/callback"]
    assert query["allow_signup"] == ["true"]
    assert "llv_oauth_state" in r.headers["set-cookie"] and "samesite=lax" in r.headers["set-cookie"].lower()


def test_first_login_creates_a_viewer_account(gh_env):
    gh_env.rt.github.codes["ok"] = GitHubIdentity(id=4242, login="AnaDev", name="Ana Dev")
    c = github_login(gh_env, "ok")
    me = c.get("/api/auth/me").json()
    assert me["role"] == "viewer" and me["auth_source"] == "github"
    assert me["email"] == "4242+anadev@users.noreply.github.com" and me["name"] == "Ana Dev"


def test_same_github_id_reuses_the_account_after_a_rename(gh_env):
    gh_env.rt.github.codes["a"] = GitHubIdentity(id=7, login="viejo", name="Persona")
    gh_env.rt.github.codes["b"] = GitHubIdentity(id=7, login="nuevo", name="Persona")
    first = github_login(gh_env, "a").get("/api/auth/me").json()
    second = github_login(gh_env, "b").get("/api/auth/me").json()
    assert first["id"] == second["id"] and second["email"].startswith("7+nuevo@")


def test_never_links_to_a_local_account(gh_env):
    gh_env.rt.github.codes["x"] = GitHubIdentity(id=99, login="intruso", name=ADMIN_EMAIL)
    with gh_env.rt.session() as s:
        s.add(User(email=ADMIN_EMAIL, name="Admin", password_hash="x", role="admin"))
    me = github_login(gh_env, "x").get("/api/auth/me").json()
    assert me["role"] == "viewer" and me["email"] != ADMIN_EMAIL


def test_bad_state_or_code_does_not_log_in(gh_env):
    c = browser(gh_env)
    c.get("/api/auth/github/start")
    r = c.get("/api/auth/github/callback", params={"code": "ok", "state": "forjado"})
    assert r.headers["location"] == "/?login_error=github_state"
    assert c.get("/api/auth/me").status_code == 401

    r = c.get("/api/auth/github/start")
    state = parse_qs(urlparse(r.headers["location"]).query)["state"][0]
    r = c.get("/api/auth/github/callback", params={"code": "desconocido", "state": state})
    assert r.headers["location"] == "/?login_error=github_rejected"
    assert c.get("/api/auth/me").status_code == 401

    r = c.get("/api/auth/github/start")
    state = parse_qs(urlparse(r.headers["location"]).query)["state"][0]
    r = c.get("/api/auth/github/callback", params={"error": "access_denied", "state": state})
    assert r.headers["location"] == "/?login_error=github_rejected"
    assert c.get("/api/auth/me").status_code == 401


def test_inactive_account_is_blocked(gh_env):
    gh_env.rt.github.codes["ok"] = GitHubIdentity(id=5, login="baja", name="Baja")
    github_login(gh_env, "ok")
    with gh_env.rt.session() as s:
        s.query(User).filter(User.auth_source == "github").update({"active": False})
    c = browser(gh_env)
    r = c.get("/api/auth/github/start")
    state = parse_qs(urlparse(r.headers["location"]).query)["state"][0]
    r = c.get("/api/auth/github/callback", params={"code": "ok", "state": state})
    assert r.headers["location"] == "/?login_error=github_inactive"
    assert c.get("/api/auth/me").status_code == 401


def test_github_accounts_have_no_password(gh_env):
    gh_env.rt.github.codes["ok"] = GitHubIdentity(id=8, login="sinclave", name="Sin Clave")
    c = github_login(gh_env, "ok")
    assert c.post("/api/auth/login", json={"email": "8+sinclave@users.noreply.github.com", "password": ""}).status_code == 401


@pytest.mark.parametrize(
    "data",
    [None, [], {"id": "1", "login": "a"}, {"id": True, "login": "a"}, {"id": 1, "login": "a/../b"}, {"id": 0, "login": "a"}],
)
def test_parse_user_rejects_bad_payloads(data):
    with pytest.raises(GitHubFailed):
        parse_user(data)
