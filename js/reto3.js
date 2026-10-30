import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* Nivel 3: Del plano al 3D.
   El modelo se genera en el navegador a partir de data/vivienda.json (muros y aberturas).
   Los errores del reto son cambios en memoria: ningún archivo de datos se modifica.
   Preguntas: data/reto3.json. Progreso: ProgresoMision (js/progreso.js). */

const ID_RETO = 'reto3';
const MAX_POR_PREGUNTA = 10;
const EMISIVOS = { normal: 0x000000, hover: 0x0b5ea8, acierto: 0x15803d, error: 0xb91c1c, revelada: 0xf59e0b };
const CAMPOS_MODIFICABLES = ['muro', 'alto', 'antepecho', 'desde', 'hasta'];
const REFERENCIAS = [
  { id: 'planta', titulo: 'Planta', archivo: 'assets/planos/planta.svg' },
  { id: 'elevacion', titulo: 'Elevación sur', archivo: 'assets/planos/elevacion-sur.svg' },
  { id: 'corte', titulo: 'Corte A-A', archivo: 'assets/planos/corte-aa.svg' }
];

const $ = function (id) { return document.getElementById(id); };
const pantallas = [$('pantalla-inicio'), $('pantalla-juego'), $('pantalla-final')];
const enunciado = $('enunciado');
const areaOpciones = $('area-opciones');
const cajaOpciones = $('opciones');
const btnPista = $('btn-pista');
const btnSiguiente = $('btn-siguiente');
const btnTecho = $('btn-techo');
const retro = $('retro');
const listaHuecos = $('lista-huecos');
const botonesHuecos = $('botones-huecos');

let vivienda = null;
let preguntas = [];
const nombres = new Map();       // id -> nombre legible
const planosRef = new Map();     // id -> SVG de referencia analizado
const estado = { indice: 0, puntos: [], errores: 0, pista: false, resuelta: false };

/* ---------- Utilidades ---------- */
const fmtN = function (n) { return n.toFixed(2).replace('.', ','); };

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

function textoMuro(muro) {
  if (muro.indexOf('interior x=') === 0) return 'interior vertical';
  if (muro.indexOf('interior y=') === 0) return 'interior horizontal';
  return muro;
}

/* ---------- Visor 3D ---------- */
let renderer, escena, camara, controles, canvas;
let modelo = null;
let renderPendiente = false;

function pedirRender() {
  if (renderPendiente || !renderer) return;
  renderPendiente = true;
  requestAnimationFrame(function () {
    renderPendiente = false;
    renderer.render(escena, camara);
  });
}

function ajustarTamano() {
  const contenedor = $('visor-3d');
  const ancho = contenedor.clientWidth;
  const alto = contenedor.clientHeight;
  if (!ancho || !alto) return;
  renderer.setSize(ancho, alto, false);
  camara.aspect = ancho / alto;
  camara.updateProjectionMatrix();
  pedirRender();
}

function iniciarVisor() {
  renderer = new THREE.WebGLRenderer({ antialias: true }); // lanza error si no hay WebGL
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  canvas = renderer.domElement;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Modelo 3D de la vivienda. Arrastra para girar; también puedes usar los botones de debajo.');
  $('visor-3d').appendChild(canvas);

  escena = new THREE.Scene();
  escena.background = new THREE.Color(0xeaf1f9);
  camara = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  escena.add(new THREE.HemisphereLight(0xffffff, 0x94a3b8, 1.4));
  const sol = new THREE.DirectionalLight(0xffffff, 1.6);
  sol.position.set(6, 10, 8);
  escena.add(sol);

  controles = new OrbitControls(camara, canvas);
  controles.enablePan = false;
  controles.minDistance = 6;
  controles.maxDistance = 24;
  controles.maxPolarAngle = Math.PI / 2 - 0.02;
  controles.addEventListener('change', pedirRender);

  vistaInicial();
  new ResizeObserver(ajustarTamano).observe($('visor-3d'));
  ajustarTamano();
}

function vistaInicial() {
  controles.target.set(0, 1.2, 0);
  camara.position.set(7, 6.5, 9);
  camara.lookAt(controles.target);
  controles.update();
  pedirRender();
}

function ajustarCamara(cambio) {
  const desplazamiento = camara.position.clone().sub(controles.target);
  const esf = new THREE.Spherical().setFromVector3(desplazamiento);
  if (cambio.dTheta) esf.theta += cambio.dTheta;
  if (cambio.phi !== undefined) esf.phi = cambio.phi;
  if (cambio.factor) esf.radius *= cambio.factor;
  esf.phi = THREE.MathUtils.clamp(esf.phi, 0.05, Math.PI / 2 - 0.02);
  esf.radius = THREE.MathUtils.clamp(esf.radius, 6, 24);
  desplazamiento.setFromSpherical(esf);
  camara.position.copy(controles.target).add(desplazamiento);
  camara.lookAt(controles.target);
  controles.update();
  pedirRender();
}

/* ---------- Construcción del modelo desde vivienda.json ---------- */
function aplicarCambios(lista, cambios) {
  const copia = lista.map(function (a) { return Object.assign({}, a); });
  (cambios || []).forEach(function (c) {
    const i = copia.findIndex(function (a) { return a.id === c.id; });
    if (i === -1) throw new Error('Cambio sobre una abertura inexistente: ' + c.id);
    if (c.quitar === true) {
      copia.splice(i, 1);
    } else if (c.set && typeof c.set === 'object') {
      Object.keys(c.set).forEach(function (campo) {
        if (CAMPOS_MODIFICABLES.indexOf(campo) === -1) throw new Error('Campo no modificable: ' + campo);
        copia[i][campo] = c.set[campo];
      });
    }
  });
  return copia;
}

// Divide un muro en cajas macizas alrededor de sus aberturas.
function tramosDeMuro(m, aberturas, alturaMuro) {
  const cajas = [];
  let cursor = m.desde;
  aberturas.slice().sort(function (p, q) { return p.desde - q.desde; }).forEach(function (a) {
    if (a.desde > cursor) cajas.push({ a0: cursor, a1: a.desde, z0: 0, z1: alturaMuro });
    if (a.antepecho > 0) cajas.push({ a0: a.desde, a1: a.hasta, z0: 0, z1: a.antepecho });
    const cabeza = a.antepecho + a.alto;
    if (cabeza < alturaMuro) cajas.push({ a0: a.desde, a1: a.hasta, z0: cabeza, z1: alturaMuro });
    cursor = Math.max(cursor, a.hasta);
  });
  if (cursor < m.hasta) cajas.push({ a0: cursor, a1: m.hasta, z0: 0, z1: alturaMuro });
  return cajas;
}

function marcar(malla, marca) {
  malla.userData.marca = marca;
  const mat = malla.material;
  mat.emissive.setHex(EMISIVOS[marca]);
  mat.emissiveIntensity = marca === 'normal' ? 0 : 0.7;
  if (malla.userData.esVano) mat.opacity = marca === 'normal' ? 0 : marca === 'hover' ? 0.25 : 0.5;
  pedirRender();
}

function construirModelo(config) {
  const ext = vivienda.exterior;
  const alturaMuro = vivienda.alturas.libreInterior;
  const losa = vivienda.alturas.espesorLosaTecho;
  const aberturas = aplicarCambios(vivienda.aberturas, config.cambios);
  const grupo = new THREE.Group();
  const muros = [];
  const pickables = [];

  const matMuro = new THREE.MeshStandardMaterial({ color: 0xdbe5f0, roughness: 0.9 });
  const matLinea = new THREE.LineBasicMaterial({ color: 0x0b5ea8 });
  const matTecho = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.9 });
  const matPiso = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 1 });

  const conBordes = function (malla) {
    malla.add(new THREE.LineSegments(new THREE.EdgesGeometry(malla.geometry), matLinea));
    return malla;
  };
  // Plano (x este, y sur, z arriba) -> Three.js (X este, Y arriba, Z sur), centrado en la casa.
  const colocar = function (malla, planX, planZ, planY) {
    malla.position.set(planX - ext.ancho / 2, planZ, planY - ext.fondo / 2);
  };

  vivienda.muros.forEach(function (m) {
    const propias = aberturas.filter(function (a) { return a.muro === m.muro; });
    propias.forEach(function (a) {
      if (a.desde < m.desde - 1e-6 || a.hasta > m.hasta + 1e-6) throw new Error('La abertura ' + a.id + ' queda fuera del muro ' + m.muro);
    });

    tramosDeMuro(m, propias, alturaMuro).forEach(function (c) {
      const largo = c.a1 - c.a0;
      const alto = c.z1 - c.z0;
      const geo = m.eje === 'x'
        ? new THREE.BoxGeometry(largo, alto, m.espesor)
        : new THREE.BoxGeometry(m.espesor, alto, largo);
      const malla = conBordes(new THREE.Mesh(geo, matMuro));
      const centro = (c.a0 + c.a1) / 2;
      if (m.eje === 'x') colocar(malla, centro, (c.z0 + c.z1) / 2, m.pos);
      else colocar(malla, m.pos, (c.z0 + c.z1) / 2, centro);
      grupo.add(malla);
      muros.push(malla);
    });

    propias.forEach(function (a) {
      const ancho = a.hasta - a.desde;
      const grosor = a.tipo === 'vano' ? m.espesor : a.tipo === 'puerta' ? 0.06 : 0.04;
      const geo = m.eje === 'x'
        ? new THREE.BoxGeometry(ancho, a.alto, grosor)
        : new THREE.BoxGeometry(grosor, a.alto, ancho);
      let parametros;
      if (a.tipo === 'puerta') parametros = { color: 0x8b5a2b, roughness: 0.7 };
      else if (a.tipo === 'ventana') parametros = { color: 0x7dd3fc, roughness: 0.1, transparent: true, opacity: 0.45, depthWrite: false };
      else parametros = { color: 0xffffff, transparent: true, opacity: 0, depthWrite: false };
      const malla = new THREE.Mesh(geo, new THREE.MeshStandardMaterial(parametros));
      if (a.tipo !== 'vano') conBordes(malla);
      const centro = (a.desde + a.hasta) / 2;
      const z = a.antepecho + a.alto / 2;
      if (m.eje === 'x') colocar(malla, centro, z, m.pos);
      else colocar(malla, m.pos, z, centro);
      malla.userData = { id: a.id, marca: 'normal', esVano: a.tipo === 'vano' };
      grupo.add(malla);
      pickables.push(malla);
    });
  });

  const techo = conBordes(new THREE.Mesh(new THREE.BoxGeometry(ext.ancho, losa, ext.fondo), matTecho));
  techo.position.set(0, alturaMuro + losa / 2, 0);
  techo.visible = config.techo !== false;
  grupo.add(techo);

  const piso = new THREE.Mesh(new THREE.PlaneGeometry(ext.ancho, ext.fondo), matPiso);
  piso.rotation.x = -Math.PI / 2;
  piso.position.y = 0.005;
  grupo.add(piso);

  const cuadricula = new THREE.GridHelper(20, 20, 0x94a3b8, 0xcbd5e1);
  cuadricula.position.y = -0.01;
  grupo.add(cuadricula);

  grupo.userData = { muros: muros, pickables: pickables, techo: techo, aberturas: aberturas };
  return grupo;
}

function limpiarModelo() {
  if (!modelo) return;
  escena.remove(modelo);
  modelo.traverse(function (obj) {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach(function (m) { m.dispose(); });
  });
  modelo = null;
}

function actualizarBotonTecho() {
  const visible = modelo.userData.techo.visible;
  btnTecho.textContent = visible ? 'Quitar el techo' : 'Poner el techo';
  btnTecho.setAttribute('aria-pressed', String(!visible));
}

/* ---------- Selección con el ratón y alternativa de teclado ---------- */
const rayo = new THREE.Raycaster();
const puntero = new THREE.Vector2();
let inicioClic = null;
let sobre = null;

function idEnPunto(evento) {
  const caja = canvas.getBoundingClientRect();
  puntero.x = ((evento.clientX - caja.left) / caja.width) * 2 - 1;
  puntero.y = -((evento.clientY - caja.top) / caja.height) * 2 + 1;
  rayo.setFromCamera(puntero, camara);
  // Solo cuentan los muros, el techo (si está puesto) y los huecos: así los muros tapan lo que hay detrás.
  const datos = modelo.userData;
  const candidatos = datos.muros.concat(datos.techo.visible ? [datos.techo] : [], datos.pickables);
  const golpes = rayo.intersectObjects(candidatos, false);
  if (golpes.length === 0) return null;
  const objeto = golpes[0].object;
  return objeto.userData && objeto.userData.id ? objeto.userData.id : null;
}

function mallaDe(id) {
  return modelo.userData.pickables.find(function (m) { return m.userData.id === id; });
}

function quitarHover() {
  if (sobre) {
    const malla = mallaDe(sobre);
    if (malla && malla.userData.marca === 'hover') marcar(malla, 'normal');
    sobre = null;
  }
  canvas.style.cursor = '';
}

function configurarPunteros() {
  canvas.addEventListener('pointerdown', function (e) { inicioClic = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerup', function (e) {
    if (!inicioClic || !modelo) return;
    const movimiento = Math.hypot(e.clientX - inicioClic.x, e.clientY - inicioClic.y);
    inicioClic = null;
    if (movimiento < 6) {
      const id = idEnPunto(e);
      if (id) elegirElemento(id);
    }
  });
  canvas.addEventListener('pointermove', function (e) {
    if (e.buttons || !modelo) return;
    const q = preguntas[estado.indice];
    if (!q || q.tipo !== 'clic' || estado.resuelta) return;
    const id = idEnPunto(e);
    if (id === sobre) return;
    quitarHover();
    if (id) {
      const malla = mallaDe(id);
      if (malla && malla.userData.marca === 'normal') marcar(malla, 'hover');
      sobre = id;
      canvas.style.cursor = 'pointer';
    }
  });
  canvas.addEventListener('pointerleave', quitarHover);
}

function construirListaHuecos(q) {
  botonesHuecos.replaceChildren();
  if (q.tipo !== 'clic') { listaHuecos.hidden = true; return; }
  listaHuecos.hidden = false;
  listaHuecos.open = false;
  // Etiquetas por posición, sin revelar de qué elemento se trata.
  modelo.userData.aberturas.forEach(function (a) {
    const boton = crear('button', 'Hueco en el muro ' + textoMuro(a.muro) + ' entre ' + fmtN(a.desde) + ' y ' + fmtN(a.hasta) + ' metros', 'opcion');
    boton.type = 'button';
    boton.addEventListener('click', function () { elegirElemento(a.id); });
    botonesHuecos.appendChild(boton);
  });
}

/* ---------- Planos de referencia ---------- */
function mostrarReferencia(id) {
  const svg = planosRef.get(id).cloneNode(true);
  svg.classList.add('plano');
  svg.removeAttribute('aria-labelledby');
  const titulo = svg.querySelector('title');
  if (titulo) svg.setAttribute('aria-label', titulo.textContent.trim());
  $('lienzo-ref').replaceChildren(svg);
  Array.prototype.forEach.call($('tabs-ref').children, function (b) {
    b.setAttribute('aria-pressed', String(b.dataset.ref === id));
  });
}

function prepararReferencias() {
  const tabs = $('tabs-ref');
  REFERENCIAS.forEach(function (r) {
    const boton = crear('button', r.titulo, 'tab');
    boton.type = 'button';
    boton.dataset.ref = r.id;
    boton.setAttribute('aria-pressed', 'false');
    boton.addEventListener('click', function () { mostrarReferencia(r.id); });
    tabs.appendChild(boton);
  });
  mostrarReferencia('planta');
}

/* ---------- Preguntas ---------- */
function prepararPreguntas(reto) {
  return reto.preguntas.map(function (p) {
    const q = { id: p.id, tipo: p.tipo, enunciado: p.enunciado, pista: p.pista, concepto: p.concepto };
    q.modelo = { techo: !p.modelo || p.modelo.techo !== false, cambios: p.modelo && Array.isArray(p.modelo.cambios) ? p.modelo.cambios : [] };
    const vigentes = aplicarCambios(vivienda.aberturas, q.modelo.cambios).map(function (a) { return a.id; });

    if (p.tipo === 'clic') {
      if (!Array.isArray(p.objetivos) || p.objetivos.length === 0 ||
          !p.objetivos.every(function (id) { return vigentes.indexOf(id) !== -1; })) {
        throw new Error('Pregunta ' + p.id + ': objetivos no válidos');
      }
      q.objetivos = p.objetivos.slice();
    } else if (p.tipo === 'opciones') {
      q.correcta = String(p.correcta);
      q.opciones = [q.correcta].concat(p.distractores.map(String));
    } else {
      throw new Error('Pregunta ' + p.id + ': tipo desconocido');
    }
    q.explicacion = String(p.explicacion);
    return q;
  });
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
  quitarHover();
  cajaOpciones.replaceChildren();
  retro.textContent = '';
  btnSiguiente.hidden = true;
  btnPista.disabled = false;
  enunciado.textContent = q.enunciado;
  actualizarHud();

  limpiarModelo();
  modelo = construirModelo(q.modelo);
  escena.add(modelo);
  actualizarBotonTecho();
  construirListaHuecos(q);
  vistaInicial();

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
  let texto = mensaje + ' Vuelve a mirar el modelo y los planos, o pide una pista.';
  if (estado.errores >= 2) {
    texto = mensaje + ' Te resaltamos la respuesta en amarillo: elígela para continuar.';
    if (q.tipo === 'clic') {
      marcar(mallaDe(q.objetivos[0]), 'revelada');
    } else {
      Array.prototype.forEach.call(cajaOpciones.children, function (b) {
        if (!b.disabled && b.firstChild.textContent === q.correcta) b.classList.add('revelada');
      });
    }
  }
  retro.textContent = texto;
}

function elegirElemento(id) {
  const q = preguntas[estado.indice];
  if (!q || q.tipo !== 'clic' || estado.resuelta) return;
  const malla = mallaDe(id);
  if (!malla) return;
  if (q.objetivos.indexOf(id) !== -1) {
    quitarHover();
    marcar(malla, 'acierto');
    acertar(q);
  } else {
    marcar(malla, 'error');
    setTimeout(function () {
      if (malla.userData.marca === 'error') marcar(malla, 'normal');
    }, 1200);
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
    ? 'Excelente: sabes comprobar si un modelo 3D corresponde con sus planos.'
    : porcentaje >= 60
      ? 'Buen trabajo: ya detectas la mayoría de las discrepancias. Repasa los temas marcados abajo.'
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

  contenedor.appendChild(crear('p', '¡Has completado los tres niveles de la misión!', 'notice'));

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
  ajustarTamano();
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

function configurarControles() {
  $('cam-izq').addEventListener('click', function () { ajustarCamara({ dTheta: -0.35 }); });
  $('cam-der').addEventListener('click', function () { ajustarCamara({ dTheta: 0.35 }); });
  $('cam-arriba').addEventListener('click', function () { ajustarCamara({ phi: 0.12 }); });
  $('cam-mas').addEventListener('click', function () { ajustarCamara({ factor: 0.8 }); });
  $('cam-menos').addEventListener('click', function () { ajustarCamara({ factor: 1.25 }); });
  $('cam-inicial').addEventListener('click', vistaInicial);
  btnTecho.addEventListener('click', function () {
    if (!modelo) return;
    modelo.userData.techo.visible = !modelo.userData.techo.visible;
    actualizarBotonTecho();
    pedirRender();
  });
  btnPista.addEventListener('click', function () {
    if (estado.resuelta) return;
    estado.pista = true;
    retro.textContent = 'Pista: ' + preguntas[estado.indice].pista;
  });
  btnSiguiente.addEventListener('click', function () {
    estado.indice += 1;
    if (estado.indice >= preguntas.length) finalizar(); else mostrarPregunta();
  });
}

async function arrancar() {if (!(await Auth.listo())) return;
  actualizarChip();
  if (!ProgresoMision.desbloqueado(ProgresoMision.leer(), ID_RETO)) {
    pantallas[0].hidden = true;
    $('aviso-bloqueado').hidden = false;
    return;
  }
  try {
    const resultados = await Promise.all([
      pedir('data/vivienda.json', 'json'),
      pedir('data/reto3.json', 'json')
    ].concat(REFERENCIAS.map(function (r) { return pedir(r.archivo, 'texto'); })));

    vivienda = resultados[0];
    if (!Array.isArray(vivienda.muros)) throw new Error('vivienda.json no tiene el bloque "muros"');
    REFERENCIAS.forEach(function (r, i) {
      const doc = new DOMParser().parseFromString(resultados[2 + i], 'image/svg+xml');
      if (doc.querySelector('parsererror')) throw new Error(r.archivo + ' no es válido');
      planosRef.set(r.id, document.importNode(doc.documentElement, true));
    });
    vivienda.aberturas.forEach(function (a) { nombres.set(a.id, a.nombre); });
    preguntas = prepararPreguntas(resultados[1]);
  } catch (error) {
    console.error(error);
    $('error-carga').hidden = false;
    pantallas[0].hidden = true;
    return;
  }

  try {
    iniciarVisor();
  } catch (error) {
    console.error(error);
    $('error-webgl').hidden = false;
    pantallas[0].hidden = true;
    return;
  }

  configurarPunteros();
  configurarControles();
  prepararReferencias();
  prepararInicio();
}

arrancar();