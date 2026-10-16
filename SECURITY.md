# Seguridad

## Reportar una vulnerabilidad

No publiques detalles sensibles en un issue. Usa [Report a vulnerability](https://github.com/ErickrU/calculadora-varillas-pwa/security/advisories/new) para enviar un reporte privado. Incluye impacto, pasos de reproducción y una prueba de concepto mínima que no afecte sistemas ajenos.

## Modelo de seguridad

La aplicación es estática y ejecuta todos los cálculos en el navegador:

- no tiene backend, base de datos, cuentas de usuario ni analítica;
- no transmite los valores del formulario;
- no usa dependencias JavaScript de terceros ni recursos de CDN;
- el service worker solo intercepta solicitudes `GET` del mismo origen;
- Compartir usa la URL actual y el fallback de portapapeles informa el resultado en una región viva;
- no se deben introducir secretos en HTML, JavaScript, el manifest ni Git.

El despliegue AWS propuesto agrega:

- bucket S3 privado con los cuatro controles de Block Public Access, `BucketOwnerEnforced`, SSE-S3 y versionado;
- acceso al origen exclusivamente mediante CloudFront OAC con firma SigV4 permanente y condición `AWS:SourceArn`;
- denegación explícita de transporte no seguro hacia S3;
- redirección HTTP→HTTPS y únicamente `GET`/`HEAD` para clientes;
- CSP sin `unsafe-inline`, `DENY`, `nosniff`, HSTS seguro para `cloudfront.net`, Referrer Policy y Permissions Policy, sin `X-XSS-Protection`;
- `DeletionPolicy: Retain` conserva el bucket durante un rollback de la creación inicial y al eliminar la stack; `UpdateReplacePolicy: Retain` lo conserva ante un reemplazo;
- versionado, stack policy que deniega todo update y termination protection para `prod` antes de publicar; el almacenamiento y las versiones retenidos pueden generar costos y no existe limpieza automática;
- flujo de creación en dos invocaciones, sin rutas de actualización, eliminación o limpieza.

Este repositorio no versiona credenciales, outputs ni estado de una cuenta AWS. Usa credenciales temporales de mínimo privilegio, verifica la identidad activa antes de cualquier escritura y conserva `.aws-change-set.json` y `.aws-deployment.json` únicamente como estado local ignorado con modo `0600`. Consulta [`docs/AWS-DEPLOYMENT.md`](docs/AWS-DEPLOYMENT.md).

## Alcance y datos

Los resultados son orientativos y académicos. Una discrepancia de ingeniería debe reportarse como defecto funcional con un cálculo manual reproducible; no es, por sí sola, una vulnerabilidad de seguridad.

Versiones con soporte: la rama `main` y la versión pública más reciente del repositorio.
