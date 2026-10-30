'use strict';

/* Datos de conexión de Supabase.
   La clave publicable es pública por diseño: lo que protege los datos son
   las reglas de acceso (RLS) de la base.
   NUNCA pongas aquí la clave secreta (sb_secret_...) ni la service_role. */
window.CONFIG_SUPABASE = {
  url: 'https://bqxpesmpvhdzyxkmrhvq.supabase.co',
  clavePublica: 'sb_publishable_dvKH4StZc0dz2tfx8F9FSg_jAZbzybl'
};