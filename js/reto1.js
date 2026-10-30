'use strict';

/* Nivel 1: Detectives del plano.
   Lee data/vivienda.json (datos de la casa) y data/reto1.json (preguntas),
   crea zonas de clic sobre planta.svg y guarda el progreso con ProgresoMision. */
(function () {
  const ID_RETO = 'reto1';
  const MAX_POR_PREGUNTA = 10;
  const ESCALA = 80;          // planta.svg: 1 m = 80 px
  const DESPLAZAMIENTO = 60;  // el origen de la casa está en (60, 60) px
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const $ = function (id) { return document.getElementById(id); };
  const pantallas = [$('pantalla-inicio'), $('pantalla-juego'), $('pantalla-final')];
  const lienzo = $('lienzo-plano');
  const enunciado = $('enunciado');
  const areaOpciones = $('area-opciones');
  const cajaOpciones = $('opciones');
  const btnPista = $('btn-pista');
  const btnSiguiente = $('btn-siguiente');
  const retro = $('retro');

  let vivienda = null;
  let preguntas = [];
  let grupoZonas = null;
  const zonas = new Map();      // id -> <rect> de clic
  const nombres = new Map();    // id -> nombre legible del elemento
  const estado = { indice: 0, puntos: [], errores: 0, pista: false, resuelta: false };

  /* ---------- Utilidades ---------- */
  const fmtN = function (n) { return n.toFixed(2).replace('.', ','); };
  const fmtM = function (n) { return fmtN(n) + ' m'; };

  function crear(etiqueta, texto, clase) {
    const nodo = document.createElement(etiqueta);
    if (texto !== undefined) nodo.textContent = texto;
    if (clase) nodo.className = clase;
    return nodo;
  }

  function barajar(lista) {
    const copia = lista.slice();
    for (let i = copia.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temporal = copia[i]; copia[i] = copia[j]; copia[j] = temporal;
    }
    return copia;
  }

  async function pedir(url, tipo) {
    const respuesta = await fetch(url);
    if (!respuesta.ok) throw new Error(url + ': HTTP ' + respuesta.status);
    return tipo === 'json' ? respuesta.json() : respuesta.text();
  }

  function mostrarPantalla(destino) {
    pantallas.forEach(function (p) { p.hidden = p !== destino; });
    const titulo = destino.querySelector('h2');
    if (titulo) titulo.focus();
  }

  function actualizarChip() {
    $('puntos-valor').textContent = String(ProgresoMision.leer().puntos);
  }

  /* ---------- Respuestas calculadas desde vivienda.json ---------- */
  const CALCULOS = {
    contarPuertas: function (v) {
      const n = v.aberturas.filter(function (a) { return a.tipo === 'puerta'; }).length;
      const distractores = [n - 2, n - 1, n + 1, n + 2, n + 3]
        .filter(function (x) { return x >= 1 && x !== n; }).slice(0, 3);
      return { correcta: String(n), distractores: distractores };
    },
    anchoTotal: function (v) {
      const e = v.exterior;
      return {
        correcta: fmtM(e.ancho),
        distractores: [fmtM(e.ancho - 2 * e.muroExterior), fmtM(e.fondo), fmtM(e.ancho + 2 * e.muroExterior)]
      };
    }
  };

  /* ---------- Zonas de clic sobre la planta ---------- */
  function geometriaMuro(muro, ext) {
    switch (muro) {
      case 'sur': return { orientacion: 'h', centro: ext.fondo - ext.muroExterior / 2 };
      case 'norte': return { orientacion: 'h', centro: ext.muroExterior / 2 };
      case 'este': return { orientacion: 'v', centro: ext.ancho - ext.muroExterior / 2 };
      case 'oeste': return { orientacion: 'v', centro: ext.muroExterior / 2 };
    }
    const m = /^interior ([xy])=(\d+(?:\.\d+)?)$/.exec(muro);
    if (!m) return null;
    return { orientacion: m[1] === 'x' ? 'v' : 'h', centro: Number(m[2]) };
  }

  function textoMuro(muro) {
    if (muro.indexOf('interior x=') === 0) return 'interior vertical';
    if (muro.indexOf('interior y=') === 0) return 'interior horizontal';
    return muro;
  }

  function crearZona(x, y, ancho, alto, id, etiqueta) {
    const r = document.createElementNS(SVG_NS, 'rect');
    const px = function (m) { return String(Number((DESPLAZAMIENTO + m * ESCALA).toFixed(2))); };
    const largo = function (m) { return String(Number((m * ESCALA).toFixed(2))); };
    r.setAttribute('x', px(x));
    r.setAttribute('y', px(y));
    r.setAttribute('width', largo(ancho));
    r.setAttribute('height', largo(alto));
    r.setAttribute('class', 'zona');
    r.setAttribute('tabindex', '0');
    r.setAttribute('role', 'button');
    r.setAttribute('aria-label', etiqueta);
    r.addEventListener('click', function () { elegirZona(id); });
    r.addEventListener('keydown', function (evento) {
      if (evento.key === 'Enter' || evento.key === ' ') {
        evento.preventDefault();
        elegirZona(id);
      }
    });
    zonas.set(id, r);
    return r;
  }

  function construirZonas(svg) {
    grupoZonas = document.createElementNS(SVG_NS, 'g');
    grupoZonas.setAttribute('display', 'none');

    // Las etiquetas describen la posición, no el nombre, para no revelar respuestas.
    const espacios = vivienda.espacios.slice().sort(function (a, b) { return a.y1 - b.y1 || a.x1 - b.x1; });
    espacios.forEach(function (e, i) {
      nombres.set(e.id, e.nombre);
      grupoZonas.appendChild(crearZona(e.x1, e.y1, e.x2 - e.x1, e.y2 - e.y1, e.id,
        'Espacio ' + (i + 1) + ' de ' + espacios.length + ' (de arriba hacia abajo y de izquierda a derecha)'));
    });

    // Las aberturas se añaden después para quedar encima de los espacios.
    vivienda.aberturas.forEach(function (a) {
      const g = geometriaMuro(a.muro, vivienda.exterior);
      if (!g) throw new Error('Muro no reconocido: ' + a.muro);
      const margen = 0.25;
      nombres.set(a.id, a.nombre);
      const etiqueta = 'Hueco en el muro ' + textoMuro(a.muro) + ' entre ' + fmtN(a.desde) + ' y ' + fmtN(a.hasta) + ' metros';
      const zona = g.orientacion === 'h'
        ? crearZona(a.desde, g.centro - margen, a.hasta - a.desde, 2 * margen, a.id, etiqueta)
        : crearZona(g.centro - margen, a.desde, 2 * margen, a.hasta - a.desde, a.id, etiqueta);
      grupoZonas.appendChild(zona);
    });

    svg.appendChild(grupoZonas);
  }

  /* ---------- Preguntas ---------- */
  function prepararPreguntas(reto) {
    return reto.preguntas.map(function (p) {
      const q = { id: p.id, tipo: p.tipo, enunciado: p.enunciado, pista: p.pista, concepto: p.concepto };
      let respuesta = '';
      if (p.tipo === 'clic') {
        const validos = Array.isArray(p.objetivos) && p.objetivos.length > 0 &&
          p.objetivos.every(function (id) { return zonas.has(id); });
        if (!validos) throw new Error('Pregunta ' + p.id + ': objetivos no válidos');
        q.objetivos = p.objetivos.slice();
      } else if (p.tipo === 'opciones') {
        let base;
        if (p.calculo) {
          if (!CALCULOS[p.calculo]) throw new Error('Pregunta ' + p.id + ': cálculo desconocido');
          base = CALCULOS[p.calculo](vivienda);
        } else {
          base = { correcta: p.correcta, distractores: p.distractores };
        }
        q.correcta = String(base.correcta);
        q.opciones = [q.correcta].concat(base.distractores.map(String));
        respuesta = q.correcta;
      } else {
        throw new Error('Pregunta ' + p.id + ': tipo desconocido');
      }
      q.explicacion = String(p.explicacion).replace('{respuesta}', respuesta);
      return q;
    });
  }

  function limpiarMarcas() {
    zonas.forEach(function (z) { z.classList.remove('acierto', 'error', 'revelada'); });
    cajaOpciones.replaceChildren();
  }

  function sumaPuntos() {
    return estado.puntos.reduce(function (a, n) { return a + n; }, 0);
  }

  function actualizarHud() {
    const total = preguntas.length;
    const porcentaje = Math.round(estado.puntos.length / total * 100);
    $('hud-pregunta').textContent = 'Pregunta ' + (estado.indice + 1) + ' de ' + total;
    const barra = $('hud-barra');
    barra.setAttribute('aria-valuenow', String(porcentaje));
    barra.firstElementChild.style.width = porcentaje + '%';
    $('hud-porcentaje').textContent = porcentaje + '%';
    $('hud-puntos').textContent = 'Puntos de este intento: ' + sumaPuntos() + ' de ' + (total * MAX_POR_PREGUNTA);
  }

  function mostrarPregunta() {
    const q = preguntas[estado.indice];
    estado.errores = 0;
    estado.pista = false;
    estado.resuelta = false;
    limpiarMarcas();
    retro.textContent = '';
    btnSiguiente.hidden = true;
    btnPista.disabled = false;
    enunciado.textContent = q.enunciado;
    actualizarHud();

    if (q.tipo === 'clic') {
      areaOpciones.hidden = true;
      grupoZonas.setAttribute('display', 'inline');
    } else {
      grupoZonas.setAttribute('display', 'none');
      areaOpciones.hidden = false;
      barajar(q.opciones).forEach(function (texto) {
        const boton = crear('button', texto, 'opcion');
        boton.type = 'button';
        boton.addEventListener('click', function () { elegirOpcion(boton, q); });
        cajaOpciones.appendChild(boton);
      });
    }
    enunciado.focus();
  }

  /* ---------- Evaluación ---------- */
  function acertar(q) {
    estado.resuelta = true;
    const ayudas = estado.errores + (estado.pista ? 1 : 0);
    const puntos = ayudas === 0 ? 10 : ayudas === 1 ? 6 : 3;
    estado.puntos[estado.indice] = puntos;
    ProgresoMision.guardarSesion(ID_RETO, estado.puntos, preguntas.length);

    retro.textContent = '¡Correcto! +' + puntos + ' puntos. ' + q.explicacion;
    btnPista.disabled = true;
    btnSiguiente.textContent = estado.indice === preguntas.length - 1 ? 'Ver resultado' : 'Siguiente';
    btnSiguiente.hidden = false;
    actualizarHud();
    btnSiguiente.focus();
  }

  function fallar(q, mensaje) {
    estado.errores += 1;
    let texto = mensaje + ' Vuelve a mirar el símbolo y su ubicación, o pide una pista.';
    if (estado.errores >= 2) {
      texto = mensaje + ' Te resaltamos la respuesta en amarillo: elígela para continuar.';
      if (q.tipo === 'clic') {
        zonas.get(q.objetivos[0]).classList.add('revelada');
      } else {
        Array.prototype.forEach.call(cajaOpciones.children, function (b) {
          if (b.textContent.indexOf(q.correcta) === 0 && !b.disabled) b.classList.add('revelada');
        });
      }
    }
    retro.textContent = texto;
  }

  function elegirZona(id) {
    const q = preguntas[estado.indice];
    if (!q || q.tipo !== 'clic' || estado.resuelta) return;
    const zona = zonas.get(id);
    if (q.objetivos.indexOf(id) !== -1) {
      zona.classList.remove('revelada');
      zona.classList.add('acierto');
      acertar(q);
    } else {
      zona.classList.add('error');
      fallar(q, 'Elegiste: ' + nombres.get(id) + '. No es lo que se pide.');
    }
  }

  function elegirOpcion(boton, q) {
    if (estado.resuelta || boton.disabled) return;
    const texto = boton.firstChild.textContent;
    if (texto === q.correcta) {
      boton.classList.remove('revelada');
      boton.classList.add('acierto');
      boton.appendChild(crear('span', ' — correcta', 'marca'));
      Array.prototype.forEach.call(cajaOpciones.children, function (b) { b.disabled = true; });
      acertar(q);
    } else {
      boton.classList.add('error');
      boton.disabled = true;
      boton.appendChild(crear('span', ' — no es esa', 'marca'));
      fallar(q, 'Esa opción no es la correcta.');
    }
  }

  /* ---------- Pantalla final ---------- */
  function mostrarFinal(mejorAnterior) {
    const total = preguntas.length;
    const maximo = total * MAX_POR_PREGUNTA;
    const suma = sumaPuntos();
    const porcentaje = Math.round(suma / maximo * 100);
    const contenedor = $('final-contenido');
    contenedor.replaceChildren();

    contenedor.appendChild(crear('p', 'Obtuviste ' + suma + ' de ' + maximo + ' puntos (' + porcentaje + ' %).', 'final-puntaje'));
    const mensaje = porcentaje >= 90
      ? 'Excelente: lees los planos con mucha seguridad.'
      : porcentaje >= 60
        ? 'Buen trabajo: ya reconoces la mayoría de los elementos. Repasa los temas marcados abajo.'
        : 'Vas por buen camino. Repasa los temas marcados y vuelve a intentarlo: puedes mejorar tu puntaje.';
    contenedor.appendChild(crear('p', mensaje));
    contenedor.appendChild(crear('p',
      'Tu mejor puntaje: ' + Math.max(mejorAnterior, suma) + ' de ' + maximo + '.', 'muted'));

    const envoltura = crear('div', undefined, 'tabla-wrap');
    const tabla = document.createElement('table');
    tabla.appendChild(crear('caption', 'Resultado por pregunta'));
    const cabecera = document.createElement('tr');
    ['Pregunta', 'Tema', 'Puntos'].forEach(function (t) {
      const th = crear('th', t); th.scope = 'col'; cabecera.appendChild(th);
    });
    const thead = document.createElement('thead'); thead.appendChild(cabecera); tabla.appendChild(thead);
    const cuerpo = document.createElement('tbody');
    preguntas.forEach(function (q, i) {
      const fila = document.createElement('tr');
      const th = crear('th', String(i + 1)); th.scope = 'row';
      fila.appendChild(th);
      fila.appendChild(crear('td', q.concepto));
      fila.appendChild(crear('td', estado.puntos[i] + ' de ' + MAX_POR_PREGUNTA));
      cuerpo.appendChild(fila);
    });
    tabla.appendChild(cuerpo);
    envoltura.appendChild(tabla);
    contenedor.appendChild(envoltura);

    contenedor.appendChild(crear('h3', 'Qué repasar', 'sub-final'));
    const pendientes = [];
    preguntas.forEach(function (q, i) {
      if (estado.puntos[i] < MAX_POR_PREGUNTA && pendientes.indexOf(q.concepto) === -1) pendientes.push(q.concepto);
    });
    if (pendientes.length === 0) {
      contenedor.appendChild(crear('p', 'No quedan temas pendientes: acertaste todo sin ayuda.'));
    } else {
      const lista = document.createElement('ul');
      pendientes.forEach(function (t) { lista.appendChild(crear('li', t)); });
      contenedor.appendChild(lista);
      const enlace = crear('a', 'Repasar en la sección Aprender');
      enlace.href = 'aprender.html';
      const p = document.createElement('p'); p.appendChild(enlace);
      contenedor.appendChild(p);
    }

    contenedor.appendChild(crear('p', 'Has desbloqueado el Nivel 2, que todavía está en desarrollo.', 'notice'));

    const acciones = crear('div', undefined, 'actions');
    const repetir = crear('button', 'Repetir el reto', 'btn btn-outline');
    repetir.type = 'button';
    repetir.addEventListener('click', function () { iniciar(false); });
    const volver = crear('a', 'Volver a la misión', 'btn btn-primary');
    volver.href = 'mision.html';
    acciones.appendChild(repetir);
    acciones.appendChild(volver);
    contenedor.appendChild(acciones);

    mostrarPantalla(pantallas[2]);
  }

  function finalizar() {
    const mejorAnterior = ProgresoMision.leer().retos[ID_RETO].mejorPuntaje;
    ProgresoMision.completarReto(ID_RETO, estado.puntos);
    actualizarChip();
    mostrarFinal(mejorAnterior);
  }

  /* ---------- Flujo ---------- */
  function iniciar(continuar) {
    if (!continuar) ProgresoMision.descartarSesion(ID_RETO);
    const sesion = continuar ? ProgresoMision.leer().retos[ID_RETO].sesion : null;
    estado.puntos = sesion ? sesion.puntos.slice(0, preguntas.length) : [];
    estado.indice = estado.puntos.length;
    if (estado.indice >= preguntas.length) { estado.puntos = []; estado.indice = 0; }
    mostrarPantalla(pantallas[1]);
    mostrarPregunta();
  }

  function prepararInicio() {
    const datos = ProgresoMision.leer().retos[ID_RETO];
    const aviso = $('aviso-inicio');
    const btnEmpezar = $('btn-empezar');
    const btnContinuar = $('btn-continuar');
    const partes = [];
    if (datos.sesion) {
      partes.push('Tienes un intento en curso: ' + datos.sesion.puntos.length + ' de ' + preguntas.length + ' preguntas respondidas.');
      btnContinuar.hidden = false;
      btnEmpezar.textContent = 'Empezar de nuevo';
      btnEmpezar.className = 'btn btn-outline';
    }
    if (datos.mejorPuntaje > 0) {
      partes.push('Tu mejor puntaje: ' + datos.mejorPuntaje + ' de ' + (preguntas.length * MAX_POR_PREGUNTA) + '.');
    }
    aviso.textContent = partes.join(' ');
    btnEmpezar.addEventListener('click', function () { iniciar(false); });
    btnContinuar.addEventListener('click', function () { iniciar(true); });
  }

  async function arrancar() {if (!(await Auth.listo())) return;
    actualizarChip();
    try {
      const resultados = await Promise.all([
        pedir('data/vivienda.json', 'json'),
        pedir('data/reto1.json', 'json'),
        pedir('assets/planos/planta.svg', 'texto')
      ]);
      vivienda = resultados[0];

      const doc = new DOMParser().parseFromString(resultados[2], 'image/svg+xml');
      if (doc.querySelector('parsererror')) throw new Error('planta.svg no es válido');
      const svg = document.importNode(doc.documentElement, true);
      svg.classList.add('plano');
      lienzo.replaceChildren(svg);

      construirZonas(svg);
      preguntas = prepararPreguntas(resultados[1]);
      prepararInicio();
      btnPista.addEventListener('click', function () {
        if (estado.resuelta) return;
        estado.pista = true;
        retro.textContent = 'Pista: ' + preguntas[estado.indice].pista;
      });
      btnSiguiente.addEventListener('click', function () {
        estado.indice += 1;
        if (estado.indice >= preguntas.length) finalizar(); else mostrarPregunta();
      });
    } catch (error) {
      console.error(error);
      $('error-carga').hidden = false;
      pantallas[0].hidden = true;
    }
  }

  arrancar();
})();