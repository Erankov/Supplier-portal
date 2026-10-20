-- 2.15: anyone can ask to join (store or supplier) with a plan. The site owner sees the requests,
-- sends a one-time code (48 hours), and the customer opens the account with it.
-- Every customer that joins this way has a subscription: a payment date the owner marks as paid.
-- One day after the payment date the customer sees an alert; 48 hours later the account is blocked.
-- Users from before this change have no subscription and are never blocked.
-- Both tables have RLS on and no grants: only the functions below touch them.

create table if not exists join_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('store', 'supplier')),
  name text not null check (char_length(name) between 1 and 120),
  contact text not null check (char_length(contact) between 1 and 120),
  email text not null check (char_length(email) between 3 and 200),
  phone text not null check (char_length(phone) between 7 and 40),
  address text not null default '' check (char_length(address) <= 200),
  hours text not null default '' check (char_length(hours) <= 200),
  plan text not null check (plan in ('bronze', 'silver', 'gold')),
  status text not null default 'new' check (status in ('new', 'sent', 'registered', 'rejected')),
  created_at timestamptz not null default now(),
  mail_token uuid not null default gen_random_uuid(),
  mailed_at timestamptz,
  code text unique,
  code_expires_at timestamptz,
  code_sent_at timestamptz,
  user_id uuid references auth.users(id) on update cascade on delete set null,
  supplier_id uuid references suppliers(id) on update cascade on delete set null,
  registered_at timestamptz
);
alter table join_requests enable row level security;

create table if not exists subscriptions (
  user_id uuid primary key references auth.users(id) on update cascade on delete cascade,
  request_id uuid unique references join_requests(id) on update cascade on delete set null,
  kind text not null check (kind in ('store', 'supplier')),
  plan text not null check (plan in ('bronze', 'silver', 'gold')),
  next_payment date not null,
  last_paid_at timestamptz,
  blocked boolean not null default false,
  created_at timestamptz not null default now()
);
alter table subscriptions enable row level security;

-- The payment is due by the end of next_payment (Israel time).
create or replace function sub_due_at(d date) returns timestamptz
language sql immutable as $$ select ((d + 1)::timestamp at time zone 'Asia/Jerusalem') $$;

create or replace function sub_state(s subscriptions) returns text
language sql stable as $$
  select case
    when s.blocked then 'blocked'
    when now() < sub_due_at(s.next_payment) then 'ok'
    when now() < sub_due_at(s.next_payment) + interval '48 hours' then 'late'
    else 'blocked' end
$$;

create or replace function sub_json(s subscriptions) returns jsonb
language sql stable as $$
  select jsonb_build_object('kind', s.kind, 'plan', s.plan, 'next_payment', s.next_payment,
    'last_paid_at', s.last_paid_at, 'state', sub_state(s), 'blocked', s.blocked, 'due_at', sub_due_at(s.next_payment),
    'block_at', sub_due_at(s.next_payment) + interval '48 hours', 'since', s.created_at)
$$;

create or replace function today_il() returns date
language sql stable as $$ select (now() at time zone 'Asia/Jerusalem')::date $$;

create or replace function join_valid_email(e text) returns boolean
language sql immutable as $$ select e ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' $$;

create or replace function join_valid_phone(p text) returns boolean
language sql immutable as $$
  select regexp_replace(regexp_replace(p, '[\s\-().]', '', 'g'), '^\+972', '0') ~ '^(0(5\d|7\d)\d{7}|0[23489]\d{7})$'
$$;

-- Public: send a request. Returns the id and a token the email function uses once.
create or replace function submit_join_request(p_kind text, p_name text, p_contact text, p_email text,
  p_phone text, p_address text, p_hours text, p_plan text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r join_requests; e text := lower(trim(coalesce(p_email, '')));
begin
  if p_kind not in ('store', 'supplier') or p_plan not in ('bronze', 'silver', 'gold') then raise exception 'join bad input'; end if;
  if trim(coalesce(p_name, '')) = '' or trim(coalesce(p_contact, '')) = '' then raise exception 'join bad input'; end if;
  if not join_valid_email(e) or not join_valid_phone(coalesce(p_phone, '')) then raise exception 'join bad input'; end if;
  if (select count(*) from join_requests where created_at > now() - interval '1 hour') >= 30 then raise exception 'join too many'; end if;
  if exists (select 1 from join_requests where email = e and status in ('new', 'sent') and created_at > now() - interval '1 day') then
    raise exception 'join exists';
  end if;
  insert into join_requests(kind, name, contact, email, phone, address, hours, plan)
  values (p_kind, left(trim(p_name), 120), left(trim(p_contact), 120), e, left(trim(p_phone), 40),
    left(trim(coalesce(p_address, '')), 200), left(trim(coalesce(p_hours, '')), 200), p_plan)
  returning * into r;
  return jsonb_build_object('id', r.id, 'token', r.mail_token);
end $$;

-- For the email function: the request's details, once per request.
create or replace function join_request_mail(p_id uuid, p_token uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r join_requests;
begin
  update join_requests set mailed_at = now() where id = p_id and mail_token = p_token and mailed_at is null returning * into r;
  if not found then return null; end if;
  return to_jsonb(r) - 'mail_token' - 'code';
end $$;

-- Owner: every request with its subscription and activity.
create or replace function admin_leads() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(x order by x->>'created_at' desc) from (
    select to_jsonb(r) - 'mail_token'
      || jsonb_build_object('code_live', r.code is not null and r.code_expires_at > now() and r.status = 'sent',
        'sub', (select sub_json(s) from subscriptions s where s.user_id = r.user_id),
        'stores', case when r.kind = 'supplier' then (select count(*) from stores where supplier_id = r.supplier_id)
          else (select count(*) from store_members where user_id = r.user_id) end,
        'orders', case when r.kind = 'supplier' then (select count(*) from orders where supplier_id = r.supplier_id)
          else (select count(*) from orders where store_id in (select store_id from store_members where user_id = r.user_id)) end) as x
    from join_requests r) q), '[]'::jsonb);
end $$;

create or replace function admin_send_code(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r join_requests; c text; a text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; k int;
begin
  if not is_platform_admin() then raise exception 'forbidden'; end if;
  select * into r from join_requests where id = p_id for update;
  if not found or r.status not in ('new', 'sent') then raise exception 'join not open'; end if;
  loop
    c := '';
    for k in 0..5 loop c := c || substr(a, 1 + get_byte(uuid_send(gen_random_uuid()), k) % 31, 1); end loop;
    exit when not exists (select 1 from join_requests where code = c);
  end loop;
  update join_requests set code = c, code_expires_at = now() + interval '48 hours', code_sent_at = now(), status = 'sent'
  where id = p_id returning * into r;
  return jsonb_build_object('code', r.code, 'expires_at', r.code_expires_at, 'name', r.name, 'contact', r.contact,
    'email', r.email, 'phone', r.phone, 'kind', r.kind);
end $$;

-- For the email function, called with the owner's sign-in.
create or replace function admin_code_mail(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r join_requests;
begin
  if not is_platform_admin() then raise exception 'forbidden'; end if;
  select * into r from join_requests where id = p_id and status = 'sent' and code_expires_at > now();
  if not found then return null; end if;
  return jsonb_build_object('code', r.code, 'expires_at', r.code_expires_at, 'name', r.name, 'contact', r.contact, 'email', r.email, 'kind', r.kind);
end $$;

create or replace function admin_reject(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'forbidden'; end if;
  update join_requests set status = 'rejected', code = null where id = p_id and status in ('new', 'sent');
end $$;

create or replace function admin_set_plan(p_id uuid, p_plan text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'forbidden'; end if;
  if p_plan not in ('bronze', 'silver', 'gold') then raise exception 'join bad input'; end if;
  update join_requests set plan = p_plan where id = p_id;
  update subscriptions set plan = p_plan where request_id = p_id;
end $$;

create or replace function admin_set_due(p_id uuid, p_date date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'forbidden'; end if;
  if p_date is null then raise exception 'join bad input'; end if;
  update subscriptions set next_payment = p_date where request_id = p_id;
end $$;

-- Paid: the next payment moves a month on (from today if it was far behind) and any block is lifted.
create or replace function admin_mark_paid(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'forbidden'; end if;
  update subscriptions set last_paid_at = now(), blocked = false,
    next_payment = case when (next_payment + interval '1 month')::date < today_il()
      then (today_il() + interval '1 month')::date else (next_payment + interval '1 month')::date end
  where request_id = p_id;
end $$;

create or replace function admin_block(p_id uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'forbidden'; end if;
  update subscriptions set blocked = coalesce(p_on, false) where request_id = p_id;
end $$;

-- Signed-in customer: what a code opens, before using it.
create or replace function join_code_info(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r join_requests;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into r from join_requests where code = upper(trim(coalesce(p_code, ''))) and status = 'sent' and code_expires_at > now();
  if not found then return null; end if;
  return jsonb_build_object('kind', r.kind, 'name', r.name, 'plan', r.plan, 'contact', r.contact);
end $$;

-- Uses up the code and opens the account: a supplier gets its business, a store gets its details kept
-- for when a supplier invites it. The payment date starts on the day the account opens.
create or replace function redeem_join_code(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r join_requests; sid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into r from join_requests where code = upper(trim(coalesce(p_code, ''))) for update;
  if not found or r.status <> 'sent' or r.code_expires_at < now() then raise exception 'join code invalid'; end if;
  if exists (select 1 from subscriptions where user_id = auth.uid()) then raise exception 'join has account'; end if;
  if r.kind = 'supplier' then
    if exists (select 1 from supplier_members where user_id = auth.uid()) then raise exception 'already a supplier'; end if;
    insert into suppliers(name, order_email, phone, address, hours)
    values (r.name, r.email, r.phone, nullif(r.address, ''), nullif(r.hours, '')) returning id into sid;
    insert into supplier_members(supplier_id, user_id) values (sid, auth.uid());
  end if;
  insert into subscriptions(user_id, request_id, kind, plan, next_payment) values (auth.uid(), r.id, r.kind, r.plan, today_il());
  update join_requests set status = 'registered', code = null, user_id = auth.uid(), supplier_id = sid, registered_at = now() where id = r.id;
  return jsonb_build_object('kind', r.kind, 'supplier_id', sid);
end $$;

-- Signed-in customer: their subscription and business details, or null for accounts from before 2.15.
create or replace function my_subscription() returns jsonb
language sql stable security definer set search_path = public as $$
  select sub_json(s) || jsonb_build_object('name', r.name, 'contact', r.contact, 'phone', r.phone,
    'email', r.email, 'address', r.address, 'hours', r.hours)
  from subscriptions s left join join_requests r on r.id = s.request_id where s.user_id = auth.uid()
$$;

-- A blocked customer can't send orders.
create or replace function orders_sub_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from subscriptions s where s.user_id = auth.uid() and sub_state(s) = 'blocked') then
    raise exception 'account blocked';
  end if;
  return new;
end $$;
create trigger orders_sub_check before insert on orders for each row execute function orders_sub_check();

revoke execute on function submit_join_request(text, text, text, text, text, text, text, text) from public;
revoke execute on function join_request_mail(uuid, uuid) from public;
revoke execute on function admin_leads() from public, anon;
revoke execute on function admin_send_code(uuid) from public, anon;
revoke execute on function admin_code_mail(uuid) from public, anon;
revoke execute on function admin_reject(uuid) from public, anon;
revoke execute on function admin_set_plan(uuid, text) from public, anon;
revoke execute on function admin_set_due(uuid, date) from public, anon;
revoke execute on function admin_mark_paid(uuid) from public, anon;
revoke execute on function admin_block(uuid, boolean) from public, anon;
revoke execute on function join_code_info(text) from public, anon;
revoke execute on function redeem_join_code(text) from public, anon;
revoke execute on function my_subscription() from public, anon;
revoke execute on function orders_sub_check() from public, anon, authenticated;
grant execute on function submit_join_request(text, text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function join_request_mail(uuid, uuid) to anon, authenticated;
grant execute on function admin_leads(), admin_send_code(uuid), admin_code_mail(uuid), admin_reject(uuid),
  admin_set_plan(uuid, text), admin_set_due(uuid, date), admin_mark_paid(uuid), admin_block(uuid, boolean),
  join_code_info(text), redeem_join_code(text), my_subscription() to authenticated;
