const { $, esc, money, fdate, tag, toast } = UI;
let svcs = [], drivers = [], orders = [], me = null, tab = "active";
let pick = { o: null, d: null }, pickMode = "o";
const map = L.map("map").setView(RODAR_CONFIG.MAP_CENTER, RODAR_CONFIG.MAP_ZOOM);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap" }).addTo(map);
const layer = L.layerGroup().addTo(map);
const mO = L.marker(RODAR_CONFIG.MAP_CENTER, { opacity: 0 }).addTo(map), mD = L.marker(RODAR_CONFIG.MAP_CENTER, { opacity: 0 }).addTo(map);
const carIcon = on => L.divIcon({ html: `<div style="background:${on ? "#12b886" : "#868e96"};color:#fff;border-radius:50%;width:26px;height:26px;display:grid;place-items:center;border:2px solid #fff;box-shadow:0 1px 4px #0005">🚗</div>`, className: "", iconSize: [26, 26] });
const f = $("#f");

async function load() {
  [svcs, drivers, orders] = await Promise.all([DB.list("services", { order: "sort" }), DB.list("drivers"), DB.list("orders", { desc: true, limit: 300 })]);
  svcs = svcs.filter(s => s.status === "active");
  if (!$("#svc").options.length) $("#svc").innerHTML = svcs.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
  draw();
}
const busy = () => new Set(orders.filter(o => ["assigned", "accepted", "arrived", "in_progress"].includes(o.status)).map(o => o.driver_id));
function estimate() {
  const s = svcs.find(x => x.id === f.service_id.value);
  if (!pick.o || !pick.d || !s) return $("#est").textContent = "Precio estimado: -";
  const km = UI.km(pick.o, pick.d) * 1.3;
  $("#est").textContent = `Precio estimado: ${money(UI.fare(s, km))} (${km.toFixed(1)} km)`;
}
function draw() {
  const today = new Date().toISOString().slice(0, 10);
  const groups = {
    active: ["Activos", o => Rides.ACTIVE.includes(o.status) && !o.scheduled_at || (o.scheduled_at && Rides.ACTIVE.includes(o.status) && new Date(o.scheduled_at) - Date.now() < 15 * 60000)],
    scheduled: ["Programados", o => o.scheduled_at && o.status === "new" && new Date(o.scheduled_at) - Date.now() >= 15 * 60000],
    done: ["Finalizados hoy", o => o.status === "completed" && (o.completed_at || "").startsWith(today)],
    cancel: ["Cancelados", o => ["cancelled", "missed"].includes(o.status) && (o.created_at || "").startsWith(today)]
  };
  $("#tabs").innerHTML = Object.entries(groups).map(([k, [l, fn]]) => `<button class="${k === tab ? "on" : ""}" data-t="${k}">${l} (${orders.filter(fn).length})</button>`).join("");
  $("#tabs").querySelectorAll("button").forEach(b => b.onclick = () => { tab = b.dataset.t; draw(); });
  const prio = { new: 0, assigned: 1, accepted: 2, arrived: 3, in_progress: 4 };
  const list = orders.filter(groups[tab][1]).sort((a, b) => (prio[a.status] ?? 9) - (prio[b.status] ?? 9) || (a.created_at > b.created_at ? 1 : -1));
  const dn = id => (drivers.find(d => d.id === id) || {}).name;
  $("#list").innerHTML = list.length ? list.map(o => `<div class="ord ${o.status}">
    <div class="row"><b>#${o.number || ""}</b> ${tag(o.status)} <span class="grow"></span><small class="muted">${fdate(o.scheduled_at || o.created_at)}</small></div>
    <div><b>${esc(o.customer_name || "")}</b> <a href="tel:${esc(o.customer_phone)}">${esc(o.customer_phone || "")}</a> <small class="muted">· ${esc(o.source || "")}</small></div>
    <div>📍 ${esc(o.origin || "")}<br>🏁 ${esc(o.destination || "-")}</div>
    <div class="muted">${esc((svcs.find(s => s.id === o.service_id) || {}).name || "")} · ${money(o.price)} ${o.driver_id ? "· 🚗 " + esc(dn(o.driver_id) || "") : ""} ${o.notes ? "· " + esc(o.notes) : ""}</div>
    ${Rides.ACTIVE.includes(o.status) ? `<div class="row" style="margin-top:6px">
      ${["new", "assigned"].includes(o.status) ? `<button class="btn sm" data-a="auto" data-id="${o.id}">Auto</button><button class="btn sm sec" data-a="pick" data-id="${o.id}">Asignar…</button>` : ""}
      ${o.status === "accepted" ? `<button class="btn sm sec" data-a="arrived" data-id="${o.id}">En puerta</button>` : ""}
      ${o.status === "arrived" ? `<button class="btn sm sec" data-a="in_progress" data-id="${o.id}">Iniciar</button>` : ""}
      ${["arrived", "in_progress"].includes(o.status) ? `<button class="btn sm ok" data-a="completed" data-id="${o.id}">Finalizar</button>` : ""}
      ${o.status === "new" ? `<button class="btn sm ghost" data-a="missed" data-id="${o.id}">Sin conductor</button>` : ""}
      <button class="btn sm ghost" data-a="cancelled" data-id="${o.id}">Cancelar</button></div>` : ""}</div>`).join("") : `<div class="empty">Sin pedidos</div>`;
  $("#list").querySelectorAll("[data-a]").forEach(b => b.onclick = () => act(b.dataset.a, orders.find(o => o.id === b.dataset.id)));
  // mapa
  layer.clearLayers();
  drivers.filter(d => d.lat && d.status === "active").forEach(d => L.marker([d.lat, d.lng], { icon: carIcon(d.online && !busy().has(d.id)) }).addTo(layer).bindTooltip(`${esc(d.name)} · ${d.online ? (busy().has(d.id) ? "ocupado" : "libre") : "desconectado"}`));
  orders.filter(o => Rides.ACTIVE.includes(o.status) && o.origin_lat).forEach(o => L.circleMarker([o.origin_lat, o.origin_lng], { radius: 8, color: o.status === "new" ? "#f59f00" : "#0f6fde", fillOpacity: .7 }).addTo(layer).bindPopup(`#${o.number} ${esc(o.customer_name)}<br>${esc(o.origin)}`));
}
async function act(a, o) {
  try {
    if (a === "auto") {
      const d = Rides.nearest(o, drivers.filter(x => !busy().has(x.id)), o.rejected_by || []);
      if (!d) return toast("No hay conductores libres en línea");
      await Rides.setStatus(o, "assigned", { driver_id: d.id }); toast("Asignado a " + d.name);
    } else if (a === "pick") {
      const free = drivers.filter(d => d.status === "active").map(d => [d.id, `${d.name}${d.online ? "" : " (desconectado)"}${busy().has(d.id) ? " — ocupado" : ""}${o.origin_lat && d.lat ? " · " + UI.km([o.origin_lat, o.origin_lng], [d.lat, d.lng]).toFixed(1) + " km" : ""}`]);
      const v = await UI.form({ title: `Asignar pedido #${o.number}`, fields: [{ name: "driver_id", label: "Conductor", type: "select", options: free }, { name: "direct", label: "Marcar como aceptado (el conductor confirmó por radio/teléfono)", type: "checkbox" }] });
      if (v && v.driver_id) await Rides.setStatus(o, v.direct ? "accepted" : "assigned", { driver_id: v.driver_id, ...(v.direct ? { assigned_at: DB.now() } : {}) });
    } else {
      if (["cancelled", "missed"].includes(a) && !confirm("¿Confirmás?")) return;
      await Rides.setStatus(o, a);
    }
  } catch (e) { toast(e.message); }
  load();
}
// despacho automático: asigna pedidos nuevos al conductor libre más cercano
async function autoDispatch() {
  if (!$("#auto").checked) return;
  const taken = busy();
  for (const o of orders.filter(o => o.status === "new" && (!o.scheduled_at || new Date(o.scheduled_at) - Date.now() < 10 * 60000))) {
    const d = Rides.nearest(o, drivers.filter(x => !taken.has(x.id)), o.rejected_by || []);
    if (d) { await Rides.setStatus(o, "assigned", { driver_id: d.id }); taken.add(d.id); }
  }
}
// Formulario
f.customer_phone.onchange = async () => {
  const c = (await DB.list("customers", { eq: { phone: f.customer_phone.value.trim() } }))[0];
  if (c && !f.customer_name.value) f.customer_name.value = c.name || "";
  const last = orders.find(o => o.customer_phone === f.customer_phone.value.trim());
  if (last && !f.origin.value) { f.origin.value = last.origin; if (last.origin_lat) setPick("o", [last.origin_lat, last.origin_lng], false); }
};
function setPick(k, ll, rev = true) {
  pick[k] = ll; const m = k === "o" ? mO : mD; m.setLatLng(ll).setOpacity(1).bindTooltip(k === "o" ? "Origen" : "Destino", { permanent: true });
  if (rev) UI.reverse(ll[0], ll[1]).then(t => f[k === "o" ? "origin" : "destination"].value = t);
  estimate();
}
$("#geoO").onclick = () => { pickMode = "o"; toast("Hacé clic en el mapa para el origen"); };
$("#geoD").onclick = () => { pickMode = "d"; toast("Hacé clic en el mapa para el destino"); };
map.on("click", e => { setPick(pickMode, [e.latlng.lat, e.latlng.lng]); pickMode = pickMode === "o" ? "d" : "o"; });
f.origin.onchange = async () => { const ll = await UI.geocode(f.origin.value + ", " + "Entre Ríos"); if (ll) { setPick("o", ll, false); map.panTo(ll); } };
f.destination.onchange = async () => { const ll = await UI.geocode(f.destination.value + ", " + "Entre Ríos"); if (ll) setPick("d", ll, false); };
f.service_id.onchange = estimate;
f.onsubmit = async e => {
  e.preventDefault();
  const v = Object.fromEntries(new FormData(f));
  const s = svcs.find(x => x.id === v.service_id);
  const km = pick.o && pick.d ? UI.km(pick.o, pick.d) * 1.3 : 0;
  try {
    await Rides.createOrder({ ...v, scheduled_at: v.scheduled_at ? new Date(v.scheduled_at).toISOString() : null, source: "operator", operator_id: me?.id || null,
      origin_lat: pick.o?.[0] ?? null, origin_lng: pick.o?.[1] ?? null, dest_lat: pick.d?.[0] ?? null, dest_lng: pick.d?.[1] ?? null,
      distance_km: +km.toFixed(1), price: km ? UI.fare(s, km) : (+s?.min_fare || 0) });
    f.reset(); pick = { o: null, d: null }; mO.setOpacity(0); mD.setOpacity(0); toast("Pedido creado"); load();
  } catch (err) { toast(err.message); }
};

(async () => {
  const a = await Auth.require("operators");
  me = a.profile; $("#me").textContent = me ? me.name : "Modo demo";
  const c = await Rides.company(); $("#title").textContent = (c.name || "Rodar") + " · Operador";
  try { $("#auto").checked = localStorage.getItem("rodar_auto") === "1"; } catch (e) {}
  $("#auto").onchange = () => { try { localStorage.setItem("rodar_auto", $("#auto").checked ? "1" : "0"); } catch (e) {} autoDispatch(); };
  await load();
  let t;
  const refresh = ev => { if (ev && ev.type === "INSERT" && ev.row && ev.row.source !== "operator") UI.beep(); clearTimeout(t); t = setTimeout(async () => { await load(); autoDispatch(); }, 300); };
  DB.on("orders", refresh); DB.on("drivers", () => refresh()); DB.on("*", e => e.type === "refresh" && refresh());
  setInterval(refresh, DB.LIVE ? 20000 : 8000);
})();
