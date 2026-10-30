'use strict';

/* Asignatura: contenidos, avance del estudiante y, para el docente dueño,
   matrícula, avance por estudiante (con detalle por pregunta) y temas a reforzar. */
(function () {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const MAX_POR_PREGUNTA = 10;
  const NOMBRES_RETO = { reto1: 'Nivel 1', reto2: 'Nivel 2', reto3: 'Nivel 3' };
  const ARCHIVOS_RETO = { reto1: 'data/reto1.json', reto2: 'data/reto2.json', reto3: 'data/reto3.json' };

  let asignatura = null;
  let sesion = null;
  let conceptos = null; // { reto1: [concepto de cada pregunta], ... }

  function crear(etiqueta, texto, clase) {
    const nodo = document.createElement(etiqueta);
    if (texto !== undefined) nodo.textContent = texto;
    if (clase) nodo.className = clase;
    return nodo;
  }

  const fmt1 = function (n) { return n.toFixed(1).replace('.', ','); };

  /* ---------- Contenidos (todos los usuarios) ---------- */
  function estadoDelReto(progreso, id) {
    const reto = progreso.retos[id];
    if (!reto) return '';
    if (!ProgresoMision.desbloqueado(progreso, id)) return 'Bloqueado: completa el nivel anterior';
    if (reto.completado) return 'Completado · mejor puntaje: ' + reto.mejorPuntaje;
    if (reto.sesion) return 'En progreso (' + reto.porcentaje + ' %)';
    return 'Disponible';
  }

  function pintarContenidos(plantilla, progreso) {
    const contenedor = document.getElementById('asig-temas');
    contenedor.replaceChildren();
    if (plantilla.temas.length === 0) {
      contenedor.appendChild(crear('p', 'Esta asignatura aún no tiene contenidos.', 'muted'));
      return;
    }
    plantilla.temas.forEach(function (tema) {
      const tarjeta = crear('article', undefined, 'card');
      tarjeta.appendChild(crear('h3', tema.titulo));
      if (tema.descripcion) tarjeta.appendChild(crear('p', tema.descripcion, 'muted'));
      const lista = crear('ul', undefined, 'actividades');
      tema.actividades.forEach(function (act) {
        const fila = crear('li', undefined, 'actividad');
        if (Auth.paginaSegura(act.enlace)) {
          const enlace = crear('a', act.titulo);
          enlace.href = act.enlace;
          fila.appendChild(enlace);
        } else {
          fila.appendChild(crear('span', act.titulo));
        }
        fila.appendChild(crear('span', act.tipo === 'reto' ? estadoDelReto(progreso, act.id) : 'Disponible', 'actividad-estado'));
        lista.appendChild(fila);
      });
      tarjeta.appendChild(lista);
      contenedor.appendChild(tarjeta);
    });
  }

  async function cargarPlantilla(nombre) {
    if (nombre === 'vacia') return { resultadoAprendizaje: '', temas: [] };
    if (!/^[a-z0-9-]+$/.test(nombre)) throw new Error('Plantilla no válida');
    const respuesta = await fetch('data/plantillas/' + nombre + '.json');
    if (!respuesta.ok) throw new Error('HTTP ' + respuesta.status);
    return respuesta.json();
  }

  /* ---------- Vista del estudiante ---------- */
  function pintarEstudiante(bloque, progreso) {
    bloque.replaceChildren();
    const tarjeta = crear('div', undefined, 'card');
    const completados = ProgresoMision.RETOS.filter(function (id) { return progreso.retos[id].completado; }).length;
    tarjeta.appendChild(crear('h2', 'Mi avance'));
    tarjeta.appendChild(crear('p', 'Niveles completados: ' + completados + ' de ' + ProgresoMision.RETOS.length + '. Puntos acumulados: ' + progreso.puntos + '.'));
    const sinNube = ProgresoMision.estadoSync() === 'sin-nube';
    tarjeta.appendChild(crear('p', sinNube
      ? 'No se pudo conectar con la nube: por ahora tu avance está solo en este navegador.'
      : 'Tu avance se guarda en tu cuenta, así que lo conservas aunque cambies de navegador o de computador.', 'muted'));
    bloque.appendChild(tarjeta);
  }

  /* ---------- Vista del docente ---------- */
  async function cargarConceptos() {
    if (conceptos) return conceptos;
    const archivos = await Promise.all(ProgresoMision.RETOS.map(function (id) {
      return fetch(ARCHIVOS_RETO[id]).then(function (r) {
        if (!r.ok) throw new Error(ARCHIVOS_RETO[id] + ': HTTP ' + r.status);
        return r.json();
      });
    }));
    conceptos = {};
    ProgresoMision.RETOS.forEach(function (id, i) {
      conceptos[id] = archivos[i].preguntas.map(function (p) { return p.concepto; });
    });
    return conceptos;
  }

  async function datosDocente() {
    const cliente = Auth.obtenerCliente();
    const respuestas = await Promise.all([
      cliente.from('matriculas').select('usuario_id').eq('asignatura_id', asignatura.id),
      cliente.from('perfiles').select('id, nombre').eq('rol', 'estudiante').order('nombre')
    ]);
    respuestas.forEach(function (r) { if (r.error) throw r.error; });
    const idsMatriculados = new Set(respuestas[0].data.map(function (m) { return m.usuario_id; }));
    const estudiantes = respuestas[1].data;
    const matriculados = estudiantes.filter(function (e) { return idsMatriculados.has(e.id); });
    let filas = [];
    if (matriculados.length > 0) {
      const progreso = await cliente.from('progreso')
        .select('usuario_id, reto, mejor_puntaje, completado, porcentaje, sesion, detalle, actualizado')
        .in('usuario_id', matriculados.map(function (e) { return e.id; }));
      if (progreso.error) throw progreso.error;
      filas = progreso.data;
    }
    return { estudiantes: estudiantes, idsMatriculados: idsMatriculados, matriculados: matriculados, filas: filas };
  }

  function agruparPorUsuario(filas) {
    const mapa = new Map();
    filas.forEach(function (f) {
      if (!mapa.has(f.usuario_id)) mapa.set(f.usuario_id, {});
      mapa.get(f.usuario_id)[f.reto] = f;
    });
    return mapa;
  }

  function textoNivel(fila) {
    if (!fila) return 'Sin iniciar';
    if (fila.completado) return 'Completado · ' + fila.mejor_puntaje + ' pts';
    if (fila.sesion) return 'En progreso · ' + fila.porcentaje + ' %';
    return 'Sin iniciar';
  }

  function textoFecha(fechas) {
    const mayor = fechas.map(function (f) { return new Date(f).getTime(); })
      .filter(function (t) { return Number.isFinite(t); })
      .sort(function (a, b) { return b - a; })[0];
    return mayor ? new Date(mayor).toLocaleString('es') : '—';
  }

  function detalleDeNivel(id, fila) {
    const caja = crear('div', undefined, 'detalle-nivel');
    caja.appendChild(crear('h4', NOMBRES_RETO[id]));
    let puntos = null;
    let etiqueta = '';
    if (fila && fila.completado && Array.isArray(fila.detalle)) {
      puntos = fila.detalle;
      etiqueta = 'Mejor intento completado';
    } else if (fila && !fila.completado && fila.sesion && Array.isArray(fila.sesion.puntos)) {
      puntos = fila.sesion.puntos;
      etiqueta = 'Intento en curso (' + puntos.length + ' preguntas respondidas)';
    } else if (fila && fila.completado) {
      caja.appendChild(crear('p', 'Completó este nivel antes de que existiera el detalle por pregunta. Se registrará cuando lo repita.', 'muted'));
      return caja;
    } else {
      caja.appendChild(crear('p', 'Sin iniciar.', 'muted'));
      return caja;
    }
    caja.appendChild(crear('p', etiqueta, 'muted'));
    const lista = crear('ol', undefined, 'lista-detalle');
    puntos.forEach(function (p, i) {
      const nombre = (conceptos[id] && conceptos[id][i]) || ('Pregunta ' + (i + 1));
      lista.appendChild(crear('li', nombre + ': ' + p + ' de ' + MAX_POR_PREGUNTA + (p < MAX_POR_PREGUNTA ? ' (necesitó ayuda)' : '')));
    });
    caja.appendChild(lista);
    return caja;
  }

  function pintarMatricula(tarjeta, datos, refrescar) {
    tarjeta.replaceChildren();
    tarjeta.appendChild(crear('h2', 'Matrícula'));
    if (datos.estudiantes.length === 0) {
      tarjeta.appendChild(crear('p', 'Aún no hay estudiantes con cuenta en el sistema.'));
      return;
    }
    tarjeta.appendChild(crear('p', 'Matricula a los estudiantes que podrán ver esta asignatura.', 'muted'));
    const lista = crear('ul', undefined, 'actividades');
    datos.estudiantes.forEach(function (e) {
      const matriculado = datos.idsMatriculados.has(e.id);
      const fila = crear('li', undefined, 'actividad');
      fila.appendChild(crear('span', e.nombre || 'Sin nombre'));
      const derecha = crear('span', undefined, 'matricula-accion');
      derecha.appendChild(crear('span', matriculado ? 'Matriculado' : 'No matriculado', 'actividad-estado'));
      const boton = crear('button', matriculado ? 'Quitar' : 'Matricular', 'btn btn-outline btn-peq');
      boton.type = 'button';
      boton.addEventListener('click', async function () {
        boton.disabled = true;
        try {
          const cliente = Auth.obtenerCliente();
          const resultado = matriculado
            ? await cliente.from('matriculas').delete().eq('asignatura_id', asignatura.id).eq('usuario_id', e.id)
            : await cliente.from('matriculas').insert({ asignatura_id: asignatura.id, usuario_id: e.id });
          if (resultado.error) throw resultado.error;
          await refrescar();
        } catch (error) {
          console.error(error);
          boton.disabled = false;
          derecha.appendChild(crear('span', 'No se pudo guardar el cambio.', 'actividad-estado'));
        }
      });
      derecha.appendChild(boton);
      fila.appendChild(derecha);
      lista.appendChild(fila);
    });
    tarjeta.appendChild(lista);
  }

  function pintarAvance(tarjeta, datos) {
    tarjeta.replaceChildren();
    tarjeta.appendChild(crear('h2', 'Avance de los estudiantes'));
    if (datos.matriculados.length === 0) {
      tarjeta.appendChild(crear('p', 'Aún no hay estudiantes matriculados en esta asignatura.'));
      return;
    }
    const porUsuario = agruparPorUsuario(datos.filas);
    const resumen = ProgresoMision.RETOS.map(function (id) {
      const hechos = datos.matriculados.filter(function (e) {
        const fila = porUsuario.get(e.id) && porUsuario.get(e.id)[id];
        return fila && fila.completado;
      }).length;
      return NOMBRES_RETO[id] + ': ' + hechos + ' de ' + datos.matriculados.length;
    });
    tarjeta.appendChild(crear('p', 'Completaron → ' + resumen.join(' · ') + '.'));

    const envoltura = crear('div', undefined, 'tabla-wrap');
    const tabla = document.createElement('table');
    tabla.appendChild(crear('caption', 'Avance por estudiante'));
    const cabecera = document.createElement('tr');
    ['Estudiante', 'Nivel 1', 'Nivel 2', 'Nivel 3', 'Puntos', 'Última actividad', 'Detalle'].forEach(function (t) {
      const th = crear('th', t);
      th.scope = 'col';
      cabecera.appendChild(th);
    });
    const thead = document.createElement('thead');
    thead.appendChild(cabecera);
    tabla.appendChild(thead);

    const cuerpo = document.createElement('tbody');
    datos.matriculados.forEach(function (e) {
      const filasDe = porUsuario.get(e.id) || {};
      const fila = document.createElement('tr');
      const nombre = crear('th', e.nombre || 'Sin nombre');
      nombre.scope = 'row';
      fila.appendChild(nombre);
      ProgresoMision.RETOS.forEach(function (id) { fila.appendChild(crear('td', textoNivel(filasDe[id]))); });
      const total = ProgresoMision.RETOS.reduce(function (suma, id) {
        return suma + (filasDe[id] ? filasDe[id].mejor_puntaje : 0);
      }, 0);
      fila.appendChild(crear('td', String(total)));
      fila.appendChild(crear('td', textoFecha(Object.keys(filasDe).map(function (id) { return filasDe[id].actualizado; }))));

      const celdaBoton = document.createElement('td');
      const boton = crear('button', 'Ver detalle', 'btn btn-outline btn-peq');
      boton.type = 'button';
      boton.setAttribute('aria-expanded', 'false');
      celdaBoton.appendChild(boton);
      fila.appendChild(celdaBoton);
      cuerpo.appendChild(fila);

      const filaDetalle = document.createElement('tr');
      filaDetalle.className = 'fila-detalle';
      filaDetalle.hidden = true;
      const celda = document.createElement('td');
      celda.colSpan = 7;
      ProgresoMision.RETOS.forEach(function (id) { celda.appendChild(detalleDeNivel(id, filasDe[id])); });
      filaDetalle.appendChild(celda);
      cuerpo.appendChild(filaDetalle);

      boton.addEventListener('click', function () {
        const abrir = filaDetalle.hidden;
        filaDetalle.hidden = !abrir;
        boton.setAttribute('aria-expanded', String(abrir));
        boton.textContent = abrir ? 'Ocultar detalle' : 'Ver detalle';
      });
    });
    tabla.appendChild(cuerpo);
    envoltura.appendChild(tabla);
    tarjeta.appendChild(envoltura);
  }

  function pintarTemasAReforzar(tarjeta, datos) {
    tarjeta.replaceChildren();
    tarjeta.appendChild(crear('h2', 'Temas que más cuestan a la clase'));
    const acumulado = new Map(); // "reto|indice" -> { suma, n }
    datos.filas.forEach(function (f) {
      if (!f.completado || !Array.isArray(f.detalle)) return;
      f.detalle.forEach(function (p, i) {
        const clave = f.reto + '|' + i;
        const registro = acumulado.get(clave) || { reto: f.reto, indice: i, suma: 0, n: 0 };
        registro.suma += p;
        registro.n += 1;
        acumulado.set(clave, registro);
      });
    });
    if (acumulado.size === 0) {
      tarjeta.appendChild(crear('p', 'Aún no hay intentos completados con detalle. Aparecerán cuando los estudiantes terminen un nivel.', 'muted'));
      return;
    }
    const dificiles = Array.from(acumulado.values())
      .map(function (r) { return { reto: r.reto, indice: r.indice, n: r.n, promedio: r.suma / r.n }; })
      .filter(function (r) { return r.promedio < MAX_POR_PREGUNTA; })
      .sort(function (a, b) { return a.promedio - b.promedio; })
      .slice(0, 6);
    if (dificiles.length === 0) {
      tarjeta.appendChild(crear('p', 'En los intentos registrados, los estudiantes acertaron todo sin ayuda.'));
      return;
    }
    tarjeta.appendChild(crear('p', 'Promedio de puntos por pregunta (de ' + MAX_POR_PREGUNTA + '), de menor a mayor.', 'muted'));
    const lista = crear('ul', undefined, 'actividades');
    dificiles.forEach(function (r) {
      const nombre = (conceptos[r.reto] && conceptos[r.reto][r.indice]) || ('Pregunta ' + (r.indice + 1));
      const fila = crear('li', undefined, 'actividad');
      fila.appendChild(crear('span', NOMBRES_RETO[r.reto] + ' · pregunta ' + (r.indice + 1) + ': ' + nombre));
      fila.appendChild(crear('span', 'Promedio ' + fmt1(r.promedio) + ' (' + r.n + (r.n === 1 ? ' estudiante' : ' estudiantes') + ')', 'actividad-estado'));
      lista.appendChild(fila);
    });
    tarjeta.appendChild(lista);
  }

  async function pintarDocente(bloque) {
    bloque.replaceChildren();
    const matricula = crear('div', undefined, 'card bloque-docente');
    const avance = crear('div', undefined, 'card bloque-docente');
    const temas = crear('div', undefined, 'card bloque-docente');
    [matricula, avance, temas].forEach(function (t) {
      t.appendChild(crear('p', 'Cargando…', 'muted'));
      bloque.appendChild(t);
    });

    async function refrescar() {
      try {
        await cargarConceptos();
        const datos = await datosDocente();
        pintarMatricula(matricula, datos, refrescar);
        pintarAvance(avance, datos);
        pintarTemasAReforzar(temas, datos);
      } catch (error) {
        console.error(error);
        [matricula, avance, temas].forEach(function (t) {
          t.replaceChildren(crear('p', 'No se pudo cargar esta sección. Revisa tu conexión y que el proyecto de Supabase esté activo.', 'error-visor'));
        });
      }
    }
    await refrescar();
  }

  /* ---------- Carga de la página ---------- */
  async function cargar() {
    sesion = await Auth.listo();
    if (!sesion) return;
    const mostrarError = function () { document.getElementById('error-asig').hidden = false; };

    const id = new URLSearchParams(location.search).get('id');
    if (!id || !UUID.test(id)) { location.replace('cursos.html'); return; }

    try {
      const respuesta = await Auth.obtenerCliente().from('asignaturas')
        .select('id, nombre, periodo, descripcion, docente_id, docente_nombre, plantilla')
        .eq('id', id).maybeSingle();
      if (respuesta.error) throw respuesta.error;
      if (!respuesta.data) { mostrarError(); return; }
      asignatura = respuesta.data;

      document.title = asignatura.nombre + ' · Del plano al 3D';
      document.getElementById('asig-nombre').textContent = asignatura.nombre;
      document.getElementById('asig-detalle').textContent =
        [asignatura.docente_nombre ? 'Docente: ' + asignatura.docente_nombre : '', asignatura.periodo ? 'Periodo: ' + asignatura.periodo : '']
          .filter(Boolean).join(' · ');
      document.getElementById('asig-descripcion').textContent = asignatura.descripcion;

      const plantilla = await cargarPlantilla(asignatura.plantilla);
      document.getElementById('bloque-resultado').hidden = !plantilla.resultadoAprendizaje;
      document.getElementById('asig-resultado').textContent = plantilla.resultadoAprendizaje;
      pintarContenidos(plantilla, ProgresoMision.leer());

      const bloque = document.getElementById('asig-rol');
      const esDueno = sesion.perfil.rol === 'docente' && asignatura.docente_id === sesion.usuario.id;
      if (esDueno) await pintarDocente(bloque);
      else pintarEstudiante(bloque, ProgresoMision.leer());
    } catch (error) {
      console.error(error);
      mostrarError();
    }
  }

  cargar();
})();