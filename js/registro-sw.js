// Registro del service worker y capacidades de la interfaz PWA.
const raiz = document.documentElement;
const metaTema = document.querySelector('meta[name="theme-color"]');
const estadoSw = document.getElementById('estado-sw');
const toast = document.getElementById('toast-actualizacion');
const btnRecargar = document.getElementById('btn-recargar');
const btnInstalar = document.getElementById('control-instalar');
const btnCompartir = document.getElementById('control-compartir');
const btnTema = document.getElementById('control-tema');
const btnRestablecer = document.getElementById('control-restablecer');
const btnAyuda = document.getElementById('control-ayuda');
const dialogoAyuda = document.getElementById('dialogo-ayuda');
const btnCerrarAyuda = document.getElementById('cerrar-ayuda');
const dialogoCompartir = document.getElementById('dialogo-compartir');
const btnCerrarCompartir = document.getElementById('cerrar-compartir');
const enlaceWhatsapp = document.getElementById('compartir-whatsapp');
const enlaceTelegram = document.getElementById('compartir-telegram');
const enlaceFacebook = document.getElementById('compartir-facebook');
const enlaceX = document.getElementById('compartir-x');
const enlaceCorreo = document.getElementById('compartir-correo');
const btnCopiarEnlace = document.getElementById('compartir-copiar');
const btnMasApps = document.getElementById('compartir-mas-apps');
const disponibilidadCompartir = document.getElementById('disponibilidad-compartir');
const estadoCompartir = document.getElementById('estado-compartir');
const bloqueCopiaManual = document.getElementById('copia-manual');
const campoCopiaManual = document.getElementById('campo-copia-manual');
const chipConexion = document.getElementById('chip-conexion');

const TEXTO_COMPARTIR = 'Calcula el refuerzo longitudinal de columnas de concreto armado.';
let promptInstalacion = null;
let focoAntesDeAyuda = null;
let temporizadorGeometria = null;

const anunciar = (texto) => { if (estadoSw) estadoSw.textContent = texto; };
const informar = (texto) => anunciar(texto ? `Service worker: ${texto}` : '');

/* ================================================================
   1. Service worker
   ================================================================ */
if (!('serviceWorker' in navigator)) {
  informar('no soportado en este navegador');
} else {
  // Solo recargamos si NOSOTROS pedimos activar la versión nueva. En la primera
  // visita clients.claim() también dispara controllerchange y recargar ahí
  // sería un parpadeo gratuito.
  let saltoSolicitado = false;
  let recargando = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!saltoSolicitado || recargando) return;
    recargando = true;
    location.reload();
  });

  /** Un SW "esperando" solo es una actualización real si ya había otro controlando. */
  function revisarEspera(registro) {
    if (!registro.waiting || !navigator.serviceWorker.controller) return;
    informar('nueva versión lista');
    if (!toast || !btnRecargar) return;
    toast.hidden = false;
    btnRecargar.onclick = () => {
      btnRecargar.disabled = true;
      saltoSolicitado = true;
      registro.waiting.postMessage({ tipo: 'SALTAR_ESPERA' });
    };
  }

  window.addEventListener('load', async () => {
    try {
      const registro = await navigator.serviceWorker.register('./sw.js');
      informar(registro.active ? 'activo · disponible sin conexión' : 'instalando…');

      revisarEspera(registro);
      registro.addEventListener('updatefound', () => {
        const nuevo = registro.installing;
        nuevo?.addEventListener('statechange', () => {
          if (nuevo.state === 'installed') {
            if (navigator.serviceWorker.controller) revisarEspera(registro);
            else informar('activo · disponible sin conexión');
          }
        });
      });
    } catch (error) {
      console.error('[SW] no se pudo registrar:', error);
      informar('no se pudo registrar');
    }
  });
}

/* ================================================================
   2. Instalación
   ================================================================ */
function estaInstalada() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function actualizarInstalacion() {
  if (!btnInstalar || !estaInstalada()) return;
  btnInstalar.setAttribute('aria-label', 'Aplicación instalada');
  btnInstalar.title = 'Aplicación instalada';
  btnInstalar.querySelector('span').textContent = 'Instalada';
}

window.addEventListener('beforeinstallprompt', (evento) => {
  evento.preventDefault();
  promptInstalacion = evento;
  anunciar('La calculadora está lista para instalarse.');
});

btnInstalar?.addEventListener('click', async () => {
  if (estaInstalada()) {
    anunciar('La calculadora ya está instalada en este dispositivo.');
    return;
  }
  if (!promptInstalacion) {
    anunciar('Usa la opción «Instalar aplicación» del menú de tu navegador.');
    return;
  }

  btnInstalar.disabled = true;
  try {
    await promptInstalacion.prompt();
    const eleccion = await promptInstalacion.userChoice;
    anunciar(eleccion.outcome === 'accepted' ? 'Instalación aceptada.' : 'Instalación cancelada.');
  } finally {
    promptInstalacion = null;
    btnInstalar.disabled = false;
  }
});

window.addEventListener('appinstalled', () => {
  promptInstalacion = null;
  actualizarInstalacion();
  anunciar('La calculadora se instaló correctamente.');
});

/* ================================================================
   3. Compartir, tema, restablecer y ayuda
   ================================================================ */
function actualizarEstadoCompartir(texto, tipo = '') {
  if (!estadoCompartir) return;
  estadoCompartir.textContent = texto;
  if (tipo) estadoCompartir.dataset.tipo = tipo;
  else delete estadoCompartir.dataset.tipo;
}

function destinoConParametros(base, parametros) {
  const destino = new URL(base);
  destino.search = new URLSearchParams(parametros).toString();
  return destino.toString();
}

function regenerarDestinos() {
  const enlace = window.location.href;
  if (enlaceWhatsapp) {
    enlaceWhatsapp.href = destinoConParametros('https://wa.me/', {
      text: `${TEXTO_COMPARTIR}\n${enlace}`,
    });
  }
  if (enlaceTelegram) {
    enlaceTelegram.href = destinoConParametros('https://t.me/share/url', {
      url: enlace,
      text: TEXTO_COMPARTIR,
    });
  }
  if (enlaceFacebook) {
    enlaceFacebook.href = destinoConParametros('https://www.facebook.com/sharer/sharer.php', {
      u: enlace,
    });
  }
  if (enlaceX) {
    enlaceX.href = destinoConParametros('https://twitter.com/intent/tweet', {
      url: enlace,
      text: TEXTO_COMPARTIR,
    });
  }
  if (enlaceCorreo) {
    const parametros = new URLSearchParams({
      subject: 'Calculadora de Varillas',
      body: `${TEXTO_COMPARTIR}\n\n${enlace}`,
    });
    enlaceCorreo.href = `mailto:?${parametros.toString()}`;
  }
}

function actualizarMasApps() {
  const disponible = typeof navigator.share === 'function';
  if (btnMasApps) btnMasApps.disabled = !disponible;
  if (!disponibilidadCompartir) return;
  disponibilidadCompartir.textContent = disponible
    ? 'Más apps abre el selector de aplicaciones del sistema.'
    : 'Más apps no está disponible en este navegador; las demás opciones siguen funcionando.';
}

function limpiarHojaCompartir() {
  actualizarEstadoCompartir('');
  if (bloqueCopiaManual) bloqueCopiaManual.hidden = true;
  if (campoCopiaManual) campoCopiaManual.value = '';
}

function abrirCompartir() {
  if (!dialogoCompartir || dialogoCompartir.open || dialogoAyuda?.open) return;
  limpiarHojaCompartir();
  regenerarDestinos();
  actualizarMasApps();
  dialogoCompartir.showModal();
  enlaceWhatsapp?.focus();
}

function copiarConComando(enlace) {
  const campo = document.createElement('textarea');
  campo.value = enlace;
  campo.className = 'campo-copia-portapapeles';
  campo.setAttribute('readonly', '');
  campo.setAttribute('aria-hidden', 'true');
  document.body.append(campo);
  campo.select();
  campo.setSelectionRange(0, campo.value.length);
  const copiado = document.execCommand('copy');
  campo.remove();
  if (!copiado) throw new Error('No se pudo copiar el enlace');
}

function mostrarCopiaManual(enlace) {
  if (!bloqueCopiaManual || !campoCopiaManual) {
    actualizarEstadoCompartir('No se pudo copiar. Selecciona la dirección desde el navegador.', 'error');
    return;
  }
  bloqueCopiaManual.hidden = false;
  campoCopiaManual.value = enlace;
  campoCopiaManual.focus();
  campoCopiaManual.select();
  campoCopiaManual.setSelectionRange(0, campoCopiaManual.value.length);
  actualizarEstadoCompartir('Copia manual disponible: el enlace está seleccionado.', 'error');
}

async function copiarEnlace() {
  const enlace = window.location.href;
  if (bloqueCopiaManual) bloqueCopiaManual.hidden = true;

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(enlace);
      actualizarEstadoCompartir('Enlace copiado al portapapeles.', 'exito');
      return;
    } catch {
      // Continúa con el fallback compatible con navegadores anteriores.
    }
  }

  try {
    copiarConComando(enlace);
    actualizarEstadoCompartir('Enlace copiado al portapapeles.', 'exito');
  } catch {
    mostrarCopiaManual(enlace);
  }
}

function manejarErrorCompartir(error) {
  if (error?.name === 'AbortError') {
    actualizarEstadoCompartir('Cerraste el selector sin compartir. Puedes elegir otra opción.');
    return;
  }
  actualizarEstadoCompartir('No se pudo abrir el selector del sistema. Prueba otra opción.', 'error');
}

btnCompartir?.addEventListener('click', abrirCompartir);
btnCerrarCompartir?.addEventListener('click', () => dialogoCompartir.close());
btnCopiarEnlace?.addEventListener('click', copiarEnlace);
btnMasApps?.addEventListener('click', () => {
  if (typeof navigator.share !== 'function') {
    actualizarMasApps();
    actualizarEstadoCompartir('Más apps no está disponible en este navegador.', 'error');
    return;
  }

  let resultado;
  try {
    resultado = navigator.share({
      title: document.title,
      text: TEXTO_COMPARTIR,
      url: window.location.href,
    });
  } catch (error) {
    manejarErrorCompartir(error);
    return;
  }

  Promise.resolve(resultado)
    .then(() => {
      anunciar('La calculadora se compartió correctamente.');
      if (dialogoCompartir.open) dialogoCompartir.close();
    })
    .catch(manejarErrorCompartir);
});

dialogoCompartir?.querySelectorAll('a[data-compartir-accion]').forEach((enlace) => {
  enlace.addEventListener('click', () => dialogoCompartir.close());
});
dialogoCompartir?.addEventListener('click', (evento) => {
  if (evento.target === dialogoCompartir) dialogoCompartir.close();
});
dialogoCompartir?.addEventListener('close', () => btnCompartir?.focus());

function aplicarTema(tema, guardar = true) {
  raiz.dataset.tema = tema;
  metaTema.content = tema === 'claro' ? '#f4f6f8' : '#101820';
  btnTema?.setAttribute('aria-pressed', String(tema === 'claro'));
  if (btnTema) {
    btnTema.setAttribute('aria-label', tema === 'claro' ? 'Usar tema oscuro' : 'Usar tema claro');
    btnTema.title = tema === 'claro' ? 'Usar tema oscuro' : 'Usar tema claro';
  }
  if (guardar) localStorage.setItem('calculadora-varillas-tema', tema);
}

const temaGuardado = localStorage.getItem('calculadora-varillas-tema');
aplicarTema(temaGuardado === 'claro' ? 'claro' : 'oscuro', false);
btnTema?.addEventListener('click', () => {
  const tema = raiz.dataset.tema === 'oscuro' ? 'claro' : 'oscuro';
  aplicarTema(tema);
  anunciar(`Tema ${tema} activado.`);
});

btnRestablecer?.addEventListener('click', () => {
  document.getElementById('form-columna')?.reset();
  anunciar('Formulario restablecido a sus valores iniciales.');
});

function abrirAyuda() {
  if (!dialogoAyuda || dialogoAyuda.open || dialogoCompartir?.open) return;
  focoAntesDeAyuda = document.activeElement;
  dialogoAyuda.showModal();
  btnCerrarAyuda?.focus();
}

btnAyuda?.addEventListener('click', abrirAyuda);
btnCerrarAyuda?.addEventListener('click', () => dialogoAyuda.close());
dialogoAyuda?.addEventListener('click', (evento) => {
  if (evento.target === dialogoAyuda) dialogoAyuda.close();
});
dialogoAyuda?.addEventListener('close', () => {
  if (focoAntesDeAyuda?.isConnected) focoAntesDeAyuda.focus();
});

/* ================================================================
   4. Window Controls Overlay
   ================================================================ */
function sincronizarWco() {
  const wco = navigator.windowControlsOverlay;
  if (!wco) {
    document.body.classList.remove('wco-visible', 'wco-angosto');
    document.body.dataset.wco = 'no-disponible';
    return;
  }

  const rectangulo = wco.getTitlebarAreaRect();
  document.body.classList.toggle('wco-visible', wco.visible);
  document.body.classList.toggle('wco-angosto', wco.visible && rectangulo.width < 720);
  document.body.dataset.wco = wco.visible ? 'visible' : 'oculto';
  document.body.dataset.wcoAncho = String(Math.round(rectangulo.width));
}

sincronizarWco();
if (navigator.windowControlsOverlay) {
  navigator.windowControlsOverlay.addEventListener('geometrychange', () => {
    clearTimeout(temporizadorGeometria);
    temporizadorGeometria = setTimeout(sincronizarWco, 200);
  });
}

/* ================================================================
   5. Estado de la conexión
   ================================================================ */
function actualizarConexion() {
  if (!chipConexion) return;
  const enLinea = navigator.onLine;
  chipConexion.dataset.estado = enLinea ? 'en-linea' : 'sin-conexion';
  chipConexion.querySelector('.chip__texto').textContent = enLinea ? 'En línea' : 'Sin conexión · la calculadora sigue funcionando';
}
window.addEventListener('online', actualizarConexion);
window.addEventListener('offline', actualizarConexion);
actualizarConexion();
actualizarInstalacion();
