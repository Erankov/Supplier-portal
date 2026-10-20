// Emails the supplier a new order. The store's browser calls this right after place_order.
// Secrets (Supabase > Edge Functions > Secrets): GMAIL_USER, GMAIL_APP_PASSWORD.
// Sends through Gmail on port 465 (edge functions can't use 25 or 587).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import nodemailer from "npm:nodemailer@6.9.14";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const ils = (n: number) => "₪" + Number(n || 0).toLocaleString("he-IL", { maximumFractionDigits: 2 });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { order_id } = await req.json();
    const url = Deno.env.get("SUPABASE_URL")!;
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return json({ error: "not signed in" }, 401);

    const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: o } = await db.from("orders")
      .select("id, number, note, total, created_at, created_by, stores(name, contact, phone), suppliers(name, order_email), order_lines(id, sku, name, qty, price, note, packs, pack_size, pack_price)")
      .eq("id", order_id).single();
    // Only the person who placed it, and only right after (so the link can't be replayed to spam).
    if (!o || o.created_by !== user.id) return json({ error: "forbidden" }, 403);
    if (Date.now() - new Date(o.created_at).getTime() > 10 * 60 * 1000) return json({ error: "too old" }, 400);
    const to = o.suppliers?.order_email;
    if (!to) return json({ skipped: "no order email" });

    const lines = (o.order_lines ?? []).sort((a, b) => a.id - b.id);
    const rows = lines.map((l) => {
      const k = l.packs || 0, sum = k * Number(l.pack_price || 0) + (l.qty - k * (l.pack_size || 0)) * Number(l.price);
      return `<tr><td>${esc(l.sku)}</td><td>${esc(l.name)}${l.note ? `<br><small>${esc(l.note)}</small>` : ""}</td>` +
        `<td style="text-align:center">${l.qty}${k ? ` (${k} קרטונים)` : ""}</td><td>${ils(sum)}</td></tr>`;
    }).join("");
    const s = o.stores ?? {};
    const html = `<div dir="rtl" style="font-family:Arial,sans-serif">
<h2>הזמנה חדשה #${o.number} מ${esc(s.name)}</h2>
<p>${esc(s.contact)} ${s.phone ? "· " + esc(s.phone) : ""}<br>${new Date(o.created_at).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" })}</p>
<table border="1" cellpadding="6" style="border-collapse:collapse"><tr><th>מק"ט</th><th>פריט</th><th>כמות</th><th>סה"כ</th></tr>${rows}</table>
<p><b>סה"כ: ${ils(o.total)}</b></p>${o.note ? `<p>הערות: ${esc(o.note)}</p>` : ""}
<p><a href="https://supplier-orders.netlify.app">לפתיחת ההזמנה באתר</a></p></div>`;

    const user_ = Deno.env.get("GMAIL_USER")!;
    const mail = nodemailer.createTransport({
      host: "smtp.gmail.com", port: 465, secure: true,
      auth: { user: user_, pass: Deno.env.get("GMAIL_APP_PASSWORD")! },
    });
    await mail.sendMail({
      from: `"${o.suppliers?.name ?? "הזמנות"} - הזמנות" <${user_}>`,
      to, subject: `הזמנה חדשה #${o.number} מ${s.name ?? "חנות"}`, html,
    });
    return json({ sent: true });
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
