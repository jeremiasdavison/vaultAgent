import pytest

from llaverito.config import ConfigError, Settings, apply_platform


def base() -> Settings:
    return Settings(_env_file=None, master_key="x")


def test_injected_database_url_is_used_unless_overridden():
    assert apply_platform(base(), {"DATABASE_URL": "postgres://u:p@h/db"}).database_url == "postgres://u:p@h/db"
    own = base()
    own.database_url = "postgresql://propio/db"
    env = {"LLAVERITO_DATABASE_URL": "postgresql://propio/db", "DATABASE_URL": "postgres://otro/db"}
    assert apply_platform(own, env).database_url == "postgresql://propio/db"


def test_vercel_requires_postgres_and_secures_cookies():
    with pytest.raises(ConfigError):
        apply_platform(base(), {"VERCEL": "1"})
    s = apply_platform(base(), {"VERCEL": "1", "POSTGRES_URL": "postgres://h/db", "VERCEL_URL": "vault-agent-abc.vercel.app"})
    assert s.cookie_secure is True
    assert "vault-agent-abc.vercel.app" in s.mcp_allowed_hosts()


def test_outside_vercel_nothing_changes():
    s = apply_platform(base(), {})
    assert s.database_url.startswith("sqlite") and s.cookie_secure is False


def test_unprefixed_github_env_fills_settings():
    s = apply_platform(
        base(),
        {
            "GITHUB_CLIENT_ID": "Ov23liPublicId",
            "GITHUB_CLIENT_SECRET": "not-a-real-secret",
            "GITHUB_CALLBACK_URL": "https://llaverito-alpha.vercel.app/api/auth/github/callback",
        },
    )
    assert s.github_client_id == "Ov23liPublicId"
    assert s.github_client_secret is not None and s.github_client_secret.get_secret_value() == "not-a-real-secret"
    assert s.github_callback_url == "https://llaverito-alpha.vercel.app/api/auth/github/callback"


def test_prefixed_github_env_is_not_overridden_by_unprefixed():
    own = base()
    own.github_client_id = "from-prefix"
    s = apply_platform(own, {"GITHUB_CLIENT_ID": "unprefixed"})
    assert s.github_client_id == "from-prefix"
