'use strict';

/* Asistente educativo "Robo-Plano".
   Requiere: vendor/supabase/supabase.js, js/config.js, js/auth.js (en ese orden).
   - Con IA: llama a la Edge Function "asistente" de Supabase (que usa Gemini).
   - Sin IA (error, sin cupo o sin conexión): muestra pistas automáticas, claramente marcadas.
   Todo el texto se inserta con textContent (sin innerHTML) para evitar XSS. */
(function () {
  const FUNCION = 'asistente';
  const IMAGEN = 'assets/robot/robot-asistente.svg';
  const MAX_CONSULTAS = 15;      // por carga de página
  const ESPERA_MS = 4000;        // pausa mínima entre consultas
  const MAX_TEXTO = 300;

  const PISTAS_AUTOMATICAS = [
    'Empieza por la planta: ¿qué espacios ves y cómo se conectan entre sí?',
    'Las puertas se dibujan con un arco que muestra hacia dónde abren. Las ventanas aparecen como líneas dentro del muro.',
    'Compara siempre dos vistas: lo que ves en la planta debe aparecer también en la elevación o en el corte.',
    'Revisa las cotas: indican distancias reales. Si un dato no está en el plano, no lo supongas.'
  ];

  let usos = 0;
  let ultimaConsulta = 0;
  let ocupado = false;
  let turnoPista = 0;
  let botonAbrir, panel, mensajes, campo, botonEnviar, botonPista;

  function crear(etiqueta, texto, clase) {
    const nodo = document.createElement(etiqueta);
    if (texto !== undefined) nodo.textContent = texto;
    if (clase) nodo.className = clase;
    return nodo;
  }

  function leerTexto(id) {
    const nodo = document.getElementById(id);
    return nodo ? nodo.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  function contextoActual() {
    const titulo = document.querySelector('h1');
    return {
      reto: titulo ? titulo.textContent.trim().slice(0, 60) : '',
      pregunta: leerTexto('enunciado').slice(0, 400),
      respuestaEstudiante: leerTexto('retro').slice(0, 200)
    };
  }

  function agregarMensaje(texto, tipo, origen) {
    const burbuja = crear('div', undefined, 'asis-msg asis-' + tipo);
    if (origen) burbuja.appendChild(crear('span', origen, 'asis-origen'));
    burbuja.appendChild(crear('p', texto));
    mensajes.appendChild(burbuja);
    mensajes.scrollTop = mensajes.scrollHeight;
  }

  function pistaAutomatica(motivo) {
    const texto = PISTAS_AUTOMATICAS[turnoPista % PISTAS_AUTOMATICAS.length];
    turnoPista += 1;
    agregarMensaje(motivo + ' ' + texto, 'robot', 'Pista automática (sin IA)');
  }

  function bloquear(valor) {
    ocupado = valor;
    botonEnviar.disabled = valor;
    botonPista.disabled = valor;
  }

  async function consultar(textoLibre) {
    if (ocupado) return;
    const ahora = Date.now();
    if (usos >= MAX_CONSULTAS) {
      agregarMensaje('Llegaste al máximo de consultas en esta sesión. Recarga la página para seguir, o usa el botón "Ver una pista" del reto.', 'aviso');
      return;
    }
    if (ahora - ultimaConsulta < ESPERA_MS) {
      agregarMensaje('Espera unos segundos antes de preguntar de nuevo.', 'aviso');
      return;
    }
    ultimaConsulta = ahora;
    usos += 1;
    bloquear(true);

    const ctx = contextoActual();
    const consulta = (textoLibre || '').trim().slice(0, MAX_TEXTO);
    agregarMensaje(consulta || 'Necesito una pista.', 'usuario');
    const espera = crear('div', 'Pensando…', 'asis-msg asis-aviso');
    mensajes.appendChild(espera);

    try {
      const cliente = Auth.obtenerCliente();
      const resultado = await cliente.functions.invoke(FUNCION, {
        body: {
          reto: ctx.reto,
          pregunta: ctx.pregunta,
          respuestaEstudiante: ctx.respuestaEstudiante,
          consulta: consulta
        }
      });
      espera.remove();
      if (resultado.error || !resultado.data || typeof resultado.data.respuesta !== 'string') {
        const estado = resultado.error && resultado.error.context && resultado.error.context.status;
        pistaAutomatica(estado === 429
          ? 'La IA alcanzó su límite gratuito por hoy.'
          : 'La IA no está disponible en este momento.');
      } else {
        agregarMensaje(resultado.data.respuesta, 'robot', 'Respuesta generada por IA (Gemini)');
      }
    } catch (error) {
      console.error(error);
      espera.remove();
      pistaAutomatica('No se pudo conectar con la IA.');
    } finally {
      bloquear(false);
      campo.value = '';
      campo.focus();
    }
  }

  function alternarPanel(abrir) {
    panel.hidden = !abrir;
    botonAbrir.setAttribute('aria-expanded', String(abrir));
    if (abrir) campo.focus(); else botonAbrir.focus();
  }

  function construir() {
    botonAbrir = crear('button', undefined, 'asis-abrir');
    botonAbrir.type = 'button';
    botonAbrir.setAttribute('aria-expanded', 'false');
    botonAbrir.setAttribute('aria-controls', 'asis-panel');
    botonAbrir.setAttribute('aria-label', 'Abrir asistente Robo-Plano');
    const img = document.createElement('img');
    img.src = IMAGEN;
    img.alt = '';
    img.width = 56;
    img.height = 62;
    botonAbrir.appendChild(img);
    botonAbrir.appendChild(crear('span', 'Ayuda', 'asis-etiqueta'));

    panel = crear('section', undefined, 'asis-panel');
    panel.id = 'asis-panel';
    panel.hidden = true;
    panel.setAttribute('aria-label', 'Asistente Robo-Plano');

    const cabecera = crear('div', undefined, 'asis-cabecera');
    cabecera.appendChild(crear('strong', 'Robo-Plano'));
    const cerrar = crear('button', 'Cerrar', 'asis-cerrar');
    cerrar.type = 'button';
    cabecera.appendChild(cerrar);

    mensajes = crear('div', undefined, 'asis-mensajes');
    mensajes.setAttribute('role', 'log');
    mensajes.setAttribute('aria-live', 'polite');

    const formulario = crear('div', undefined, 'asis-form');
    const etiqueta = crear('label', 'Tu pregunta (opcional)');
    etiqueta.setAttribute('for', 'asis-campo');
    campo = document.createElement('input');
    campo.type = 'text';
    campo.id = 'asis-campo';
    campo.maxLength = MAX_TEXTO;
    campo.autocomplete = 'off';
    campo.placeholder = 'Ej.: no entiendo cómo reconocer una puerta';

    const fila = crear('div', undefined, 'asis-botones');
    botonPista = crear('button', 'Pedir pista', 'btn btn-outline btn-peq');
    botonPista.type = 'button';
    botonEnviar = crear('button', 'Enviar', 'btn btn-primary btn-peq');
    botonEnviar.type = 'button';
    fila.appendChild(botonPista);
    fila.appendChild(botonEnviar);

    const nota = crear('p', 'Las respuestas con IA las genera Gemini (Google) y pueden contener errores. Se envía solo la pregunta del reto y tu consulta, nunca datos personales. No sustituye al docente.', 'asis-nota');

    formulario.appendChild(etiqueta);
    formulario.appendChild(campo);
    formulario.appendChild(fila);
    formulario.appendChild(nota);

    panel.appendChild(cabecera);
    panel.appendChild(mensajes);
    panel.appendChild(formulario);

    botonAbrir.addEventListener('click', function () { alternarPanel(panel.hidden); });
    cerrar.addEventListener('click', function () { alternarPanel(false); });
    panel.addEventListener('keydown', function (e) { if (e.key === 'Escape') alternarPanel(false); });
    botonPista.addEventListener('click', function () { consultar(''); });
    botonEnviar.addEventListener('click', function () { consultar(campo.value); });
    campo.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); consultar(campo.value); }
    });

    document.body.appendChild(botonAbrir);
    document.body.appendChild(panel);

    agregarMensaje('¡Hola! Soy Robo-Plano. No te daré la respuesta directa, pero sí pistas para que la encuentres tú. Pregunta lo que quieras o pulsa "Pedir pista".', 'robot');
  }

  async function arrancar() {
    if (typeof Auth === 'undefined') return;
    const sesion = await Auth.listo();
    if (!sesion) return;
    construir();
  }

  document.addEventListener('DOMContentLoaded', arrancar);
})();