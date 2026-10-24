// ============================================================
//  Edge Function: hubspot-sync
//  Clientes -> Contactos de HubSpot · Pedidos -> Negocios (Deals)
//  Secretos necesarios (Supabase → Edge Functions → Secrets):
//    HUBSPOT_TOKEN   token de la "Private App" / app legacy de HubSpot
//    WEBHOOK_SECRET  cualquier texto largo; se repite en el header del Database Webhook
//  Opcionales: HUBSPOT_PIPELINE (default "default"), HUBSPOT_STAGE_OPEN / _WON / _LOST
// ============================================================
import { createClient } from "jsr:@supabase/supabase-js@2";

const HS = "https://api.hubapi.com";
const TOKEN = Deno.env.get("HUBSPOT_TOKEN") ?? "";
const SECRET = Deno.env.get("WEBHOOK_SECRET") ?? "";
const PIPELINE = Deno.env.get("HUBSPOT_PIPELINE") ?? "default";
const STAGE = {
  open: Deno.env.get("HUBSPOT_STAGE_OPEN") ?? "appointmentscheduled",
  won: Deno.env.get("HUBSPOT_STAGE_WON") ?? "closedwon",
  lost: Deno.env.get("HUBSPOT_STAGE_LOST") ?? "closedlost",
};
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-webhook-secret",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b, null, 1), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function hs(path: string, method = "GET", body?: unknown) {
  const r = await fetch(HS + path, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HubSpot ${r.status}: ${t}`);
  return t ? JSON.parse(t) : {};
}

function splitName(n = "") {
  const p = n.trim().split(/\s+/);
  return { firstname: p[0] ?? "", lastname: p.slice(1).join(" ") };
}

// Busca el contacto por teléfono (o email); si no existe lo crea. Devuelve el id de HubSpot.
async function upsertContact(c: { name?: string; phone?: string; email?: string; hubspot_id?: string }) {
  const props: Record<string, string> = { ...splitName(c.name), phone: c.phone ?? "" };
  if (c.email) props.email = c.email;
  let id = c.hubspot_id;
  if (!id) {
    const filters = [{ propertyName: "phone", operator: "EQ", value: c.phone }];
    const r = await hs("/crm/v3/objects/contacts/search", "POST", { filterGroups: [{ filters }], limit: 1 });
    id = r.results?.[0]?.id;
    if (!id && c.email) {
      const r2 = await hs("/crm/v3/objects/contacts/search", "POST", { filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: c.email }] }], limit: 1 });
      id = r2.results?.[0]?.id;
    }
  }
  if (id) await hs(`/crm/v3/objects/contacts/${id}`, "PATCH", { properties: props });
  else id = (await hs("/crm/v3/objects/contacts", "POST", { properties: { ...props, lifecyclestage: "customer" } })).id;
  if (c.phone) await db.from("customers").update({ hubspot_id: id }).eq("phone", c.phone);
  return id as string;
}

function stageOf(s: string) {
  return s === "completed" ? STAGE.won : ["cancelled", "missed"].includes(s) ? STAGE.lost : STAGE.open;
}

async function syncOrder(o: any) {
  if (!o?.customer_phone) return { skipped: "sin teléfono" };
  const { data: cust } = await db.from("customers").select("*").eq("phone", o.customer_phone).maybeSingle();
  const contactId = await upsertContact({ name: o.customer_name, phone: o.customer_phone, email: o.customer_email, hubspot_id: cust?.hubspot_id });
  const { data: drv } = o.driver_id ? await db.from("drivers").select("name,plate").eq("id", o.driver_id).maybeSingle() : { data: null };
  const properties: Record<string, unknown> = {
    dealname: `Viaje #${o.number} · ${o.origin ?? ""} → ${o.destination ?? ""}`.slice(0, 250),
    amount: String(o.price ?? 0),
    pipeline: PIPELINE,
    dealstage: stageOf(o.status),
    closedate: new Date(o.completed_at ?? o.created_at).toISOString(),
    description: [`Estado: ${o.status}`, `Origen: ${o.origin ?? "-"}`, `Destino: ${o.destination ?? "-"}`, `Pago: ${o.payment_method ?? "-"}`,
      `Canal: ${o.source ?? "-"}`, drv ? `Conductor: ${drv.name} (${drv.plate ?? ""})` : "", o.coupon ? `Cupón: ${o.coupon}` : "", o.rating ? `Calificación: ${o.rating}★` : ""].filter(Boolean).join("\n"),
  };
  if (o.hubspot_deal_id) {
    await hs(`/crm/v3/objects/deals/${o.hubspot_deal_id}`, "PATCH", { properties });
    return { deal: o.hubspot_deal_id, contact: contactId, updated: true };
  }
  const deal = await hs("/crm/v3/objects/deals", "POST", {
    properties,
    associations: [{ to: { id: contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 }] }], // 3 = deal → contact
  });
  await db.from("orders").update({ hubspot_deal_id: deal.id }).eq("id", o.id);
  return { deal: deal.id, contact: contactId, created: true };
}

async function isManager(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace("Bearer ", "");
  const { data } = await db.auth.getUser(token);
  if (!data.user) return false;
  const { data: m } = await db.from("managers").select("id").eq("email", data.user.email).eq("status", "active").maybeSingle();
  return !!m;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!TOKEN) return json({ error: "Falta el secreto HUBSPOT_TOKEN" }, 500);
  try {
    const body = await req.json().catch(() => ({}));

    // 1) Llamada desde un Database Webhook de Supabase
    if (body.type && body.table) {
      if (!SECRET || req.headers.get("x-webhook-secret") !== SECRET) return json({ error: "webhook no autorizado" }, 401);
      const o = body.record, old = body.old_record;
      if (body.table === "customers") return json({ contact: await upsertContact(o) });
      if (body.table !== "orders") return json({ skipped: body.table });
      if (body.type === "UPDATE" && old && old.status === o.status && old.price === o.price && old.driver_id === o.driver_id && old.rating === o.rating)
        return json({ skipped: "sin cambios relevantes" });
      return json(await syncOrder(o));
    }

    // 2) Llamada manual desde el panel (requiere usuario administrador)
    if (!(await isManager(req))) return json({ error: "Solo administradores" }, 401);
    if (body.action === "ping") {
      const r = await hs("/crm/v3/objects/contacts?limit=1");
      return json({ ok: true, mensaje: "Conexión con HubSpot correcta", contactos_visibles: r.results?.length ?? 0 });
    }
    if (body.action === "full_sync") {
      const { data: orders } = await db.from("orders").select("*").is("hubspot_deal_id", null).order("created_at").limit(80);
      const out = [];
      for (const o of orders ?? []) {
        try { out.push({ n: o.number, ...(await syncOrder(o)) }); } catch (e) { out.push({ n: o.number, error: String(e) }); }
      }
      return json({ procesados: out.length, detalle: out, nota: out.length === 80 ? "Quedan más: volvé a presionar 'Sincronizar todo'" : "Listo" });
    }
    return json({ error: "acción desconocida" }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
