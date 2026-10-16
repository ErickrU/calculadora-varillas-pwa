# Infraestructura

`cloudformation.yaml` crea alojamiento AWS genérico para la PWA:

- bucket S3 privado, cifrado y versionado;
- Block Public Access completo y Object Ownership sin ACL;
- CloudFront Origin Access Control con firma SigV4;
- distribución CloudFront que redirige HTTP a HTTPS;
- Content Security Policy, HSTS y otras cabeceras;
- política que limita `s3:GetObject` a la distribución creada.

El bucket usa `DeletionPolicy: Retain` y `UpdateReplacePolicy: Retain`. Borrar o reemplazar el stack no borra datos automáticamente. El repositorio no contiene nombres físicos, cuentas, ARN, outputs ni evidencia de un despliegue existente.

No ejecutes la plantilla sin leer [`../docs/AWS-DEPLOYMENT.md`](../docs/AWS-DEPLOYMENT.md). El punto de entrada recomendado, primero sin `--apply`, es:

```bash
./scripts/deploy-aws.sh \
  --profile <YOUR_AWS_PROFILE> \
  --region <YOUR_AWS_REGION> \
  --stack <YOUR_STACK_NAME> \
  --environment <YOUR_ENVIRONMENT>
```

`--profile` es opcional: admite perfiles normales o SSO; al omitirlo se usa la cadena estándar de credenciales de AWS. Usa credenciales temporales de mínimo privilegio, confirma la identidad/cuenta activa y evita credenciales administrativas para el uso habitual. Nunca versiones credenciales, `.aws-deployment.json`, outputs ni estado local.

## Certificado y TLS

La configuración inicial usa el dominio y certificado predeterminados de CloudFront. AWS fija la política mínima de ese certificado; CloudFormation no permite endurecerla para `cloudfront.net`. Para controlar el mínimo TLS, configura un dominio propio, un certificado ACM en `us-east-1`, `Aliases`, `AcmCertificateArn`, `SslSupportMethod: sni-only` y `MinimumProtocolVersion`.
