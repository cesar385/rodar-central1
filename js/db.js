// ============================================================
//  Capa de datos única: Supabase (producción) o localStorage (demo)
// ============================================================
(function () {
  const C = window.RODAR_CONFIG;
  const LIVE = !!(C.SUPABASE_URL && C.SUPABASE_ANON_KEY && window.supabase);
  const sb = LIVE ? window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY) : null;
  const KEY = "rodar_db_v1";
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const now = () => new Date().toISOString();
  const bc = "BroadcastChannel" in window ? new BroadcastChannel("rodar") : null;
  const listeners = {};

  function seed() {
    return {
      company: [{ id: 1, name: "Rodar", email: "", phone: "", driver_license: "", language: "es", units: "metric",
        currency: C.CURRENCY, timezone: "America/Argentina/Cordoba", precision: 0, hide_precision_driver: false,
        hide_precision_client: false, sos_phone: "", no_travelers: false, plain_summary: false,
        geo_alert: true, geo_alert_minutes: 10,
        geo_alert_text: "No estás recibiendo pedidos de Rodar. Tocá aquí para reactivar tu app de conductor.",
        zone: [], plan: "Gratis", balance: 0, auto_topup: false, created_at: now() }],
      services: [
        { id: uid(), name: "Clásico", vehicle_type: "Auto", allowed: "Pasajeros", base_fare: 900, per_km: 450, per_min: 40, min_fare: 1500, status: "active", sort: 1, created_at: now() },
        { id: uid(), name: "Business", vehicle_type: "Auto premium", allowed: "Pasajeros", base_fare: 1500, per_km: 650, per_min: 60, min_fare: 2500, status: "active", sort: 2, created_at: now() },
        { id: uid(), name: "Food delivery", vehicle_type: "Moto", allowed: "Mensajero", base_fare: 600, per_km: 300, per_min: 0, min_fare: 1000, status: "active", sort: 3, created_at: now() }
      ],
      drivers: [], operators: [], managers: [], customers: [], orders: [], crews: [],
      driver_plans: [], driver_levels: [], promotions: [], notifications: [], reports: [],
      billing: [], api_keys: [], webhooks: [], payment_gateways: [], ratings: []
    };
  }
  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || seed(); } catch (e) { return seed(); } }
  function save(db) { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {} }
  let mem = LIVE ? null : load();
  if (!LIVE) save(mem);

  function emit(table, type, row) {
    (listeners[table] || []).forEach(cb => cb({ type, row }));
    (listeners["*"] || []).forEach(cb => cb({ table, type, row }));
  }
  if (!LIVE) {
    const sync = (msg) => { mem = load(); emit(msg.table, msg.type, msg.row); };
    if (bc) bc.onmessage = e => sync(e.data);
    window.addEventListener("storage", e => { if (e.key === KEY) { mem = load(); emit("*", "refresh", null); } });
  }
  function localChanged(table, type, row) { save(mem); emit(table, type, row); if (bc) bc.postMessage({ table, type, row }); }

  function match(row, eq) { return !eq || Object.entries(eq).every(([k, v]) => row[k] === v); }

  const DB = {
    LIVE, sb, uid, now,
    async list(table, opt = {}) {
      if (LIVE) {
        let q = sb.from(table).select("*");
        if (opt.eq) for (const [k, v] of Object.entries(opt.eq)) q = q.eq(k, v);
        if (opt.in) for (const [k, v] of Object.entries(opt.in)) q = q.in(k, v);
        if (opt.since) q = q.gte(opt.sinceField || "created_at", opt.since);
        q = q.order(opt.order || "created_at", { ascending: !opt.desc });
        if (opt.limit) q = q.limit(opt.limit);
        const { data, error } = await q; if (error) throw error; return data;
      }
      mem = load();
      let rows = (mem[table] || []).filter(r => match(r, opt.eq));
      if (opt.in) rows = rows.filter(r => Object.entries(opt.in).every(([k, v]) => v.includes(r[k])));
      if (opt.since) rows = rows.filter(r => (r[opt.sinceField || "created_at"] || "") >= opt.since);
      const o = opt.order || "created_at";
      rows.sort((a, b) => (a[o] > b[o] ? 1 : a[o] < b[o] ? -1 : 0) * (opt.desc ? -1 : 1));
      return opt.limit ? rows.slice(0, opt.limit) : rows;
    },
    async get(table, id) {
      if (LIVE) { const { data, error } = await sb.from(table).select("*").eq("id", id).maybeSingle(); if (error) throw error; return data; }
      mem = load(); return (mem[table] || []).find(r => r.id === id) || null;
    },
    async insert(table, obj) {
      if (LIVE) { const { data, error } = await sb.from(table).insert(obj).select().single(); if (error) throw error; return data; }
      mem = load(); mem[table] = mem[table] || [];
      const row = { id: uid(), created_at: now(), ...obj };
      if (table === "orders") row.number = (mem.orders.reduce((m, o) => Math.max(m, o.number || 0), 1000)) + 1;
      mem[table].push(row); localChanged(table, "INSERT", row); return row;
    },
    async update(table, id, patch) {
      if (LIVE) { const { data, error } = await sb.from(table).update(patch).eq("id", id).select().single(); if (error) throw error; return data; }
      mem = load(); const r = (mem[table] || []).find(x => x.id === id); if (!r) return null;
      Object.assign(r, patch, { updated_at: now() }); localChanged(table, "UPDATE", r); return r;
    },
    async remove(table, id) {
      if (LIVE) { const { error } = await sb.from(table).delete().eq("id", id); if (error) throw error; return true; }
      mem = load(); mem[table] = (mem[table] || []).filter(r => r.id !== id); localChanged(table, "DELETE", { id }); return true;
    },
    on(table, cb) {
      (listeners[table] = listeners[table] || []).push(cb);
      if (LIVE && table !== "*") {
        sb.channel("rt-" + table + "-" + uid()).on("postgres_changes", { event: "*", schema: "public", table },
          p => cb({ type: p.eventType, row: p.new && Object.keys(p.new).length ? p.new : p.old })).subscribe();
      }
    },
    // Seguimiento público de un pedido (pasajero sin cuenta)
    async trackOrder(id) {
      if (LIVE) { const { data, error } = await sb.rpc("track_order", { p_id: id }); if (error) throw error; return data && data[0]; }
      return this.get("orders", id);
    },
    // Autenticación (solo en modo Supabase)
    auth: {
      async user() { if (!LIVE) return { email: "demo@rodar.local", demo: true }; const { data } = await sb.auth.getUser(); return data.user; },
      async signIn(email, password) { const { data, error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw error; return data.user; },
      async signUp(email, password) { const { data, error } = await sb.auth.signUp({ email, password }); if (error) throw error; return data.user; },
      async signOut() { if (LIVE) await sb.auth.signOut(); }
    },
    resetDemo() { if (!LIVE) { mem = seed(); localChanged("*", "refresh", null); } },
    exportAll() { return LIVE ? null : load(); },
    importAll(obj) { if (!LIVE) { mem = obj; localChanged("*", "refresh", null); } }
  };
  window.DB = DB;
})();
