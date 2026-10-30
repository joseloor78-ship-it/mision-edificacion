'use strict';

/* Progreso de la misión.
   - Se guarda en este navegador, separado por usuario (la clave incluye el id de la cuenta).
   - Con sesión de Supabase, se sincroniza con la tabla "progreso" (iniciar() lo conecta).
   - Si no hay conexión, el avance local se conserva y se reintenta después.
   - "detalle" guarda los puntos de cada pregunta del mejor intento completado. */
const ProgresoMision = (function () {
  const PREFIJO = 'mision-edificacion:progreso:v2:';
  const RETOS = ['reto1', 'reto2', 'reto3'];

  let clave = null;          // se fija en iniciar(), según el usuario
  let cliente = null;        // cliente de Supabase (null si no se pudo leer la nube)
  let usuarioId = null;
  let estadoSync = 'local';  // local | sincronizando | guardado | pendiente | sin-nube
  let cola = Promise.resolve();
  const pendientes = new Set();

  function retoInicial() {
    return { porcentaje: 0, completado: false, mejorPuntaje: 0, sesion: null, detalle: null };
  }

  function estadoInicial() {
    const estado = { puntos: 0, retos: {} };
    RETOS.forEach(function (id) { estado.retos[id] = retoInicial(); });
    return estado;
  }

  function numero(valor, min, max) {
    const n = Number(valor);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : min;
  }

  function normalizarLista(lista) {
    if (!Array.isArray(lista)) return null;
    const puntos = lista.slice(0, 50).map(function (n) { return numero(n, 0, 100); });
    return puntos.length > 0 ? puntos : null;
  }

  function normalizarSesion(sesion) {
    if (!sesion || typeof sesion !== 'object') return null;
    const puntos = normalizarLista(sesion.puntos);
    return puntos ? { puntos: puntos } : null;
  }

  // Los datos guardados (en el navegador o en la nube) no son confiables: se validan siempre.
  function normalizar(datos) {
    const base = estadoInicial();
    if (!datos || typeof datos !== 'object') return base;
    const retos = datos.retos && typeof datos.retos === 'object' ? datos.retos : {};
    RETOS.forEach(function (id) {
      const r = retos[id];
      if (!r || typeof r !== 'object') return;
      const destino = base.retos[id];
      destino.completado = r.completado === true;
      destino.mejorPuntaje = numero(r.mejorPuntaje, 0, 10000);
      destino.sesion = normalizarSesion(r.sesion);
      destino.detalle = normalizarLista(r.detalle);
      destino.porcentaje = destino.completado ? 100 : (destino.sesion ? numero(r.porcentaje, 0, 100) : 0);
    });
    base.puntos = RETOS.reduce(function (suma, id) { return suma + base.retos[id].mejorPuntaje; }, 0);
    return base;
  }

  function leer() {
    if (!clave) return estadoInicial();
    try {
      const crudo = localStorage.getItem(clave);
      return crudo ? normalizar(JSON.parse(crudo)) : estadoInicial();
    } catch (error) {
      return estadoInicial();
    }
  }

  function guardarLocal(estado) {
    if (!clave) return false;
    try {
      localStorage.setItem(clave, JSON.stringify(normalizar(estado)));
      return true;
    } catch (error) {
      return false;
    }
  }

  /* ---------- Sincronización con Supabase ---------- */
  function avisar(estado) {
    estadoSync = estado;
    document.dispatchEvent(new CustomEvent('progreso:sync', { detail: { estado: estado } }));
  }

  async function subir(ids) {
    const estado = leer();
    const filas = ids.map(function (id) {
      const r = estado.retos[id];
      return {
        usuario_id: usuarioId,
        reto: id,
        mejor_puntaje: r.mejorPuntaje,
        completado: r.completado,
        porcentaje: r.porcentaje,
        sesion: r.sesion,
        detalle: r.detalle,
        actualizado: new Date().toISOString()
      };
    });
    const resultado = await cliente.from('progreso').upsert(filas, { onConflict: 'usuario_id,reto' });
    if (resultado.error) {
      console.error(resultado.error);
      return false;
    }
    return true;
  }

  function sincronizar(id) {
    if (!cliente || !usuarioId) return;
    pendientes.add(id);
    avisar('sincronizando');
    cola = cola.then(async function () {
      const ids = Array.from(pendientes);
      if (ids.length === 0) return;
      let correcto = false;
      try { correcto = await subir(ids); } catch (error) { console.error(error); }
      if (correcto) ids.forEach(function (i) { pendientes.delete(i); });
      avisar(pendientes.size === 0 ? 'guardado' : 'pendiente');
    });
  }

  function filasAEstado(filas) {
    const retos = {};
    (filas || []).forEach(function (f) {
      if (RETOS.indexOf(f.reto) === -1) return;
      retos[f.reto] = {
        completado: f.completado === true,
        mejorPuntaje: f.mejor_puntaje,
        porcentaje: f.porcentaje,
        sesion: f.sesion,
        detalle: f.detalle
      };
    });
    return normalizar({ retos: retos });
  }

  // Une el avance local y el de la nube; siempre gana el más adelantado.
  function fusionar(a, b) {
    const retos = {};
    RETOS.forEach(function (id) {
      const x = a.retos[id];
      const y = b.retos[id];
      let sesion = x.sesion || y.sesion;
      if (x.sesion && y.sesion) sesion = x.sesion.puntos.length >= y.sesion.puntos.length ? x.sesion : y.sesion;
      let detalle = x.detalle || y.detalle;
      if (x.detalle && y.detalle) detalle = x.mejorPuntaje >= y.mejorPuntaje ? x.detalle : y.detalle;
      retos[id] = {
        completado: x.completado || y.completado,
        mejorPuntaje: Math.max(x.mejorPuntaje, y.mejorPuntaje),
        porcentaje: Math.max(x.porcentaje, y.porcentaje),
        sesion: sesion,
        detalle: detalle
      };
    });
    return normalizar({ retos: retos });
  }

  // Se llama una vez que hay una sesión verificada (lo hace Auth.listo()).
  async function iniciar(clienteSupabase, id) {
    clave = PREFIJO + id;
    usuarioId = id;
    const local = leer();
    let nube;
    try {
      const resultado = await clienteSupabase.from('progreso')
        .select('reto, mejor_puntaje, completado, porcentaje, sesion, detalle')
        .eq('usuario_id', id);
      if (resultado.error) throw resultado.error;
      nube = filasAEstado(resultado.data);
    } catch (error) {
      // Sin acceso a la nube: se trabaja solo con el avance local y no se sube nada,
      // para no sobrescribir datos más nuevos que ya estén guardados.
      console.error(error);
      cliente = null;
      avisar('sin-nube');
      return;
    }
    cliente = clienteSupabase;
    const fusionado = fusionar(local, nube);
    guardarLocal(fusionado);
    const cambiados = RETOS.filter(function (r) {
      return JSON.stringify(fusionado.retos[r]) !== JSON.stringify(nube.retos[r]);
    });
    if (cambiados.length === 0) avisar('guardado');
    cambiados.forEach(sincronizar);
  }

  window.addEventListener('online', function () {
    if (cliente && pendientes.size > 0) sincronizar(Array.from(pendientes)[0]);
  });

  /* ---------- Operaciones usadas por el juego ---------- */
  function guardar(estado) {
    const correcto = guardarLocal(estado);
    if (correcto && cliente) {
      RETOS.slice(1).forEach(function (id) { pendientes.add(id); });
      sincronizar(RETOS[0]);
    }
    return correcto;
  }

  // Borra el avance de este usuario (en el navegador y en la nube). Útil para pruebas.
  function reiniciar() {
    try { if (clave) localStorage.removeItem(clave); } catch (error) { /* sin almacenamiento */ }
    pendientes.clear();
    if (cliente && usuarioId) {
      cliente.from('progreso').delete().eq('usuario_id', usuarioId).then(function (resultado) {
        if (resultado.error) console.error(resultado.error);
      });
    }
    return estadoInicial();
  }

  // El reto 1 siempre está disponible; cada reto siguiente exige completar el anterior.
  function desbloqueado(estado, id) {
    const indice = RETOS.indexOf(id);
    if (indice <= 0) return indice === 0;
    return estado.retos[RETOS[indice - 1]].completado === true;
  }

  // Guarda un intento a medias: los puntos de cada pregunta ya resuelta.
  function guardarSesion(id, puntos, totalPreguntas) {
    const estado = leer();
    const reto = estado.retos[id];
    if (!reto) return false;
    reto.sesion = { puntos: puntos.slice() };
    if (!reto.completado) {
      reto.porcentaje = totalPreguntas > 0 ? Math.round(puntos.length / totalPreguntas * 100) : 0;
    }
    const correcto = guardarLocal(estado);
    if (correcto) sincronizar(id);
    return correcto;
  }

  // Marca el reto como completado; conserva el mejor puntaje y el detalle de ese intento.
  function completarReto(id, puntos) {
    const estado = leer();
    const reto = estado.retos[id];
    if (!reto) return false;
    const suma = puntos.reduce(function (a, n) { return a + numero(n, 0, 100); }, 0);
    const previo = reto.mejorPuntaje;
    reto.completado = true;
    reto.porcentaje = 100;
    reto.mejorPuntaje = Math.max(previo, suma);
    if (suma >= previo || !reto.detalle) reto.detalle = puntos.slice();
    reto.sesion = null;
    const correcto = guardarLocal(estado);
    if (correcto) sincronizar(id);
    return correcto;
  }

  function descartarSesion(id) {
    const estado = leer();
    const reto = estado.retos[id];
    if (!reto) return false;
    reto.sesion = null;
    if (!reto.completado) reto.porcentaje = 0;
    const correcto = guardarLocal(estado);
    if (correcto) sincronizar(id);
    return correcto;
  }

  return {
    RETOS: RETOS,
    iniciar: iniciar,
    leer: leer,
    guardar: guardar,
    reiniciar: reiniciar,
    desbloqueado: desbloqueado,
    guardarSesion: guardarSesion,
    completarReto: completarReto,
    descartarSesion: descartarSesion,
    estadoSync: function () { return estadoSync; }
  };
})();