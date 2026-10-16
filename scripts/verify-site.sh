#!/usr/bin/env bash
# Verifica de forma anónima una publicación HTTPS de Calculadora de Varillas.
set -euo pipefail

URL="${1:-}"
[[ "$URL" == https://* ]] || { printf 'Uso: %s https://dominio\n' "$0" >&2; exit 1; }
URL="${URL%/}"
HTTP_URL="http://${URL#https://}"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
RETRY=(--retry 18 --retry-delay 10 --retry-all-errors)

printf 'Verificando publicación anónima de Calculadora de Varillas...\n'
HTTP_STATUS="$(curl --silent --head "${RETRY[@]}" --dump-header "$TMP_DIR/http-headers" \
  --output /dev/null --write-out '%{http_code}' "$HTTP_URL/" 2>/dev/null)"
[[ "$HTTP_STATUS" =~ ^30[1278]$ ]] || { printf 'ERROR: HTTP no redirige a HTTPS.\n' >&2; exit 1; }
grep -Eiq '^location:[[:space:]]*https://' "$TMP_DIR/http-headers" || {
  printf 'ERROR: la redirección no apunta a HTTPS.\n' >&2
  exit 1
}

curl --fail --silent --show-error "${RETRY[@]}" --dump-header "$TMP_DIR/index-headers" \
  --output "$TMP_DIR/index.html" "$URL/"
grep -Fq '<title>Calculadora de Varillas ·' "$TMP_DIR/index.html" || {
  printf 'ERROR: index.html no corresponde a la calculadora.\n' >&2
  exit 1
}

[[ "$(grep -o 'data-control-ventana' "$TMP_DIR/index.html" | wc -l | tr -d ' ')" == '5' ]] || {
  printf 'ERROR: la publicación no contiene exactamente cinco controles WCO.\n' >&2
  exit 1
}
[[ "$(grep -o 'id="control-compartir"' "$TMP_DIR/index.html" | wc -l | tr -d ' ')" == '1' ]] || {
  printf 'ERROR: la publicación no contiene exactamente un control Compartir.\n' >&2
  exit 1
}
[[ "$(grep -o 'data-compartir-accion' "$TMP_DIR/index.html" | wc -l | tr -d ' ')" == '7' ]] || {
  printf 'ERROR: la hoja no contiene exactamente siete acciones para compartir.\n' >&2
  exit 1
}
[[ "$(grep -o 'target="_blank" rel="noopener noreferrer"' "$TMP_DIR/index.html" | wc -l | tr -d ' ')" == '4' ]] || {
  printf 'ERROR: los destinos HTTPS no conservan target y rel seguros.\n' >&2
  exit 1
}
grep -Fq 'id="dialogo-compartir"' "$TMP_DIR/index.html" || { printf 'ERROR: falta la hoja de Compartir.\n' >&2; exit 1; }
grep -Fq 'aria-labelledby="titulo-compartir"' "$TMP_DIR/index.html" || { printf 'ERROR: la hoja no tiene nombre accesible.\n' >&2; exit 1; }
grep -Fq 'aria-describedby="descripcion-compartir"' "$TMP_DIR/index.html" || { printf 'ERROR: la hoja no tiene descripción accesible.\n' >&2; exit 1; }
grep -Fq 'id="estado-compartir"' "$TMP_DIR/index.html" || { printf 'ERROR: falta feedback propio de Compartir.\n' >&2; exit 1; }
grep -Fq 'id="copia-manual"' "$TMP_DIR/index.html" || { printf 'ERROR: falta la copia manual accesible.\n' >&2; exit 1; }

grep -Eiq '^content-security-policy:' "$TMP_DIR/index-headers" || { printf 'ERROR: falta CSP.\n' >&2; exit 1; }
grep -Eiq '^x-frame-options:[[:space:]]*DENY' "$TMP_DIR/index-headers" || { printf 'ERROR: falta X-Frame-Options: DENY.\n' >&2; exit 1; }
grep -Eiq '^x-content-type-options:[[:space:]]*nosniff' "$TMP_DIR/index-headers" || { printf 'ERROR: falta nosniff.\n' >&2; exit 1; }
grep -Eiq '^strict-transport-security:[[:space:]]*max-age=47304000' "$TMP_DIR/index-headers" || { printf 'ERROR: falta HSTS esperado.\n' >&2; exit 1; }
grep -Eiq '^referrer-policy:[[:space:]]*strict-origin-when-cross-origin' "$TMP_DIR/index-headers" || { printf 'ERROR: falta Referrer Policy.\n' >&2; exit 1; }
grep -Eiq '^permissions-policy:.*clipboard-write=\(self\)' "$TMP_DIR/index-headers" || { printf 'ERROR: falta permiso same-origin para clipboard.\n' >&2; exit 1; }
grep -Eiq '^permissions-policy:.*web-share=\(self\)' "$TMP_DIR/index-headers" || { printf 'ERROR: falta permiso same-origin para Web Share.\n' >&2; exit 1; }
! grep -Eiq '^x-xss-protection:' "$TMP_DIR/index-headers" || { printf 'ERROR: está presente X-XSS-Protection obsoleto.\n' >&2; exit 1; }
! grep -Eiq '^content-security-policy:.*unsafe-(inline|eval)' "$TMP_DIR/index-headers" || { printf 'ERROR: CSP contiene una excepción insegura.\n' >&2; exit 1; }

check_asset() {
  local path="$1"
  local expected_type="$2"
  local output="$TMP_DIR/${path//\//-}"
  local headers="$output.headers"
  curl --fail --silent --show-error "${RETRY[@]}" --dump-header "$headers" \
    --output "$output" "$URL/$path"
  grep -Eiq "^content-type:[[:space:]]*$expected_type" "$headers" || {
    printf 'ERROR: Content-Type inesperado para %s.\n' "$path" >&2
    exit 1
  }
  printf '  ✓ %s\n' "$path"
}

check_asset 'offline.html' 'text/html'
check_asset 'manifest.webmanifest' 'application/manifest\+json'
check_asset 'sw.js' '(text|application)/javascript'
check_asset 'css/estilos.css' 'text/css'
check_asset 'js/app.js' '(text|application)/javascript'
check_asset 'js/calculo.js' '(text|application)/javascript'
check_asset 'js/registro-sw.js' '(text|application)/javascript'
check_asset 'iconos/favicon.svg' 'image/svg\+xml'
check_asset 'iconos/icono-192.png' 'image/png'
check_asset 'iconos/icono-512.png' 'image/png'
check_asset 'iconos/icono-maskable-512.png' 'image/png'
check_asset 'iconos/apple-touch-icon.png' 'image/png'

node -e "JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8'))" \
  "$TMP_DIR/manifest.webmanifest"
node --check "$TMP_DIR/sw.js" >/dev/null
node --check "$TMP_DIR/js-app.js" >/dev/null
node --check "$TMP_DIR/js-calculo.js" >/dev/null
node --check "$TMP_DIR/js-registro-sw.js" >/dev/null
! grep -Eiq '<style([[:space:]>])|style=' "$TMP_DIR/offline.html" || {
  printf 'ERROR: offline.html contiene estilos inline.\n' >&2
  exit 1
}
grep -Fq 'new URLSearchParams' "$TMP_DIR/js-registro-sw.js" || {
  printf 'ERROR: los destinos no usan URLSearchParams.\n' >&2
  exit 1
}
for endpoint in \
  'https://wa.me/' \
  'https://t.me/share/url' \
  'https://www.facebook.com/sharer/sharer.php' \
  'https://twitter.com/intent/tweet'; do
  grep -Fq "$endpoint" "$TMP_DIR/js-registro-sw.js" || {
    printf 'ERROR: falta el destino oficial %s.\n' "$endpoint" >&2
    exit 1
  }
done
grep -Fq 'const enlace = window.location.href' "$TMP_DIR/js-registro-sw.js" || {
  printf 'ERROR: los destinos y la copia no usan la URL actual.\n' >&2
  exit 1
}
grep -Fq 'url: window.location.href' "$TMP_DIR/js-registro-sw.js" || {
  printf 'ERROR: Web Share no usa la URL actual.\n' >&2
  exit 1
}
grep -Fq "btnCompartir?.addEventListener('click', abrirCompartir)" "$TMP_DIR/js-registro-sw.js" || {
  printf 'ERROR: el control superior no abre la hoja propia.\n' >&2
  exit 1
}
grep -Fq "btnMasApps?.addEventListener('click'" "$TMP_DIR/js-registro-sw.js" || {
  printf 'ERROR: Más apps no tiene un gesto explícito.\n' >&2
  exit 1
}
grep -Fq 'resultado = navigator.share({' "$TMP_DIR/js-registro-sw.js" || {
  printf 'ERROR: falta Web Share directo desde Más apps.\n' >&2
  exit 1
}
grep -Fq "btnCopiarEnlace?.addEventListener('click', copiarEnlace)" "$TMP_DIR/js-registro-sw.js" || {
  printf 'ERROR: Copiar no requiere una selección explícita.\n' >&2
  exit 1
}
grep -Fq 'navigator.clipboard?.writeText' "$TMP_DIR/js-registro-sw.js" || {
  printf 'ERROR: falta Clipboard API.\n' >&2
  exit 1
}
grep -Fq "document.execCommand('copy')" "$TMP_DIR/js-registro-sw.js" || {
  printf 'ERROR: falta el fallback de copia.\n' >&2
  exit 1
}
grep -Fq "error?.name === 'AbortError'" "$TMP_DIR/js-registro-sw.js" || {
  printf 'ERROR: falta el tratamiento neutral de cancelación.\n' >&2
  exit 1
}
node -e '
  const manifest = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  if (JSON.stringify(manifest.display_override) !== JSON.stringify(["window-controls-overlay", "standalone"])) process.exit(1);
' "$TMP_DIR/manifest.webmanifest" || {
  printf 'ERROR: el manifest no conserva WCO.\n' >&2
  exit 1
}

printf '  ✓ HTTPS, cabeceras, PWA, cinco controles, hoja Compartir e iconos\n'
printf 'Sitio publicado correctamente.\n'
