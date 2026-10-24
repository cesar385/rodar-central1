// Inicio de sesión común (solo se activa con Supabase configurado)
// Auth.require("managers" | "operators" | "drivers") -> { user, profile }
window.Auth = {
  async require(table) {
    if (!DB.LIVE) {
      const rows = await DB.list(table);
      return { user: { email: "demo@rodar.local", demo: true }, profile: rows[0] || null };
    }
    let user = await DB.auth.user();
    if (!user) user = await this.loginScreen();
    const rows = await DB.list(table, { eq: { email: user.email } });
    let profile = rows[0];
    if (!profile && table === "managers") {
      const all = await DB.list("managers");
      if (!all.length) profile = await DB.insert("managers", { name: user.email.split("@")[0], email: user.email, status: "active", protected: true });
    }
    if (!profile) {
      document.body.innerHTML = `<div class="app"><main><div class="card"><h2>Sin acceso</h2><p class="muted">La cuenta ${UI.esc(user.email)} no está dada de alta en esta sección. Pedile al administrador que te agregue.</p><button class="btn" onclick="DB.auth.signOut().then(()=>location.reload())">Cambiar de cuenta</button></div></main></div>`;
      throw new Error("sin acceso");
    }
    if (profile.status && !["active", "online", "offline"].includes(profile.status) && table !== "drivers") {
      alert("Tu usuario no está activo."); await DB.auth.signOut(); location.reload();
    }
    const lo = document.getElementById("logout");
    if (lo) { lo.hidden = false; lo.onclick = () => DB.auth.signOut().then(() => location.reload()); }
    return { user, profile };
  },
  loginScreen() {
    return new Promise(res => {
      const bg = document.createElement("div"); bg.className = "modal-bg"; bg.style.background = "var(--bg)";
      bg.innerHTML = `<form class="modal"><h2>${UI.esc(RODAR_CONFIG.APP_NAME)} · Ingresar</h2>
        <label>Email</label><input name="e" type="email" required>
        <label>Contraseña</label><input name="p" type="password" required minlength="6">
        <p class="muted" id="msg"></p>
        <div class="row"><button class="btn grow">Ingresar</button><button type="button" class="btn ghost" id="reg">Crear cuenta</button></div></form>`;
      document.body.appendChild(bg);
      const f = bg.querySelector("form"), msg = bg.querySelector("#msg");
      f.onsubmit = async e => {
        e.preventDefault();
        try { const u = await DB.auth.signIn(f.e.value, f.p.value); bg.remove(); res(u); }
        catch (err) { msg.textContent = err.message; }
      };
      bg.querySelector("#reg").onclick = async () => {
        try { await DB.auth.signUp(f.e.value, f.p.value); msg.textContent = "Cuenta creada. Si Supabase pide confirmar el email, revisá tu correo y luego ingresá."; }
        catch (err) { msg.textContent = err.message; }
      };
    });
  }
};
