"""Entorno para CI: un runner pide las variables de una carpeta y las recibe en un sobre de un solo uso.

Flujo (portado del PoC Next.js de Llaverito, mismo formato de sobre que `scripts/unseal.mjs`):
1. Una carpeta mapea credenciales a variables (`OPENAI_API_KEY` -> `cred://proyecto/OpenAI`).
2. El runner genera un par X25519 fuera del modelo y pide el entorno con su token de agente y la clave pública.
3. Una persona aprueba en la web. La aprobación no devuelve ningún valor.
4. Durante 2 minutos el runner puede canjear el pedido una sola vez: recibe los valores sellados para su clave.

Decisiones de seguridad:
- El agente tiene que tener la carpeta (o cada credencial) entre sus grants, y su dueño acceso vigente.
- Quien aprueba tiene que poder revelar cada credencial (rol y "permitir revelar"): exportar es revelar.
- Lo que se aprueba queda fijado al pedir (credencial + variable); cambiar las variables después no lo amplía.
- Si la carpeta tiene `github_repo`, el pedido tiene que declarar ese repositorio.
- El canje marca el pedido como consumido antes de abrir nada; un segundo canje falla.
"""

import base64
import json
import os
import re
from datetime import timedelta
from typing import Any

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

SEAL_ALG = "X25519-HKDF-SHA256-AES-256-GCM"
SEAL_INFO = b"llaverito-seal-v1"
ENV_KEY_RE = re.compile(r"^[A-Z][A-Z0-9_]{0,63}$")
REPO_RE = re.compile(r"^[A-Za-z0-9_.-]{1,39}/[A-Za-z0-9_.-]{1,100}$")
PENDING_TTL = timedelta(hours=24)
GRANT_TTL = timedelta(seconds=120)


def b64u(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def b64u_decode(value: str) -> bytes:
    if not re.fullmatch(r"[A-Za-z0-9_-]+", value or ""):
        raise ValueError("no es base64url")
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def parse_wrap_key(value: str) -> bytes:
    try:
        raw = b64u_decode(value)
    except ValueError:
        raw = b""
    if len(raw) != 32:
        raise ValueError("La clave pública de cierre debe ser X25519 de 32 bytes en base64url")
    return raw


def seal_json(value: Any, recipient_public: bytes) -> dict:
    """Sella `value` para la clave X25519 del runner. Compatible con `openSeal` del PoC y con `unseal.mjs`."""
    ephemeral = X25519PrivateKey.generate()
    shared = ephemeral.exchange(X25519PublicKey.from_public_bytes(recipient_public))
    key = HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=SEAL_INFO).derive(shared)
    iv = os.urandom(12)
    sealed = AESGCM(key).encrypt(iv, json.dumps(value, separators=(",", ":")).encode(), None)
    return {
        "alg": SEAL_ALG,
        "ephemeralPublicKey": b64u(ephemeral.public_key().public_bytes_raw()),
        "iv": b64u(iv),
        "ciphertext": b64u(sealed[:-16]),
        "tag": b64u(sealed[-16:]),
    }


def open_seal(sealed: dict, recipient_private: bytes) -> Any:
    """Abre un sobre. Lo usa el runner (o los tests); el servidor nunca tiene la clave privada."""
    if sealed.get("alg") != SEAL_ALG:
        raise ValueError("Algoritmo de cierre no soportado")
    private = X25519PrivateKey.from_private_bytes(recipient_private)
    shared = private.exchange(X25519PublicKey.from_public_bytes(b64u_decode(sealed["ephemeralPublicKey"])))
    key = HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=SEAL_INFO).derive(shared)
    body = b64u_decode(sealed["ciphertext"]) + b64u_decode(sealed["tag"])
    return json.loads(AESGCM(key).decrypt(b64u_decode(sealed["iv"]), body, None))
