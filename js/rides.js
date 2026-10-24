// Lógica de viajes compartida por operador, conductor y pasajero
window.Rides = {
  ACTIVE: ["new", "assigned", "accepted", "arrived", "in_progress"],
  STAMP: { assigned: "assigned_at", accepted: "accepted_at", arrived: "arrived_at", in_progress: "started_at", completed: "completed_at", cancelled: "cancelled_at", missed: "cancelled_at" },

  async company() {
    const rows = await DB.list("company", { order: "id" }).catch(() => []);
    if (rows[0]) return rows[0];
    if (DB.LIVE) { const { data } = await DB.sb.rpc("public_company"); return (data && data[0]) || {}; } // pasajero sin sesión
    return {};
  },
  // Acciones del pasajero sin cuenta (en Supabase van por funciones seguras)
  async cancelByPassenger(id) {
    if (DB.LIVE) { const { error } = await DB.sb.rpc("cancel_order", { p_id: id }); if (error) throw error; return; }
    const o = await DB.get("orders", id); if (o && ["new", "assigned"].includes(o.status)) await this.setStatus(o, "cancelled", { cancel_reason: "pasajero" });
  },
  async rate(id, stars) {
    if (DB.LIVE) { await DB.sb.rpc("rate_order", { p_id: id, p_rating: stars }); return; }
    const o = await DB.update("orders", id, { rating: stars });
    if (o.driver_id) { const os = (await DB.list("orders", { eq: { driver_id: o.driver_id } })).filter(x => x.rating); const avg = os.reduce((s, x) => s + x.rating, 0) / os.length; await DB.update("drivers", o.driver_id, { rating: +avg.toFixed(2) }); }
  },

  async validatePromo(code) {
    if (!code) return null;
    code = code.toUpperCase().trim();
    if (DB.LIVE) { const { data } = await DB.sb.rpc("validate_promo", { p_code: code }); return data && data[0] || null; }
    const p = (await DB.list("promotions")).find(x => x.code === code && x.active && x.type !== "topup");
    if (!p) return null;
    if (p.valid_to && p.valid_to < new Date().toISOString().slice(0, 10)) return null;
    if (p.max_uses && (p.used || 0) >= p.max_uses) return null;
    return p;
  },

  async createOrder(o) {
    const c = await this.company();
    if (o.origin_lat && c.zone && c.zone.length > 2 && !UI.inPolygon([o.origin_lat, o.origin_lng], c.zone))
      throw new Error("El origen está fuera del área de servicio.");
    const payload = { status: "new", source: "web", payment_method: "cash", ...o };
    if (DB.LIVE) { // función segura: valida zona, crea cliente y suma uso del cupón
      const { data, error } = await DB.sb.rpc("create_order", { p: payload }); if (error) throw error; return data;
    }
    const order = await DB.insert("orders", payload);
    if (!DB.LIVE) { // en Supabase esto lo hace el trigger on_order_insert
      const cs = await DB.list("customers", { eq: { phone: o.customer_phone } });
      if (cs[0]) await DB.update("customers", cs[0].id, { name: o.customer_name || cs[0].name, orders_count: (cs[0].orders_count || 0) + 1 });
      else if (o.customer_phone) await DB.insert("customers", { name: o.customer_name, phone: o.customer_phone, email: o.customer_email || null, orders_count: 1 });
      if (o.coupon) { const p = (await DB.list("promotions")).find(x => x.code === o.coupon); if (p) await DB.update("promotions", p.id, { used: (p.used || 0) + 1 }); }
    }
    return order;
  },

  async setStatus(order, status, extra = {}) {
    const patch = { status, ...extra };
    if (this.STAMP[status]) patch[this.STAMP[status]] = DB.now();
    const upd = await DB.update("orders", order.id, patch);
    if (status === "completed") await this.charge(upd);
    return upd;
  },

  // Cobra la comisión al conductor según su plan (si está activo en Plan y saldo)
  async charge(order) {
    const c = await this.company();
    if (!c.auto_topup || !order.driver_id) return;
    const d = await DB.get("drivers", order.driver_id); if (!d) return;
    const p = d.plan_id ? await DB.get("driver_plans", d.plan_id) : null;
    const fee = Math.round((+order.price || 0) * ((p ? +p.commission_pct : 10) / 100) + (p ? +p.fee_fixed || 0 : 0));
    if (!fee) return;
    await DB.update("drivers", d.id, { balance: (+d.balance || 0) - fee });
    await DB.insert("billing", { concept: `Comisión viaje #${order.number} (${d.name})`, amount: fee, driver_id: d.id });
    await DB.update("company", c.id, { balance: (+c.balance || 0) + fee });
  },

  // Base diaria: válida desde las 00:00 hasta las 23:59:59 del día en que se paga
  todayKey() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; },
  async payDailyBase(driver) {
    const p = driver.plan_id ? await DB.get("driver_plans", driver.plan_id) : null;
    const amount = +(p && p.daily_base) || 0;
    if (!amount) throw new Error("Tu plan no tiene base diaria.");
    if (driver.base_paid_date === this.todayKey()) throw new Error("La base de hoy ya está paga.");
    const c = await this.company();
    await DB.update("drivers", driver.id, { base_paid_date: this.todayKey(), balance: (+driver.balance || 0) - amount });
    await DB.insert("billing", { concept: `Base diaria ${this.todayKey()} (${driver.name})`, amount, driver_id: driver.id });
    await DB.update("company", c.id, { balance: (+c.balance || 0) + amount });
    return amount;
  },

  nearest(order, drivers, exclude = []) {
    const busy = new Set(); // conductores con viaje activo se filtran antes de llamar
    return drivers.filter(d => d.online && d.status === "active" && !exclude.includes(d.id) && !busy.has(d.id) && d.lat && (!order.service_id || !d.service_id || d.service_id === order.service_id))
      .map(d => ({ d, km: order.origin_lat ? UI.km([order.origin_lat, order.origin_lng], [d.lat, d.lng]) : 0 }))
      .sort((a, b) => a.km - b.km)[0]?.d || null;
  }
};
