// ============================================================
//  CONFIGURACIÓN GENERAL — editá solo este archivo
// ============================================================
// Si dejás SUPABASE_URL vacío, la app funciona en MODO DEMO
// (datos guardados en el navegador, sin servidor). Ideal para probar.
window.RODAR_CONFIG = {
  APP_NAME: "Rodar",
  SUPABASE_URL: "",          // ej: "https://xxxxxxxx.supabase.co"
  SUPABASE_ANON_KEY: "",     // clave "anon public" / publishable de Supabase
  // URL de la Edge Function que sincroniza con HubSpot (se completa sola si hay SUPABASE_URL)
  HUBSPOT_FUNCTION: "",
  // Centro del mapa (Federal, Entre Ríos)
  MAP_CENTER: [-30.9547, -58.7833],
  MAP_ZOOM: 14,
  CURRENCY: "ARS",
  LOCALE: "es-AR"
};
