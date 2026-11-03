"""Login con GitHub (OAuth App, flujo de código de autorización).

Decisiones de seguridad (ver README):
- Cualquier cuenta de GitHub puede entrar, con el rol `github_default_role` (lectura por defecto).
- La cuenta se identifica por el id numérico de GitHub, nunca por el email: si se vinculara por email, quien
  agregue a su GitHub el email de un admin local tomaría esa cuenta. El email interno es el noreply de GitHub
  (`{id}+{login}@users.noreply.github.com`), que no choca con cuentas locales ni de AD.
- Estas cuentas no tienen contraseña, así que no pueden confirmar un desencriptado.
- `state` aleatorio en una cookie SameSite=Lax de corta vida, comparado en tiempo constante en el callback.
"""

import re
from dataclasses import dataclass
from urllib.parse import urlencode

import httpx

from .config import Settings

AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
TOKEN_URL = "https://github.com/login/oauth/access_token"
USER_URL = "https://api.github.com/user"
NOREPLY_DOMAIN = "users.noreply.github.com"


class GitHubFailed(Exception):
    """GitHub rechazó el código o no respondió bien: no se inicia sesión."""


@dataclass
class GitHubIdentity:
    id: int
    login: str
    name: str

    @property
    def email(self) -> str:
        return f"{self.id}+{self.login.lower()}@{NOREPLY_DOMAIN}"


def email_prefix(github_id: int) -> str:
    return f"{github_id}+"


class GitHubClient:
    def __init__(self, settings: Settings):
        secret = settings.github_client_secret
        self.client_id = settings.github_client_id
        self.client_secret = secret.get_secret_value() if secret else ""
        self.timeout = settings.ad_timeout_seconds

    def authorize_url(self, redirect_uri: str, state: str) -> str:
        query = {"client_id": self.client_id, "redirect_uri": redirect_uri, "state": state, "scope": "read:user", "allow_signup": "true"}
        return f"{AUTHORIZE_URL}?{urlencode(query)}"

    def identify(self, code: str, redirect_uri: str) -> GitHubIdentity:
        try:
            with httpx.Client(timeout=self.timeout, follow_redirects=False) as http:
                r = http.post(
                    TOKEN_URL,
                    headers={"Accept": "application/json"},
                    data={"client_id": self.client_id, "client_secret": self.client_secret, "code": code, "redirect_uri": redirect_uri},
                )
                token = r.json().get("access_token") if r.status_code == 200 else None
                if not isinstance(token, str) or not token:
                    raise GitHubFailed("GitHub rechazó el código de autorización")
                r = http.get(USER_URL, headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"})
                data = r.json() if r.status_code == 200 else None
        except httpx.HTTPError as exc:
            raise GitHubFailed(f"GitHub no respondió: {exc.__class__.__name__}") from None
        except ValueError:
            raise GitHubFailed("Respuesta inválida de GitHub") from None
        return parse_user(data)


def parse_user(data: object) -> GitHubIdentity:
    if not isinstance(data, dict):
        raise GitHubFailed("Respuesta inválida de GitHub")
    gid, login, name = data.get("id"), data.get("login"), data.get("name")
    if not isinstance(gid, int) or isinstance(gid, bool) or gid <= 0:
        raise GitHubFailed("GitHub no devolvió un id de usuario")
    if not isinstance(login, str) or not re.fullmatch(r"[A-Za-z0-9-]{1,39}", login):
        raise GitHubFailed("GitHub devolvió un login inválido")
    display = name.strip()[:255] if isinstance(name, str) and name.strip() else login
    return GitHubIdentity(id=gid, login=login, name=display)
