const { $, esc, money, fdate, tag, toast } = UI;
let me = null, company = {}, orders = [], svcs = [], tab = "free", watchId = null, lastOfferId = null;
const map = L.map("map", { zoomControl: false }).setView(RODAR_CONFIG.MAP_CENTER, RODAR_CONFIG.MAP_ZOOM);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OSM" }).addTo(map);
const meMk = L.circleMarker(RODAR_CONFIG.MAP_CENTER, { radius: 9, color: "#12b886", fillOpacity: .9 }).addTo(map);
const layer = L.layerGroup().addTo(map);

async function register(email) {
  const v = await UI.form({ title: "Registro de conductor", submit: "Enviar solicitud", values: { email }, fields: [
    { name: "name", label: "Nombre y apellido", required: true }, { name: "phone", label: "Teléfono", required: true }, { name: "email", label: "Email", type: "email", required: true },
    { name: "dni", label: "DNI" }, { name: "license", label: "Licencia de conducir" }, { name: "vehicle", label: "Vehículo" }, { name: "plate", label: "Patente" }, { name: "color", label: "Color" }] });
  if (!v) return null;
  return DB.insert("drivers", { ...v, status: "pending", online: false, balance: 0, rating: 5 });
}
async function login() {
  if (!DB.LIVE) {
    const ds = await DB.list("drivers");
    let id; try { id = localStorage.getItem("rodar_driver"); } catch (e) {}
    let d = ds.find(x => x.id === id);
    if (!d) {
      const v = await UI.form({ title: "Modo demo · ¿Quién maneja?", submit: "Entrar", fields: [{ name: "id", label: "Conductor", type: "select", options: [["", "➕ Registrarme como nuevo"], ...ds.map(x => [x.id, `${x.name} (${UI.STATUS[x.status]})`])] }] });
      d = v && v.id ? ds.find(x => x.id === v.id) : await register("");
      if (!d) return login();
      try { localStorage.setItem("rodar_driver", d.id); } catch (e) {}
    }
    $("#logout").hidden = false; $("#logout").onclick = () => { try { localStorage.removeItem("rodar_driver"); } catch (e) {} location.reload(); };
    return d;
  }
  const user = (await DB.auth.user()) || await Auth.loginScreen();
  $("#logout").hidden = false; $("#logout").onclick = () => DB.auth.signOut().then(() => location.reload());
  return (await DB.list("drivers", { eq: { email: user.email } }))[0] || await register(user.email);
}

async function load() {
  [me, orders, svcs] = await Promise.all([DB.get("drivers", me.id), DB.list("orders", { desc: true, limit: 200 }), DB.list("services")]);
  draw();
}
const mine = () => orders.filter(o => o.driver_id === me.id);
function draw() {
  $("#who").textContent = me.name;
  const can = me.status === "active";
  $("#stLabel").innerHTML = can ? (me.online ? "🟢 En línea" : "⚪ Desconectado") : `Cuenta: ${tag(me.status)}`;
  $("#toggle").textContent = me.online ? "Desconectarme" : "Conectarme"; $("#toggle").disabled = !can;
  $("#toggle").className = "btn " + (me.online ? "ghost" : "ok");
  // viaje / oferta
  const offer = mine().find(o => o.status === "assigned");
  const cur = mine().find(o => ["accepted", "arrived", "in_progress"].includes(o.status));
  const nav = (lat, lng, txt) => `https://www.google.com/maps/dir/?api=1&destination=${lat ? lat + "," + lng : encodeURIComponent(txt || "")}`;
  layer.clearLayers();
  if (offer) {
    if (offer.id !== lastOfferId) { lastOfferId = offer.id; UI.beep(); if (navigator.vibrate) navigator.vibrate([300, 100, 300]); }
    $("#trip").innerHTML = `<div class="card offer"><h2>¡Nuevo pedido! #${offer.number}</h2>
      <p>📍 <b>${esc(offer.origin)}</b><br>🏁 ${esc(offer.destination || "-")}</p>
      <p>${money(offer.price)} · ${esc(offer.payment_method || "")} ${offer.origin_lat && me.lat ? "· a " + UI.km([me.lat, me.lng], [offer.origin_lat, offer.origin_lng]).toFixed(1) + " km" : ""}</p>
      ${offer.notes ? `<p class="muted">${esc(offer.notes)}</p>` : ""}
      <div class="row"><button class="btn ok big grow" id="acc">Aceptar</button><button class="btn ghost" id="rej">Rechazar</button></div></div>`;
    $("#acc").onclick = () => step(offer, "accepted");
    $("#rej").onclick = async () => { await DB.update("orders", offer.id, { status: "new", driver_id: null, rejected_by: [...(offer.rejected_by || []), me.id] }); load(); };
    if (offer.origin_lat) L.marker([offer.origin_lat, offer.origin_lng]).addTo(layer);
  } else if (cur) {
    const next = { accepted: ["arrived", "Llegué al origen"], arrived: ["in_progress", "Iniciar viaje"], in_progress: ["completed", "Finalizar viaje"] }[cur.status];
    const toDest = cur.status === "in_progress";
    $("#trip").innerHTML = `<div class="card"><div class="row"><h2 class="grow">Viaje #${cur.number}</h2>${tag(cur.status)}</div>
      <p><b>${esc(cur.customer_name || "")}</b> · <a href="tel:${esc(cur.customer_phone)}">Llamar</a> · <a target="_blank" href="https://wa.me/${esc((cur.customer_phone || "").replace(/\D/g, ""))}">WhatsApp</a></p>
      <p>📍 ${esc(cur.origin)}<br>🏁 ${esc(cur.destination || "-")}</p><p>${money(cur.price)} · ${esc(cur.payment_method || "")}</p>
      ${cur.notes ? `<p class="muted">${esc(cur.notes)}</p>` : ""}
      <a class="btn sec" target="_blank" href="${toDest ? nav(cur.dest_lat, cur.dest_lng, cur.destination) : nav(cur.origin_lat, cur.origin_lng, cur.origin)}">Navegar ↗</a>
      <button class="btn big" id="next" style="margin-top:10px">${next[1]}</button></div>`;
    $("#next").onclick = async () => {
      let extra = {};
      if (next[0] === "completed") {
        const v = await UI.form({ title: "Finalizar viaje", submit: "Finalizar", values: { price: cur.price, payment_method: cur.payment_method }, fields: [{ name: "price", label: "Importe final", type: "number" }, { name: "payment_method", label: "Cobrado en", type: "select", options: [["cash", "Efectivo"], ["mercadopago", "Mercado Pago"], ["transfer", "Transferencia"], ["account", "Cuenta corriente"]] }] });
        if (!v) return; extra = v;
      }
      step(cur, next[0], extra);
    };
    const t = toDest ? [cur.dest_lat, cur.dest_lng] : [cur.origin_lat, cur.origin_lng];
    if (t[0]) L.marker(t).addTo(layer);
  } else $("#trip").innerHTML = "";
  // paneles
  document.querySelectorAll("#tabs button").forEach(b => { b.classList.toggle("on", b.dataset.t === tab); b.onclick = () => { tab = b.dataset.t; draw(); }; });
  const today = new Date().toISOString().slice(0, 10);
  if (tab === "free") {
    const free = orders.filter(o => o.status === "new" && !(o.rejected_by || []).includes(me.id) && (!o.service_id || !me.service_id || o.service_id === me.service_id));
    $("#panel").innerHTML = !me.online ? `<p class="muted">Conectate para ver pedidos.</p>` : free.length ? free.map(o => `<div class="row" style="border-bottom:1px solid var(--line);padding:8px 0"><div class="grow">📍 ${esc(o.origin)}<br><small class="muted">→ ${esc(o.destination || "-")} · ${money(o.price)}${o.origin_lat && me.lat ? " · " + UI.km([me.lat, me.lng], [o.origin_lat, o.origin_lng]).toFixed(1) + " km" : ""}</small></div><button class="btn sm ok" data-take="${o.id}" ${cur || offer ? "disabled" : ""}>Tomar</button></div>`).join("") : `<p class="muted">No hay pedidos libres.</p>`;
    $("#panel").querySelectorAll("[data-take]").forEach(b => b.onclick = async () => {
      const o = (await DB.get("orders", b.dataset.take));
      if (!o || o.status !== "new") return toast("Otro conductor lo tomó"), load();
      await Rides.setStatus(o, "accepted", { driver_id: me.id, assigned_at: DB.now() }); load();
    });
  } else if (tab === "hist") {
    const h = mine().filter(o => o.status === "completed" && (o.completed_at || "").startsWith(today));
    $("#panel").innerHTML = `<p><b>${h.length}</b> viajes · <b>${money(h.reduce((s, o) => s + (+o.price || 0), 0))}</b> facturado hoy</p>` + h.map(o => `<div style="border-bottom:1px solid var(--line);padding:6px 0">#${o.number} ${esc(o.origin)} → ${esc(o.destination || "")}<br><small class="muted">${fdate(o.completed_at)} · ${money(o.price)}</small></div>`).join("");
  } else {
    const paid = me.base_paid_date === Rides.todayKey();
    $("#panel").innerHTML = `<p>Saldo con la central: <b>${money(me.balance)}</b></p><p>Calificación: <b>${(+me.rating || 5).toFixed(1)} ★</b> ${me.level ? "· Nivel " + esc(me.level) : ""}</p>
      <p>Base del día: ${paid ? `<span class="tag active">Pagada hoy</span>` : `<span class="tag pending">Pendiente</span>`} <small class="muted">(válida de 00:00 a 23:59:59)</small></p>
      <button class="btn sec" id="base" ${paid ? "disabled" : ""}>Pagar base de hoy</button>
      <p class="muted">${esc(me.vehicle || "")} ${esc(me.plate || "")}</p>`;
    $("#base").onclick = async () => { try { const a = await Rides.payDailyBase(me); toast("Base pagada: " + money(a)); load(); } catch (e) { toast(e.message); } };
  }
}
async function step(o, st, extra = {}) {
  if (st === "accepted") { const fresh = await DB.get("orders", o.id); if (fresh.driver_id !== me.id || fresh.status !== "assigned") return toast("El pedido ya no está disponible"), load(); }
  await Rides.setStatus(o, st, extra); load();
}
function gps(on) {
  if (!navigator.geolocation) return;
  if (on && watchId == null) {
    let last = 0;
    watchId = navigator.geolocation.watchPosition(async p => {
      const ll = [p.coords.latitude, p.coords.longitude]; meMk.setLatLng(ll); map.panTo(ll);
      if (Date.now() - last > 12000) { last = Date.now(); await DB.update("drivers", me.id, { lat: ll[0], lng: ll[1], last_seen: DB.now() }); }
    }, e => toast("Activá la ubicación: " + e.message), { enableHighAccuracy: true });
  } else if (!on && watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
}
async function notes() {
  const n = (await DB.list("notifications", { desc: true, limit: 5 })).filter(x => x.sent_at && ["all", "drivers"].includes(x.audience));
  let seen; try { seen = localStorage.getItem("rodar_seen_d"); } catch (e) {}
  const x = n[0];
  $("#notes").innerHTML = x && x.id !== seen ? `<div class="card" style="background:#e7f0fe"><b>${esc(x.title)}</b><p style="margin:4px 0">${esc(x.body || "")}</p><button class="btn sm ghost" id="ok">Entendido</button></div>` : "";
  if ($("#ok")) $("#ok").onclick = () => { try { localStorage.setItem("rodar_seen_d", x.id); } catch (e) {} $("#notes").innerHTML = ""; };
}

(async () => {
  me = await login(); if (!me) return;
  company = await Rides.company();
  $("#title").textContent = (company.name || "Rodar") + " · Conductor";
  $("#sos").href = "tel:" + (company.sos_phone || "911");
  if (me.lat) { meMk.setLatLng([me.lat, me.lng]); map.setView([me.lat, me.lng]); }
  $("#toggle").onclick = async () => { me = await DB.update("drivers", me.id, { online: !me.online, last_seen: DB.now() }); gps(me.online); draw(); };
  await load(); gps(me.online); notes();
  let t; const r = () => { clearTimeout(t); t = setTimeout(load, 250); };
  DB.on("orders", r); DB.on("drivers", r); DB.on("notifications", notes); DB.on("*", e => e.type === "refresh" && r());
  setInterval(r, DB.LIVE ? 15000 : 6000);
})();
