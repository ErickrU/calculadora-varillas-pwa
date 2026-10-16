# Estado del despliegue AWS

## Sin despliegue versionado

Este repositorio público **no registra ni afirma que exista un despliegue AWS activo**. No se versionan URL de CloudFront, identificadores, fechas, commits desplegados, hashes de plantillas, cuentas, ARN, nombres de stack ni nombres físicos de buckets.

Cada persona que cree una instancia debe mantener esos datos fuera de Git. `scripts/deploy-aws.sh` usa `.aws-change-set.json` entre las fases `prepare` y `execute`, y genera `.aws-deployment.json` solo al finalizar correctamente. Ambos archivos están ignorados y se protegen con modo `0600`.

## Forma del estado local

Los valores siguientes son marcadores, no recursos reales:

```json
{
  "stack": "<YOUR_STACK_NAME>",
  "stackId": "<YOUR_STACK_ARN>",
  "region": "<YOUR_AWS_REGION>",
  "environment": "<YOUR_ENVIRONMENT>",
  "deploymentId": "<YOUR_DEPLOYMENT_ID>",
  "templateSha256": "<YOUR_TEMPLATE_SHA256>",
  "contentBucket": "<YOUR_PRIVATE_BUCKET_NAME>",
  "distributionId": "<YOUR_CLOUDFRONT_DISTRIBUTION_ID>",
  "siteUrl": "<YOUR_CLOUDFRONT_URL>",
  "deployedAt": "<YOUR_DEPLOYMENT_TIME>"
}
```

No copies estos valores a documentación versionada ni adjuntes los estados a issues.

## Verificación posterior a una creación propia

Comprueba y conserva en un sistema privado apropiado:

- stack `CREATE_COMPLETE`, cinco recursos exactos y termination protection para `prod`;
- stack policy que deniega todo update;
- redirección HTTP→HTTPS y únicamente `GET`/`HEAD`;
- S3 Block Public Access, Object Ownership, SSE-S3, versionado y policy no pública;
- acceso al origen exclusivamente mediante OAC y `403` S3 directo;
- CSP, HSTS sin subdominios, `nosniff`, `DENY`, Referrer y Permissions Policy, sin `X-XSS-Protection`;
- 13 archivos exactos, manifest y service worker activos;
- cinco controles, un Compartir domain-agnostic y funcionamiento offline;
- cálculo de 8 barras para 30 × 50 cm, 1 % y 5/8".

## Flujo permitido

1. `--phase review`: solo lectura y validación.
2. `--phase prepare`: crea un change set `CREATE` y no lo ejecuta.
3. `--phase execute`: revalida ese change set, crea la stack, aplica protecciones y publica.

No hay fases para actualizar, reemplazar, destruir o limpiar. Una operación posterior exige un proceso independiente y aprobación explícita, especialmente en producción. El bucket retenido y sus versiones pueden seguir generando costos.
