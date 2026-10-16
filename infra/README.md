# Infraestructura

`cloudformation.yaml` define exactamente cinco recursos para una instancia nueva:

- bucket S3 privado con los cuatro Block Public Access, `BucketOwnerEnforced`, SSE-S3 y versionado;
- bucket policy con lectura exclusiva desde la distribución por `AWS:SourceArn` y denegación de transporte inseguro;
- CloudFront Origin Access Control con firma SigV4 `always`;
- distribución con origen REST, HTTP→HTTPS y solo `GET`/`HEAD`;
- Response Headers Policy con CSP estricta, `DENY`, `nosniff`, HSTS sin subdominios, Referrer Policy y Permissions Policy, sin `X-XSS-Protection`.

No se crean website endpoints, CORS, ACL públicas, IAM, DNS, certificados, dominios personalizados, WAF, logs ni funciones.

El bucket usa `DeletionPolicy: Retain` y `UpdateReplacePolicy: Retain`: se conserva durante un rollback de la creación inicial, al eliminar la stack y ante un reemplazo. El almacenamiento retenido y sus versiones pueden seguir generando costos; no existe limpieza automática. `stack-policy.json` deniega `Update:*` sobre todos los recursos. En `prod`, el flujo activa termination protection antes del primer upload.

No ejecutes la plantilla directamente. Lee [`../docs/AWS-DEPLOYMENT.md`](../docs/AWS-DEPLOYMENT.md) y comienza con la fase de solo lectura:

```bash
./scripts/deploy-aws.sh \
  --phase review \
  --profile <YOUR_AWS_PROFILE> \
  --region <YOUR_AWS_REGION> \
  --stack <YOUR_NEW_STACK_NAME> \
  --environment prod
```

`--profile` es opcional. Usa credenciales temporales de mínimo privilegio, confirma identidad/cuenta por un canal local y evita credenciales administrativas. Las fases `prepare` y `execute` están separadas y solo admiten `CREATE`; no hay rutas de actualización o eliminación. Nunca versiones credenciales, `.aws-change-set.json`, `.aws-deployment.json`, outputs o nombres físicos.
