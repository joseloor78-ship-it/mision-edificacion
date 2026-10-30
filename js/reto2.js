'use strict';

/* Nivel 2: Conecta las vistas.
   Muestra la planta, la elevación sur y el corte A-A y pide relacionarlas.
   Datos: data/vivienda.json (casa) y data/reto2.json (preguntas).
   Progreso: ProgresoMision. Los SVG originales no se modifican: las
   discrepancias se crean en memoria sobre una copia. */
(function () {
  const ID_RETO = 'reto2';
  const MAX_POR_PREGUNTA = 10;
  const ESCALA = 80;          // en los tres SVG: 1 m = 80 px
  const DESPLAZAMIENTO = 60;  // origen en px (horizontal, y vertical en la planta)
  const SUELO_Y = 300;        // línea de piso en la elevación y en el corte (px)
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const SELECTOR_COTAS = 'g[font-size="12"]'; // grupo de cotas en elevación y corte

  const VISTAS = {
    planta: { archivo: 'assets/planos/planta.svg', titulo: 'Planta' },
    elevacion: { archivo: 'assets/planos/elevacion-sur.svg', titulo: 'Elevación sur' },
    corte: { archivo: 'assets/planos/corte-aa.svg', titulo: 'Corte A-A' }
  };

  const $ = function (id) { return document.getElementById(id); };
  const pantallas = [$('pantalla-inicio'), $('pantalla-juego'), $('pantalla-final')];
  const contenedorVistas = $('vistas');
  const enunciado = $('enunciado');
  const areaOpciones = $('area-opciones');
  const cajaOpciones = $('opciones');
  const btnPista = $('btn-pista');
  const btnSiguiente = $('btn-siguiente');
  const retro = $('retro');

  let vivienda = null;
  let preguntas = [];
  const base = new Map();         // vista -> SVG original ya analizado
  const nombres = new Map();      // id -> nombre legible
  const zonasActivas = new Map(); // id -> <rect> clicable de la pregunta actual
  const estado = { indice: 0, puntos: [], errores: 0, pista: false, resuelta: false };

  /* ---------- Utilidades ---------- */
  const fmtN = function (n) { return n.toFixed(2).replace('.', ','); };
  const fmtM = function (n) { return fmtN(n) + ' m'; };
  const X = function (m) { return DESPLAZAMIENTO + m * ESCALA; };
  const Z = function (m) { return SUELO_Y - m * ESCALA; };

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

  function rectSvg(x, y, ancho, alto, clase) {
    const r = document.createElementNS(SVG_NS, 'rect');
    [['x', x], ['y', y], ['width', ancho], ['height', alto]].forEach(function (par) {
      r.setAttribute(par[0], String(Number(par[1].toFixed(2))));
    });
    r.setAttribute('class', clase);
    return r;
  }

  /* ---------- Geometría a partir de vivienda.json ---------- */
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

  // Caja (en metros) de un espacio o de una abertura sobre la planta.
  function cajaEnPlanta(id) {
    const esp = vivienda.espacios.find(function (e) { return e.id === id; });
    if (esp) return { x: esp.x1, y: esp.y1, w: esp.x2 - esp.x1, h: esp.y2 - esp.y1 };
    const a = vivienda.aberturas.find(function (o) { return o.id === id; });
    if (!a) return null;
    const g = geometriaMuro(a.muro, vivienda.exterior);
    if (!g) return null;
    const margen = 0.25;
    return g.orientacion === 'h'
      ? { x: a.desde, y: g.centro - margen, w: a.hasta - a.desde, h: 2 * margen }
      : { x: g.centro - margen, y: a.desde, w: 2 * margen, h: a.hasta - a.desde };
  }

  // Zonas clicables (en px) de la elevación sur.
  function zonasElevacion() {
    return vivienda.aberturas
      .filter(function (a) { return a.muro === 'sur'; })
      .map(function (a) {
        return { id: a.id, x: X(a.desde), y: Z(a.antepecho + a.alto), w: (a.hasta - a.desde) * ESCALA, h: a.alto * ESCALA, orden: 0 };
      });
  }

  // Zonas clicables (en px) del corte A-A: lo cortado y lo visto al fondo.
  function zonasCorte() {
    const ext = vivienda.exterior;
    const corte = vivienda.cortes[0].y;
    const zonas = [];
    vivienda.aberturas.forEach(function (a) {
      const y = Z(a.antepecho + a.alto);
      const h = a.alto * ESCALA;
      const cruza = corte >= a.desde && corte <= a.hasta;
      const interior = /^interior ([xy])=(\d+(?:\.\d+)?)$/.exec(a.muro);
      if (a.muro === 'este' && cruza) {
        zonas.push({ id: a.id, x: X(ext.ancho - ext.muroExterior) - 12, y: y, w: ext.muroExterior * ESCALA + 24, h: h, orden: 1 });
      } else if (interior && interior[1] === 'x' && cruza) {
        zonas.push({ id: a.id, x: X(Number(interior[2]) - ext.muroInterior / 2) - 16, y: y, w: ext.muroInterior * ESCALA + 32, h: h, orden: 1 });
      } else if (interior && interior[1] === 'y' && Number(interior[2]) < corte) {
        zonas.push({ id: a.id, x: X(a.desde), y: y, w: (a.hasta - a.desde) * ESCALA, h: h, orden: 0 }); // vano visto al fondo
      } else if (a.muro === 'norte') {
        zonas.push({ id: a.id, x: X(a.desde), y: y, w: (a.hasta - a.desde) * ESCALA, h: h, orden: 2 }); // ventana vista al fondo
      }
    });
    return zonas.sort(function (a, b) { return a.orden - b.orden; });
  }

  function zonasDe(vista) {
    if (vista === 'elevacion') return zonasElevacion();
    if (vista === 'corte') return zonasCorte();
    return [];
  }

  /* ---------- Respuestas calculadas desde vivienda.json ---------- */
  const CALCULOS = {
    inicioVentana: function (v, id) {
      const a = v.aberturas.find(function (o) { return o.id === id; });
      if (!a) throw new Error('Abertura no encontrada: ' + id);
      return {
        correcta: fmtM(a.antepecho),
        distractores: [fmtM(a.alto), fmtM(a.antepecho + a.alto), fmtM(0)]
      };
    }
  };

  /* ---------- Preparación de preguntas ---------- */
  function prepararPreguntas(reto) {
    return reto.preguntas.map(function (p) {
      if (!Array.isArray(p.vistas) || p.vistas.length === 0) throw new Error('Pregunta ' + p.id + ': faltan vistas');
      const q = { id: p.id, tipo: p.tipo, enunciado: p.enunciado, pista: p.pista, concepto: p.concepto };

      q.vistas = p.vistas.map(function (c) {
        if (!VISTAS[c.vista]) throw new Error('Pregunta ' + p.id + ': vista desconocida');
        const resaltar = Array.isArray(c.resaltar) ? c.resaltar : [];
        resaltar.forEach(function (id) {
          if (!cajaEnPlanta(id)) throw new Error('Pregunta ' + p.id + ': elemento a resaltar no válido: ' + id);
        });
        const mover = Array.isArray(c.mover) ? c.mover : [];
        mover.forEach(function (m) {
          if (!Number.isFinite(Number(m.dx))) throw new Error('Pregunta ' + p.id + ': desplazamiento no válido');
        });
        return {
          vista: c.vista, resaltar: resaltar, mover: mover,
          quitarCotas: c.quitarCotas === true,
          objetivos: Array.isArray(c.objetivos) ? c.objetivos.slice() : null
        };
      });

      let respuesta = '';
      if (p.tipo === 'clic') {
        const interactivas = q.vistas.filter(function (c) { return c.objetivos; });
        if (interactivas.length !== 1) throw new Error('Pregunta ' + p.id + ': debe haber una vista con objetivos');
        const ids = zonasDe(interactivas[0].vista).map(function (z) { return z.id; });
        if (!interactivas[0].objetivos.every(function (id) { return ids.indexOf(id) !== -1; })) {
          throw new Error('Pregunta ' + p.id + ': objetivos no válidos');
        }
        q.objetivos = interactivas[0].objetivos;
      } else if (p.tipo === 'opciones') {
        let datos;
        if (p.calculo) {
          if (!CALCULOS[p.calculo]) throw new Error('Pregunta ' + p.id + ': cálculo desconocido');
          datos = CALCULOS[p.calculo](vivienda, p.parametro);
        } else {
          datos = { correcta: p.correcta, distractores: p.distractores };
        }
        q.correcta = String(datos.correcta);
        q.opciones = [q.correcta].concat(datos.distractores.map(String));
        respuesta = q.correcta;
      } else {
        throw new Error('Pregunta ' + p.id + ': tipo desconocido');
      }
      q.explicacion = String(p.explicacion).replace('{respuesta}', respuesta);
      return q;
    });
  }

  /* ---------- Dibujo de las vistas ---------- */
  function elementosDe(svg, vista, id) {
    const lista = [];
    const grupo = svg.querySelector('[id="' + vista + '-' + id + '"]');
    if (grupo) lista.push(grupo);
    svg.querySelectorAll('text').forEach(function (t) {
      if (t.textContent.trim() === id) lista.push(t);
    });
    return lista;
  }

  function instanciar(config) {
    const svg = base.get(config.vista).cloneNode(true);
    const titulo = svg.querySelector('title');
    if (titulo) svg.setAttribute('aria-label', titulo.textContent.trim());
    svg.removeAttribute('aria-labelledby');
    // Ids únicos por vista, para que no se repitan al mostrar dos planos a la vez.
    svg.querySelectorAll('[id]').forEach(function (nodo) { nodo.id = config.vista + '-' + nodo.id; });

    if (config.quitarCotas) {
      const cotas = svg.querySelector(SELECTOR_COTAS);
      if (cotas) cotas.remove();
    }
    config.mover.forEach(function (m) {
      const dx = Number(m.dx) * ESCALA;
      elementosDe(svg, config.vista, m.id).forEach(function (nodo) {
        nodo.setAttribute('transform', 'translate(' + dx + ' 0)');
      });
    });

    if (config.resaltar.length > 0) {
      const grupo = document.createElementNS(SVG_NS, 'g');
      config.resaltar.forEach(function (id) {
        const caja = cajaEnPlanta(id);
        grupo.appendChild(rectSvg(X(caja.x), X(caja.y), caja.w * ESCALA, caja.h * ESCALA, 'destacado'));
      });
      svg.appendChild(grupo);
    }

    if (config.objetivos) {
      const grupo = document.createElementNS(SVG_NS, 'g');
      zonasDe(config.vista).forEach(function (z) {
        const r = rectSvg(z.x, z.y, z.w, z.h, 'zona');
        r.setAttribute('tabindex', '0');
        r.setAttribute('role', 'button');
        // Etiqueta por posición, sin revelar de qué elemento se trata.
        r.setAttribute('aria-label', 'Hueco con centro a ' + fmtN((z.x + z.w / 2 - DESPLAZAMIENTO) / ESCALA) +
          ' m del borde oeste y a ' + fmtN((SUELO_Y - (z.y + z.h / 2)) / ESCALA) + ' m de altura');
        r.addEventListener('click', function () { elegirZona(z.id); });
        r.addEventListener('keydown', function (evento) {
          if (evento.key === 'Enter' || evento.key === ' ') {
            evento.preventDefault();
            elegirZona(z.id);
          }
        });
        zonasActivas.set(z.id, r);
        grupo.appendChild(r);
      });
      svg.appendChild(grupo);
    }
    return svg;
  }

  function dibujarVistas(q) {
    contenedorVistas.replaceChildren();
    q.vistas.forEach(function (config) {
      const figura = crear('figure', undefined, 'vista-panel');
      let pie = VISTAS[config.vista].titulo;
      if (config.resaltar.length > 0) pie += ' · elemento resaltado en amarillo con borde grueso';
      if (config.objetivos) pie += ' · haz clic aquí';
      figura.appendChild(crear('figcaption', pie));
      const lienzo = crear('div', undefined, 'lienzo');
      const svg = instanciar(config);
      svg.classList.add('plano');
      lienzo.appendChild(svg);
      figura.appendChild(lienzo);
      contenedorVistas.appendChild(figura);
    });
  }

  /* ---------- Avance y preguntas ---------- */
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
    zonasActivas.clear();
    cajaOpciones.replaceChildren();
    retro.textContent = '';
    btnSiguiente.hidden = true;
    btnPista.disabled = false;
    enunciado.textContent = q.enunciado;
    actualizarHud();
    dibujarVistas(q);

    if (q.tipo === 'opciones') {
      areaOpciones.hidden = false;
      barajar(q.opciones).forEach(function (texto) {
        const boton = crear('button', texto, 'opcion');
        boton.type = 'button';
        boton.addEventListener('click', function () { elegirOpcion(boton, q); });
        cajaOpciones.appendChild(boton);
      });
    } else {
      areaOpciones.hidden = true;
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
    let texto = mensaje + ' Vuelve a mirar las vistas, o pide una pista.';
    if (estado.errores >= 2) {
      texto = mensaje + ' Te resaltamos la respuesta en amarillo: elígela para continuar.';
      if (q.tipo === 'clic') {
        zonasActivas.get(q.objetivos[0]).classList.add('revelada');
      } else {
        Array.prototype.forEach.call(cajaOpciones.children, function (b) {
          if (!b.disabled && b.firstChild.textContent === q.correcta) b.classList.add('revelada');
        });
      }
    }
    retro.textContent = texto;
  }

  function elegirZona(id) {
    const q = preguntas[estado.indice];
    if (!q || q.tipo !== 'clic' || estado.resuelta) return;
    const zona = zonasActivas.get(id);
    if (!zona) return;
    if (q.objetivos.indexOf(id) !== -1) {
      zona.classList.remove('revelada');
      zona.classList.add('acierto');
      acertar(q);
    } else {
      zona.classList.add('error');
      fallar(q, 'Elegiste: ' + (nombres.get(id) || 'otro elemento') + '. No es el que se pide.');
    }
  }

  function elegirOpcion(boton, q) {
    if (estado.resuelta || boton.disabled) return;
    if (boton.firstChild.textContent === q.correcta) {
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
      ? 'Excelente: relacionas muy bien las distintas vistas de una edificación.'
      : porcentaje >= 60
        ? 'Buen trabajo: ya conectas la mayoría de las vistas. Repasa los temas marcados abajo.'
        : 'Vas por buen camino. Repasa los temas marcados y vuelve a intentarlo: puedes mejorar tu puntaje.';
    contenedor.appendChild(crear('p', mensaje));
    contenedor.appendChild(crear('p', 'Tu mejor puntaje: ' + Math.max(mejorAnterior, suma) + ' de ' + maximo + '.', 'muted'));

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

    contenedor.appendChild(crear('p', 'Has desbloqueado el Nivel 3, que todavía está en desarrollo.', 'notice'));

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
    $('aviso-inicio').textContent = partes.join(' ');
    btnEmpezar.addEventListener('click', function () { iniciar(false); });
    btnContinuar.addEventListener('click', function () { iniciar(true); });
  }

  async function arrancar() {if (!(await Auth.listo())) return;
    actualizarChip();
    if (!ProgresoMision.desbloqueado(ProgresoMision.leer(), ID_RETO)) {
      pantallas[0].hidden = true;
      $('aviso-bloqueado').hidden = false;
      return;
    }
    try {
      const claves = Object.keys(VISTAS);
      const resultados = await Promise.all([
        pedir('data/vivienda.json', 'json'),
        pedir('data/reto2.json', 'json')
      ].concat(claves.map(function (k) { return pedir(VISTAS[k].archivo, 'texto'); })));

      vivienda = resultados[0];
      claves.forEach(function (clave, i) {
        const doc = new DOMParser().parseFromString(resultados[2 + i], 'image/svg+xml');
        if (doc.querySelector('parsererror')) throw new Error(VISTAS[clave].archivo + ' no es válido');
        base.set(clave, document.importNode(doc.documentElement, true));
      });

      vivienda.espacios.forEach(function (e) { nombres.set(e.id, e.nombre); });
      vivienda.aberturas.forEach(function (a) { nombres.set(a.id, a.nombre); });

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