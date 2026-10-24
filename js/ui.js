// Utilidades de interfaz compartidas por todos los módulos
(function () {
  const C = window.RODAR_CONFIG;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = n => new Intl.NumberFormat(C.LOCALE, { style: "currency", currency: C.CURRENCY, maximumFractionDigits: 0 }).format(+n || 0);
  const fdate = d => d ? new Date(d).toLocaleString(C.LOCALE, { dateStyle: "short", timeStyle: "short" }) : "-";
  const STATUS = {
    new: "Nuevo", assigned: "Asignado", accepted: "Aceptado", arrived: "En puerta", in_progress: "En viaje",
    completed: "Finalizado", cancelled: "Cancelado", missed: "Sin conductor",
    active: "Activo", disabled: "Desactivado", suspended: "Suspendido", pending: "Activación en espera",
    awaiting: "Esperando activación", incomplete: "Registro incompleto", rejected: "Rechazado", invited: "Invitado",
    online: "En línea", offline: "Desconectado"
  };
  const tag = s => `<span class="tag ${esc(s)}">${esc(STATUS[s] || s)}</span>`;

  function toast(msg) {
    const t = document.createElement("div"); t.className = "toast"; t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
  }

  // form({title, fields:[{name,label,type,options,value,required}], submit}) -> Promise<obj|null>
  function form({ title, fields, submit = "Guardar", values = {} }) {
    return new Promise(res => {
      const bg = document.createElement("div"); bg.className = "modal-bg";
      const f = fields.map(fl => {
        const v = values[fl.name] ?? fl.value ?? "";
        let input;
        if (fl.type === "select") input = `<select name="${fl.name}">${fl.options.map(o => { const [val, lab] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(val)}" ${String(val) === String(v) ? "selected" : ""}>${esc(lab)}</option>`; }).join("")}</select>`;
        else if (fl.type === "textarea") input = `<textarea name="${fl.name}" rows="3">${esc(v)}</textarea>`;
        else if (fl.type === "checkbox") input = `<input type="checkbox" name="${fl.name}" ${v ? "checked" : ""} style="width:auto">`;
        else input = `<input name="${fl.name}" type="${fl.type || "text"}" value="${esc(v)}" ${fl.required ? "required" : ""} step="any">`;
        return `<label>${esc(fl.label)}</label>${input}`;
      }).join("");
      bg.innerHTML = `<form class="modal"><h2>${esc(title)}</h2>${f}<div class="row" style="justify-content:flex-end;margin-top:16px"><button type="button" class="btn ghost" data-x>Cancelar</button><button class="btn">${esc(submit)}</button></div></form>`;
      document.body.appendChild(bg);
      const close = v => { bg.remove(); res(v); };
      bg.querySelector("[data-x]").onclick = () => close(null);
      bg.onclick = e => { if (e.target === bg) close(null); };
      bg.querySelector("form").onsubmit = e => {
        e.preventDefault(); const o = {};
        fields.forEach(fl => {
          const el = e.target.elements[fl.name];
          o[fl.name] = fl.type === "checkbox" ? el.checked : fl.type === "number" ? (el.value === "" ? null : +el.value) : el.value;
        });
        close(o);
      };
    });
  }
  const confirmBox = msg => Promise.resolve(window.confirm(msg));

  // Tabla genérica: cols=[{k,label,fmt}], actions(row)->html
  function table(rows, cols, actions) {
    if (!rows.length) return `<div class="empty">Sin registros</div>`;
    return `<table><thead><tr>${cols.map(c => `<th>${esc(c.label)}</th>`).join("")}${actions ? "<th></th>" : ""}</tr></thead><tbody>${rows.map(r => `<tr data-id="${esc(r.id)}">${cols.map(c => `<td>${c.fmt ? c.fmt(r[c.k], r) : esc(r[c.k] ?? "-")}</td>`).join("")}${actions ? `<td style="text-align:right;white-space:nowrap">${actions(r)}</td>` : ""}</tr>`).join("")}</tbody></table>`;
  }

  function km(a, b) { // haversine
    const R = 6371, t = x => x * Math.PI / 180;
    const dLa = t(b[0] - a[0]), dLo = t(b[1] - a[1]);
    const h = Math.sin(dLa / 2) ** 2 + Math.cos(t(a[0])) * Math.cos(t(b[0])) * Math.sin(dLo / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function fare(svc, distKm, minutes) {
    if (!svc) return 0;
    const p = (+svc.base_fare || 0) + (+svc.per_km || 0) * distKm + (+svc.per_min || 0) * (minutes ?? distKm * 2.5);
    return Math.round(Math.max(p, +svc.min_fare || 0) / 10) * 10;
  }
  function applyPromo(price, promo) {
    if (!promo) return price;
    return promo.value_type === "percent" ? Math.round(price * (1 - promo.value / 100)) : Math.max(0, price - promo.value);
  }
  // Geocodificación gratuita (OpenStreetMap Nominatim) — uso moderado
  async function geocode(q) {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ar&q=${encodeURIComponent(q)}`);
    const j = await r.json(); return j[0] ? [+j[0].lat, +j[0].lon] : null;
  }
  async function reverse(lat, lng) {
    try { const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`); const j = await r.json(); return (j.display_name || "").split(",").slice(0, 3).join(","); }
    catch (e) { return `${lat.toFixed(5)}, ${lng.toFixed(5)}`; }
  }
  function inPolygon(pt, poly) {
    if (!poly || poly.length < 3) return true;
    let ins = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [yi, xi] = poly[i], [yj, xj] = poly[j];
      if (((yi > pt[0]) !== (yj > pt[0])) && (pt[1] < (xj - xi) * (pt[0] - yi) / (yj - yi) + xi)) ins = !ins;
    }
    return ins;
  }
  function csv(rows, cols) {
    const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    return [cols.map(c => q(c.label)).join(","), ...rows.map(r => cols.map(c => q(c.get ? c.get(r) : r[c.k])).join(","))].join("\n");
  }
  function download(name, text, type = "text/csv") {
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + text], { type })); a.download = name; a.click();
  }
  function beep() { try { const a = new AudioContext(), o = a.createOscillator(); o.connect(a.destination); o.frequency.value = 880; o.start(); setTimeout(() => { o.stop(); a.close(); }, 350); } catch (e) {} }

  window.UI = { $, esc, money, fdate, tag, STATUS, toast, form, confirmBox, table, km, fare, applyPromo, geocode, reverse, inPolygon, csv, download, beep };
})();
