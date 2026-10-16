# Estado del despliegue AWS

## Sin despliegue versionado

Este repositorio público **no registra ni afirma que exista un despliegue AWS activo**. No se versionan URL de CloudFront, IDs de distribución, fechas, commits desplegados, hashes de plantillas, cuentas, ARN, nombres de stack ni nombres físicos de buckets.

Cada persona que despliegue la plantilla debe mantener esos datos fuera de Git. `scripts/deploy-aws.sh` genera `.aws-deployment.json` al finalizar correctamente, aplica permisos restrictivos y el archivo está incluido en `.gitignore`.

## Estado local generado

El archivo local usa esta forma; los valores siguientes son marcadores, no recursos reales:

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
  "siteUrl": "<YOUR_CLOUDFRONT_URL>"
}
```

No copies estos valores a documentación versionada ni adjuntes el archivo a issues. Para compartir evidencia, elimina primero cualquier identificador de cuenta o recurso.

## Verificación posterior a un despliegue propio

Comprueba y registra en un sistema privado apropiado:

- estado completo del stack y de la distribución;
- protección de terminación si el entorno elegido es `prod`;
- stack policy contra reemplazo/eliminación del bucket y la distribución;
- redirección HTTP a HTTPS y respuesta HTTPS correcta;
- S3 Block Public Access, Object Ownership, cifrado y versionado;
- acceso al bucket exclusivamente mediante OAC;
- CSP, HSTS, `nosniff`, Frame, Referrer y Permissions Policy;
- manifest y service worker activos;
- cálculo de 8 barras para 30 × 50 cm, 1 % y 5/8";
- vista móvil sin desborde, recarga offline y consola sin errores.

## Recuperar outputs sin versionarlos

Después de revisar la identidad y cuenta activas, usa un perfil SSO/de mínimo privilegio o la cadena estándar de credenciales:

```bash
aws cloudformation describe-stacks \
  --profile <YOUR_AWS_PROFILE> \
  --region <YOUR_AWS_REGION> \
  --stack-name <YOUR_STACK_NAME> \
  --query 'Stacks[0].Outputs' \
  --output table
```

`--profile <YOUR_AWS_PROFILE>` es opcional. El comando anterior es de solo lectura; no pegues su salida en el repositorio.

## Actualizaciones

1. valida localmente;
2. incrementa `VERSION` en `sw.js` si cambió el app shell;
3. ejecuta `deploy-aws.sh` sin `--apply`;
4. verifica cuenta, región, StackId y SHA mostrados localmente;
5. ejecuta con las confirmaciones exactas si el cambio fue aprobado;
6. repite las pruebas y conserva la evidencia fuera de Git.

## Riesgos operativos

- El dominio predeterminado de CloudFront usa una política TLS administrada por AWS; para fijar TLS 1.2 o posterior hace falta dominio propio y certificado ACM.
- Los logs de acceso no están activos; deben diseñarse junto con retención, privacidad y presupuesto si el proyecto pasa a operación sostenida.
- La publicación está ordenada, pero no usa nombres de assets con hash; un corte durante la carga puede requerir repetir el despliegue.
- El bucket conserva versiones y tiene `DeletionPolicy: Retain`; esto protege datos, pero puede acumular costo hasta una limpieza explícitamente aprobada.
