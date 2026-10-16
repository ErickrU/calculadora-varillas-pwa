# Estado del despliegue AWS

## Sin despliegue afirmado

Este repositorio no registra ni afirma un despliegue AWS activo. Este workflow no hizo llamadas AWS. No contiene cuentas, ARN, buckets físicos, IDs de distribución, tokens, outputs ni URL reales de recursos.

`calculadora-varillas-pwa-public-prod` es un intento bloqueado que permanece intacto y sobre el cual el script no realiza ninguna operación. El único target futuro propuesto es `calculadora-varillas-pwa-public-prod-v2`. Una fase `prepare` debe probar su ausencia mediante `DescribeStacks` **y** `ListChangeSets`, además de correlacionar CloudTrail. Si v2 existe o la prueba es incompleta, el resultado obligatorio es STOP; nunca update ni cambio automático de nombre.

## Evidencia local esperada

Cada intento futuro conserva datos completos únicamente en `.aws-attempts/<attempt-id>/` (`0700`, archivos `0600`) y en `.aws-change-set.json` (`0600`). Incluye timestamps UTC, profile, región, identidad normalizada, target v2, nombre de change set, client token, request/respuesta, inicio real de cada captura, template y commit SHA, respuestas remotas y una cadena de hashes write-once. Los reportes compartibles contienen solo hashes y booleanos.

Un intento fallido queda intacto y bloquea reintentos automáticos. `DO_NOTHING`, `DeletionPolicy: Retain`, `UpdateReplacePolicy: Retain`, versionado y recursos parciales pueden conservar costos. No existe cleanup automático; la recuperación exige una autorización posterior separada.

## Conjunción obligatoria antes de execute

- commit limpio y template local idéntico al blob aprobado;
- template ASCII con LF e igualdad byte por byte con `GetTemplate`;
- identidad, profile y región iguales a sus hashes aprobados;
- dos fuentes de ausencia cuyo fin queda a menos de 60 segundos del inicio capturado de `CreateChangeSet`, con request ID exacto de `DescribeStacks` corroborado por CloudTrail;
- request `CREATE` revisado, descripción ligada al template, nombre/token internos, `OnStackFailure=DO_NOTHING` y opciones fuera de alcance vacías;
- respuesta y evento `CreateChangeSet` correlacionados por éxito, identidad, región, tiempo, stack, nombre, token e ID;
- placeholder `REVIEW_IN_PROGRESS` sin recursos, outputs ni template aplicado;
- un único change set `CREATE_COMPLETE/AVAILABLE`, sin role, notificaciones, imports ni rollback triggers;
- parámetros, tags, modo `STANDARD` y capabilities exactos;
- guard local previo a toda llamada AWS de `execute` que rechaza symlinks, verifica la cadena que sella `proof-prepare.json` y vincula exactamente puntero, intento, IDs, nombre, token, profile, región, commit, identidad y plantilla;
- exactamente cinco acciones `Add` allowlisted;
- snapshot TOCTOU completo cuyas observaciones tienen antigüedad máxima de 300 segundos, seguido por una cadena revisada que sella `proof-execute.json`; tras derivar los únicos IDs y token aceptados, el guard de lanzamiento repite toda la validación y, solo al terminar, genera internamente una hora UTC nueva y vuelve a exigir con ella la frescura. Si el snapshot vence dentro del guard, no emite autorización y el proceso `execute-change-set` no comienza; la captura queda ligada a la hora final emitida.

`ChangeSetType` no es un campo obligatorio de `DescribeChangeSet`; su ausencia o valor nulo no invalida la prueba. Un valor contradictorio sí la invalida.

## Estado público

GitHub Pages publica solo el artefacto `_site` de 13 archivos. Infraestructura, scripts, pruebas, documentación y evidencia privada no forman parte del sitio. La PWA conserva exactamente cinco controles, un Compartir y el caso funcional de 8 barras, `15 cm²` requeridos y `16 cm²` colocados.
