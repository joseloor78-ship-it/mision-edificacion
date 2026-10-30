'use strict';

/* Autenticación y sesión con Supabase Auth.
   Requiere, en este orden: vendor/supabase/supabase.js, js/config.js, js/auth.js */
const Auth = (function () {
  const PAGINA_LOGIN = 'login.html';
  const PAGINA_INICIO = 'cursos.html';
  const ROLES = { docente: 'Docente', estudiante: 'Estudiante' };
  const TEXTOS_SYNC = {
    guardado: 'Avance guardado',
    sincronizando: 'Guardando…',
    pendiente: 'Sin guardar en la nube (se reintentará)',
    'sin-nube': 'Sin conexión con la nube: avance solo en este navegador'
  };
  let cliente = null;
  let verificacion = null;
  let estado = null; // { usuario, perfil } de la sesión ya verificada

  function obtenerCliente() {
    if (cliente) return cliente;
    const cfg = window.CONFIG_SUPABASE;
    const configurado = cfg && typeof cfg.url === 'string' && typeof cfg.clavePublica === 'string' &&
      cfg.url.indexOf('TU-PROYECTO') === -1 && cfg.clavePublica.indexOf('TU_CLAVE') === -1;
    if (!configurado) throw new Error('Falta configurar Supabase en js/config.js');
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      throw new Error('No se cargó vendor/supabase/supabase.js');
    }
    cliente = window.supabase.createClient(cfg.url, cfg.clavePublica);
    return cliente;
  }

  // Solo se permite volver a páginas propias con nombre simple (evita redirecciones a otros sitios).
  function paginaSegura(nombre) {
    return typeof nombre === 'string' && /^[a-z0-9-]+\.html$/.test(nombre);
  }

  function irALogin() {
    const actual = location.pathname.split('/').pop();
    const destino = paginaSegura(actual) && actual !== PAGINA_LOGIN ? '?volver=' + encodeURIComponent(actual) : '';
    location.replace(PAGINA_LOGIN + destino);
  }

  async function haySesion() {
    const resultado = await obtenerCliente().auth.getSession();
    return Boolean(resultado.data.session);
  }

  async function iniciarSesion(correo, contrasena) {
    const resultado = await obtenerCliente().auth.signInWithPassword({ email: correo, password: contrasena });
    return resultado.error ? { ok: false, error: resultado.error } : { ok: true };
  }

  async function cerrarSesion() {
    try { await obtenerCliente().auth.signOut(); } catch (error) { /* ya no hay sesión */ }
  }

  async function leerPerfil(id) {
    const resultado = await obtenerCliente().from('perfiles').select('nombre, rol').eq('id', id).single();
    if (resultado.error) throw resultado.error;
    return resultado.data;
  }

  async function verificar() {
    const c = obtenerCliente();
    const local = await c.auth.getSession();
    if (!local.data.session) { irALogin(); return null; }

    // getUser valida la sesión con el servidor (getSession solo lee lo guardado en el navegador).
    const remoto = await c.auth.getUser();
    if (remoto.error || !remoto.data.user) {
      const e = remoto.error;
      if (!e || e.status === 401 || e.status === 403 || e.name === 'AuthSessionMissingError') {
        await cerrarSesion();
        irALogin();
        return null;
      }
      throw e;
    }
    const perfil = await leerPerfil(remoto.data.user.id);
    if (!ROLES[perfil.rol]) perfil.rol = 'estudiante';
    estado = { usuario: remoto.data.user, perfil: perfil };
    return estado;
  }

  function pintarCabecera(e) {
    const barra = document.querySelector('.site-header .bar');
    if (!barra) return;

    const lista = barra.querySelector('nav ul');
    if (lista && !lista.querySelector('a[href="' + PAGINA_INICIO + '"]')) {
      const item = document.createElement('li');
      const enlace = document.createElement('a');
      enlace.href = PAGINA_INICIO;
      enlace.textContent = 'Mis asignaturas';
      item.appendChild(enlace);
      lista.insertBefore(item, lista.children[1] || null);
    }

    const caja = document.createElement('div');
    caja.className = 'sesion-usuario';
    const etiqueta = document.createElement('span');
    etiqueta.className = 'sesion-nombre';
    etiqueta.textContent = e.perfil.nombre + ' · ' + ROLES[e.perfil.rol];
    caja.appendChild(etiqueta);

    if (typeof ProgresoMision !== 'undefined') {
      const sync = document.createElement('span');
      sync.className = 'sesion-sync';
      sync.setAttribute('aria-live', 'polite');
      sync.textContent = TEXTOS_SYNC[ProgresoMision.estadoSync()] || '';
      document.addEventListener('progreso:sync', function (evento) {
        sync.textContent = TEXTOS_SYNC[evento.detail.estado] || '';
      });
      caja.appendChild(sync);
    }

    const salir = document.createElement('button');
    salir.type = 'button';
    salir.className = 'btn btn-outline btn-peq';
    salir.textContent = 'Cerrar sesión';
    salir.addEventListener('click', async function () {
      await cerrarSesion();
      location.replace(PAGINA_LOGIN);
    });
    caja.appendChild(salir);
    barra.appendChild(caja);
  }

  function mostrarErrorSesion() {
    const aviso = document.createElement('p');
    aviso.className = 'error-visor aviso-sesion';
    aviso.setAttribute('role', 'alert');
    aviso.textContent = 'No se pudo verificar tu sesión. Revisa tu conexión, que el proyecto de Supabase esté activo (los gratuitos se pausan tras una semana sin uso) y que js/config.js tenga los datos correctos.';
    const enlace = document.createElement('a');
    enlace.href = PAGINA_LOGIN;
    enlace.textContent = ' Ir al inicio de sesión';
    aviso.appendChild(enlace);
    const principal = document.querySelector('main');
    if (principal && principal.parentNode) principal.parentNode.insertBefore(aviso, principal);
  }

  // Verifica la sesión una sola vez y conecta el progreso con la cuenta.
  // Devuelve { usuario, perfil }, o null si no hay sesión válida.
  function listo() {
    if (!verificacion) {
      verificacion = verificar().then(async function (e) {
        if (!e) return null;
        if (typeof ProgresoMision !== 'undefined') {
          try {
            await ProgresoMision.iniciar(obtenerCliente(), e.usuario.id);
          } catch (error) {
            console.error(error);
          }
        }
        pintarCabecera(e);
        document.body.classList.add('sesion-ok');
        return e;
      }).catch(function (error) {
        console.error(error);
        mostrarErrorSesion();
        return null;
      });
    }
    return verificacion;
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (document.body.hasAttribute('data-requiere-sesion')) listo();
  });

  return {
    PAGINA_LOGIN: PAGINA_LOGIN,
    PAGINA_INICIO: PAGINA_INICIO,
    obtenerCliente: obtenerCliente,
    paginaSegura: paginaSegura,
    haySesion: haySesion,
    iniciarSesion: iniciarSesion,
    cerrarSesion: cerrarSesion,
    listo: listo,
    usuarioActivo: function () { return estado; }
  };
})();