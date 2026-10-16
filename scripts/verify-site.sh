#!/usr/bin/env bash
# Verifica una publicación existente sin usar credenciales AWS.
set -euo pipefail

URL="${1:-}"
[[ "$URL" == https://* ]] || { echo "Uso: $0 https://dominio" >&2; exit 1; }
URL="${URL%/}"

TMP_BODY="$(mktemp)"
TMP_HEADERS="$(mktemp)"
trap 'rm -f "$TMP_BODY" "$TMP_HEADERS"' EXIT

retry=(--retry 12 --retry-delay 10 --retry-all-errors)

echo "Verificando $URL"
curl --fail --silent --show-error "${retry[@]}" --dump-header "$TMP_HEADERS" --output "$TMP_BODY" "$URL/"

grep -Fq '<title>Calculadora de Varillas' "$TMP_BODY" || { echo 'ERROR: index.html no corresponde a la aplicación.' >&2; exit 1; }
grep -Eiq '^content-security-policy:' "$TMP_HEADERS" || { echo 'ERROR: falta Content-Security-Policy.' >&2; exit 1; }
grep -Eiq '^strict-transport-security:' "$TMP_HEADERS" || { echo 'ERROR: falta Strict-Transport-Security.' >&2; exit 1; }
grep -Eiq '^x-content-type-options:[[:space:]]*nosniff' "$TMP_HEADERS" || { echo 'ERROR: falta X-Content-Type-Options: nosniff.' >&2; exit 1; }

check_asset() {
  local path="$1" expected_type="$2"
  local headers
  headers="$(curl --fail --silent --show-error "${retry[@]}" --head "$URL/$path")"
  printf '%s' "$headers" | grep -Eiq "^content-type:[[:space:]]*$expected_type" || {
    echo "ERROR: Content-Type inesperado para $path" >&2
    printf '%s\n' "$headers" >&2
    exit 1
  }
  printf '  ✓ %s\n' "$path"
}

check_asset 'sw.js' 'text/javascript'
check_asset 'manifest.webmanifest' 'application/manifest\+json'
check_asset 'css/estilos.css' 'text/css'
check_asset 'js/app.js' 'text/javascript'
check_asset 'iconos/icono-192.png' 'image/png'

echo '  ✓ HTTPS y cabeceras de seguridad'
echo 'Sitio publicado correctamente.'
