# Despliegue AWS seguro

Esta alternativa propone crear una instancia nueva de Calculadora de Varillas con S3 privado y CloudFront OAC. El único target futuro permitido es `calculadora-varillas-pwa-public-prod-v2`; esto no demuestra que esté libre ni que exista un despliegue activo.

> Este workflow preparó y verificó código exclusivamente de forma local: no hizo llamadas AWS. Toda operación futura requiere credenciales temporales de mínimo privilegio, revisión independiente y autorización trazable.

## Intento bloqueado y regla de parada

`calculadora-varillas-pwa-public-prod` es un intento bloqueado que debe permanecer intacto: el script nunca lo consulta, ejecuta, actualiza, elimina ni reutiliza.

`calculadora-varillas-pwa-public-prod-v2` solo puede usarse si una fase `prepare` futura todavía demuestra su ausencia inmediatamente antes de crear. Si `DescribeStacks` o `ListChangeSets` encuentra el nombre, devuelve un resultado ambiguo o no puede correlacionarse, el resultado es **STOP**. El script nunca actualiza un stack existente, elige otro nombre, elimina un intento ni realiza cleanup automático.

Stack v2, entorno `prod`, `PriceClass_100`, tipo `CREATE`, nombre del change set y client token son internos. No existen opciones para inyectarlos.

## Controles conservados

- S3 privado: cuatro Block Public Access, `BucketOwnerEnforced`, SSE-S3 y versionado.
- CloudFront: OAC SigV4 `always`, HTTP→HTTPS y únicamente `GET`/`HEAD`.
- Política S3: lectura exclusiva desde la distribución creada y denegación de transporte inseguro.
- Cabeceras: CSP estricta, `DENY`, `nosniff`, HSTS, Referrer Policy y Permissions Policy; sin `X-XSS-Protection`.
- Protección: stack policy que niega updates y termination protection antes de publicar contenido en `prod`.
- PWA: allowlist exacta de 13 archivos, cinco controles WCO y un único Compartir.

`DeletionPolicy: Retain` conserva el bucket durante rollback de creación o eliminación del stack. `UpdateReplacePolicy: Retain` conserva el recurso anterior si una operación autorizada por separado lo reemplazara. S3, CloudFront, objetos versionados y recursos parciales pueden generar costos mientras permanezcan retenidos.

## Requisitos para una operación futura

- AWS CLI v2 compatible, Node.js 20+, `jq`, `curl`, `git`, `cmp` y `shasum`;
- profile explícito de un rol temporal con el mínimo privilegio necesario;
- región, commit e identidad aprobados fuera de banda;
- repositorio limpio y commit publicado y revisado;
- autorización separada para `prepare` y otra autorización explícita para `execute`.

No guardes credenciales, cuentas, ARN, tokens, nombres físicos, outputs ni URL reales de recursos en Git. Cada intento se conserva en `.aws-attempts/<attempt-id>/` con directorio `0700` y archivos `0600`; `.aws-change-set.json` es un puntero privado `0600`. Un intento fallido permanece intacto y bloquea reintentos automáticos.

## 1. Revisar hashes

Una persona autorizada puede obtener los hashes sin crear, actualizar o eliminar infraestructura:

```bash
./scripts/deploy-aws.sh \
  --phase review \
  --profile <YOUR_AWS_PROFILE> \
  --region <YOUR_AWS_REGION>
```

Esta fase consultará la identidad activa en AWS cuando se ejecute en el futuro. Muestra únicamente hashes del commit, plantilla e identidad canónica. La identidad liga cuenta, principal, profile y región; los valores completos quedan fuera de reportes compartibles. `review` no decide que v2 esté libre.

## 2. Preparar un CREATE sin ejecutarlo

```bash
./scripts/deploy-aws.sh \
  --phase prepare \
  --profile <YOUR_AWS_PROFILE> \
  --region <YOUR_AWS_REGION> \
  --confirm-commit-sha <APPROVED_COMMIT_SHA> \
  --confirm-identity-sha <APPROVED_IDENTITY_SHA256>
```

Antes de cualquier API, el script inspecciona localmente el skeleton de AWS CLI v2 y exige soporte para `ClientToken` y `OnStackFailure`. Después:

1. crea una sola vez el attempt ID, nombre de change set y client token, y los persiste antes del request;
2. conserva los bytes exactos del template local y del blob del commit aprobado, y persiste la identidad normalizada `0600` antes de crear infraestructura;
3. captura dos probes independientes e inmediatamente anteriores: `DescribeStacks` y `ListChangeSets`; el primero conserva su request ID exacto;
4. emite literalmente `--change-set-type CREATE`, `--client-token` y `--on-stack-failure DO_NOTHING`, sin `DisableRollback`;
5. conserva el contrato completo del request, parámetros/tags, opciones vacías, respuesta, stdout, stderr, timestamps UTC, identidad, región, profile, hashes e identificadores de correlación;
6. exige eventos únicos de CloudTrail: `DescribeStacks` coincide con el request ID exacto; `CreateChangeSet` correlaciona éxito, identidad, región, tiempo, stack, nombre, token e ID retornado;
7. mide un máximo de 60 segundos desde cada probe hasta el inicio real capturado de `CreateChangeSet`;
8. recupera el template del change set y exige igualdad byte por byte con el archivo enviado y el commit;
9. valida un placeholder `REVIEW_IN_PROGRESS` sin recursos, outputs ni template aplicado, un único change set disponible, opciones fuera de alcance vacías y exactamente cinco acciones `Add` allowlisted.

Los campos de CloudTrail que no estén garantizados pueden faltar; cualquier valor presente debe concordar con el request, la respuesta y los snapshots sellados.

`DO_NOTHING` deja el placeholder y cualquier recurso parcial disponibles para diagnóstico si la creación falla. No se combina con una opción de rollback incompatible. Puede conservar recursos facturables y no autoriza recuperarlos o borrarlos.

`DescribeChangeSet` no está obligado a devolver `ChangeSetType`. El validador demuestra `CREATE` mediante la conjunción del request revisado, ausencia previa corroborada, creación correlacionada, placeholder vacío y cinco `Add`. Si aparece un valor contradictorio, se detiene.

## 3. Ejecutar solo después de otra autorización

```bash
./scripts/deploy-aws.sh \
  --phase execute \
  --profile <YOUR_AWS_PROFILE> \
  --region <YOUR_AWS_REGION> \
  --confirm-commit-sha <APPROVED_COMMIT_SHA> \
  --confirm-identity-sha <APPROVED_IDENTITY_SHA256>
```

Antes de cualquier llamada AWS de la fase `execute`, un guard puramente local rechaza symlinks y modos inseguros, verifica `chain-input-prepare.json` y `chain-prepare.json`, exige que esta última selle `proof-prepare.json`, y compara exactamente puntero, `attempt.json` y prueba: attempt ID, target v2, stack ID, change set ID/nombre, client token, profile, región, commit, identidad y plantilla. Solo los IDs derivados de esa evidencia sellada se usan para volver a consultar identidad, template remoto, placeholder vacío, único change set, descripción, parámetros, tags, modo `STANDARD`, `OnStackFailure`, opciones vacías y cinco acciones.

Después del snapshot TOCTOU, el script crea `proof-execute.json` y una `chain-execute-reviewed.json` que lo sella. Un guard preliminar verifica toda la cadena, vuelve a validar la conjunción y deriva stack, change set y token de la prueba sellada. El guard de lanzamiento ejecuta de nuevo la validación completa sin recibir una hora externa. Cuando esa validación y sus comprobaciones de integridad terminan, obtiene internamente una hora UTC nueva y vuelve a exigir con ella que todas las observaciones del snapshot, desde la primera hasta la última, tengan como máximo 300 segundos. Solo entonces escribe la autorización y emite esa hora para iniciar la captura de `execute-change-set`. Si el snapshot vence dentro del propio guard, no se crea la autorización y el proceso AWS no comienza. `execute-change-set` consume los valores derivados de la prueba sellada y su captura queda ligada a esa hora final. Cualquier symlink, hash alterado, dato discordante, ausencia, contradicción o demora produce STOP y conserva todo.

Tras una creación correcta, verifica stack policy, termination protection, S3 privado, los cuatro Block Public Access, ownership, SSE-S3, versionado, policy no pública, OAC SigV4, origen exacto, `GET`/`HEAD`, HTTPS y cabeceras antes de subir contenido. También exige rechazo del acceso S3 anónimo directo antes y después, y valida la publicación anónima final.

## Evidencia, retención y recuperación

Los archivos privados conservan valores completos y una cadena de hashes write-once. Los reportes `shareable-*.json` contienen exclusivamente hashes SHA-256 y booleanos. No adjuntes el directorio privado, el puntero ni el estado de despliegue a commits, issues o artefactos.

No hay ruta de update, delete o cleanup. Cualquier recuperación de un intento parcial, incluso para detener costos, requiere diagnóstico, plan y autorización trazable separados. No desactives `Retain` ni termination protection para sortear este límite.

## Verificación independiente de una publicación autorizada

```bash
./scripts/verify-site.sh <YOUR_CLOUDFRONT_HTTPS_URL>
```

Comprueba HTTPS, cabeceras, manifest, service worker, CSS, JavaScript, iconos, cinco controles y Compartir con Web Share, Clipboard API, fallback y feedback accesible. El caso funcional debe seguir produciendo 8 barras, `As = 15 cm²` requerido y `16 cm²` colocado.

## Fuentes

- [AWS: restringir un origen S3 mediante OAC](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)
- [AWS: CreateChangeSet](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_CreateChangeSet.html)
- [AWS: DescribeChangeSet](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DescribeChangeSet.html)

Contenido reformulado para cumplir restricciones de licencia.
