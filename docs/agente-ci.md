# Entorno para CI: cómo un runner recibe sus variables

Un runner (GitHub Actions, GitLab CI, un script en la VM) no ve los secretos en ninguna respuesta de aprobación.
Genera una clave X25519 fuera del modelo, pide el entorno, espera que una persona apruebe y canjea un sobre que
solo él puede abrir. El canje sirve una vez y dura 2 minutos.

## 1. Preparar la carpeta (en la web)

1. Abrí la carpeta y tocá **Variables de entorno**.
2. Agregá cada variable: nombre (`OPENAI_API_KEY`) y credencial de esa carpeta.
3. Opcional, solo admin: fijá el repositorio (`owner/repo`). Con eso, solo un pedido que declare ese repositorio pasa.

## 2. Token del runner

En **Agentes** (consola clásica) creá un agente con permiso sobre la carpeta. El token (`llv_…`) se muestra una vez:
guardalo como secreto del CI, por ejemplo `LLAVERITO_TOKEN`. Ese token puede leer el manifiesto, pedir y canjear;
no puede revelar nada sin una aprobación.

## 3. Manifiesto, sin valores

```bash
curl -sS "$LLAVERITO_URL/api/agent/folders/$FOLDER_ID/env" -H "authorization: Bearer $LLAVERITO_TOKEN"
```

Trae `env_key` y el nombre de cada credencial. `value` es siempre `null`.

## 4. Pedido

En el runner, nunca en el prompt de un modelo:

```bash
node --input-type=module -e '
import crypto from "node:crypto";
const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519");
const pub = Buffer.from(publicKey.export({ format: "der", type: "spki" })).subarray(-32).toString("base64url");
const priv = Buffer.from(privateKey.export({ format: "der", type: "pkcs8" })).subarray(-32).toString("base64url");
console.log(JSON.stringify({ pub, priv }));
' > "$RUNNER_TEMP/llaverito-wrap.json"

curl -sS -X POST "$LLAVERITO_URL/api/agent/folders/$FOLDER_ID/env" \
  -H "authorization: Bearer $LLAVERITO_TOKEN" -H "content-type: application/json" \
  -d "{\"purpose\":\"deploy\",\"wrap_public_key\":\"$PUB\",\"repository\":\"$GITHUB_REPOSITORY\"}"
```

La respuesta trae el `id` del pedido en estado `pending`.

## 5. Aprobación (en la web)

Una persona lo aprueba en **Solicitudes**. Puede aprobar un admin o el dueño del agente, siempre que pueda revelar
cada credencial del pedido. Lo que se aprueba es exactamente lo que se listó al pedir.

## 6. Canje y apertura

```bash
curl -sS "$LLAVERITO_URL/api/agent/env-requests/$REQUEST_ID" -H "authorization: Bearer $LLAVERITO_TOKEN"   # esperar "approved"

curl -sS -X POST "$LLAVERITO_URL/api/agent/env-requests/$REQUEST_ID/redeem" \
  -H "authorization: Bearer $LLAVERITO_TOKEN" -o "$RUNNER_TEMP/llaverito-sealed.json"

LLAVERITO_WRAP_PRIVATE_KEY="$PRIV" node scripts/unseal.mjs "$RUNNER_TEMP/llaverito-sealed.json" >> "$GITHUB_ENV"
rm "$RUNNER_TEMP/llaverito-sealed.json" "$RUNNER_TEMP/llaverito-wrap.json"
```

`unseal.mjs` escribe `CLAVE="valor"` por variable. No imprimas el archivo en los logs.

Un segundo canje responde 410. Si entre la aprobación y el canje alguien le quitó el permiso al agente o desactivó
"permitir revelar", el pedido se consume sin entregar nada (409). Cancelar: `DELETE /api/agent/env-requests/$REQUEST_ID`.

## Qué no hace

No federa OIDC de GitHub Actions: el token del runner es un secreto de larga vida (ponele vencimiento al crearlo).
La aprobación siempre es una persona en la web.
