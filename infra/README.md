# Infraestructura AWS

`cloudformation.yaml` define exactamente cinco recursos para una creación nueva propuesta de Calculadora de Varillas:

1. bucket S3 privado, cifrado y versionado;
2. Origin Access Control de CloudFront con SigV4 permanente;
3. política de cabeceras de seguridad;
4. distribución CloudFront HTTPS;
5. política del bucket limitada al ARN de esa distribución.

S3 mantiene los cuatro controles de Block Public Access, usa `BucketOwnerEnforced` y no expone website endpoint, CORS ni ACL pública. CloudFront permite únicamente `GET` y `HEAD`, redirige HTTP a HTTPS y aplica CSP sin inline/eval, `DENY`, `nosniff`, HSTS, Referrer Policy y Permissions Policy.

La plantilla no fija nombres físicos ni contiene cuentas, ARN, buckets, distribuciones o dominios reales. Tampoco crea IAM, DNS, certificados propios, WAF, logs, funciones de borde, macros, nested stacks o imports. Su texto no funcional es ASCII y usa LF para comparar `GetTemplate`, el archivo enviado y el blob aprobado byte por byte, sin normalización ni relajación del hash.

`DeletionPolicy: Retain` conserva el bucket ante rollback de creación o eliminación del stack. `UpdateReplacePolicy: Retain` conserva el recurso anterior ante un reemplazo autorizado por separado. El almacenamiento, versiones y recursos parciales pueden generar costos; no existe cleanup automático.

`calculadora-varillas-pwa-public-prod` es un intento bloqueado que permanece intacto. El único target futuro de `deploy-aws.sh` es `calculadora-varillas-pwa-public-prod-v2`. Si v2 existe o no puede probarse su ausencia, el script hace STOP y nunca update, delete ni cambio de nombre.

`prepare` persiste la identidad normalizada, liga dos probes al inicio real de `CreateChangeSet`, exige el request ID exacto de `DescribeStacks` en CloudTrail y usa `CREATE`, descripción ligada al template, client token interno y `OnStackFailure=DO_NOTHING`, sin opciones fuera de alcance. `execute` exige autorización separada, compara el token del puntero con intento/evidencia y repite una validación TOCTOU completa de máximo 300 segundos inmediatamente antes de la llamada.

La evidencia completa se guarda fuera de Git en `.aws-attempts/` con modos `0700/0600`; los reportes compartibles solo contienen hashes y booleanos. La validación no exige `ChangeSetType` en `DescribeChangeSet`, pero rechaza cualquier valor contradictorio y exige exactamente cinco `Add` allowlisted.

Este workflow no hizo llamadas AWS. Consulta [`../docs/AWS-DEPLOYMENT.md`](../docs/AWS-DEPLOYMENT.md) antes de cualquier operación futura.
