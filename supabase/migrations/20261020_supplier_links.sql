-- 2.17: a store picks suppliers from a list and asks to join; the supplier approves or declines.
-- On approval the store gets a stores row under that supplier (regular prices) and a membership.
-- RLS on and no grants: only the functions below touch the table.

create table if not exists link_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on update cascade,
  supplier_id uuid not null references suppliers(id) on update cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  name text not null,
  contact text, phone text, email text, address text, hours text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  store_id uuid references stores(id) on update cascade,
  mail_token uuid not null default gen_random_uuid(),
  mailed_at timestamptz,
  unique (user_id, supplier_id)
);
alter table link_requests enable row level security;

-- The store's details: from its join request, else from a store row it already has.
create or replace function my_store_profile() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_build_object('name', r.name, 'contact', r.contact, 'phone', r.phone, 'email', r.email,
       'address', r.address, 'hours', r.hours)
     from subscriptions s join join_requests r on r.id = s.request_id
     where s.user_id = auth.uid() and s.kind = 'store'),
    (select jsonb_build_object('name', st.name, 'contact', st.contact, 'phone', st.phone, 'email', st.email,
       'address', st.address, 'hours', st.hours)
     from stores st join store_members m on m.store_id = st.id
     where m.user_id = auth.uid() order by st.created_at desc limit 1))
$$;

-- Every supplier, with this store's state for each: linked, pending, declined or null.
create or replace function supplier_directory() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'logo', p.logo_url, 'color', p.color,
      'address', p.address,
      'state', case
        when exists (select 1 from stores st join store_members m on m.store_id = st.id
                     where m.user_id = auth.uid() and st.supplier_id = p.id) then 'linked'
        else (select l.status from link_requests l where l.user_id = auth.uid() and l.supplier_id = p.id) end)
    order by p.name), '[]'::jsonb)
  from suppliers p
  where auth.uid() is not null
    and not exists (select 1 from supplier_members sm where sm.supplier_id = p.id and sm.user_id = auth.uid())
$$;

create or replace function request_supplier(p_supplier uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr jsonb := my_store_profile(); l link_requests;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if pr is null then raise exception 'link no store'; end if;
  if not exists (select 1 from suppliers where id = p_supplier) then raise exception 'link bad supplier'; end if;
  if exists (select 1 from stores st join store_members m on m.store_id = st.id
             where m.user_id = auth.uid() and st.supplier_id = p_supplier) then raise exception 'link exists'; end if;
  if (select count(*) from link_requests where user_id = auth.uid() and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'join too many';
  end if;
  insert into link_requests(user_id, supplier_id, name, contact, phone, email, address, hours)
  values (auth.uid(), p_supplier, pr->>'name', pr->>'contact', pr->>'phone', pr->>'email', pr->>'address', pr->>'hours')
  on conflict (user_id, supplier_id) do update set status = 'pending', created_at = now(), decided_at = null,
    name = excluded.name, contact = excluded.contact, phone = excluded.phone, email = excluded.email,
    address = excluded.address, hours = excluded.hours, mail_token = gen_random_uuid(), mailed_at = null
    where link_requests.status <> 'pending'
  returning * into l;
  if l.id is null then raise exception 'link pending'; end if;
  return jsonb_build_object('id', l.id, 'token', l.mail_token);
end $$;

-- For the email to the supplier: returns the request once, only to the store that sent it.
create or replace function link_request_mail(p_id uuid, p_token uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l link_requests; p suppliers;
begin
  update link_requests set mailed_at = now()
  where id = p_id and mail_token = p_token and user_id = auth.uid() and mailed_at is null and status = 'pending'
  returning * into l;
  if l.id is null then return null; end if;
  select * into p from suppliers where id = l.supplier_id;
  return jsonb_build_object('to', p.order_email, 'supplier', p.name, 'name', l.name, 'contact', l.contact,
    'phone', l.phone, 'email', l.email, 'address', l.address, 'hours', l.hours, 'created_at', l.created_at);
end $$;

create or replace function supplier_link_requests(p_supplier uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'contact', l.contact, 'phone', l.phone,
      'email', l.email, 'address', l.address, 'hours', l.hours, 'created_at', l.created_at) order by l.created_at), '[]'::jsonb)
  from link_requests l where l.supplier_id = p_supplier and l.status = 'pending' and is_supplier_admin(p_supplier)
$$;

create or replace function supplier_link_decide(p_id uuid, p_ok boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare l link_requests; sid uuid;
begin
  select * into l from link_requests where id = p_id for update;
  if not found or not is_supplier_admin(l.supplier_id) then raise exception 'forbidden'; end if;
  if l.status <> 'pending' then raise exception 'link decided'; end if;
  if p_ok then
    insert into stores(supplier_id, name, contact, phone, email, address, hours)
    values (l.supplier_id, l.name, l.contact, l.phone, l.email, nullif(l.address, ''), nullif(l.hours, ''))
    returning id into sid;
    insert into store_members(store_id, user_id) values (sid, l.user_id) on conflict do nothing;
  end if;
  update link_requests set status = case when p_ok then 'approved' else 'declined' end, decided_at = now(), store_id = sid
  where id = l.id;
  return sid;
end $$;

revoke execute on function my_store_profile() from public, anon;
revoke execute on function supplier_directory() from public, anon;
revoke execute on function request_supplier(uuid) from public, anon;
revoke execute on function link_request_mail(uuid, uuid) from public, anon;
revoke execute on function supplier_link_requests(uuid) from public, anon;
revoke execute on function supplier_link_decide(uuid, boolean) from public, anon;
grant execute on function my_store_profile() to authenticated;
grant execute on function supplier_directory() to authenticated;
grant execute on function request_supplier(uuid) to authenticated;
grant execute on function link_request_mail(uuid, uuid) to authenticated;
grant execute on function supplier_link_requests(uuid) to authenticated;
grant execute on function supplier_link_decide(uuid, boolean) to authenticated;
