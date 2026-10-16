import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const css = readFileSync(join(root, 'css', 'estilos.css'), 'utf8');
const pwa = readFileSync(join(root, 'js', 'registro-sw.js'), 'utf8');
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));

function occurrences(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

test('conserva exactamente cinco controles y un único Compartir', () => {
  assert.equal(occurrences(html, /\bdata-control-ventana\b/g), 5);
  assert.equal(occurrences(html, /\bid="control-compartir"/g), 1);
  assert.match(html, /<button[^>]+id="control-compartir"[^>]+data-control-ventana/);
});

test('incluye una hoja de Compartir accesible con siete acciones e iconos propios', () => {
  const dialogo = html.match(/<dialog id="dialogo-compartir"[\s\S]*?<\/dialog>/)?.[0];
  assert.ok(dialogo, 'debe existir un diálogo independiente para Compartir');
  assert.match(dialogo, /aria-labelledby="titulo-compartir"/);
  assert.match(dialogo, /aria-describedby="descripcion-compartir"/);
  assert.match(dialogo, /id="estado-compartir"[^>]+role="status"[^>]+aria-live="polite"/);
  assert.equal(occurrences(dialogo, /\bdata-compartir-accion\b/g), 7);
  assert.equal(occurrences(dialogo, /<svg\b/g), 7);
  assert.doesNotMatch(dialogo, /<img\b|https?:\/\/[^"']+\.(?:png|svg|webp)/i);

  for (const id of [
    'compartir-whatsapp',
    'compartir-telegram',
    'compartir-facebook',
    'compartir-x',
    'compartir-correo',
    'compartir-copiar',
    'compartir-mas-apps',
  ]) {
    assert.match(dialogo, new RegExp(`id="${id}"`));
  }
  assert.equal(occurrences(dialogo, /target="_blank" rel="noopener noreferrer"/g), 4);
  assert.match(dialogo, /href="mailto:"/);
});

test('genera todos los destinos con URLSearchParams y la URL actual', () => {
  assert.match(pwa, /const enlace = window\.location\.href/);
  assert.match(pwa, /new URLSearchParams\(parametros\)/);
  assert.match(pwa, /new URLSearchParams\(\{[\s\S]*?subject:[\s\S]*?body:/);
  for (const endpoint of [
    'https://wa.me/',
    'https://t.me/share/url',
    'https://www.facebook.com/sharer/sharer.php',
    'https://twitter.com/intent/tweet',
  ]) {
    assert.ok(pwa.includes(endpoint), `falta el destino ${endpoint}`);
  }
  assert.match(pwa, /enlaceCorreo\.href = `mailto:\?\$\{parametros\.toString\(\)\}`/);
  assert.doesNotMatch(pwa, /github\.com\/ErickrU|erickru\.github\.io/);
});

test('el control superior solo abre la hoja y separa Share de Copiar', () => {
  const apertura = pwa.match(/function abrirCompartir\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(apertura);
  assert.match(apertura, /regenerarDestinos\(\)/);
  assert.match(apertura, /dialogoCompartir\.showModal\(\)/);
  assert.match(apertura, /enlaceWhatsapp\?\.focus\(\)/);
  assert.doesNotMatch(apertura, /navigator\.share|clipboard|copiarEnlace/);
  assert.match(pwa, /btnCompartir\?\.addEventListener\('click', abrirCompartir\)/);
  assert.match(pwa, /btnMasApps\?\.addEventListener\('click',[\s\S]*?resultado = navigator\.share\(\{[\s\S]*?url: window\.location\.href/);
  assert.match(pwa, /btnCopiarEnlace\?\.addEventListener\('click', copiarEnlace\)/);
  assert.equal(occurrences(pwa, /\bcopiarEnlace\b/g), 2);
});

test('Web Share ausente, cancelado o fallido nunca activa la copia', () => {
  assert.match(pwa, /const disponible = typeof navigator\.share === 'function'/);
  assert.match(pwa, /btnMasApps\.disabled = !disponible/);
  const errorShare = pwa.match(/function manejarErrorCompartir\(error\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(errorShare);
  assert.match(errorShare, /AbortError/);
  assert.doesNotMatch(errorShare, /copiar|clipboard|execCommand/);
  assert.match(pwa, /\.catch\(manejarErrorCompartir\)/);
});

test('Copiar usa Clipboard, execCommand y selección manual solo desde su acción', () => {
  assert.match(pwa, /navigator\.clipboard\?\.writeText/);
  assert.match(pwa, /navigator\.clipboard\.writeText\(enlace\)/);
  assert.match(pwa, /document\.execCommand\('copy'\)/);
  assert.match(pwa, /function mostrarCopiaManual\(enlace\)/);
  assert.match(pwa, /campoCopiaManual\.select\(\)/);
  assert.match(html, /id="copia-manual"[^>]+hidden/);
  assert.match(html, /id="campo-copia-manual"[^>]+readonly/);
  assert.match(pwa, /Enlace copiado al portapapeles/);
});

test('la hoja cierra por botón y backdrop y devuelve el foco sin interferir con Ayuda', () => {
  assert.match(pwa, /btnCerrarCompartir\?\.addEventListener\('click', \(\) => dialogoCompartir\.close\(\)\)/);
  assert.match(pwa, /if \(evento\.target === dialogoCompartir\) dialogoCompartir\.close\(\)/);
  assert.match(pwa, /dialogoCompartir\?\.addEventListener\('close', \(\) => btnCompartir\?\.focus\(\)\)/);
  assert.match(pwa, /dialogoAyuda\?\.open/);
  assert.match(pwa, /dialogoCompartir\?\.open/);
  assert.match(css, /#dialogo-compartir[\s\S]*?width: min\(640px/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?#dialogo-compartir[\s\S]*?margin: auto 0 0/);
  assert.match(css, /\.compartir__accion[\s\S]*?min-height: 96px/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test('actualiza el app shell a v5 sin cambiar el contrato WCO', () => {
  assert.match(sw, /const VERSION = 'v5'/);
  assert.match(sw, /'\.\/js\/registro-sw\.js'/);
  assert.match(sw, /'\.\/css\/estilos\.css'/);
  assert.deepEqual(manifest.display_override, ['window-controls-overlay', 'standalone']);
  assert.equal(manifest.display, 'standalone');
});
