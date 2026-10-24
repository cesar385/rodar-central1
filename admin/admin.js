// ============================================================
//  Panel de administración — todos los módulos
// ============================================================
const { $, esc, money, fdate, tag, toast, form, table } = UI;
const V = $("#view");
let company = null, charts = [], leafletMap = null;
const BASE = location.href.replace(/admin\/.*$/, "");
const URLS = { driver: BASE + "conductor/", operator: BASE + "operador/", web: BASE + "pasajero/" };

async function loadCompany() {
  const rows = await DB.list("company", { order: "id" });
  company = rows[0];
  if (!company) company = await DB.insert("company", { id: 1, name: "Rodar", currency: RODAR_CONFIG.CURRENCY, zone: [] });
  $("#brandName").textContent = company.name || "Rodar";
  document.title = (company.name || "Rodar") + " · Panel de control";
}
const saveCompany = async patch => { company = await DB.update("company", company.id, patch); toast("Guardado"); };

function cleanup() { charts.forEach(c => c.destroy()); charts = []; if (leafletMap) { leafletMap.remove(); leafletMap = null; } }
function head(title, actions = "", sub = "") {
  return `<div class="row" style="margin-bottom:14px"><div class="grow"><h1>${esc(title)}</h1>${sub ? `<p class="muted" style="margin:0">${sub}</p>` : ""}</div>${actions}</div>`;
}
function monthPicker(id = "month") {
  const d = new Date(); const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return `<input type="month" id="${id}" value="${v}" style="width:auto">`;
}

// ---------------------------------------------------- CRUD genérico
function crud(cfg) {
  return async () => {
    let filter = cfg.tabs ? cfg.tabs[0][0] : null;
    const draw = async () => {
      let rows = await DB.list(cfg.table, { eq: cfg.eq, order: cfg.order || "created_at", desc: !cfg.order });
      const all = rows;
      if (filter && filter !== "all") rows = rows.filter(r => r[cfg.tabKey || "status"] === filter);
      const q = ($("#q") || {}).value || "";
      if (q) rows = rows.filter(r => JSON.stringify(r).toLowerCase().includes(q.toLowerCase()));
      const tabs = cfg.tabs ? `<div class="tabs">${cfg.tabs.map(([k, l]) => `<button data-tab="${k}" class="${k === filter ? "on" : ""}">${l} (${k === "all" ? all.length : all.filter(r => r[cfg.tabKey || "status"] === k).length})</button>`).join("")}</div>` : "";
      $("#list").innerHTML = tabs + (all.length ? table(rows, cfg.cols, r => `<button class="btn sm sec" data-edit="${r.id}">Editar</button> ${r.protected ? "" : `<button class="btn sm ghost" data-del="${r.id}">Eliminar</button>`} ${cfg.extraAction ? cfg.extraAction(r) : ""}`)
        : `<div class="empty"><h3>${esc(cfg.emptyTitle || "Todavía no hay registros")}</h3><p>${cfg.emptyText || ""}</p><button class="btn" data-add>${esc(cfg.addLabel || "Agregar")}</button></div>`);
      $("#list").querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { filter = b.dataset.tab; draw(); });
      $("#list").querySelectorAll("[data-add]").forEach(b => b.onclick = add);
      $("#list").querySelectorAll("[data-edit]").forEach(b => b.onclick = async () => {
        const row = all.find(r => r.id === b.dataset.edit);
        const fields = typeof cfg.fields === "function" ? await cfg.fields() : cfg.fields;
        const v = await form({ title: "Editar", fields, values: row }); if (!v) return;
        await DB.update(cfg.table, row.id, cfg.before ? cfg.before(v) : v); toast("Actualizado"); draw();
      });
      $("#list").querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
        if (await UI.confirmBox("¿Eliminar este registro?")) { await DB.remove(cfg.table, b.dataset.del); draw(); }
      });
      if (cfg.after) cfg.after(all, draw);
    };
    const add = async () => {
      const fields = typeof cfg.fields === "function" ? await cfg.fields() : cfg.fields;
      const v = await form({ title: cfg.addLabel || "Agregar", fields, values: cfg.defaults || {} }); if (!v) return;
      await DB.insert(cfg.table, { ...(cfg.extra || {}), ...(cfg.before ? cfg.before(v) : v) }); toast("Creado"); draw();
    };
    V.innerHTML = head(cfg.title, `${cfg.headExtra || ""}<input id="q" placeholder="Buscar…" style="width:180px"><button class="btn" id="addBtn">${esc(cfg.addLabel || "Agregar")}</button>`, cfg.intro) + (cfg.top || "") + `<div class="card" id="list"></div>`;
    $("#addBtn").onclick = add; $("#q").oninput = draw;
    if (cfg.init) await cfg.init(draw);
    draw();
  };
}

const opts = async (tbl, label = "name") => [["", "—"], ...(await DB.list(tbl)).map(r => [r.id, r[label]])];
const nameOf = (list, id) => (list.find(x => x.id === id) || {}).name || "-";

// ---------------------------------------------------- Inicio
async function dashboard() {
  const [drivers, ops, orders] = await Promise.all([DB.list("drivers"), DB.list("operators"), DB.list("orders")]);
  const cnt = s => drivers.filter(d => d.status === s).length;
  const today = new Date().toISOString().slice(0, 10);
  const td = orders.filter(o => (o.created_at || "").startsWith(today));
  V.innerHTML = `
  <div class="grid g4" style="margin-bottom:14px">
    <a class="tile" style="background:#0f6fde" href="#guide"><b>¡Bienvenido a ${esc(company.name)}!</b><small>Guía de inicio</small></a>
    <a class="tile" style="background:#6741d9" href="${URLS.driver}" target="_blank"><b>App para conductores</b><small>Abrir ↗</small></a>
    <a class="tile" style="background:#1b2333" href="${URLS.operator}" target="_blank"><b>App para operadores</b><small>Abrir ↗</small></a>
    <a class="tile" style="background:#f59f00" href="${URLS.web}" target="_blank"><b>Aplicación web</b><small>Abrir ↗</small></a>
    <a class="tile" style="background:#12b886" href="#apis"><b>APIs para desarrolladores</b><small>Ver →</small></a>
  </div>
  <div class="banner" style="margin-bottom:14px"><h1>Tu central de viajes está lista</h1>
    <p>La app web para pasajeros, la app de conductores y la app de operadores ya funcionan conectadas a esta central. Configurá tus servicios, cargá conductores y empezá a despachar.</p>
    <a class="btn" href="#guide">Cómo usar el panel</a></div>
  <div class="grid g4" style="margin-bottom:14px">
    <div class="card"><div class="muted">Pedidos hoy</div><div class="stat">${td.length}</div></div>
    <div class="card"><div class="muted">Finalizados hoy</div><div class="stat">${td.filter(o => o.status === "completed").length}</div></div>
    <div class="card"><div class="muted">Facturado hoy</div><div class="stat">${money(td.filter(o => o.status === "completed").reduce((s, o) => s + (+o.price || 0), 0))}</div></div>
    <div class="card"><div class="muted">Conductores en línea</div><div class="stat">${drivers.filter(d => d.online).length}</div></div>
  </div>
  <div class="grid g2">
    <div class="card"><div class="row"><h2 class="grow">Conductores</h2><a href="#drivers">Ver todos</a></div>
      <div class="stat">${drivers.length}</div><table>${[["active", "Activo"], ["disabled", "Desactivado"], ["suspended", "Suspendido"], ["pending", "Activación en espera"], ["awaiting", "Esperando activación"], ["incomplete", "Registro incompleto"], ["rejected", "Rechazado"], ["invited", "Invitado"]].map(([k, l]) => `<tr><td>${l}</td><td style="text-align:right"><b>${cnt(k)}</b></td></tr>`).join("")}</table></div>
    <div class="card"><div class="row"><h2 class="grow">Operadores</h2><a href="#operators">Ver todos</a></div>
      <div class="stat">${ops.length}</div><table>${[["active", "Activo"], ["suspended", "Suspendido"], ["invited", "Invitado"]].map(([k, l]) => `<tr><td>${l}</td><td style="text-align:right"><b>${ops.filter(o => o.status === k).length}</b></td></tr>`).join("")}</table></div>
  </div>`;
}

function guide() {
  V.innerHTML = head("Cómo usar el panel") + `<div class="card"><ol style="line-height:1.9">
  <li><b>Configuración → Configuración</b>: nombre, teléfono, moneda, botón SOS.</li>
  <li><b>Configuración → Área operacional</b>: dibujá en el mapa la zona donde trabajás (los pedidos fuera de zona se rechazan).</li>
  <li><b>Servicios</b>: definí tarifas (bajada de bandera, $/km, $/min, mínimo) y el orden en que los ve el pasajero.</li>
  <li><b>Conductores → Planes</b>: comisión que cobra la central por viaje. Luego agregá <b>conductores</b> (su email es su usuario en la app).</li>
  <li><b>Operadores</b>: quiénes toman pedidos telefónicos desde la app de operador.</li>
  <li>Compartí la <b>app web</b> con tus clientes (QR en <a href="#apps">Aplicaciones</a>).</li>
  <li><b>Integración HubSpot</b>: sincronizá clientes y viajes con tu CRM.</li></ol></div>`;
}

// ---------------------------------------------------- Análisis
const AN = {
  gmv: ["Valor bruto de la mercancía (GMV)", "Suma del precio de los viajes finalizados por día."],
  revenue: ["Ingresos totales", "Comisión de la central según el plan de cada conductor (10 % si no tiene plan)."],
  statuses: ["Estados de pedidos", "Distribución de los pedidos del mes por estado."],
  "assigned-missed": ["Asignados vs. perdidos", "Pedidos tomados por un conductor contra pedidos sin conductor o cancelados."],
  "median-response": ["Tiempo de respuesta mediano", "Minutos entre la creación del pedido y la aceptación del conductor."],
  "response-waiting": ["Respuesta vs. espera", "Tiempo de respuesta promedio frente al tiempo de espera del pasajero (aceptado → en puerta)."],
  sources: ["Origen de las reservas", "Por dónde entran los pedidos: web, operador, API."],
  coupons: ["Cupones de referidos y descuentos", "Usos de cada código promocional."],
  pickups: ["Puntos de recogida", "Direcciones de origen más frecuentes y mapa."]
};
async function analytics(kind) {
  const [title, sub] = AN[kind] || AN.gmv;
  V.innerHTML = head(title, monthPicker(), sub) + `<div class="card"><canvas id="ch" height="110"></canvas><div id="extra"></div></div>`;
  const draw = async () => {
    cleanup();
    const [y, m] = $("#month").value.split("-").map(Number);
    const from = new Date(y, m - 1, 1), to = new Date(y, m, 1);
    const [all, drivers, plans] = await Promise.all([DB.list("orders", { since: from.toISOString() }), DB.list("drivers"), DB.list("driver_plans")]);
    const orders = all.filter(o => new Date(o.created_at) < to);
    const days = [...Array(new Date(y, m, 0).getDate())].map((_, i) => i + 1);
    const byDay = fn => days.map(d => fn(orders.filter(o => new Date(o.created_at).getDate() === d)));
    const mins = (a, b) => (new Date(b) - new Date(a)) / 60000;
    const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const h = s.length >> 1; return +(s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2).toFixed(1); };
    const avg = a => a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : 0;
    const comm = o => { const d = drivers.find(x => x.id === o.driver_id); const p = d && plans.find(x => x.id === d.plan_id); return (+o.price || 0) * ((p ? +p.commission_pct : 10) / 100) + (p ? +p.fee_fixed || 0 : 0); };
    const C = (type, labels, datasets, extra = {}) => charts.push(new Chart($("#ch"), { type, data: { labels, datasets }, options: { plugins: { legend: { display: datasets.length > 1 || type !== "bar" } }, ...extra } }));
    $("#extra").innerHTML = "";
    if (!orders.length) { $("#extra").innerHTML = `<div class="empty">No hay datos para este mes todavía</div>`; }
    const done = os => os.filter(o => o.status === "completed");
    if (kind === "gmv") C("bar", days, [{ label: "GMV", data: byDay(os => done(os).reduce((s, o) => s + (+o.price || 0), 0)), backgroundColor: "#0f6fde" }]);
    if (kind === "revenue") C("bar", days, [{ label: "Ingresos", data: byDay(os => Math.round(done(os).reduce((s, o) => s + comm(o), 0))), backgroundColor: "#12b886" }]);
    if (kind === "statuses") { const st = Object.keys(UI.STATUS).slice(0, 8); C("doughnut", st.map(s => UI.STATUS[s]), [{ data: st.map(s => orders.filter(o => o.status === s).length), backgroundColor: ["#f59f00", "#4dabf7", "#228be6", "#7950f2", "#15aabf", "#2f9e44", "#e03131", "#868e96"] }]); }
    if (kind === "assigned-missed") C("bar", days, [{ label: "Asignados", data: byDay(os => os.filter(o => o.driver_id).length), backgroundColor: "#0f6fde" }, { label: "Perdidos", data: byDay(os => os.filter(o => ["missed", "cancelled"].includes(o.status) && !o.driver_id).length), backgroundColor: "#e03131" }], { scales: { x: { stacked: true }, y: { stacked: true } } });
    if (kind === "median-response") C("line", days, [{ label: "Minutos", data: byDay(os => median(os.filter(o => o.accepted_at).map(o => mins(o.created_at, o.accepted_at)))), borderColor: "#0f6fde" }]);
    if (kind === "response-waiting") C("line", days, [{ label: "Respuesta (min)", data: byDay(os => avg(os.filter(o => o.accepted_at).map(o => mins(o.created_at, o.accepted_at)))), borderColor: "#0f6fde" }, { label: "Espera (min)", data: byDay(os => avg(os.filter(o => o.arrived_at && o.accepted_at).map(o => mins(o.accepted_at, o.arrived_at)))), borderColor: "#f59f00" }]);
    if (kind === "sources") { const s = ["web", "operator", "app", "api"]; C("pie", ["Web", "Operador", "App", "API"], [{ data: s.map(k => orders.filter(o => (o.source || "web") === k).length), backgroundColor: ["#0f6fde", "#1b2333", "#12b886", "#7950f2"] }]); }
    if (kind === "coupons") { const codes = [...new Set(orders.map(o => o.coupon).filter(Boolean))]; C("bar", codes.length ? codes : ["Sin cupones"], [{ label: "Usos", data: codes.map(c => orders.filter(o => o.coupon === c).length), backgroundColor: "#7950f2" }]); }
    if (kind === "pickups") {
      const top = Object.entries(orders.reduce((a, o) => (a[o.origin] = (a[o.origin] || 0) + 1, a), {})).sort((a, b) => b[1] - a[1]).slice(0, 10);
      C("bar", top.map(t => (t[0] || "").slice(0, 28)), [{ label: "Pedidos", data: top.map(t => t[1]), backgroundColor: "#0f6fde" }], { indexAxis: "y" });
      $("#extra").innerHTML += `<div id="pmap" class="map" style="margin-top:14px"></div>`;
      leafletMap = L.map("pmap").setView(RODAR_CONFIG.MAP_CENTER, RODAR_CONFIG.MAP_ZOOM);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap" }).addTo(leafletMap);
      orders.filter(o => o.origin_lat).forEach(o => L.circleMarker([o.origin_lat, o.origin_lng], { radius: 6, color: "#0f6fde", fillOpacity: .5 }).addTo(leafletMap).bindPopup(esc(o.origin)));
    }
  };
  $("#month").onchange = draw; draw();
}

// ---------------------------------------------------- Reportes
const REPORTS = {
  orders: { label: "Pedidos", table: "orders", cols: [{ k: "number", label: "N°" }, { k: "created_at", label: "Fecha" }, { k: "customer_name", label: "Cliente" }, { k: "customer_phone", label: "Teléfono" }, { k: "origin", label: "Origen" }, { k: "destination", label: "Destino" }, { k: "status", label: "Estado" }, { k: "source", label: "Origen reserva" }, { k: "price", label: "Precio" }, { k: "payment_method", label: "Pago" }] },
  drivers: { label: "Conductores", table: "drivers", cols: [{ k: "name", label: "Nombre" }, { k: "phone", label: "Teléfono" }, { k: "email", label: "Email" }, { k: "vehicle", label: "Vehículo" }, { k: "plate", label: "Patente" }, { k: "status", label: "Estado" }, { k: "trips", label: "Viajes" }, { k: "rating", label: "Calificación" }] },
  earnings: { label: "Ganancias por conductor", table: "orders" },
  billing: { label: "Facturación", table: "billing", cols: [{ k: "created_at", label: "Fecha" }, { k: "concept", label: "Concepto" }, { k: "amount", label: "Monto" }] }
};
async function runReport(r) {
  const rep = REPORTS[r.type];
  let rows = await DB.list(rep.table, { since: r.date_from ? new Date(r.date_from).toISOString() : undefined });
  if (r.date_to) rows = rows.filter(x => x.created_at <= r.date_to + "T23:59:59");
  if (r.type === "earnings") {
    const ds = await DB.list("drivers");
    const done = rows.filter(o => o.status === "completed");
    rows = ds.map(d => { const os = done.filter(o => o.driver_id === d.id); return { name: d.name, trips: os.length, total: os.reduce((s, o) => s + (+o.price || 0), 0) }; });
    return UI.csv(rows, [{ k: "name", label: "Conductor" }, { k: "trips", label: "Viajes" }, { k: "total", label: "Total" }]);
  }
  if (r.type === "drivers") { const os = await DB.list("orders"); rows.forEach(d => d.trips = os.filter(o => o.driver_id === d.id && o.status === "completed").length); }
  return UI.csv(rows, rep.cols);
}
const reports = crud({
  table: "reports", title: "Reportes", addLabel: "Agregar reporte", emptyTitle: "Aún no tenés ningún informe",
  emptyText: "Generá tu primer informe para hacer el seguimiento y administrar los datos de tu empresa.",
  cols: [{ k: "name", label: "Nombre" }, { k: "type", label: "Tipo", fmt: v => REPORTS[v]?.label || v }, { k: "date_from", label: "Desde" }, { k: "date_to", label: "Hasta" }, { k: "created_at", label: "Creado", fmt: fdate }],
  fields: [{ name: "name", label: "Nombre", required: true }, { name: "type", label: "Tipo", type: "select", options: Object.entries(REPORTS).map(([k, v]) => [k, v.label]) }, { name: "date_from", label: "Desde", type: "date" }, { name: "date_to", label: "Hasta", type: "date" }],
  extraAction: r => `<button class="btn sm" data-dl="${r.id}">CSV</button>`,
  after: rows => document.querySelectorAll("[data-dl]").forEach(b => b.onclick = async () => { const r = rows.find(x => x.id === b.dataset.dl); UI.download(`${r.name}.csv`, await runReport(r)); })
});

// ---------------------------------------------------- Historial de pedidos
async function orders(kind) {
  const label = { customers: "Clientes", drivers: "Conductores", all: "Todos los pedidos" }[kind];
  const [svcs, drivers] = await Promise.all([DB.list("services"), DB.list("drivers")]);
  V.innerHTML = head(label, kind === "all" ? `<select id="st" style="width:auto"><option value="">Todos los estados</option>${Object.entries(UI.STATUS).slice(0, 8).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>` : "") +
    `<div class="card"><label>Buscar órdenes por número de teléfono</label><div class="row"><input id="ph" placeholder="+5493454000000" class="grow" style="width:auto"><button class="btn" id="go">Buscar</button></div>
    <p class="muted">Usá el formato internacional completo, por ejemplo +5493454123456. ${kind === "all" ? "Dejalo vacío para ver todos." : ""}</p><div id="res"></div></div>`;
  const run = async () => {
    const ph = $("#ph").value.replace(/\s/g, "");
    let rows = await DB.list("orders", { desc: true, limit: 500 });
    if (kind === "customers" && ph) rows = rows.filter(o => (o.customer_phone || "").replace(/\s/g, "").includes(ph));
    if (kind === "drivers" && ph) { const ids = drivers.filter(d => (d.phone || "").replace(/\s/g, "").includes(ph)).map(d => d.id); rows = rows.filter(o => ids.includes(o.driver_id)); }
    if (kind !== "all" && !ph) rows = [];
    if ($("#st") && $("#st").value) rows = rows.filter(o => o.status === $("#st").value);
    $("#res").innerHTML = (kind !== "all" && !ph) ? "" : table(rows, [
      { k: "number", label: "N°" }, { k: "created_at", label: "Fecha", fmt: fdate }, { k: "customer_name", label: "Cliente", fmt: (v, r) => `${esc(v || "-")}<br><small class="muted">${esc(r.customer_phone || "")}</small>` },
      { k: "origin", label: "Origen → Destino", fmt: (v, r) => `${esc(v || "-")}<br><small class="muted">→ ${esc(r.destination || "-")}</small>` },
      { k: "service_id", label: "Servicio", fmt: v => esc(nameOf(svcs, v)) }, { k: "driver_id", label: "Conductor", fmt: v => esc(nameOf(drivers, v)) },
      { k: "status", label: "Estado", fmt: tag }, { k: "price", label: "Precio", fmt: money }]);
  };
  $("#go").onclick = run; $("#ph").onkeydown = e => e.key === "Enter" && run(); if ($("#st")) $("#st").onchange = run;
  if (kind === "all") run();
}

// ---------------------------------------------------- Conductores
const DRIVER_STATUS = [["active", "Activo"], ["disabled", "Desactivado"], ["suspended", "Suspendido"], ["pending", "Activación en espera"], ["awaiting", "Esperando activación"], ["incomplete", "Registro incompleto"], ["rejected", "Rechazado"], ["invited", "Invitado"]];
let _cache = {};
const drivers = crud({
  table: "drivers", title: "Administrar conductores", addLabel: "Añadir conductor",
  emptyTitle: "No tenés ningún conductor en esta empresa", emptyText: "Invitá a los conductores para empezar a administrarlos. Su email será su usuario en la app de conductores.",
  tabs: [["all", "Todos"], ...DRIVER_STATUS],
  init: async () => { _cache.plans = await DB.list("driver_plans"); _cache.svcs = await DB.list("services"); },
  cols: [{ k: "name", label: "Nombre" }, { k: "phone", label: "Teléfono" }, { k: "vehicle", label: "Vehículo", fmt: (v, r) => `${esc(v || "-")} <small class="muted">${esc(r.plate || "")}</small>` },
    { k: "plan_id", label: "Plan", fmt: v => esc(nameOf(_cache.plans || [], v)) }, { k: "online", label: "Conexión", fmt: v => tag(v ? "online" : "offline") },
    { k: "balance", label: "Saldo", fmt: money }, { k: "status", label: "Estado", fmt: tag }],
  fields: async () => [
    { name: "name", label: "Nombre y apellido", required: true }, { name: "phone", label: "Teléfono" }, { name: "email", label: "Email (usuario de la app)", type: "email" },
    { name: "dni", label: "DNI" }, { name: "license", label: "Licencia de conducir" },
    { name: "vehicle", label: "Vehículo (marca y modelo)" }, { name: "plate", label: "Patente" }, { name: "color", label: "Color" },
    { name: "service_id", label: "Servicio", type: "select", options: await opts("services") },
    { name: "plan_id", label: "Plan de suscripción", type: "select", options: await opts("driver_plans") },
    { name: "crew_id", label: "Equipo", type: "select", options: await opts("crews") },
    { name: "status", label: "Estado", type: "select", options: DRIVER_STATUS }],
  defaults: { status: "invited" }, extra: { online: false, balance: 0, rating: 5 }
});
const driverPlans = crud({
  table: "driver_plans", title: "Planes de suscripción para conductores", addLabel: "Agregar plan",
  emptyTitle: "No se agregaron planes de suscripción", emptyText: "Los planes determinan la comisión que la central cobra por cada viaje aceptado.",
  cols: [{ k: "name", label: "Nombre" }, { k: "commission_pct", label: "Comisión %", fmt: v => (v ?? 0) + " %" }, { k: "fee_fixed", label: "Cargo fijo/viaje", fmt: money }, { k: "daily_base", label: "Base diaria", fmt: money }, { k: "description", label: "Descripción" }],
  fields: [{ name: "name", label: "Nombre", required: true }, { name: "commission_pct", label: "Comisión por viaje (%)", type: "number", value: 10 }, { name: "fee_fixed", label: "Cargo fijo por viaje", type: "number", value: 0 }, { name: "daily_base", label: "Base diaria (se paga de 00:00 a 23:59)", type: "number", value: 0 }, { name: "description", label: "Descripción", type: "textarea" }]
});
async function driverLevels() {
  if (!company.levels_enabled) {
    V.innerHTML = head("Niveles de conductores") + `<div class="card empty"><h3>Los niveles de conductores están deshabilitados</h3><p>Los niveles transfieren automáticamente a los conductores de un plan al siguiente según viajes y calificación. Automatiza el proceso y lo hace claro para los conductores.</p><button class="btn" id="en">Habilitar niveles de conductores</button></div>`;
    $("#en").onclick = async () => { await saveCompany({ levels_enabled: true }); driverLevels(); }; return;
  }
  await crud({
    table: "driver_levels", title: "Niveles de conductores", addLabel: "Agregar nivel", order: "min_trips",
    headExtra: `<button class="btn ghost" id="dis">Deshabilitar</button><button class="btn sec" id="apply">Aplicar ahora</button>`,
    cols: [{ k: "name", label: "Nivel" }, { k: "min_trips", label: "Viajes mínimos" }, { k: "min_rating", label: "Calificación mínima" }, { k: "plan_id", label: "Plan asignado", fmt: v => esc(nameOf(_cache.plans || [], v)) }],
    init: async () => { _cache.plans = await DB.list("driver_plans"); },
    fields: async () => [{ name: "name", label: "Nombre", required: true }, { name: "min_trips", label: "Viajes finalizados mínimos", type: "number" }, { name: "min_rating", label: "Calificación mínima (1-5)", type: "number" }, { name: "plan_id", label: "Plan", type: "select", options: await opts("driver_plans") }]
  })();
  $("#dis").onclick = async () => { await saveCompany({ levels_enabled: false }); driverLevels(); };
  $("#apply").onclick = async () => {
    const [lv, ds, os] = await Promise.all([DB.list("driver_levels", { order: "min_trips" }), DB.list("drivers"), DB.list("orders", { eq: { status: "completed" } })]);
    let n = 0;
    for (const d of ds) {
      const trips = os.filter(o => o.driver_id === d.id).length;
      const best = lv.filter(l => trips >= (+l.min_trips || 0) && (+d.rating || 5) >= (+l.min_rating || 0)).pop();
      if (best && best.plan_id && best.plan_id !== d.plan_id) { await DB.update("drivers", d.id, { plan_id: best.plan_id, level: best.name }); n++; }
    }
    toast(`${n} conductores cambiaron de nivel`);
  };
}

// ---------------------------------------------------- Equipo
const operators = crud({
  table: "operators", title: "Operadores", addLabel: "Agregar operador", tabs: [["all", "Todos"], ["active", "Activo"], ["suspended", "Suspendido"], ["invited", "Invitado"]],
  cols: [{ k: "name", label: "Nombre" }, { k: "email", label: "Email" }, { k: "status", label: "Estado", fmt: tag }, { k: "access", label: "Tipo de acceso", fmt: v => v === "limited" ? "Acceso limitado" : "Acceso completo" }, { k: "extension", label: "# de extensión" }],
  fields: [{ name: "name", label: "Nombre", required: true }, { name: "email", label: "Email (usuario de la app de operador)", type: "email", required: true }, { name: "status", label: "Estado", type: "select", options: [["active", "Activo"], ["suspended", "Suspendido"], ["invited", "Invitado"]] }, { name: "access", label: "Tipo de acceso", type: "select", options: [["full", "Acceso completo"], ["limited", "Acceso limitado (solo crear pedidos)"]] }, { name: "extension", label: "# de extensión telefónica" }],
  defaults: { status: "active", access: "full" }
});
const users = crud({
  table: "managers", title: "Usuarios", addLabel: "Agregar un usuario", intro: "Personas con acceso a este panel de administración.", tabs: [["all", "Todos"], ["active", "Activo"], ["suspended", "Suspendido"]],
  cols: [{ k: "name", label: "Nombre" }, { k: "email", label: "Email" }, { k: "status", label: "Estado", fmt: tag }, { k: "protected", label: "Protección", fmt: v => v ? "Protegido" : "-" }],
  fields: [{ name: "name", label: "Nombre", required: true }, { name: "email", label: "Email", type: "email", required: true }, { name: "status", label: "Estado", type: "select", options: [["active", "Activo"], ["suspended", "Suspendido"]] }],
  defaults: { status: "active" }, extra: { protected: false }
});
const services = crud({
  table: "services", title: "Servicios", addLabel: "Agregar servicio", order: "sort",
  intro: "El orden (número) define cómo aparecen los tipos de servicio en la app del cliente.",
  tabs: [["all", "Todos"], ["active", "Activo"], ["disabled", "Desactivado"]],
  init: async () => { _cache.drivers = await DB.list("drivers"); },
  cols: [{ k: "sort", label: "Orden" }, { k: "name", label: "Nombre" }, { k: "vehicle_type", label: "Tipo de vehículo" }, { k: "allowed", label: "Tipos de servicio permitidos" },
    { k: "base_fare", label: "Tarifa", fmt: (v, r) => `${money(v)} + ${money(r.per_km)}/km<br><small class="muted">mín. ${money(r.min_fare)}</small>` },
    { k: "id", label: "Conductores", fmt: v => (_cache.drivers || []).filter(d => d.service_id === v).length }, { k: "status", label: "Estado", fmt: tag }],
  fields: [{ name: "name", label: "Nombre", required: true }, { name: "vehicle_type", label: "Tipo de vehículo" }, { name: "allowed", label: "Tipo", type: "select", options: ["Pasajeros", "Mensajero", "Carga"] },
    { name: "base_fare", label: "Bajada de bandera", type: "number" }, { name: "per_km", label: "Precio por km", type: "number" }, { name: "per_min", label: "Precio por minuto", type: "number" }, { name: "min_fare", label: "Tarifa mínima", type: "number" },
    { name: "sort", label: "Orden en la app", type: "number" }, { name: "status", label: "Estado", type: "select", options: [["active", "Activo"], ["disabled", "Desactivado"]] }],
  defaults: { status: "active", allowed: "Pasajeros", sort: 9 }
});
const crews = crud({
  table: "crews", title: "Equipos de conductores", addLabel: "Agregar equipo", intro: "Agrupá conductores (por turno, zona o flota) para filtrarlos al despachar.",
  init: async () => { _cache.drivers = await DB.list("drivers"); },
  cols: [{ k: "name", label: "Equipo" }, { k: "description", label: "Descripción" }, { k: "id", label: "Conductores", fmt: v => (_cache.drivers || []).filter(d => d.crew_id === v).map(d => esc(d.name)).join(", ") || "-" }],
  fields: [{ name: "name", label: "Nombre", required: true }, { name: "description", label: "Descripción", type: "textarea" }]
});

// ---------------------------------------------------- Promociones
const PROMO = { referral: "Programas de referidos", discount: "Programas de descuento", topup: "Cupones de recarga" };
const promos = kind => crud({
  table: "promotions", eq: { type: kind }, extra: { type: kind, used: 0 }, title: PROMO[kind], addLabel: "Crear programa",
  intro: { referral: "El cliente comparte su código; quien lo usa obtiene un descuento y el que refiere un crédito.", discount: "Códigos de descuento para el pasajero (porcentaje o monto fijo).", topup: "Cupones que suman saldo a la cuenta del conductor o del pasajero." }[kind],
  cols: [{ k: "name", label: "Nombre" }, { k: "code", label: "Código", fmt: v => `<code>${esc(v)}</code>` }, { k: "value", label: "Valor", fmt: (v, r) => r.value_type === "percent" ? v + " %" : money(v) }, { k: "used", label: "Usos", fmt: (v, r) => `${v || 0}${r.max_uses ? " / " + r.max_uses : ""}` }, { k: "valid_to", label: "Vence" }, { k: "active", label: "Estado", fmt: v => tag(v ? "active" : "disabled") }],
  fields: [{ name: "name", label: "Nombre", required: true }, { name: "code", label: "Código", required: true }, { name: "value_type", label: "Tipo de valor", type: "select", options: [["percent", "Porcentaje"], ["amount", "Monto fijo"]] }, { name: "value", label: "Valor", type: "number", required: true }, { name: "max_uses", label: "Usos máximos (vacío = ilimitado)", type: "number" }, { name: "valid_to", label: "Válido hasta", type: "date" }, { name: "active", label: "Activo", type: "checkbox", value: true }],
  before: v => ({ ...v, code: v.code.toUpperCase().trim() })
});

// ---------------------------------------------------- Notificaciones
const notifications = crud({
  table: "notifications", title: "Notificaciones de la aplicación", addLabel: "Crear notificación",
  emptyTitle: "Aún no creaste ninguna notificación", emptyText: "Usalas para compartir novedades, promociones e información en tiempo real con clientes y conductores.",
  cols: [{ k: "title", label: "Título" }, { k: "body", label: "Mensaje" }, { k: "audience", label: "Destinatarios", fmt: v => ({ customers: "Clientes", drivers: "Conductores", all: "Todos" }[v]) }, { k: "sent_at", label: "Enviada", fmt: v => v ? fdate(v) : `<span class="tag pending">Borrador</span>` }],
  fields: [{ name: "title", label: "Título", required: true }, { name: "body", label: "Mensaje", type: "textarea" }, { name: "audience", label: "Destinatarios", type: "select", options: [["all", "Todos"], ["customers", "Clientes"], ["drivers", "Conductores"]] }],
  extraAction: r => r.sent_at ? "" : `<button class="btn sm ok" data-send="${r.id}">Enviar</button>`,
  after: (rows, draw) => document.querySelectorAll("[data-send]").forEach(b => b.onclick = async () => { await DB.update("notifications", b.dataset.send, { sent_at: DB.now() }); toast("Enviada a las apps"); draw(); })
});

// ---------------------------------------------------- Marketing / Apps / APIs
function qr(el, text) { el.innerHTML = ""; try { new QRCode(el, { text, width: 140, height: 140 }); } catch (e) { el.textContent = text; } }
function marketing() {
  V.innerHTML = head("Servicios de marketing", "", "Herramientas para conseguir más pasajeros y conductores.") + `<div class="grid g2">
  <div class="card"><h2>Afiche con QR para pasajeros</h2><p class="muted">Imprimilo y pegalo en comercios, el hospital o la terminal.</p><div id="q1"></div><p><code>${esc(URLS.web)}</code></p><button class="btn" onclick="window.print()">Imprimir</button></div>
  <div class="card"><h2>Reclutamiento de conductores</h2><p class="muted">Compartí este enlace por WhatsApp para que se registren.</p><div id="q2"></div>
    <a class="btn ok" target="_blank" href="https://wa.me/?text=${encodeURIComponent("Sumate como conductor de " + company.name + ": " + URLS.driver)}">Compartir por WhatsApp</a></div>
  <div class="card"><h2>Campaña por notificación</h2><p class="muted">Enviá un aviso a todos los clientes con un código de descuento.</p><a class="btn sec" href="#promos/discount">Crear código</a> <a class="btn sec" href="#notifications">Crear notificación</a></div>
  <div class="card"><h2>CRM y email marketing</h2><p class="muted">Sincronizá clientes y viajes con HubSpot para armar listas y campañas.</p><a class="btn" href="#hubspot">Configurar HubSpot</a></div></div>`;
  qr($("#q1"), URLS.web); qr($("#q2"), URLS.driver);
}
function apps() {
  const card = (t, d, u, id) => `<div class="card"><h2>${t}</h2><p class="muted">${d}</p><div id="${id}"></div><p><a class="btn" href="${u}" target="_blank">Abrir aplicación</a></p><small class="muted">${esc(u)}</small></div>`;
  V.innerHTML = head("Aplicaciones y servicios", "", "Todas son gratuitas e instalables en el celular (Agregar a pantalla de inicio).") + `<div class="grid g2">
    ${card("Aplicación para conductores", "Reciben pedidos, aceptan, navegan y finalizan viajes. Ingresan con el email cargado en Conductores.", URLS.driver, "qa")}
    ${card("Aplicación para operadores", "Toma de pedidos telefónicos, mapa en vivo y asignación manual o automática.", URLS.operator, "qb")}
    ${card("Aplicación web (pasajeros)", "Tus clientes piden desde el navegador del celular o la computadora, sin descargar nada.", URLS.web, "qc")}
    <div class="card"><h2>Panel de administración</h2><p class="muted">Este panel.</p><small class="muted">${esc(location.href.split("#")[0])}</small></div></div>`;
  qr($("#qa"), URLS.driver); qr($("#qb"), URLS.operator); qr($("#qc"), URLS.web);
}
async function apis() {
  const key = () => "rk_" + [...crypto.getRandomValues(new Uint8Array(18))].map(b => b.toString(16).padStart(2, "0")).join("");
  await crud({
    table: "api_keys", title: "APIs para desarrolladores", addLabel: "Generar clave",
    intro: "Claves para integrar otros sistemas. En producción la API es la REST de Supabase (ver abajo).",
    cols: [{ k: "name", label: "Nombre" }, { k: "key", label: "Clave", fmt: v => `<code>${esc(v)}</code>` }, { k: "created_at", label: "Creada", fmt: fdate }],
    fields: [{ name: "name", label: "Nombre de la integración", required: true }], before: v => ({ ...v, key: key() }),
    top: `<div class="card" style="margin-bottom:14px"><h2>Endpoints</h2><pre style="white-space:pre-wrap;font-size:12px">Crear pedido:   POST ${esc(RODAR_CONFIG.SUPABASE_URL || "https://TU-PROYECTO.supabase.co")}/rest/v1/orders
Headers:        apikey: &lt;anon key&gt;   Content-Type: application/json
Body:           {"customer_name":"Ana","customer_phone":"+549345...","origin":"San Martín 100","destination":"Hospital","source":"api"}
Consultar:      GET  .../rest/v1/rpc/track_order?p_id=&lt;uuid&gt;
Tiempo real:    canal postgres_changes sobre la tabla "orders"</pre></div>
    <div class="card" style="margin-bottom:14px"><div class="row"><h2 class="grow">Webhooks</h2><button class="btn sm" id="addWh">Agregar webhook</button></div><div id="wh"></div><p class="muted">Se configuran en Supabase → Database → Webhooks (ver README). Acá queda el registro.</p></div>`
  })();
  const drawWh = async () => { $("#wh").innerHTML = table(await DB.list("webhooks"), [{ k: "url", label: "URL" }, { k: "events", label: "Eventos" }]); };
  $("#addWh").onclick = async () => { const v = await form({ title: "Webhook", fields: [{ name: "url", label: "URL", required: true }, { name: "events", label: "Eventos", value: "orders.insert, orders.update" }] }); if (v) { await DB.insert("webhooks", v); drawWh(); } };
  drawWh();
}

// ---------------------------------------------------- HubSpot
async function hubspot() {
  const fn = RODAR_CONFIG.HUBSPOT_FUNCTION || (RODAR_CONFIG.SUPABASE_URL ? RODAR_CONFIG.SUPABASE_URL + "/functions/v1/hubspot-sync" : "");
  V.innerHTML = head("Integración HubSpot", "", "Clientes → Contactos · Viajes → Negocios (Deals) asociados al contacto.") + `<div class="grid g2">
  <div class="card"><h2>Sincronización automática</h2>
    <p>Estado: ${DB.LIVE && fn ? `<span class="tag active">Supabase conectado</span>` : `<span class="tag pending">Modo demo — usá la exportación CSV</span>`}</p>
    <p class="muted">Con la Edge Function <code>hubspot-sync</code> desplegada y el webhook de base de datos activo, cada pedido nuevo o actualizado se envía solo a HubSpot.</p>
    <button class="btn" id="full" ${DB.LIVE && fn ? "" : "disabled"}>Sincronizar todo ahora</button> <button class="btn ghost" id="test" ${DB.LIVE && fn ? "" : "disabled"}>Probar conexión</button><pre id="out" class="muted" style="white-space:pre-wrap"></pre></div>
  <div class="card"><h2>Importación manual (CSV)</h2><p class="muted">HubSpot → Contactos → Importar → "Archivo desde la computadora". Primero contactos, después negocios.</p>
    <button class="btn sec" id="c1">Descargar contactos.csv</button> <button class="btn sec" id="c2">Descargar negocios.csv</button></div></div>`;
  const call = async body => {
    const { data: { session } } = await DB.sb.auth.getSession();
    const r = await fetch(fn, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (session?.access_token || RODAR_CONFIG.SUPABASE_ANON_KEY), apikey: RODAR_CONFIG.SUPABASE_ANON_KEY }, body: JSON.stringify(body) });
    $("#out").textContent = await r.text();
  };
  $("#full").onclick = () => call({ action: "full_sync" });
  $("#test").onclick = () => call({ action: "ping" });
  const [os, cs] = [await DB.list("orders"), await DB.list("customers")];
  const split = n => { const p = (n || "").trim().split(/\s+/); return [p[0] || "", p.slice(1).join(" ")]; };
  const contacts = new Map();
  cs.forEach(c => contacts.set(c.phone, { name: c.name, phone: c.phone, email: c.email || "" }));
  os.forEach(o => o.customer_phone && !contacts.has(o.customer_phone) && contacts.set(o.customer_phone, { name: o.customer_name, phone: o.customer_phone, email: o.customer_email || "" }));
  $("#c1").onclick = () => UI.download("contactos.csv", UI.csv([...contacts.values()], [{ label: "First Name", get: r => split(r.name)[0] }, { label: "Last Name", get: r => split(r.name)[1] }, { label: "Phone Number", k: "phone" }, { label: "Email", k: "email" }, { label: "Lead Status", get: () => "NEW" }]));
  const stage = s => s === "completed" ? "closedwon" : ["cancelled", "missed"].includes(s) ? "closedlost" : "appointmentscheduled";
  $("#c2").onclick = () => UI.download("negocios.csv", UI.csv(os, [{ label: "Deal Name", get: o => `Viaje #${o.number} ${o.origin || ""} → ${o.destination || ""}` }, { label: "Amount", k: "price" }, { label: "Deal Stage", get: o => stage(o.status) }, { label: "Pipeline", get: () => "default" }, { label: "Close Date", get: o => (o.completed_at || o.created_at || "").slice(0, 10) }, { label: "Phone Number", k: "customer_phone" }]));
}

// ---------------------------------------------------- Facturación
async function balance() {
  const [os, ds] = await Promise.all([DB.list("orders", { since: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString() }), DB.list("drivers")]);
  V.innerHTML = head("Plan y saldo") + `<div class="grid g2">
  <div class="card"><h2>Plan</h2><div class="stat">${esc(company.plan || "Gratis")}</div><p class="muted">Sin límite de conductores ni pedidos.</p>
    <table><tr><td>Pedidos este mes</td><td><b>${os.length}</b></td></tr><tr><td>Conductores</td><td><b>${ds.length}</b></td></tr><tr><td>Límite total de conductores</td><td><b>Ilimitado</b></td></tr></table></div>
  <div class="card"><h2>Saldo de la central</h2><div class="stat">${money(company.balance)}</div><p class="muted">Se usa para registrar cobros a conductores (bases diarias, comisiones) y pagos.</p>
    <div class="row"><button class="btn" id="top">Registrar ingreso</button><button class="btn ghost" id="out">Registrar egreso</button></div>
    <label><input type="checkbox" id="auto" style="width:auto" ${company.auto_topup ? "checked" : ""}> Cobrar comisión automáticamente al finalizar cada viaje</label></div></div>`;
  const mov = async sign => { const v = await form({ title: sign > 0 ? "Ingreso" : "Egreso", fields: [{ name: "concept", label: "Concepto", required: true }, { name: "amount", label: "Monto", type: "number", required: true }] }); if (!v) return;
    await DB.insert("billing", { concept: v.concept, amount: sign * Math.abs(v.amount) }); await saveCompany({ balance: (+company.balance || 0) + sign * Math.abs(v.amount) }); balance(); };
  $("#top").onclick = () => mov(1); $("#out").onclick = () => mov(-1);
  $("#auto").onchange = e => saveCompany({ auto_topup: e.target.checked });
}
async function billing() {
  V.innerHTML = head("Historial de facturación", `<input type="date" id="d1" style="width:auto"><input type="date" id="d2" style="width:auto"><button class="btn sec" id="csv">CSV</button>`) + `<div class="card" id="res"></div>`;
  const draw = async () => {
    let rows = await DB.list("billing", { desc: true });
    if ($("#d1").value) rows = rows.filter(r => r.created_at >= $("#d1").value);
    if ($("#d2").value) rows = rows.filter(r => r.created_at <= $("#d2").value + "T23:59:59");
    $("#res").innerHTML = table(rows, [{ k: "created_at", label: "Fecha", fmt: fdate }, { k: "concept", label: "Concepto" }, { k: "amount", label: "Monto", fmt: money }]);
    $("#csv").onclick = () => UI.download("facturacion.csv", UI.csv(rows, REPORTS.billing.cols));
  };
  $("#d1").onchange = $("#d2").onchange = draw; draw();
}

// ---------------------------------------------------- Configuración
async function settings() {
  const c = company;
  V.innerHTML = head(c.name || "Configuración", `<button class="btn" id="edit">Editar la configuración</button>`) + `<div class="grid g2">
  <div class="card"><h2>Información</h2><table>
    <tr><td>Email de la compañía</td><td>${esc(c.email || "-")}</td></tr><tr><td>Teléfono de la compañía</td><td>${esc(c.phone || "-")}</td></tr>
    <tr><td>Licencia / habilitación</td><td>${esc(c.driver_license || "-")}</td></tr></table></div>
  <div class="card"><h2>Configuración general</h2><table>
    <tr><td>Idioma</td><td>${esc(c.language || "es")}</td></tr><tr><td>Medición</td><td>${c.units === "imperial" ? "Imperial" : "Métrico"}</td></tr>
    <tr><td>Moneda</td><td>${esc(c.currency)}</td></tr><tr><td>Zona horaria</td><td>${esc(c.timezone)}</td></tr>
    <tr><td>Grado de precisión (redondeo de precios)</td><td>${c.precision ?? 0}</td></tr>
    <tr><td>Ocultar precisión al conductor / cliente</td><td>${c.hide_precision_driver ? "Sí" : "No"} / ${c.hide_precision_client ? "Sí" : "No"}</td></tr></table></div>
  <div class="card"><h2>Botón SOS</h2><p>Número de contacto en caso de emergencia: <b>${esc(c.sos_phone || "-")}</b></p></div>
  <div class="card"><h2>Configuración avanzada</h2><table>
    <tr><td>No proveer servicio a viajeros</td><td>${c.no_travelers ? "Sí" : "No"}</td></tr>
    <tr><td>Redacción no jurídica en el resumen</td><td>${c.plain_summary ? "Sí" : "No"}</td></tr>
    <tr><td>Alerta cuando el GPS del conductor se detiene</td><td>${c.geo_alert ? "Sí, a los " + (c.geo_alert_minutes || 10) + " min" : "No"}</td></tr>
    <tr><td>Mensaje</td><td>${esc(c.geo_alert_text || "")}</td></tr></table></div></div>`;
  $("#edit").onclick = async () => {
    const v = await form({ title: "Editar configuración", values: c, fields: [
      { name: "name", label: "Nombre de la compañía", required: true }, { name: "email", label: "Email", type: "email" }, { name: "phone", label: "Teléfono" }, { name: "driver_license", label: "Licencia / habilitación municipal" },
      { name: "language", label: "Idioma", type: "select", options: [["es", "Español"], ["en", "English"], ["pt", "Português"]] }, { name: "units", label: "Medición", type: "select", options: [["metric", "Métrico"], ["imperial", "Imperial"]] },
      { name: "currency", label: "Moneda", type: "select", options: ["ARS", "USD", "UYU", "BRL", "CLP"] }, { name: "timezone", label: "Zona horaria" },
      { name: "precision", label: "Grado de precisión (múltiplo de redondeo, 0 = sin redondeo)", type: "number" },
      { name: "hide_precision_driver", label: "Ocultar el grado de precisión al conductor", type: "checkbox" }, { name: "hide_precision_client", label: "Ocultar el grado de precisión al cliente", type: "checkbox" },
      { name: "sos_phone", label: "Número SOS" }, { name: "no_travelers", label: "No proveer servicio a viajeros", type: "checkbox" }, { name: "plain_summary", label: "Redacción no jurídica en el resumen del pedido", type: "checkbox" },
      { name: "geo_alert", label: "Notificar cuando se detienen las actualizaciones GPS del conductor", type: "checkbox" }, { name: "geo_alert_minutes", label: "Minutos de demora antes de notificar", type: "number" }, { name: "geo_alert_text", label: "Mensaje", type: "textarea" }] });
    if (v) { await saveCompany(v); settings(); }
  };
}
async function zone() {
  V.innerHTML = head("Área operacional", `<button class="btn ghost" id="clr">Borrar</button><button class="btn" id="sv">Guardar</button>`, "Hacé clic en el mapa para marcar los vértices del área. Los pedidos fuera de esta zona no se aceptan.") + `<div class="card"><div id="zmap" class="map" style="height:520px"></div></div>`;
  let pts = [...(company.zone || [])];
  leafletMap = L.map("zmap").setView(pts[0] || RODAR_CONFIG.MAP_CENTER, RODAR_CONFIG.MAP_ZOOM);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap" }).addTo(leafletMap);
  const poly = L.polygon(pts, { color: "#0f6fde" }).addTo(leafletMap);
  if (pts.length > 2) leafletMap.fitBounds(poly.getBounds());
  leafletMap.on("click", e => { pts.push([+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6)]); poly.setLatLngs(pts); });
  $("#clr").onclick = () => { pts = []; poly.setLatLngs(pts); };
  $("#sv").onclick = () => saveCompany({ zone: pts });
}
const gateways = crud({
  table: "payment_gateways", title: "Pasarelas de pago", addLabel: "Agregar pasarela", intro: "Medios de pago que verá el pasajero. Las claves privadas NUNCA van acá: se guardan como secretos en Supabase.",
  cols: [{ k: "provider", label: "Proveedor" }, { k: "label", label: "Nombre visible" }, { k: "public_key", label: "Clave pública", fmt: v => v ? `<code>${esc(String(v).slice(0, 14))}…</code>` : "-" }, { k: "active", label: "Estado", fmt: v => tag(v ? "active" : "disabled") }],
  fields: [{ name: "provider", label: "Proveedor", type: "select", options: [["cash", "Efectivo"], ["mercadopago", "Mercado Pago"], ["transfer", "Transferencia"], ["stripe", "Stripe"]] }, { name: "label", label: "Nombre visible", required: true }, { name: "public_key", label: "Clave pública (opcional)" }, { name: "alias", label: "Alias / CBU para transferencias" }, { name: "active", label: "Activa", type: "checkbox", value: true }]
});

// ---------------------------------------------------- Datos
async function data() {
  V.innerHTML = head("Datos y respaldo") + `<div class="grid g2">
  <div class="card"><h2>Respaldo</h2>${DB.LIVE ? `<p class="muted">Con Supabase, los respaldos se hacen desde Supabase → Database → Backups.</p>` : `<p class="muted">Descargá o restaurá todos los datos del modo demo.</p>
    <button class="btn" id="exp">Exportar JSON</button> <label class="btn sec" style="display:inline-block">Importar JSON<input type="file" id="imp" accept=".json" hidden></label>`}</div>
  <div class="card"><h2>Datos de ejemplo</h2><p class="muted">Genera 6 conductores, 15 clientes y 120 pedidos de los últimos 30 días para probar el panel y los gráficos.</p>
    <button class="btn sec" id="sample">Cargar datos de ejemplo</button> ${DB.LIVE ? "" : `<button class="btn danger" id="reset">Borrar todo</button>`}</div></div>`;
  if (!DB.LIVE) {
    $("#exp").onclick = () => UI.download("rodar-respaldo.json", JSON.stringify(DB.exportAll(), null, 1), "application/json");
    $("#imp").onchange = async e => { DB.importAll(JSON.parse(await e.target.files[0].text())); toast("Importado"); };
    $("#reset").onclick = async () => { if (await UI.confirmBox("¿Borrar todos los datos del modo demo?")) { DB.resetDemo(); location.reload(); } };
  }
  $("#sample").onclick = sampleData;
}
async function sampleData() {
  const svcs = await DB.list("services");
  let plan = (await DB.list("driver_plans"))[0] || await DB.insert("driver_plans", { name: "Estándar", commission_pct: 10, fee_fixed: 0, daily_base: 3000 });
  const names = ["Carlos Gómez", "Marta Ruiz", "Diego Benítez", "Lucía Acosta", "Raúl Sosa", "Hernán Ojeda"];
  const ds = [];
  for (const [i, n] of names.entries()) ds.push(await DB.insert("drivers", { name: n, phone: "+54934545" + (10000 + i), email: `conductor${i + 1}@ejemplo.com`, vehicle: ["Fiat Cronos", "VW Gol", "Chevrolet Prisma", "Renault Logan", "Peugeot 208", "Toyota Etios"][i], plate: "AB" + (100 + i) + "CD", status: i < 5 ? "active" : "invited", plan_id: plan.id, service_id: svcs[i % 2]?.id, online: i < 3, balance: 0, rating: 4.5 + (i % 5) / 10, lat: RODAR_CONFIG.MAP_CENTER[0] + (Math.random() - .5) / 60, lng: RODAR_CONFIG.MAP_CENTER[1] + (Math.random() - .5) / 60 }));
  const cn = ["Ana", "Jorge", "Sofía", "Pablo", "Valeria", "Miguel", "Laura", "Nicolás", "Paula", "Andrés", "Carla", "Esteban", "Rocío", "Tomás", "Julieta"];
  const streets = ["San Martín", "Urquiza", "Belgrano", "Sarmiento", "Moreno", "Rivadavia", "Mitre", "Hospital", "Terminal", "Plaza"];
  const st = ["completed", "completed", "completed", "completed", "completed", "cancelled", "missed", "completed"];
  for (let i = 0; i < 120; i++) {
    const t = new Date(Date.now() - Math.random() * 30 * 864e5), s = st[i % st.length], d = s === "missed" ? null : ds[i % 5], c = cn[i % cn.length];
    const km = 1 + Math.random() * 6, svc = svcs[i % svcs.length];
    const lat = RODAR_CONFIG.MAP_CENTER[0] + (Math.random() - .5) / 50, lng = RODAR_CONFIG.MAP_CENTER[1] + (Math.random() - .5) / 50;
    await DB.insert("orders", { created_at: t.toISOString(), customer_name: c + " " + ["Pérez", "López", "Díaz"][i % 3], customer_phone: "+54934546" + (20000 + (i % 15)),
      origin: `${streets[i % 10]} ${100 + (i * 37) % 900}`, origin_lat: lat, origin_lng: lng, destination: `${streets[(i + 3) % 10]} ${200 + (i * 53) % 800}`,
      service_id: svc.id, driver_id: d?.id || null, status: s, source: ["web", "operator", "operator", "app", "api"][i % 5], distance_km: +km.toFixed(1), price: UI.fare(svc, km), payment_method: i % 4 ? "cash" : "mercadopago",
      coupon: i % 9 === 0 ? "BIENVENIDA" : null, accepted_at: d ? new Date(+t + (30 + Math.random() * 200) * 1000).toISOString() : null,
      arrived_at: d ? new Date(+t + (240 + Math.random() * 400) * 1000).toISOString() : null, completed_at: s === "completed" ? new Date(+t + 1500e3).toISOString() : null });
  }
  toast("Datos de ejemplo cargados"); location.hash = "#dashboard";
}

// ---------------------------------------------------- Router
const ROUTES = {
  dashboard, guide, reports, operators, users, services, crews, notifications, marketing, apps, apis, hubspot, balance, billing, settings, zone, gateways, data,
  drivers, "driver-plans": driverPlans, "driver-levels": driverLevels
};
async function route() {
  cleanup();
  const h = location.hash.slice(1) || "dashboard";
  const [a, b] = h.split("/");
  document.querySelectorAll(".side a").forEach(x => x.classList.toggle("on", x.getAttribute("href") === "#" + h));
  $("#side").classList.remove("open");
  $("#crumb").textContent = (document.querySelector(`.side a[href="#${h}"]`) || {}).textContent || "Panel";
  try {
    if (a === "analytics") await analytics(b);
    else if (a === "orders") await orders(b || "all");
    else if (a === "promos") await promos(b || "discount")();
    else await (ROUTES[a] || dashboard)();
  } catch (e) { console.error(e); V.innerHTML = `<div class="card"><h2>Error</h2><pre>${esc(e.message)}</pre></div>`; }
}
(async () => {
  if (!DB.LIVE) $("#demoBar").hidden = false;
  await Auth.require("managers");
  await loadCompany();
  setInterval(() => $("#clock").textContent = new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }), 1000);
  window.addEventListener("hashchange", route); route();
})();
