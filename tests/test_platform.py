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
