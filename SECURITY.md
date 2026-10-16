# Seguridad

## Reportar una vulnerabilidad

No publiques detalles sensibles en un issue. Usa [Report a vulnerability](https://github.com/ErickrU/calculadora-varillas-pwa/security/advisories/new) para enviar un reporte privado. Incluye impacto, pasos de reproducción y una prueba mínima que no afecte sistemas ajenos.

## Modelo de seguridad

La aplicación es estática y ejecuta todos los cálculos en el navegador:

- no tiene backend, base de datos, cuentas de usuario ni analítica;
- no transmite los valores del formulario;
- no usa dependencias JavaScript de terceros ni recursos de CDN;
- el service worker solo intercepta solicitudes `GET` del mismo origen;
- Compartir usa la URL actual y anuncia el resultado en una región viva;
- no se deben introducir secretos en HTML, JavaScript, el manifest ni Git.

La alternativa AWS mantiene:

- bucket S3 privado con cuatro Block Public Access, `BucketOwnerEnforced`, SSE-S3 y versionado;
- acceso al origen exclusivamente mediante CloudFront OAC con firma SigV4 y condición `AWS:SourceArn`;
- denegación de transporte no seguro hacia S3;
- redirección HTTP→HTTPS y únicamente `GET`/`HEAD` para clientes;
- CSP sin `unsafe-inline`, `DENY`, `nosniff`, HSTS, Referrer Policy y Permissions Policy, sin `X-XSS-Protection`;
- `DeletionPolicy: Retain` para rollback de creación o eliminación del stack y `UpdateReplacePolicy: Retain` para reemplazo;
- stack policy que deniega updates y termination protection antes de publicar en `prod`.

## Evidencia y operaciones AWS

Este workflow no hizo llamadas AWS. `calculadora-varillas-pwa-public-prod` es un intento bloqueado que permanece intacto. El único target futuro propuesto es `calculadora-varillas-pwa-public-prod-v2`; cualquier existencia o resultado ambiguo obliga a `STOP`, sin update, nombre alternativo, eliminación ni cleanup.

El script exige profile explícito, commit e identidad aprobados y una plantilla ASCII+LF idéntica al blob revisado. Genera internamente attempt ID, nombre de change set y client token. Antes de crear exige `DescribeStacks` y `ListChangeSets` inmediatamente anteriores, y luego correlaciona CloudTrail por identidad, cuenta, región, tiempo, request ID, stack, nombre, token y respuesta.

El validador fail-closed exige request `CREATE`, `OnStackFailure=DO_NOTHING`, opciones fuera de alcance vacías, placeholder `REVIEW_IN_PROGRESS` sin recursos, outputs o template aplicado, un único change set `CREATE_COMPLETE/AVAILABLE`, modo `STANDARD`, parámetros/tags exactos y cinco acciones `Add` allowlisted. No requiere `ChangeSetType` como campo de respuesta; rechaza un valor contradictorio. Antes de cualquier llamada AWS de `execute`, un guard puramente local rechaza symlinks, verifica `chain-prepare.json` y compara exactamente puntero, intento y `proof-prepare.json`; los IDs para las consultas TOCTOU salen solo de esa evidencia sellada. Después repite toda la conjunción con observaciones TOCTOU de máximo 300 segundos y sella `proof-execute.json` en `chain-execute-reviewed.json`. Un guard preliminar deriva de esa prueba los IDs y el token. El guard de lanzamiento vuelve a validar evidencia, cadena y vinculación; solo cuando termina obtiene internamente una hora UTC nueva y vuelve a exigir con ella la frescura máxima. Si el snapshot vence durante el propio guard, no escribe autorización y el proceso AWS no comienza. La captura consume exactamente la hora emitida por esa autorización final.

Los valores completos se conservan exclusivamente en `.aws-attempts/<attempt-id>/` (`0700`, archivos `0600`) y `.aws-change-set.json` (`0600`), ambos ignorados. Los reportes compartibles contienen solo hashes y booleanos. Nunca compartas el directorio, el puntero o `.aws-deployment.json`.

`DO_NOTHING`, `Retain/Retain`, versionado y recursos parciales pueden conservar costos. No hay limpieza automática. Toda preparación, ejecución CREATE y recuperación posterior requieren autorizaciones trazables separadas; no desactives termination protection ni políticas de retención para evitar ese proceso.

## Alcance y datos

Los resultados son orientativos y académicos. Una discrepancia de ingeniería debe reportarse como defecto funcional con un cálculo manual reproducible; no es, por sí sola, una vulnerabilidad de seguridad.

Versiones con soporte: la rama `main` y la versión pública más reciente del repositorio.
