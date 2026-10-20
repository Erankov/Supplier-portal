// 2.15: emails about join requests. Called from the browser:
//   {action:"new", id, token}  right after someone sends a request: tells the site owner (GMAIL_USER), once per request.
//   {action:"code", id}        by the site owner after making a code: sends the code to the customer.
//   {action:"link", id, token} right after a store asks to join a supplier (2.17): tells the supplier.
// Secrets and the SMTP client are the same as order-email.
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

const SITE = "https://supplier-orders.netlify.app";
const KIND: Record<string, string> = { store: "חנות / משווק", supplier: "ספק" };
const PLAN: Record<string, string> = { bronze: "ברונזה", silver: "סילבר", gold: "גולד" };
const when = (t: string) => new Date(t).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "short", timeStyle: "short" });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight(req);
  try {
    const { action, id, token } = await req.json();
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const gu = Deno.env.get("GMAIL_USER")!, gp = (Deno.env.get("GMAIL_APP_PASSWORD") ?? "").replace(/\s/g, "");
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("SMTP timeout")), 20000));
    let to: string, subject: string, html: string;

    if (action === "new") {
      // The token is only in the sender's browser, and the function returns the request once.
      const { data: r, error } = await db.rpc("join_request_mail", { p_id: id, p_token: token });
      if (error) console.error("join-email: read request", error.message);
      if (!r) return json({ error: "forbidden" }, 403);
      to = gu;
      subject = `פנייה חדשה: ${r.name} (${KIND[r.kind] ?? r.kind})`;
      html = `<div dir="rtl" style="font-family:Arial,sans-serif">
<h2>פנייה חדשה להצטרפות</h2>
<p><b>${esc(r.name)}</b> · ${esc(KIND[r.kind])} · מסלול ${esc(PLAN[r.plan])}</p>
<p>איש קשר: ${esc(r.contact)}<br>טלפון: ${esc(r.phone)}<br>מייל: ${esc(r.email)}<br>כתובת: ${esc(r.address)}<br>שעות פעילות: ${esc(r.hours)}</p>
<p>${when(r.created_at)}</p>
<p><a href="${SITE}/#/leads">לפניות ולקוחות באתר</a></p></div>`;
    } else if (action === "code") {
      const { data: r, error } = await db.rpc("admin_code_mail", { p_id: id });
      if (error) console.error("join-email: read code", error.message);
      if (!r) return json({ error: "forbidden" }, 403);
      to = r.email;
      subject = "הקוד שלך לפתיחת החשבון";
      html = `<div dir="rtl" style="font-family:Arial,sans-serif">
<h2>שלום ${esc(r.contact)},</h2>
<p>הקוד לפתיחת החשבון של ${esc(r.name)}:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:6px" dir="ltr">${esc(r.code)}</p>
<p>נכנסים לאתר, לוחצים "קיבלתם קוד? פתיחת חשבון", ממלאים את הקוד, המייל וסיסמה.<br>הקוד עובד פעם אחת ותקף עד ${when(r.expires_at)}.</p>
<p><a href="${SITE}/#/code/${encodeURIComponent(r.code)}">לפתיחת החשבון</a></p></div>`;
    } else if (action === "link") {
      // A store asked to join a supplier: tell the supplier, once per request.
      const { data: r, error } = await db.rpc("link_request_mail", { p_id: id, p_token: token });
      if (error) console.error("join-email: read link", error.message);
      if (!r) return json({ error: "forbidden" }, 403);
      if (!r.to) return json({ sent: false });
      to = r.to;
      subject = `בקשת הצטרפות מחנות: ${r.name}`;
      html = `<div dir="rtl" style="font-family:Arial,sans-serif">
<h2>${esc(r.name)} מבקשת להזמין מ${esc(r.supplier)}</h2>
<p>איש קשר: ${esc(r.contact)}<br>טלפון: ${esc(r.phone)}<br>מייל: ${esc(r.email)}<br>כתובת: ${esc(r.address)}<br>שעות פעילות: ${esc(r.hours)}</p>
<p>${when(r.created_at)}</p>
<p><a href="${SITE}/#/stores">לאישור או דחייה באתר</a></p></div>`;
    } else return json({ error: "bad action" }, 400);

    await Promise.race([timeout, sendGmail(gu, gp, "מערכת ההזמנות", to, subject, html)]);
    console.log("join-email: sent", action);
    return json({ sent: true });
  } catch (e) {
    console.error("join-email:", e?.message ?? e);
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
