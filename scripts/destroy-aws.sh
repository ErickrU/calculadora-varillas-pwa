#!/usr/bin/env bash
# Elimina únicamente un stack verificado de esta aplicación; conserva el bucket.
# Nunca desactiva protección de terminación ni purga datos.
set -euo pipefail
umask 077

MARKER='calculadora-varillas-pwa-cloudfront-oac-v1'
PROJECT='calculadora-varillas-pwa'
REPOSITORY='ErickrU-calculadora-varillas-pwa'
PROFILE=""
REGION=""
STACK=""
CONFIRM_ACCOUNT=""
CONFIRM_STACK_ID=""
CONFIRM_ENVIRONMENT=""
APPLY=false

usage() {
  cat <<'USAGE'
Revisión (solo lectura):
  ./scripts/destroy-aws.sh [--profile <YOUR_AWS_PROFILE>] \
    --region <YOUR_AWS_REGION> --stack <YOUR_STACK_NAME>

Eliminar un stack verificado que no tenga protección de terminación:
  ./scripts/destroy-aws.sh [--profile <YOUR_AWS_PROFILE>] \
    --region <YOUR_AWS_REGION> --stack <YOUR_STACK_NAME> \
    --confirm-account <YOUR_AWS_ACCOUNT_ID> \
    --confirm-stack-id <YOUR_STACK_ARN> \
    --confirm-environment dev|test|stage|prod --apply

--profile es opcional y admite perfiles normales o SSO. Si se omite,
AWS CLI usa la cadena estándar de credenciales. Revisa siempre la identidad.
Este script NUNCA desactiva protección, vacía ni elimina el bucket retenido.
USAGE
}
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) [[ $# -ge 2 ]] || fail 'Falta el valor de --profile'; PROFILE="$2"; shift 2 ;;
    --region) [[ $# -ge 2 ]] || fail 'Falta el valor de --region'; REGION="$2"; shift 2 ;;
    --stack) [[ $# -ge 2 ]] || fail 'Falta el valor de --stack'; STACK="$2"; shift 2 ;;
    --confirm-account) [[ $# -ge 2 ]] || fail 'Falta el valor de --confirm-account'; CONFIRM_ACCOUNT="$2"; shift 2 ;;
    --confirm-stack-id) [[ $# -ge 2 ]] || fail 'Falta el valor de --confirm-stack-id'; CONFIRM_STACK_ID="$2"; shift 2 ;;
    --confirm-environment) [[ $# -ge 2 ]] || fail 'Falta el valor de --confirm-environment'; CONFIRM_ENVIRONMENT="$2"; shift 2 ;;
    --apply) APPLY=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) fail "Argumento desconocido: $1" ;;
  esac
done

[[ -n "$REGION" && -n "$STACK" ]] || fail 'Debes indicar --region y --stack.'
command -v aws >/dev/null 2>&1 || fail 'No se encontró aws en PATH.'
AWS=(aws --region "$REGION" --no-cli-pager)
CREDENTIAL_SOURCE='cadena estándar de credenciales de AWS'
if [[ -n "$PROFILE" ]]; then
  AWS=(aws --profile "$PROFILE" --region "$REGION" --no-cli-pager)
  CREDENTIAL_SOURCE="perfil $PROFILE"
fi

ACCOUNT_ID="$("${AWS[@]}" sts get-caller-identity --query Account --output text)"
CALLER_ARN="$("${AWS[@]}" sts get-caller-identity --query Arn --output text)"
STACK_ID="$("${AWS[@]}" cloudformation describe-stacks --stack-name "$STACK" --query 'Stacks[0].StackId' --output text)"
stack_value() { "${AWS[@]}" cloudformation describe-stacks --stack-name "$STACK_ID" --query "$1" --output text; }
STACK_PROJECT="$(stack_value "Stacks[0].Tags[?Key=='Project'].Value | [0]")"
STACK_REPOSITORY="$(stack_value "Stacks[0].Tags[?Key=='Repository'].Value | [0]")"
STACK_MANAGED_BY="$(stack_value "Stacks[0].Tags[?Key=='ManagedBy'].Value | [0]")"
ENVIRONMENT="$(stack_value "Stacks[0].Parameters[?ParameterKey=='Environment'].ParameterValue | [0]")"
DEPLOYMENT_ID="$(stack_value "Stacks[0].Parameters[?ParameterKey=='DeploymentId'].ParameterValue | [0]")"
STACK_MARKER="$(stack_value "Stacks[0].Outputs[?OutputKey=='DeploymentMarker'].OutputValue | [0]")"
BUCKET="$(stack_value "Stacks[0].Outputs[?OutputKey=='ContentBucketName'].OutputValue | [0]")"
SITE_URL="$(stack_value "Stacks[0].Outputs[?OutputKey=='SiteUrl'].OutputValue | [0]")"
TERMINATION_PROTECTION="$(stack_value 'Stacks[0].EnableTerminationProtection')"

[[ "$STACK_PROJECT" == "$PROJECT" ]] || fail "Project inesperado: $STACK_PROJECT"
[[ "$STACK_REPOSITORY" == "$REPOSITORY" ]] || fail "Repository inesperado: $STACK_REPOSITORY"
[[ "$STACK_MANAGED_BY" == 'CloudFormation' ]] || fail "ManagedBy inesperado: $STACK_MANAGED_BY"
[[ "$STACK_MARKER" == "$MARKER" ]] || fail "Marcador inesperado: $STACK_MARKER"
[[ "$DEPLOYMENT_ID" =~ ^[a-f0-9]{10}$ ]] || fail 'DeploymentId inválido.'
[[ "$BUCKET" != 'None' && "$SITE_URL" == https://* ]] || fail 'Outputs esperados ausentes.'

for resource in ContentBucket Distribution OriginAccessControl SecurityHeadersPolicy ContentBucketPolicy; do
  case "$resource" in
    ContentBucket) expected_type='AWS::S3::Bucket' ;;
    Distribution) expected_type='AWS::CloudFront::Distribution' ;;
    OriginAccessControl) expected_type='AWS::CloudFront::OriginAccessControl' ;;
    SecurityHeadersPolicy) expected_type='AWS::CloudFront::ResponseHeadersPolicy' ;;
    ContentBucketPolicy) expected_type='AWS::S3::BucketPolicy' ;;
  esac
  type="$("${AWS[@]}" cloudformation describe-stack-resource --stack-name "$STACK_ID" --logical-resource-id "$resource" --query 'StackResourceDetail.ResourceType' --output text)"
  [[ "$type" == "$expected_type" ]] || fail "Tipo inesperado para $resource: $type (esperado $expected_type)"
done

cat <<PLAN

ACCIÓN DESTRUCTIVA: eliminar el stack interrumpirá el sitio.
  Credenciales:          $CREDENTIAL_SOURCE
  Cuenta:                $ACCOUNT_ID
  Principal:             $CALLER_ARN
  Región:                $REGION
  StackId inmutable:     $STACK_ID
  Entorno:               $ENVIRONMENT
  Sitio afectado:        $SITE_URL
  Bucket retenido:       $BUCKET
  TerminationProtection: $TERMINATION_PROTECTION

Este script no elimina objetos, versiones ni el bucket. El almacenamiento
retenido puede seguir generando cargos.
PLAN

if [[ "$APPLY" != true ]]; then
  printf '\nMODO REVISIÓN: no se modificó ningún recurso.\n'
  exit 0
fi

[[ "$CONFIRM_ACCOUNT" == "$ACCOUNT_ID" ]] || fail 'La cuenta confirmada no coincide con la activa.'
[[ "$CONFIRM_STACK_ID" == "$STACK_ID" ]] || fail 'El StackId confirmado no coincide exactamente.'
[[ "$CONFIRM_ENVIRONMENT" == "$ENVIRONMENT" ]] || fail 'El entorno confirmado no coincide exactamente.'
if [[ "$TERMINATION_PROTECTION" == 'True' ]]; then
  fail 'La protección de terminación está activa. Este script no la desactiva; se requiere una aprobación separada y explícita.'
fi

printf '\nEliminando exclusivamente el StackId verificado...\n'
"${AWS[@]}" cloudformation delete-stack --stack-name "$STACK_ID"
"${AWS[@]}" cloudformation wait stack-delete-complete --stack-name "$STACK_ID"
printf '\nStack eliminado: %s\nBucket conservado: %s\nNo se eliminaron datos.\n' "$STACK_ID" "$BUCKET"
