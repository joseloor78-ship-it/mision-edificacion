'use strict';

(function () {
  const formulario = document.getElementById('form-login');
  const mensaje = document.getElementById('login-msg');
  const boton = document.getElementById('login-boton');

  function avisar(texto) {
    mensaje.textContent = texto;
    mensaje.hidden = !texto;
  }

  function destinoTrasIngresar() {
    const volver = new URLSearchParams(location.search).get('volver');
    return Auth.paginaSegura(volver) && volver !== Auth.PAGINA_LOGIN ? volver : Auth.PAGINA_INICIO;
  }

  async function revisarSesionPrevia() {
    try {
      if (await Auth.haySesion()) location.replace(destinoTrasIngresar());
    } catch (error) {
      console.error(error);
      avisar('No se pudo comprobar la configuración de Supabase. Revisa js/config.js.');
    }
  }

  formulario.addEventListener('submit', async function (evento) {
    evento.preventDefault();
    const correo = formulario.elements.correo.value.trim();
    const clave = formulario.elements.clave.value;
    if (!correo || !clave) {
      avisar('Escribe tu correo y tu contraseña.');
      return;
    }
    boton.disabled = true;
    avisar('Ingresando…');
    try {
      const resultado = await Auth.iniciarSesion(correo, clave);
      if (resultado.ok) {
        location.replace(destinoTrasIngresar());
        return;
      }
      // Mensaje genérico: no revela si falló el correo o la contraseña.
      avisar(resultado.error.status === 400
        ? 'Correo o contraseña incorrectos.'
        : 'No se pudo iniciar sesión. Inténtalo de nuevo.');
    } catch (error) {
      console.error(error);
      avisar('No se pudo conectar con Supabase. Revisa js/config.js, tu conexión y que el proyecto esté activo.');
    } finally {
      boton.disabled = false;
      formulario.elements.clave.value = '';
    }
  });

  revisarSesionPrevia();
})();