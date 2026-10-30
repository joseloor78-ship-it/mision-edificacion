'use strict';

/* Visor de vistas (solo en aprender.html) */
(function () {
  const VISTAS = {
    planta: {
      archivo: 'assets/planos/planta.svg',
      texto: 'Planta: vista desde arriba tras un corte horizontal imaginario. Muestra la distribución de los espacios, la posición de muros, puertas y ventanas, y las medidas en planta. En esta vista no se pueden leer alturas.'
    },
    elevacion: {
      archivo: 'assets/planos/elevacion-sur.svg',
      texto: 'Elevación sur: vista frontal de la fachada principal, sin perspectiva. Muestra qué aberturas se ven desde fuera, a qué altura están y la altura total (2,75 m).'
    },
    corte: {
      archivo: 'assets/planos/corte-aa.svg',
      texto: 'Corte A-A: la vivienda partida por un plano vertical en y = 3,00 m, mirando al norte. Lo cortado se dibuja en negro y lo que queda detrás, en gris. Permite leer alturas interiores y aberturas en los muros cortados.'
    }
  };

  const panel = document.getElementById('panel-vista');
  const descripcion = document.getElementById('visor-texto');
  const tabs = Array.from(document.querySelectorAll('[role="tab"][data-vista]'));
  if (!panel || !descripcion || tabs.length === 0) return;

  const cache = new Map();
  let peticion = 0;

  async function cargarSvg(url) {
    if (cache.has(url)) return cache.get(url).cloneNode(true);
    const respuesta = await fetch(url);
    if (!respuesta.ok) throw new Error('HTTP ' + respuesta.status);
    const texto = await respuesta.text();
    const doc = new DOMParser().parseFromString(texto, 'image/svg+xml');
    if (doc.querySelector('parsererror')) throw new Error('SVG no válido');
    const svg = document.importNode(doc.documentElement, true);
    svg.classList.add('plano');
    cache.set(url, svg);
    return svg.cloneNode(true);
  }

  function mostrarError() {
    const aviso = document.createElement('p');
    aviso.className = 'error-visor';
    aviso.textContent = 'No se pudo cargar el plano. Si abriste el archivo directamente desde el explorador, usa Live Server o un servidor local.';
    panel.replaceChildren(aviso);
  }

  async function seleccionar(pestana) {
    const vista = VISTAS[pestana.dataset.vista];
    if (!vista) return;

    tabs.forEach(function (t) {
      const activa = t === pestana;
      t.setAttribute('aria-selected', String(activa));
      t.tabIndex = activa ? 0 : -1;
    });
    panel.setAttribute('aria-labelledby', pestana.id);
    descripcion.textContent = vista.texto;

    const turno = ++peticion;
    try {
      const svg = await cargarSvg(vista.archivo);
      if (turno === peticion) panel.replaceChildren(svg);
    } catch (error) {
      if (turno === peticion) mostrarError();
    }
  }

  tabs.forEach(function (pestana, indice) {
    pestana.addEventListener('click', function () { seleccionar(pestana); });
    pestana.addEventListener('keydown', function (evento) {
      let destino = null;
      if (evento.key === 'ArrowRight') destino = tabs[(indice + 1) % tabs.length];
      else if (evento.key === 'ArrowLeft') destino = tabs[(indice - 1 + tabs.length) % tabs.length];
      else if (evento.key === 'Home') destino = tabs[0];
      else if (evento.key === 'End') destino = tabs[tabs.length - 1];
      if (destino) {
        evento.preventDefault();
        destino.focus();
        seleccionar(destino);
      }
    });
  });

  seleccionar(tabs[0]);
})();