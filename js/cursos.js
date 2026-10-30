'use strict';

/* Catálogo "Mis asignaturas".
   Estudiante: ve las asignaturas en las que está matriculado.
   Docente: ve las suyas y puede crear nuevas. */
(function () {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const PLANTILLAS = { 'planos-3d': 'Contenido: Del plano al 3D', vacia: 'Sin contenidos por ahora' };
  let sesion = null;

  const $ = function (id) { return document.getElementById(id); };

  function crear(etiqueta, texto, clase) {
    const nodo = document.createElement(etiqueta);
    if (texto !== undefined) nodo.textContent = texto;
    if (clase) nodo.className = clase;
    return nodo;
  }

  function tarjeta(a) {
    const articulo = crear('article', undefined, 'card curso');
    const banda = crear('div', undefined, 'curso-banda');
    banda.setAttribute('aria-hidden', 'true');
    articulo.appendChild(banda);

    const cuerpo = crear('div', undefined, 'curso-cuerpo');
    cuerpo.appendChild(crear('h3', a.nombre));
    const meta = [a.docente_nombre, a.periodo].filter(Boolean).join(' · ');
    if (meta) cuerpo.appendChild(crear('p', meta, 'muted'));
    if (a.descripcion) cuerpo.appendChild(crear('p', a.descripcion));
    cuerpo.appendChild(crear('p', PLANTILLAS[a.plantilla] || '', 'muted'));

    const pie = crear('div', undefined, 'curso-pie');
    if (UUID.test(a.id)) {
      const enlace = crear('a', 'Entrar', 'btn btn-primary');
      enlace.href = 'asignatura.html?id=' + encodeURIComponent(a.id);
      pie.appendChild(enlace);
    }
    cuerpo.appendChild(pie);
    articulo.appendChild(cuerpo);
    return articulo;
  }

  async function cargarLista() {
    const lista = $('lista-cursos');
    const vacio = $('vacio-cursos');
    $('error-cursos').hidden = true;
    try {
      const respuesta = await Auth.obtenerCliente().from('asignaturas')
        .select('id, nombre, periodo, descripcion, docente_nombre, plantilla')
        .order('creada');
      if (respuesta.error) throw respuesta.error;
      lista.replaceChildren();
      respuesta.data.forEach(function (a) { lista.appendChild(tarjeta(a)); });
      vacio.hidden = respuesta.data.length > 0;
      if (respuesta.data.length === 0) {
        vacio.textContent = sesion.perfil.rol === 'docente'
          ? 'Aún no tienes asignaturas. Crea la primera con el botón "Nueva asignatura".'
          : 'Aún no estás matriculado en ninguna asignatura. Pídele a tu docente que te matricule.';
      }
    } catch (error) {
      console.error(error);
      $('error-cursos').hidden = false;
    }
  }

  function avisar(texto) {
    const mensaje = $('msg-nueva');
    mensaje.textContent = texto;
    mensaje.hidden = !texto;
  }

  function configurarFormulario() {
    const boton = $('btn-nueva');
    const formulario = $('form-asig');

    function alternar(abrir) {
      formulario.hidden = !abrir;
      boton.setAttribute('aria-expanded', String(abrir));
      avisar('');
      if (abrir) $('asig-nombre-in').focus();
    }
    boton.addEventListener('click', function () { alternar(formulario.hidden); });
    $('btn-cancelar').addEventListener('click', function () { alternar(false); boton.focus(); });

    formulario.addEventListener('submit', async function (evento) {
      evento.preventDefault();
      const nombre = formulario.elements.nombre.value.trim();
      const periodo = formulario.elements.periodo.value.trim();
      const descripcion = formulario.elements.descripcion.value.trim();
      const plantilla = formulario.elements.plantilla.value;

      if (nombre.length < 3 || nombre.length > 120) { avisar('El nombre debe tener entre 3 y 120 caracteres.'); return; }
      if (periodo.length > 60) { avisar('El periodo puede tener hasta 60 caracteres.'); return; }
      if (descripcion.length > 400) { avisar('La descripción puede tener hasta 400 caracteres.'); return; }
      if (!PLANTILLAS[plantilla]) { avisar('Elige un contenido válido.'); return; }

      $('btn-crear').disabled = true;
      avisar('Creando…');
      try {
        const respuesta = await Auth.obtenerCliente().from('asignaturas').insert({
          nombre: nombre,
          periodo: periodo,
          descripcion: descripcion,
          plantilla: plantilla,
          docente_id: sesion.usuario.id,
          docente_nombre: sesion.perfil.nombre
        });
        if (respuesta.error) throw respuesta.error;
        formulario.reset();
        alternar(false);
        await cargarLista();
      } catch (error) {
        console.error(error);
        avisar('No se pudo crear la asignatura. Inténtalo de nuevo.');
      } finally {
        $('btn-crear').disabled = false;
      }
    });
  }

  async function iniciar() {
    sesion = await Auth.listo();
    if (!sesion) return;
    if (sesion.perfil.rol === 'docente') {
      $('zona-docente').hidden = false;
      $('cursos-subtitulo').textContent = 'Estas son tus asignaturas. Puedes crear nuevas y matricular estudiantes dentro de cada una.';
      configurarFormulario();
    }
    await cargarLista();
  }

  iniciar();
})();