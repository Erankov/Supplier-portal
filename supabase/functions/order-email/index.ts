// Emails the supplier a new order. The store's browser calls this right after place_order.
// Secrets (Supabase > Edge Functions > Secrets): GMAIL_USER, GMAIL_APP_PASSWORD.
// Sends through Gmail on port 465 (edge functions can't use 25 or 587) with a tiny SMTP client:
// nodemailer hung inside the edge runtime.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
// Echo whatever headers the browser asks for (supabase-js adds its own x-* headers).
const preflight = (req: Request) => new Response("ok", { headers: { ...cors,
  "Access-Control-Allow-Headers": req.headers.get("Access-Control-Request-Headers") ?? "authorization, x-client-info, apikey, content-type" } });
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const ils = (n: number) => "₪" + Number(n || 0).toLocaleString("he-IL", { maximumFractionDigits: 2 });

const b64 = (t: string) => {
  const b = new TextEncoder().encode(t);
  let bin = "";
  for (let i = 0; i < b.length; i += 8192) bin += String.fromCharCode(...b.subarray(i, i + 8192));
  return btoa(bin);
};
async function sendGmail(user: string, pass: string, from: string, to: string, subject: string, html: string) {
  const conn = await Deno.connectTls({ hostname: "smtp.gmail.com", port: 465 });
  const enc = new TextEncoder(), dec = new TextDecoder();
  let buf = "";
  const read = async (want: string) => {
    for (;;) {
      const m = buf.match(/^(\d{3}) .*\r\n/m);
      if (m) {
        const end = buf.indexOf(m[0]) + m[0].length, all = buf.slice(0, end);
        buf = buf.slice(end);
        if (!all.startsWith(want) && !m[1].startsWith(want)) throw new Error("SMTP " + all.trim());
        return all;
      }
      const chunk = new Uint8Array(4096), n = await conn.read(chunk);
      if (n === null) throw new Error("SMTP closed");
      buf += dec.decode(chunk.subarray(0, n));
    }
  };
  const cmd = async (line: string, want: string) => { console.log("smtp: waiting for " + want); await conn.write(enc.encode(line + "\r\n")); return read(want); };
  try {
    await read("220");
    await cmd("EHLO supplier-orders", "250");
    await cmd("AUTH LOGIN", "334");
    await cmd(b64(user), "334");
    await cmd(b64(pass), "235");
    await cmd(`MAIL FROM:<${user}>`, "250");
    await cmd(`RCPT TO:<${to}>`, "250");
    await cmd("DATA", "354");
    const body = b64(html).replace(/.{1,76}/g, "$&\r\n");
    const msg = [
      `From: =?UTF-8?B?${b64(from)}?= <${user}>`, `To: <${to}>`, `Subject: =?UTF-8?B?${b64(subject)}?=`,
      `Date: ${new Date().toUTCString()}`, "MIME-Version: 1.0",
      "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", body,
    ].join("\r\n");
    await cmd(msg + "\r\n.", "250");
    await cmd("QUIT", "221").catch(() => {});
  } finally {
    try { conn.close(); } catch { /* already closed */ }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight(req);
  try {
    const { order_id } = await req.json();
    console.log("order-email: request");
    const url = Deno.env.get("SUPABASE_URL")!;
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return json({ error: "not signed in" }, 401);

    // Read as the store user (RLS lets a store read its own orders and its supplier's order email).
    const { data: o, error } = await asUser.from("orders")
      .select("id, number, note, total, created_at, created_by, stores(name, contact, phone), suppliers(name, order_email), order_lines(id, sku, name, qty, price, note, packs, pack_size, pack_price)")
      .eq("id", order_id).single();
    if (error) console.error("order-email: read order", order_id, error.message);
    // Only the person who placed it, and only right after (so the link can't be replayed to spam).
    if (!o || o.created_by !== user.id) return json({ error: "forbidden" }, 403);
    if (Date.now() - new Date(o.created_at).getTime() > 10 * 60 * 1000) return json({ error: "too old" }, 400);
    const to = o.suppliers?.order_email;
    if (!to) return json({ skipped: "no order email" });
    console.log("order-email: sending order", o.number);

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

    const gu = Deno.env.get("GMAIL_USER")!, gp = (Deno.env.get("GMAIL_APP_PASSWORD") ?? "").replace(/\s/g, "");
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("SMTP timeout")), 20000));
    await Promise.race([timeout, sendGmail(gu, gp, `${o.suppliers?.name ?? "הזמנות"} - הזמנות`, to,
      `הזמנה חדשה #${o.number} מ${s.name ?? "חנות"}`, html)]);
    console.log("order-email: sent order", o.number);
    return json({ sent: true });
  } catch (e) {
    console.error("order-email:", e?.message ?? e);
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
