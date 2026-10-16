# Contribuir

Gracias por mejorar Calculadora de Varillas. Es una aplicación académica de ingeniería estructural: un cambio pequeño en una fórmula puede alterar resultados de diseño, por lo que las modificaciones deben ser trazables y fáciles de revisar.

## Preparación

Requisitos: Node.js 20 o posterior y un navegador moderno.

```bash
git clone https://github.com/ErickrU/calculadora-varillas-pwa.git
cd calculadora-varillas-pwa
npm start
```

Abre `http://localhost:8080/`. La aplicación no instala dependencias ni requiere credenciales para el desarrollo local.

## Flujo recomendado

1. Crea una rama desde `main` (`feature/...`, `fix/...` o `docs/...`).
2. Haz un cambio enfocado; evita mezclar fórmulas, interfaz e infraestructura sin necesidad.
3. Si cambias `js/calculo.js`, documenta la ecuación, unidades, hipótesis y referencia normativa.
4. Si cambias archivos incluidos en el app shell, incrementa `VERSION` en `sw.js` para que las instalaciones existentes reciban la actualización.
5. Ejecuta las verificaciones indicadas abajo.
6. Abre un pull request describiendo el problema, la solución y los casos comprobados.

## Verificación mínima

```bash
node --check js/calculo.js
node --check js/app.js
node --check js/registro-sw.js
node --check sw.js
node --check herramientas/servidor.mjs
node -e "JSON.parse(require('fs').readFileSync('manifest.webmanifest', 'utf8'))"
```

Después, prueba en el navegador:

- columna rectangular, circular y circular con espiral;
- método por cuantía y por carga axial;
- errores por dato vacío, cuantía fuera de 1 %–6 % y sección insuficiente;
- presentación en móvil y escritorio;
- los cinco controles de la barra, incluido «Compartir» mediante Web Share y copia de URL;
- recarga sin conexión después de una primera visita;
- actualización del service worker si cambiaste el app shell.

Para infraestructura, usa primero el modo de revisión sin `--apply`:

```bash
./scripts/deploy-aws.sh \
  --profile <YOUR_AWS_PROFILE> \
  --region <YOUR_AWS_REGION> \
  --stack <YOUR_STACK_NAME> \
  --environment <YOUR_ENVIRONMENT>
```

`--profile` es opcional; omítelo para usar la cadena estándar de credenciales de AWS. Usa SSO o credenciales temporales de mínimo privilegio, comprueba la identidad activa y no uses credenciales administrativas como opción habitual. No publiques credenciales, identificadores de cuenta, ARN, nombres físicos, archivos `.env`, `.aws-deployment.json` ni outputs de despliegue.

## Estilo

- Código y documentación en español; nombres de APIs web pueden conservarse en inglés.
- JavaScript moderno, módulos ES y sin dependencias cuando la plataforma web sea suficiente.
- HTML semántico, navegación por teclado, mensajes asociados a sus controles y contraste WCAG AA.
- Usa términos inclusivos como `main`, `allowlist`, `denylist`, `primary` y `replica`.

## Cambios de cálculo

Un pull request que altere resultados debe incluir al menos:

- valores de entrada;
- desarrollo manual independiente;
- resultado anterior y nuevo;
- cláusula normativa aplicable;
- explicación de unidades y redondeos.

La herramienta no reemplaza la revisión de un ingeniero estructural.
