# Despliegue AWS seguro

Esta alternativa crea una instancia nueva de Calculadora de Varillas con S3 privado y CloudFront OAC. El repositorio no contiene ni afirma un despliegue activo.

> S3, CloudFront, solicitudes, transferencia, versiones e invalidaciones pueden generar costos. Usa credenciales temporales de mínimo privilegio. Si no puedes determinar si la cuenta es de producción, trátala como producción y detente antes de escribir.

## Controles principales

- S3: cuatro Block Public Access, `BucketOwnerEnforced`, SSE-S3 y versionado.
- Origen: endpoint REST privado; no website endpoint, CORS ni ACL pública.
- CloudFront: OAC SigV4 `always`, HTTP→HTTPS y solo `GET`/`HEAD`.
- Política S3: lectura exclusiva desde la distribución creada mediante `AWS:SourceArn` y denegación de transporte inseguro.
- Respuestas: CSP estricta, `DENY`, `nosniff`, HSTS, Referrer Policy y Permissions Policy; sin `X-XSS-Protection`.
- Operación: creación única con `prepare`/`execute`, stack policy inmutable y termination protection para `prod` antes de publicar objetos.

La plantilla no crea IAM, DNS, certificados, WAF, logs, funciones ni nombres físicos.

## Requisitos

- AWS CLI v2, Node.js 20+, `jq`, `curl` y `shasum`;
- un perfil SSO/rol temporal de mínimo privilegio o la cadena estándar de credenciales;
- permisos para validar/crear la plantilla, aplicar protecciones, cargar la allowlist y crear una invalidación.

No guardes credenciales, cuentas, ARN ni outputs en Git. Los estados locales `.aws-change-set.json` y `.aws-deployment.json` están ignorados y el script los crea con modo `0600`.

## 1. Revisar sin escribir

```bash
./scripts/deploy-aws.sh \
  --phase review \
  --profile <YOUR_AWS_PROFILE> \
  --region <YOUR_AWS_REGION> \
  --stack <YOUR_NEW_STACK_NAME> \
  --environment prod
```

`--profile` es opcional. La fase valida archivos, sintaxis, identidad, plantilla y que el nombre de stack no exista. Solo muestra el SHA-256; no imprime cuenta, ARN ni identificadores físicos. Comprueba la identidad activa por un canal local seguro y no continúes si tiene permisos más amplios de lo necesario.

## 2. Preparar un change set CREATE

```bash
./scripts/deploy-aws.sh \
  --phase prepare \
  --profile <YOUR_AWS_PROFILE> \
  --region <YOUR_AWS_REGION> \
  --stack <YOUR_NEW_STACK_NAME> \
  --environment prod \
  --confirm-account <YOUR_AWS_ACCOUNT_ID> \
  --confirm-template-sha <YOUR_TEMPLATE_SHA256>
```

La fase vuelve a verificar todo, exige que el stack no exista y crea un change set `CREATE` sin ejecutarlo. Rechaza cualquier conjunto que no agregue exactamente los cinco recursos esperados o indique reemplazo. Su referencia queda solo en `.aws-change-set.json` con modo `0600`.

## 3. Ejecutar el change set preparado

Revisa el cambio fuera del repositorio. Si es correcto, repite los mismos argumentos con `execute`:

```bash
./scripts/deploy-aws.sh \
  --phase execute \
  --profile <YOUR_AWS_PROFILE> \
  --region <YOUR_AWS_REGION> \
  --stack <YOUR_NEW_STACK_NAME> \
  --environment prod \
  --confirm-account <YOUR_AWS_ACCOUNT_ID> \
  --confirm-template-sha <YOUR_TEMPLATE_SHA256>
```

La fase `execute`:

1. valida modo y contenido del estado local;
2. comprueba que el mismo change set sigue disponible y es exclusivamente `CREATE`;
3. confirma que el stack está en revisión y no tiene recursos previos;
4. ejecuta una sola vez y espera `CREATE_COMPLETE`;
5. confirma identidad, cinco recursos y bucket vacío;
6. aplica/verifica la stack policy y, en `prod`, ejecuta `cloudformation update-termination-protection --enable-termination-protection` y verifica el resultado;
7. valida privacidad S3, cifrado, versionado, OAC, métodos, HTTPS y cabeceras antes de cargar contenido;
8. exige `403` al acceso S3 anónimo directo;
9. carga únicamente los 13 archivos públicos, recursos primero e HTML/service worker al final;
10. invalida solo la distribución creada, verifica el sitio anónimamente, repite el `403` directo y guarda estado local `0600`.

No ejecutes aquí el comando de termination protection de forma aislada: forma parte del gate de `execute` para una creación aprobada. No existe ruta de actualización, destrucción o limpieza. Cualquier operación futura sobre infraestructura desplegada requiere revisión y autorización separadas; nunca desactives protecciones de producción para sortear este límite.

## Verificación independiente

```bash
./scripts/verify-site.sh <YOUR_CLOUDFRONT_HTTPS_URL>
```

Comprueba redirección HTTPS, respuesta 200, cabeceras, ausencia de `X-XSS-Protection`, manifest, service worker, CSS, JavaScript, iconos, cinco controles y un solo Compartir. Prueba además instalación, segunda carga offline, vista móvil, teclado, Web Share y los dos fallbacks de portapapeles.

El caso funcional de referencia debe seguir produciendo 8 barras, `As = 15 cm²` requerido y `16 cm²` colocado para `30 × 50 cm`, `1 %` y `5/8"`.

## Retención y recuperación

`DeletionPolicy: Retain` conserva el bucket durante un rollback de la creación inicial y al eliminar la stack; `UpdateReplacePolicy: Retain` lo conserva ante un reemplazo. El versionado, la stack policy y termination protection agregan más barreras contra pérdida accidental. El almacenamiento retenido y sus versiones pueden seguir generando cargos. Este repositorio no automatiza eliminación ni desactivación de protecciones.

## Fuentes

- [AWS: restringir un origen S3 mediante OAC](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)
- [AWS: requerir HTTPS entre clientes y CloudFront](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-https-viewers-to-cloudfront.html)
- [AWS: políticas de cabeceras de respuesta](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/understanding-response-headers-policies.html)

Contenido reformulado para cumplir restricciones de licencia.
