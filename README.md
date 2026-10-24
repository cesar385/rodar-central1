# Rodar · Central de viajes (panel + operador + conductor + pasajero)

Sistema completo para una remisería / empresa de transporte, con los mismos módulos que un panel tipo "MyHub":

| Carpeta | Módulo | Quién lo usa |
|---|---|---|
| `admin/` | **Panel de control**: Información de empresa, Análisis (9 gráficos), Reportes, Historial de pedidos, Conductores (+ planes de suscripción y niveles), Operadores, Usuarios, Servicios y tarifas, Equipos, Promociones (referidos, descuentos, recargas), Notificaciones, Marketing (QR), APIs y webhooks, Aplicaciones, **Integración HubSpot**, Facturación (plan, saldo, historial), Configuración, Área operacional (mapa), Pasarelas de pago, Respaldo | Dueño / administración |
| `operador/` | Toma de pedidos telefónicos, mapa en vivo, asignación manual o **despacho automático** al conductor libre más cercano, pedidos programados | Telefonista |
| `conductor/` | Conectarse/desconectarse, GPS, recibir/aceptar/rechazar, tomar pedidos libres, llegué → iniciar → finalizar, navegar, llamar/WhatsApp, SOS, saldo, **base diaria (00:00–23:59:59)**, registro de nuevos choferes | Choferes |
| `pasajero/` | Pedido web con ubicación GPS, precio estimado, cupones, seguimiento en vivo, cancelar, calificar | Clientes |
| `supabase/` | Base de datos (`schema.sql`) y función `hubspot-sync` | Backend |
| `hubspot/` | Módulo para páginas de HubSpot CMS + ejemplo de formulario | HubSpot |

> Es una implementación propia (código, nombre y diseño originales). No usa código, logos ni marca de Onde. Cambiá "Rodar" por tu marca en `js/config.js` y en Configuración del panel.

---

## 1. Probarlo ya (modo demo, sin servidor)

1. Descomprimí la carpeta y abrí `index.html` con un servidor local (por ejemplo, la extensión *Live Server* de VS Code, o `python -m http.server` dentro de la carpeta y luego `http://localhost:8000`).
2. Entrá a **Panel → Datos y respaldo → Cargar datos de ejemplo** para ver gráficos con 120 viajes.
3. Abrí en pestañas distintas el pasajero, el operador y el conductor: se comunican en tiempo real dentro del mismo navegador.

En modo demo los datos quedan solo en ese navegador. Para usarlo en serio, seguí los pasos 2 y 3.

---

## 2. Subir a GitHub (GitHub Pages)

1. Creá un repositorio nuevo en GitHub, por ejemplo `rodar-hub` (público si usás GitHub Free).
2. Subí **el contenido** de esta carpeta (no la carpeta contenedora):
   - Desde la web: *Add file → Upload files* → arrastrá todo (incluida la carpeta oculta `.github`; si el navegador no la sube, creá el archivo `.github/workflows/pages.yml` a mano con *Add file → Create new file* y pegá su contenido).
   - O con Git:
     ```bash
     git init && git add . && git commit -m "Rodar: primera versión"
     git branch -M main
     git remote add origin https://github.com/TU-USUARIO/rodar-hub.git
     git push -u origin main
     ```
3. En el repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. Esperá 1–2 minutos (pestaña *Actions*). Tu sistema queda en:
   - `https://TU-USUARIO.github.io/rodar-hub/` (inicio)
   - `.../admin/` · `.../operador/` · `.../conductor/` · `.../pasajero/`

Cada vez que hagas *push* a `main` se vuelve a publicar solo.

---

## 3. Conectar la base de datos (Supabase)

1. En [supabase.com](https://supabase.com) creá un proyecto nuevo (región São Paulo).
2. **SQL Editor → New query** → pegá todo `supabase/schema.sql` → **Run**. Crea tablas, seguridad (RLS), funciones y tiempo real.
3. **Project Settings → API**: copiá la *Project URL* y la clave *anon / publishable*.
4. Editá `js/config.js`:
   ```js
   SUPABASE_URL: "https://xxxxxxxx.supabase.co",
   SUPABASE_ANON_KEY: "eyJ... o sb_publishable_...",
   ```
   Hacé commit/push.
5. **Authentication → Providers → Email**: dejalo activo. (Opcional: desactivá "Confirm email" para que el alta sea inmediata.)
6. **Primer ingreso al panel** (`/admin/`): tocá *Crear cuenta* con tu email. El primer usuario que entra queda como administrador protegido.
7. Dar acceso al resto:
   - **Operadores**: cargalos en *Panel → Operadores* con su email; luego ellos crean su cuenta en `/operador/` con ese mismo email.
   - **Conductores**: cargalos en *Panel → Conductores* (o se registran solos en `/conductor/` y quedan "Activación en espera"). Cambiá su estado a **Activo** para que puedan conectarse.
8. **Authentication → URL Configuration**: en *Site URL* poné `https://TU-USUARIO.github.io/rodar-hub/`.

> Seguridad: la app de pasajeros nunca lee la tabla de pedidos directamente; usa funciones seguras (`create_order`, `track_order`, `cancel_order`, `rate_order`). Los usuarios con sesión (admin, operadores, choferes) tienen acceso completo; si más adelante querés permisos finos por rol, se ajustan las políticas en `schema.sql`.

---

## 4. Integración con HubSpot

Qué se sincroniza:

| Rodar | HubSpot |
|---|---|
| Cliente (nombre, teléfono, email) | **Contacto** (se busca por teléfono o email; si no existe se crea) |
| Pedido / viaje | **Negocio (Deal)** "Viaje #1234 · Origen → Destino", importe, etapa y descripción con conductor, pago y calificación, asociado al contacto |
| Estado del viaje | Etapa: nuevo/en curso → *appointmentscheduled* · finalizado → *closedwon* · cancelado/sin conductor → *closedlost* |

### Opción A — Automática (recomendada, requiere Supabase)

**4.1 Crear el token en HubSpot**
1. HubSpot → ⚙️ Configuración → **Integraciones → Aplicaciones privadas** → *Crear una aplicación privada*. (En cuentas nuevas aparece como **Desarrollo → Apps heredadas → Crear → Privada**.)
2. Nombre: `Rodar`. En **Alcances (scopes)** marcá:
   - `crm.objects.contacts.read` y `crm.objects.contacts.write`
   - `crm.objects.deals.read` y `crm.objects.deals.write`
3. Crear → copiá el **token de acceso** (empieza con `pat-`).

**4.2 Publicar la función en Supabase** (necesitás Node.js instalado)
```bash
npx supabase login
npx supabase link --project-ref TU_REF          # el código que aparece en la URL del proyecto
npx supabase secrets set HUBSPOT_TOKEN=pat-na1-xxxxxxxx
npx supabase secrets set WEBHOOK_SECRET=una-clave-larga-que-inventes
npx supabase functions deploy hubspot-sync --no-verify-jwt
```
(`--no-verify-jwt` es correcto: la función valida por su cuenta el secreto del webhook o que quien la llama sea administrador.)

Opcionales si usás otro pipeline: `HUBSPOT_PIPELINE`, `HUBSPOT_STAGE_OPEN`, `HUBSPOT_STAGE_WON`, `HUBSPOT_STAGE_LOST` (los IDs internos se ven en HubSpot → Configuración → Objetos → Negocios → Pipelines).

**4.3 Disparar la sincronización con cada pedido**
Supabase → **Database → Webhooks → Create a new hook**:
- Nombre: `hubspot_orders` · Tabla: `orders` · Eventos: **Insert** y **Update**
- Tipo: **Supabase Edge Functions** → `hubspot-sync` · Método POST
- **HTTP Headers** → agregar `x-webhook-secret` = la misma clave de `WEBHOOK_SECRET`
- (Opcional) otro hook igual para la tabla `customers` con evento Insert.

**4.4 Probar**: Panel → **Integración HubSpot → Probar conexión**. Luego **Sincronizar todo ahora** para subir los viajes históricos (de a 80 por clic).

### Opción B — Manual por CSV (sirve también en modo demo)
Panel → Integración HubSpot → descargá `contactos.csv` y `negocios.csv`.
En HubSpot: **Contactos → Importar → Archivo desde la computadora → Un archivo → Un objeto**. Importá primero contactos y después negocios (la columna *Phone Number* sirve para asociarlos).

### Opción C — Mostrar la app de pedidos dentro de tu web de HubSpot
La carpeta `hubspot/rodar-pedido.module` es un módulo para HubSpot CMS.

Con la CLI:
```bash
npm install -g @hubspot/cli
hs init                       # o copiá hubspot/hubspot.config.yml.example como hubspot.config.yml
hs upload hubspot/rodar-pedido.module rodar/rodar-pedido.module
```
Después, en el editor de cualquier página o landing: *Agregar → Rodar · Pedido de viaje*, y en el campo **URL** poné `https://TU-USUARIO.github.io/rodar-hub/pasajero/`.

Sin CLI: Marketing → Archivos y plantillas → **Herramientas de diseño** → Archivo → Nuevo archivo → Módulo, y pegá el contenido de `module.html` y los campos de `fields.json`.
Si tu plan no permite módulos personalizados, agregá un módulo **Insertar / HTML enriquecido** en la página y pegá:
```html
<iframe src="https://TU-USUARIO.github.io/rodar-hub/pasajero/" style="width:100%;height:900px;border:0" allow="geolocation"></iframe>
```
`hubspot/formulario-hubspot.html` muestra cómo enviar además cada pedido a un formulario de HubSpot (Forms API), si preferís no usar la función.

---

## 5. Uso diario

- **Servicios**: definí bajada de bandera, $/km, $/min y mínimo. El orden define cómo se ven en la app del pasajero.
- **Área operacional**: clic en el mapa para marcar la zona; los pedidos fuera de ella se rechazan.
- **Planes de conductores**: comisión %, cargo fijo por viaje y **base diaria**. Si en *Plan y saldo* activás "Cobrar comisión automáticamente", al finalizar cada viaje se descuenta del saldo del chofer y se registra en Facturación.
- **Niveles**: habilitalos, definí viajes/calificación mínimos y tocá *Aplicar ahora* para mover a cada chofer al plan que corresponda.
- **Notificaciones**: se crean como borrador y al tocar *Enviar* aparecen en la app de conductores y/o pasajeros.
- **Instalar en el celular**: abrir la app en Chrome → menú ⋮ → *Agregar a la pantalla principal*.

## 6. Estructura

```
index.html            inicio con accesos a los 4 módulos
css/app.css           estilos compartidos
js/config.js          ← ÚNICO archivo a editar (Supabase, nombre, mapa)
js/db.js              datos: Supabase o modo demo (localStorage) con tiempo real
js/ui.js  rides.js  auth.js   utilidades, lógica de viajes, inicio de sesión
admin/ operador/ conductor/ pasajero/
supabase/schema.sql   supabase/functions/hubspot-sync/index.ts
hubspot/              módulo CMS, ejemplo de formulario, config de la CLI
.github/workflows/pages.yml   publicación automática en GitHub Pages
```

Librerías (por CDN, sin instalar nada): Supabase JS 2.45.4, Leaflet 1.9.4 + OpenStreetMap, Chart.js 4.4.1, qrcodejs 1.0.0. La geocodificación usa Nominatim (OpenStreetMap), gratis con uso moderado.
