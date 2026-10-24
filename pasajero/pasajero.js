const { $, esc, money, tag, toast } = UI;
let svcs = [], sel = null, pick = { o: null, d: null }, company = {}, current = null, poll = null;
const map = L.map("map").setView(RODAR_CONFIG.MAP_CENTER, RODAR_CONFIG.MAP_ZOOM);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OSM" }).addTo(map);
const mO = L.marker(RODAR_CONFIG.MAP_CENTER, { opacity: 0 }).addTo(map), mD = L.marker(RODAR_CONFIG.MAP_CENTER, { opacity: 0 }).addTo(map);
const car = L.circleMarker(RODAR_CONFIG.MAP_CENTER, { radius: 9, color: "#12b886", fillOpacity: .9, opacity: 0 }).addTo(map);
const f = $("#f");
const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };

function km() { return pick.o && pick.d ? UI.km(pick.o, pick.d) * 1.3 : 0; }
function drawSvcs() {
  $("#svcs").innerHTML = svcs.map(s => `<div class="svc ${s.id === sel ? "on" : ""}" data-s="${s.id}"><span><b>${esc(s.name)}</b><br><small class="muted">${esc(s.vehicle_type || "")}</small></span><b>${km() ? money(UI.fare(s, km())) : "desde " + money(s.min_fare)}</b></div>`).join("");
  $("#svcs").querySelectorAll("[data-s]").forEach(d => d.onclick = () => { sel = d.dataset.s; drawSvcs(); });
}
function setPick(k, ll, rev = true) {
  pick[k] = ll; (k === "o" ? mO : mD).setLatLng(ll).setOpacity(1);
  if (rev) UI.reverse(ll[0], ll[1]).then(t => f[k === "o" ? "origin" : "destination"].value = t);
  drawSvcs();
}
let next = "o";
map.on("click", e => { setPick(next, [e.latlng.lat, e.latlng.lng]); next = next === "o" ? "d" : "o"; });
$("#gps").onclick = () => navigator.geolocation?.getCurrentPosition(p => { const ll = [p.coords.latitude, p.coords.longitude]; map.setView(ll, 16); setPick("o", ll); }, e => toast("No pudimos obtener tu ubicación"));
f.origin.onchange = async () => { const ll = await UI.geocode(f.origin.value + ", Entre Ríos"); if (ll) { setPick("o", ll, false); map.panTo(ll); } };
f.destination.onchange = async () => { const ll = await UI.geocode(f.destination.value + ", Entre Ríos"); if (ll) setPick("d", ll, false); };

f.onsubmit = async e => {
  e.preventDefault(); $("#send").disabled = true;
  try {
    const v = Object.fromEntries(new FormData(f));
    const s = svcs.find(x => x.id === sel) || svcs[0];
    let price = km() ? UI.fare(s, km()) : (+s?.min_fare || 0), coupon = null;
    if (v.coupon) { const p = await Rides.validatePromo(v.coupon); if (!p) throw new Error("El código no es válido"); price = UI.applyPromo(price, p); coupon = p.code; }
    store.set("rodar_name", v.customer_name); store.set("rodar_phone", v.customer_phone);
    const o = await Rides.createOrder({ ...v, coupon, service_id: s?.id, source: "web", price, distance_km: +km().toFixed(1),
      origin_lat: pick.o?.[0] ?? null, origin_lng: pick.o?.[1] ?? null, dest_lat: pick.d?.[0] ?? null, dest_lng: pick.d?.[1] ?? null });
    store.set("rodar_order", o.id); track(o.id);
  } catch (err) { toast(err.message); }
  $("#send").disabled = false;
};

const MSG = { new: "Buscando un conductor cerca tuyo…", assigned: "Ofreciendo tu viaje a un conductor…", accepted: "¡Tu remis está en camino!", arrived: "Tu remis llegó. ¡Te espera en la puerta!", in_progress: "Buen viaje 🚗", completed: "Viaje finalizado. ¡Gracias!", cancelled: "Viaje cancelado", missed: "No encontramos conductores disponibles. Probá de nuevo en unos minutos." };
async function track(id) {
  f.hidden = true;
  let box = $("#trk"); if (!box) { box = document.createElement("div"); box.id = "trk"; box.className = "card"; $("#main").appendChild(box); }
  const render = async () => {
    const o = await DB.trackOrder(id); if (!o) { store.set("rodar_order", ""); location.reload(); return; }
    current = o;
    let d = o.driver_name ? { name: o.driver_name, vehicle: o.driver_vehicle, plate: o.driver_plate, color: o.driver_color, phone: o.driver_phone, lat: o.driver_lat, lng: o.driver_lng } : null;
    if (!d && o.driver_id && !DB.LIVE) d = await DB.get("drivers", o.driver_id);
    if (o.origin_lat) mO.setLatLng([o.origin_lat, o.origin_lng]).setOpacity(1);
    if (d && d.lat && ["accepted", "arrived", "in_progress"].includes(o.status)) { car.setLatLng([d.lat, d.lng]).setStyle({ opacity: 1 }); map.panTo([d.lat, d.lng]); }
    const end = ["completed", "cancelled", "missed"].includes(o.status);
    box.innerHTML = `<div class="row"><h2 class="grow">Pedido #${o.number || ""}</h2>${tag(o.status)}</div><p style="font-size:16px">${MSG[o.status] || ""}</p>
      ${d && ["accepted", "arrived", "in_progress"].includes(o.status) ? `<p><b>${esc(d.name)}</b><br>${esc(d.vehicle || "")} ${esc(d.color || "")} · <b>${esc(d.plate || "")}</b>${d.phone ? `<br><a href="tel:${esc(d.phone)}">Llamar al conductor</a>` : ""}</p>` : ""}
      <p class="muted">📍 ${esc(o.origin)}<br>🏁 ${esc(o.destination || "-")}<br>${money(o.price)}</p>
      ${["new", "assigned"].includes(o.status) ? `<button class="btn ghost" id="cx">Cancelar pedido</button>` : ""}
      ${o.status === "completed" && !o.rating ? `<p>¿Cómo fue tu viaje?</p><div class="stars">${[1, 2, 3, 4, 5].map(n => `<button data-r="${n}">☆</button>`).join("")}</div>` : ""}
      ${end ? `<button class="btn big" id="again">Pedir otro viaje</button>` : ""}`;
    if ($("#cx")) $("#cx").onclick = async () => { if (confirm("¿Cancelar el pedido?")) { await Rides.cancelByPassenger(id); render(); } };
    box.querySelectorAll("[data-r]").forEach(b => b.onclick = async () => { await Rides.rate(id, +b.dataset.r); toast("¡Gracias por calificar!"); render(); });
    if ($("#again")) $("#again").onclick = () => { store.set("rodar_order", ""); location.reload(); };
    if (end) clearInterval(poll);
  };
  await render();
  clearInterval(poll); poll = setInterval(render, DB.LIVE ? 5000 : 3000);
  if (!DB.LIVE) { DB.on("orders", render); DB.on("drivers", render); }
}
async function notes() {
  const n = (await DB.list("notifications", { desc: true, limit: 5 }).catch(() => [])).filter(x => x.sent_at && ["all", "customers"].includes(x.audience));
  const x = n[0]; if (!x || store.get("rodar_seen_p") === x.id) return;
  $("#notes").innerHTML = `<div class="card" style="background:#e7f0fe"><b>${esc(x.title)}</b><p style="margin:4px 0">${esc(x.body || "")}</p><button class="btn sm ghost" id="ok">Cerrar</button></div>`;
  $("#ok").onclick = () => { store.set("rodar_seen_p", x.id); $("#notes").innerHTML = ""; };
}
(async () => {
  company = await Rides.company();
  $("#title").textContent = company.name || RODAR_CONFIG.APP_NAME; document.title = (company.name || "Rodar") + " · Pedí tu viaje";
  if (company.zone && company.zone.length > 2) L.polygon(company.zone, { color: "#0f6fde", fillOpacity: .04, weight: 1 }).addTo(map);
  svcs = (await DB.list("services", { order: "sort" })).filter(s => s.status === "active"); sel = svcs[0]?.id; drawSvcs();
  const gws = (await DB.list("payment_gateways").catch(() => [])).filter(g => g.active && g.provider !== "cash");
  $("#pay").innerHTML += gws.map(g => `<option value="${esc(g.provider)}">${esc(g.label)}${g.alias ? " (" + esc(g.alias) + ")" : ""}</option>`).join("");
  f.customer_name.value = store.get("rodar_name") || ""; f.customer_phone.value = store.get("rodar_phone") || "";
  notes();
  const pending = store.get("rodar_order"); if (pending) track(pending);
})();
