# Contribuir

Gracias por mejorar Calculadora de Varillas. Es una aplicación académica de ingeniería estructural: un cambio pequeño en una fórmula puede alterar resultados de diseño, por lo que las modificaciones deben ser trazables y fáciles de revisar.

## Preparación

Requisitos: Node.js 20 o posterior y un navegador moderno.

```bash
git clone https://github.com/ErickrU/calculadora-varillas-pwa.git
cd calculadora-varillas-pwa
npm start
```

Abre `http://127.0.0.1:8080/`. El servidor escucha solo en loopback; la aplicación no instala dependencias ni requiere credenciales para el desarrollo local.

## Flujo recomendado

1. Crea una rama desde `main` (`feature/...`, `fix/...` o `docs/...`).
2. Haz un cambio enfocado; evita mezclar fórmulas, interfaz e infraestructura sin necesidad.
3. Si cambias `js/calculo.js`, documenta la ecuación, unidades, hipótesis y referencia normativa.
4. Si cambias archivos incluidos en el app shell, incrementa `VERSION` en `sw.js`.
5. Ejecuta las verificaciones locales.
6. Abre un pull request con el problema, la solución y los casos comprobados.

## Verificación local

```bash
npm run check
npm test
bash -n scripts/deploy-aws.sh scripts/verify-site.sh
shellcheck scripts/deploy-aws.sh scripts/verify-site.sh
```

La suite comprueba el caso rectangular `30 × 50 cm`, cuantía `1 %`, barra `5/8"`: `ok=true`, 8 barras, `As` requerido de `15 cm²` y colocado de `16 cm²`. También exige exactamente cinco controles, un solo Compartir, una hoja accesible con siete acciones, destinos codificados desde la URL actual, enlaces externos seguros, Web Share únicamente desde «Más apps», copia únicamente desde «Copiar enlace», cancelación neutral, selección manual final, feedback accesible y Window Controls Overlay.

Después, prueba en el navegador geometrías y métodos distintos, validaciones, presentación adaptable, teclado, la hoja centrada en escritorio y anclada abajo en móvil, foco inicial y de retorno, instalación, uso offline y actualización del service worker cuando corresponda. Abrir la hoja no debe copiar, invocar Web Share ni solicitar contenido de terceros.

## Infraestructura

Este workflow no hizo llamadas AWS. Las pruebas AWS usan únicamente módulos puros y fixtures sintéticos; no ejecutes `scripts/deploy-aws.sh` para validar un cambio de código.

El intento `calculadora-varillas-pwa-public-prod` está bloqueado y debe permanecer intacto. El único target futuro del script es `calculadora-varillas-pwa-public-prod-v2`; si existe o la ausencia no puede corroborarse, se detiene sin update, cambio de nombre, delete ni cleanup. El invocador no controla stack, entorno, price class, nombre de change set o client token.

Una operación futura autorizada exige profile y región explícitos, commit e identidad aprobados, repositorio limpio, dos pruebas de ausencia, correlación CloudTrail, plantilla idéntica byte por byte, `CREATE`, `DO_NOTHING`, exactamente cinco `Add` allowlisted y un guard TOCTOU fresco. `ChangeSetType` puede faltar en `DescribeChangeSet`; una contradicción sí debe fallar.

La evidencia completa vive solo en `.aws-attempts/<attempt-id>/` (`0700`, archivos `0600`) y `.aws-change-set.json` (`0600`). Los reportes compartibles contienen únicamente hashes y booleanos. No publiques credenciales, cuentas, ARN, nombres físicos, tokens, archivos `.env`, estados ni outputs. Preparar, ejecutar y recuperar recursos parciales requieren autorizaciones trazables separadas.

## Estilo

- Código y documentación en español; nombres de APIs web pueden conservarse en inglés.
- JavaScript moderno, módulos ES y sin dependencias cuando la plataforma web sea suficiente.
- HTML semántico, navegación por teclado, mensajes asociados a sus controles y contraste WCAG AA.
- Usa términos inclusivos como `main`, `allowlist`, `denylist`, `primary` y `replica`.

## Cambios de cálculo

Un pull request que altere resultados debe incluir valores de entrada, desarrollo manual independiente, resultado anterior y nuevo, cláusula normativa aplicable y explicación de unidades/redondeos. La herramienta no reemplaza la revisión de un ingeniero estructural.
