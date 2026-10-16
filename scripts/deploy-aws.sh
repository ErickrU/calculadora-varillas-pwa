#!/usr/bin/env bash
# Revisa o despliega la PWA mediante CloudFormation + S3 + CloudFront.
# Seguro por defecto: sin --apply solo lee y valida; no crea change sets.
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$ROOT/infra/cloudformation.yaml"
STACK_POLICY="$ROOT/infra/stack-policy.json"
MARKER='calculadora-varillas-pwa-cloudfront-oac-v1'
PROJECT='calculadora-varillas-pwa'
REPOSITORY='ErickrU-calculadora-varillas-pwa'

PROFILE=""
REGION=""
STACK=""
ENVIRONMENT=""
PRICE_CLASS="PriceClass_100"
CONFIRM_ACCOUNT=""
CONFIRM_TEMPLATE_SHA=""
CONFIRM_STACK_ID=""
APPLY=false

usage() {
  cat <<'USAGE'
Uso (revisión; no modifica AWS):
  ./scripts/deploy-aws.sh [--profile <YOUR_AWS_PROFILE>] \
    --region <YOUR_AWS_REGION> --stack <YOUR_STACK_NAME> \
    --environment dev|test|stage|prod

Despliegue después de revisar el plan:
  ./scripts/deploy-aws.sh [--profile <YOUR_AWS_PROFILE>] \
    --region <YOUR_AWS_REGION> --stack <YOUR_STACK_NAME> \
    --environment <YOUR_ENVIRONMENT> \
    --confirm-account <YOUR_AWS_ACCOUNT_ID> \
    --confirm-template-sha <YOUR_TEMPLATE_SHA256> --apply

Al actualizar un stack existente también se exige:
  --confirm-stack-id <YOUR_STACK_ARN>

Credenciales:
  --profile es opcional y admite perfiles normales o SSO. Si se omite,
  AWS CLI usa la cadena estándar de credenciales. Prefiere credenciales
  temporales de mínimo privilegio y revisa la identidad antes de aplicar.

Opciones:
  --profile PERFIL           Perfil normal o SSO de AWS CLI (opcional)
  --region REGION            Región del stack/bucket (obligatorio)
  --stack NOMBRE             Nombre del stack (obligatorio)
  --environment ENTORNO      dev|test|stage|prod (obligatorio, sin predeterminado)
  --price-class CLASE        PriceClass_100 (pred.) | PriceClass_200 | PriceClass_All
  --confirm-account ID       ID de 12 dígitos; obligatorio con --apply
  --confirm-template-sha SHA SHA-256 mostrado por la revisión; obligatorio con --apply
  --confirm-stack-id ARN     StackId inmutable; obligatorio al actualizar
  --apply                    Crea un change set, lo revisa y despliega si es seguro
  -h, --help                 Muestra esta ayuda
USAGE
}

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
info() { printf '\n==> %s\n' "$*"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) [[ $# -ge 2 ]] || fail 'Falta el valor de --profile'; PROFILE="$2"; shift 2 ;;
    --region) [[ $# -ge 2 ]] || fail 'Falta el valor de --region'; REGION="$2"; shift 2 ;;
    --stack) [[ $# -ge 2 ]] || fail 'Falta el valor de --stack'; STACK="$2"; shift 2 ;;
    --environment) [[ $# -ge 2 ]] || fail 'Falta el valor de --environment'; ENVIRONMENT="$2"; shift 2 ;;
    --price-class) [[ $# -ge 2 ]] || fail 'Falta el valor de --price-class'; PRICE_CLASS="$2"; shift 2 ;;
    --confirm-account) [[ $# -ge 2 ]] || fail 'Falta el valor de --confirm-account'; CONFIRM_ACCOUNT="$2"; shift 2 ;;
    --confirm-template-sha) [[ $# -ge 2 ]] || fail 'Falta el valor de --confirm-template-sha'; CONFIRM_TEMPLATE_SHA="$2"; shift 2 ;;
    --confirm-stack-id) [[ $# -ge 2 ]] || fail 'Falta el valor de --confirm-stack-id'; CONFIRM_STACK_ID="$2"; shift 2 ;;
    --apply) APPLY=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) fail "Argumento desconocido: $1" ;;
  esac
done

[[ -n "$REGION" ]] || fail 'Debes indicar --region.'
[[ -n "$STACK" ]] || fail 'Debes indicar --stack.'
[[ -n "$ENVIRONMENT" ]] || fail 'Debes indicar --environment de forma explícita.'
[[ "$STACK" =~ ^[a-zA-Z][a-zA-Z0-9-]{0,99}$ ]] || fail 'El stack debe comenzar con letra y usar hasta 100 letras, números o guiones.'
[[ "$ENVIRONMENT" =~ ^(dev|test|stage|prod)$ ]] || fail '--environment debe ser dev, test, stage o prod.'
[[ "$PRICE_CLASS" =~ ^(PriceClass_100|PriceClass_200|PriceClass_All)$ ]] || fail '--price-class no es válido.'

for tool in aws node curl shasum; do command -v "$tool" >/dev/null 2>&1 || fail "No se encontró $tool en PATH."; done
[[ -f "$TEMPLATE" ]] || fail "No existe $TEMPLATE"
[[ -f "$STACK_POLICY" ]] || fail "No existe $STACK_POLICY"
[[ -f "$ROOT/scripts/verify-site.sh" ]] || fail 'Falta scripts/verify-site.sh.'
[[ -x "$ROOT/scripts/verify-site.sh" ]] || fail 'scripts/verify-site.sh no es ejecutable.'
bash -n "$ROOT/scripts/verify-site.sh"

AWS=(aws --region "$REGION" --no-cli-pager)
CREDENTIAL_SOURCE='cadena estándar de credenciales de AWS'
if [[ -n "$PROFILE" ]]; then
  AWS=(aws --profile "$PROFILE" --region "$REGION" --no-cli-pager)
  CREDENTIAL_SOURCE="perfil $PROFILE"
fi

info 'Validando la allowlist local'
PUBLIC_FILES=(
  index.html
  offline.html
  manifest.webmanifest
  sw.js
  css/estilos.css
  js/app.js
  js/calculo.js
  js/registro-sw.js
  iconos/favicon.svg
  iconos/icono-192.png
  iconos/icono-512.png
  iconos/icono-maskable-512.png
  iconos/apple-touch-icon.png
)
for relative in "${PUBLIC_FILES[@]}"; do
  [[ -f "$ROOT/$relative" ]] || fail "Falta el archivo publicable: $relative"
  [[ ! -L "$ROOT/$relative" ]] || fail "No se permiten enlaces simbólicos en la publicación: $relative"
done
for script in "$ROOT"/js/*.js "$ROOT/sw.js" "$ROOT/herramientas/servidor.mjs"; do node --check "$script" >/dev/null; done
node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" "$ROOT/manifest.webmanifest"
read -r TEMPLATE_SHA _ < <(shasum -a 256 "$TEMPLATE")
[[ "$TEMPLATE_SHA" =~ ^[a-f0-9]{64}$ ]] || fail 'No se pudo calcular SHA-256 de la plantilla.'
printf 'Archivos, scripts y manifest: OK\n'

info 'Verificando identidad AWS (solo lectura)'
ACCOUNT_ID="$("${AWS[@]}" sts get-caller-identity --query Account --output text)"
CALLER_ARN="$("${AWS[@]}" sts get-caller-identity --query Arn --output text)"
[[ "$ACCOUNT_ID" =~ ^[0-9]{12}$ ]] || fail 'AWS devolvió un ID de cuenta inesperado.'
read -r DEPLOYMENT_ID _ < <(printf '%s' "$ACCOUNT_ID:$REGION:$STACK" | shasum -a 256)
DEPLOYMENT_ID="${DEPLOYMENT_ID:0:10}"
printf 'Credenciales: %s\nRegión: %s\nCuenta: %s\nPrincipal: %s\n' \
  "$CREDENTIAL_SOURCE" "$REGION" "$ACCOUNT_ID" "$CALLER_ARN"

info 'Validando CloudFormation (solo lectura)'
"${AWS[@]}" cloudformation validate-template --template-body "file://$TEMPLATE" >/dev/null
printf 'Plantilla: válida\n'

STACK_EXISTS=false
STACK_ID=''
STACK_ERROR="$(mktemp)"
trap 'rm -f "$STACK_ERROR"' EXIT
if STACK_ID="$("${AWS[@]}" cloudformation describe-stacks --stack-name "$STACK" --query 'Stacks[0].StackId' --output text 2>"$STACK_ERROR")"; then
  STACK_EXISTS=true
else
  MESSAGE="$(<"$STACK_ERROR")"
  if [[ "$MESSAGE" != *'does not exist'* ]]; then fail "No se pudo inspeccionar el stack: $MESSAGE"; fi
fi

if [[ "$STACK_EXISTS" == true ]]; then
  info 'Verificando propiedad del stack existente (solo lectura)'
  stack_value() { "${AWS[@]}" cloudformation describe-stacks --stack-name "$STACK_ID" --query "$1" --output text; }
  EXISTING_PROJECT="$(stack_value "Stacks[0].Tags[?Key=='Project'].Value | [0]")"
  EXISTING_REPOSITORY="$(stack_value "Stacks[0].Tags[?Key=='Repository'].Value | [0]")"
  EXISTING_MANAGED_BY="$(stack_value "Stacks[0].Tags[?Key=='ManagedBy'].Value | [0]")"
  EXISTING_ENVIRONMENT="$(stack_value "Stacks[0].Parameters[?ParameterKey=='Environment'].ParameterValue | [0]")"
  EXISTING_DEPLOYMENT_ID="$(stack_value "Stacks[0].Parameters[?ParameterKey=='DeploymentId'].ParameterValue | [0]")"
  EXISTING_MARKER="$(stack_value "Stacks[0].Outputs[?OutputKey=='DeploymentMarker'].OutputValue | [0]")"
  [[ "$EXISTING_PROJECT" == "$PROJECT" ]] || fail "El stack existente no pertenece al proyecto esperado (Project=$EXISTING_PROJECT)."
  [[ "$EXISTING_REPOSITORY" == "$REPOSITORY" ]] || fail "El stack existente no pertenece al repositorio esperado (Repository=$EXISTING_REPOSITORY)."
  [[ "$EXISTING_MANAGED_BY" == 'CloudFormation' ]] || fail "ManagedBy inesperado: $EXISTING_MANAGED_BY"
  [[ "$EXISTING_MARKER" == "$MARKER" ]] || fail "Marcador de despliegue inesperado: $EXISTING_MARKER"
  [[ "$EXISTING_ENVIRONMENT" == "$ENVIRONMENT" ]] || fail "No se permite cambiar el entorno existente ($EXISTING_ENVIRONMENT) a $ENVIRONMENT."
  [[ "$EXISTING_DEPLOYMENT_ID" == "$DEPLOYMENT_ID" ]] || fail 'DeploymentId no coincide; revisa cuenta, región y stack.'
fi

cat <<PLAN

Plan local (no es un change set):
  Acción:       $([[ "$STACK_EXISTS" == true ]] && printf 'actualizar stack propio' || printf 'crear stack nuevo')
  Stack:        $STACK
  StackId:      ${STACK_ID:-nuevo}
  Entorno:      $ENVIRONMENT
  Price class:  $PRICE_CLASS
  Cuenta:       $ACCOUNT_ID
  Región:       $REGION
  DeploymentId: $DEPLOYMENT_ID
  Template SHA: $TEMPLATE_SHA
  Recursos:     S3 privado + CloudFront OAC + política de cabeceras
  Retención:    el bucket y sus versiones NO se borran al eliminar el stack
PLAN

if [[ "$APPLY" != true ]]; then
  printf '\nMODO REVISIÓN: no se creó ni modificó ningún recurso.\n'
  printf 'La escritura exige confirmar cuenta y SHA; una actualización exige además StackId.\n'
  exit 0
fi

[[ "$CONFIRM_ACCOUNT" =~ ^[0-9]{12}$ ]] || fail 'Con --apply debes indicar --confirm-account con 12 dígitos.'
[[ "$CONFIRM_ACCOUNT" == "$ACCOUNT_ID" ]] || fail 'La cuenta confirmada no coincide con la activa.'
[[ "$CONFIRM_TEMPLATE_SHA" == "$TEMPLATE_SHA" ]] || fail 'El SHA confirmado no coincide con la plantilla actual.'
if [[ "$STACK_EXISTS" == true ]]; then
  [[ "$CONFIRM_STACK_ID" == "$STACK_ID" ]] || fail 'Para actualizar debes confirmar el StackId completo mostrado en la revisión.'
else
  [[ -z "$CONFIRM_STACK_ID" ]] || fail '--confirm-stack-id no debe usarse al crear un stack nuevo.'
fi

info 'Creando un change set sin ejecutarlo'
CHANGE_SET_NAME="${STACK}-$(date -u +%Y%m%dT%H%M%SZ)"
CHANGE_SET_TYPE="$([[ "$STACK_EXISTS" == true ]] && printf UPDATE || printf CREATE)"
CHANGE_SET_ARN="$("${AWS[@]}" cloudformation create-change-set \
  --stack-name "$STACK" \
  --change-set-name "$CHANGE_SET_NAME" \
  --change-set-type "$CHANGE_SET_TYPE" \
  --description "Calculadora de Varillas template $TEMPLATE_SHA" \
  --template-body "file://$TEMPLATE" \
  --parameters \
    "ParameterKey=ProjectSlug,ParameterValue=$PROJECT" \
    "ParameterKey=Environment,ParameterValue=$ENVIRONMENT" \
    "ParameterKey=DeploymentId,ParameterValue=$DEPLOYMENT_ID" \
    "ParameterKey=PriceClass,ParameterValue=$PRICE_CLASS" \
  --tags \
    "Key=Project,Value=$PROJECT" \
    "Key=Environment,Value=$ENVIRONMENT" \
    'Key=ManagedBy,Value=CloudFormation' \
    "Key=Repository,Value=$REPOSITORY" \
    "Key=DeploymentId,Value=$DEPLOYMENT_ID" \
  --query Id --output text)"

if ! "${AWS[@]}" cloudformation wait change-set-create-complete --change-set-name "$CHANGE_SET_ARN" --stack-name "$STACK"; then
  REASON="$("${AWS[@]}" cloudformation describe-change-set --change-set-name "$CHANGE_SET_ARN" --stack-name "$STACK" --query StatusReason --output text 2>/dev/null || true)"
  if [[ "$REASON" == *"didn't contain changes"* || "$REASON" == *'No updates are to be performed'* ]]; then
    "${AWS[@]}" cloudformation delete-change-set --change-set-name "$CHANGE_SET_ARN" --stack-name "$STACK" >/dev/null 2>&1 || true
    printf 'La infraestructura no tiene cambios.\n'
    CHANGE_SET_ARN=''
  else
    fail "El change set no se pudo crear: $REASON"
  fi
fi

if [[ -n "$CHANGE_SET_ARN" ]]; then
  info 'Cambios de infraestructura propuestos'
  "${AWS[@]}" cloudformation describe-change-set \
    --change-set-name "$CHANGE_SET_ARN" --stack-name "$STACK" \
    --query 'Changes[].ResourceChange.{Action:Action,LogicalId:LogicalResourceId,Type:ResourceType,Replacement:Replacement}' \
    --output table
  RISKY_COUNT="$("${AWS[@]}" cloudformation describe-change-set \
    --change-set-name "$CHANGE_SET_ARN" --stack-name "$STACK" \
    --query "length(Changes[?ResourceChange.Action=='Remove' || ResourceChange.Replacement=='True' || ResourceChange.Replacement=='Conditional'])" \
    --output text)"
  if [[ "$RISKY_COUNT" != '0' ]]; then
    "${AWS[@]}" cloudformation delete-change-set --change-set-name "$CHANGE_SET_ARN" --stack-name "$STACK" >/dev/null
    fail "Se rechazó el change set: contiene $RISKY_COUNT eliminación(es) o reemplazo(s)."
  fi

  info 'Ejecutando el change set revisado'
  "${AWS[@]}" cloudformation execute-change-set --change-set-name "$CHANGE_SET_ARN" --stack-name "$STACK"
  if [[ "$CHANGE_SET_TYPE" == 'CREATE' ]]; then
    "${AWS[@]}" cloudformation wait stack-create-complete --stack-name "$STACK"
  else
    "${AWS[@]}" cloudformation wait stack-update-complete --stack-name "$STACK_ID"
  fi
fi

STACK_ID="$("${AWS[@]}" cloudformation describe-stacks --stack-name "$STACK" --query 'Stacks[0].StackId' --output text)"
"${AWS[@]}" cloudformation set-stack-policy --stack-name "$STACK_ID" --stack-policy-body "file://$STACK_POLICY"
if [[ "$ENVIRONMENT" == 'prod' ]]; then
  "${AWS[@]}" cloudformation update-termination-protection --enable-termination-protection --stack-name "$STACK_ID" >/dev/null
  printf 'Protección de terminación: activada (prod).\n'
fi

output() {
  local key="$1"
  "${AWS[@]}" cloudformation describe-stacks --stack-name "$STACK_ID" \
    --query "Stacks[0].Outputs[?OutputKey=='$key'].OutputValue | [0]" --output text
}
BUCKET="$(output ContentBucketName)"
DISTRIBUTION_ID="$(output DistributionId)"
SITE_URL="$(output SiteUrl)"
[[ -n "$BUCKET" && "$BUCKET" != 'None' ]] || fail 'No se obtuvo ContentBucketName.'
[[ -n "$DISTRIBUTION_ID" && "$DISTRIBUTION_ID" != 'None' ]] || fail 'No se obtuvo DistributionId.'
[[ "$SITE_URL" == https://* ]] || fail 'No se obtuvo una URL HTTPS válida.'

info 'Verificando bucket y objetos existentes'
"${AWS[@]}" s3api head-bucket --bucket "$BUCKET" --expected-bucket-owner "$ACCOUNT_ID"
BUCKET_PROJECT="$("${AWS[@]}" s3api get-bucket-tagging --bucket "$BUCKET" --expected-bucket-owner "$ACCOUNT_ID" --query "TagSet[?Key=='Project'].Value | [0]" --output text)"
BUCKET_DEPLOYMENT="$("${AWS[@]}" s3api get-bucket-tagging --bucket "$BUCKET" --expected-bucket-owner "$ACCOUNT_ID" --query "TagSet[?Key=='DeploymentId'].Value | [0]" --output text)"
[[ "$BUCKET_PROJECT" == "$PROJECT" && "$BUCKET_DEPLOYMENT" == "$DEPLOYMENT_ID" ]] || fail 'Las etiquetas del bucket no coinciden con este despliegue.'
CURRENT_KEYS="$("${AWS[@]}" s3api list-objects-v2 --bucket "$BUCKET" --expected-bucket-owner "$ACCOUNT_ID" --query 'Contents[].Key' --output text)"
[[ "$CURRENT_KEYS" == 'None' ]] && CURRENT_KEYS=''
for key in $CURRENT_KEYS; do
  expected=false
  for relative in "${PUBLIC_FILES[@]}"; do [[ "$key" == "$relative" ]] && expected=true && break; done
  [[ "$expected" == true ]] || fail "El bucket contiene un objeto fuera de la allowlist: $key. Revísalo antes de publicar."
done

upload() {
  local relative="$1" type="$2" cache="$3"
  # Usamos la API de bajo nivel porque --expected-bucket-owner no está
  # disponible en todas las versiones del comando de alto nivel `aws s3 cp`.
  "${AWS[@]}" s3api put-object \
    --bucket "$BUCKET" \
    --key "$relative" \
    --body "$ROOT/$relative" \
    --expected-bucket-owner "$ACCOUNT_ID" \
    --content-type "$type" \
    --cache-control "$cache" \
    --server-side-encryption AES256 \
    >/dev/null
  printf '  ✓ %s\n' "$relative"
}

info "Publicando archivos exactos en s3://$BUCKET (recursos primero)"
NO_CACHE='no-cache, max-age=0, must-revalidate'
SHORT_CACHE='public, max-age=3600, must-revalidate'
ICON_CACHE='public, max-age=86400, must-revalidate'
upload css/estilos.css 'text/css; charset=utf-8' "$SHORT_CACHE"
upload js/calculo.js 'text/javascript; charset=utf-8' "$SHORT_CACHE"
upload js/app.js 'text/javascript; charset=utf-8' "$SHORT_CACHE"
upload js/registro-sw.js 'text/javascript; charset=utf-8' "$SHORT_CACHE"
upload iconos/favicon.svg 'image/svg+xml' "$ICON_CACHE"
upload iconos/icono-192.png 'image/png' "$ICON_CACHE"
upload iconos/icono-512.png 'image/png' "$ICON_CACHE"
upload iconos/icono-maskable-512.png 'image/png' "$ICON_CACHE"
upload iconos/apple-touch-icon.png 'image/png' "$ICON_CACHE"
upload offline.html 'text/html; charset=utf-8' "$NO_CACHE"
upload manifest.webmanifest 'application/manifest+json; charset=utf-8' "$NO_CACHE"
upload sw.js 'text/javascript; charset=utf-8' "$NO_CACHE"
upload index.html 'text/html; charset=utf-8' "$NO_CACHE"

info 'Invalidando CloudFront'
INVALIDATION_ID="$("${AWS[@]}" cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths '/*' --query Invalidation.Id --output text)"
"${AWS[@]}" cloudfront wait invalidation-completed --distribution-id "$DISTRIBUTION_ID" --id "$INVALIDATION_ID"
printf 'Invalidación completada: %s\n' "$INVALIDATION_ID"

info 'Verificando la URL pública'
"$ROOT/scripts/verify-site.sh" "$SITE_URL"

cat > "$ROOT/.aws-deployment.json" <<JSON
{
  "stack": "$STACK",
  "stackId": "$STACK_ID",
  "region": "$REGION",
  "environment": "$ENVIRONMENT",
  "deploymentId": "$DEPLOYMENT_ID",
  "templateSha256": "$TEMPLATE_SHA",
  "contentBucket": "$BUCKET",
  "distributionId": "$DISTRIBUTION_ID",
  "siteUrl": "$SITE_URL"
}
JSON
chmod 600 "$ROOT/.aws-deployment.json"

printf '\nDESPLIEGUE COMPLETADO\nURL: %s\nStackId: %s\nDistribución: %s\nBucket: %s (privado y retenido)\n' \
  "$SITE_URL" "$STACK_ID" "$DISTRIBUTION_ID" "$BUCKET"
