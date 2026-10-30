'use strict';

/* Muestra el estado real de la misión a partir del avance de la cuenta. */
(function () {
  const IMPLEMENTADOS = { reto1: true, reto2: true, reto3: true };
  const PAGINAS = { reto1: 'reto1.html', reto2: 'reto2.html', reto3: 'reto3.html' };
  const NOMBRES = { reto1: 'Nivel 1', reto2: 'Nivel 2', reto3: 'Nivel 3' };

  function pintar() {
    const estado = ProgresoMision.leer();
    const puntos = document.getElementById('puntos-valor');
    if (puntos) puntos.textContent = String(estado.puntos);

    ProgresoMision.RETOS.forEach(function (id, indice) {
      const tarjeta = document.querySelector('[data-reto="' + id + '"]');
      if (!tarjeta) return;

      const datos = estado.retos[id];
      const bloqueado = !ProgresoMision.desbloqueado(estado, id);

      let clave, etiqueta;
      if (!IMPLEMENTADOS[id]) { clave = 'desarrollo'; etiqueta = 'En desarrollo'; }
      else if (datos.completado) { clave = 'completado'; etiqueta = 'Completado'; }
      else if (bloqueado) { clave = 'bloqueado'; etiqueta = 'Bloqueado'; }
      else if (datos.porcentaje > 0) { clave = 'progreso'; etiqueta = 'En progreso'; }
      else { clave = 'disponible'; etiqueta = 'Disponible'; }

      tarjeta.dataset.estado = clave;
      tarjeta.dataset.bloqueado = String(bloqueado);
      tarjeta.querySelector('[data-etiqueta]').textContent = etiqueta;

      const barra = tarjeta.querySelector('[role="progressbar"]');
      barra.setAttribute('aria-valuenow', String(datos.porcentaje));
      barra.firstElementChild.style.width = datos.porcentaje + '%';
      tarjeta.querySelector('.progreso-valor').textContent = datos.porcentaje + '%';

      tarjeta.querySelector('[data-nota]').textContent = bloqueado
        ? 'Se desbloquea al completar el ' + NOMBRES[ProgresoMision.RETOS[indice - 1]] + '.'
        : '';

      const accion = tarjeta.querySelector('[data-accion]');
      accion.replaceChildren();
      if (IMPLEMENTADOS[id] && !bloqueado) {
        const enlace = document.createElement('a');
        enlace.className = 'btn btn-primary';
        enlace.href = PAGINAS[id];
        enlace.textContent = datos.completado ? 'Repetir' : (datos.sesion ? 'Continuar' : 'Jugar');
        accion.appendChild(enlace);
      }
    });
  }

  Auth.listo().then(function (sesion) {
    if (sesion) pintar();
  });
})();