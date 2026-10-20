-- 2.18: supplier deals and new products shown to stores in a carousel, and a brand banner per supplier.
-- deals has RLS on and no grants: only the functions below touch it. Images live in the logos bucket
-- under the supplier's folder (the existing logos_admin_write policy covers them).

alter table suppliers add column if not exists banner_url text;

create table if not exists deals (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references suppliers(id) on update cascade,
  product_id uuid not null references products(id) on update cascade,
  kind text not null default 'deal' check (kind in ('deal', 'new')),
  price numeric not null check (price > 0),
  was_price numeric,
  ends_on date not null,
  audience text not null default 'mine' check (audience in ('mine', 'all')),
  image_url text,
  bg text, accent text,
  hidden boolean not null default false,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
alter table deals enable row level security;
create index if not exists deals_live on deals (supplier_id) where ended_at is null;

create or replace function deal_live(d deals) returns boolean
language sql stable set search_path = public as $$
  select d.ended_at is null and d.ends_on >= today_il()
$$;

-- 'all' (every store in the system) is for Gold, and for older accounts that have no subscription.
create or replace function supplier_may_show_all(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from supplier_members m join subscriptions s on s.user_id = m.user_id
                     where m.supplier_id = sid)
      or exists (select 1 from supplier_members m join subscriptions s on s.user_id = m.user_id
                 where m.supplier_id = sid and s.plan = 'gold')
$$;

-- A live deal lowers the price the store pays (place_order reads prices from here too).
create or replace function store_catalog(p_store uuid)
returns table(id uuid, sku text, name text, category text, subcategory text, price numeric, sort integer, special boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.sku, p.name, p.category, p.subcategory,
         least(coalesce(sp.price, p.price), coalesce(dl.price, coalesce(sp.price, p.price))),
         p.sort, sp.price is not null
  from stores st
  join products p on p.supplier_id = st.supplier_id and p.active
  left join store_products sp on sp.store_id = st.id and sp.product_id = p.id
  left join lateral (select min(d.price) price from deals d
                     where d.product_id = p.id and d.supplier_id = st.supplier_id and not d.hidden and deal_live(d)) dl on true
  where st.id = p_store and is_store_member(p_store)
    and (not st.custom_catalog or sp.product_id is not null)
  order by p.category, p.sort, p.name;
$$;

-- What a store sees: live deals of its suppliers, and deals other suppliers show to everyone.
create or replace function store_deals() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'linked' desc, x->>'created_at' desc), '[]'::jsonb) from (
    select jsonb_build_object('id', d.id, 'supplier_id', d.supplier_id, 'supplier', s.name, 'logo', s.logo_url,
      'banner', s.banner_url, 'color', s.color, 'product_id', d.product_id, 'name', pr.name, 'kind', d.kind,
      'price', d.price, 'was_price', d.was_price, 'ends_on', d.ends_on, 'image', d.image_url, 'bg', d.bg,
      'accent', d.accent, 'created_at', d.created_at,
      'linked', ls.id is not null, 'store_id', ls.id,
      'state', case when ls.id is not null then 'linked'
        else (select l.status from link_requests l where l.user_id = auth.uid() and l.supplier_id = d.supplier_id) end) x
    from deals d
    join suppliers s on s.id = d.supplier_id
    join products pr on pr.id = d.product_id and pr.active
    left join lateral (select st.id from stores st join store_members m on m.store_id = st.id
                       where st.supplier_id = d.supplier_id and m.user_id = auth.uid() and st.active
                       order by st.created_at limit 1) ls on true
    where auth.uid() is not null and not d.hidden and deal_live(d)
      and (ls.id is not null or d.audience = 'all')
      and not exists (select 1 from supplier_members sm where sm.supplier_id = d.supplier_id and sm.user_id = auth.uid())
    order by d.created_at desc limit 30) q
$$;

create or replace function supplier_deals(p_supplier uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'product_id', d.product_id, 'name', pr.name, 'kind', d.kind,
      'price', d.price, 'was_price', d.was_price, 'regular', pr.price, 'ends_on', d.ends_on, 'audience', d.audience,
      'image', d.image_url, 'bg', d.bg, 'accent', d.accent, 'hidden', d.hidden, 'created_at', d.created_at)
    order by d.created_at), '[]'::jsonb)
  from deals d join products pr on pr.id = d.product_id
  where d.supplier_id = p_supplier and deal_live(d) and is_supplier_admin(p_supplier)
$$;

create or replace function save_deal(p_supplier uuid, p_product uuid, p_kind text, p_price numeric, p_ends date,
  p_audience text, p_image text, p_bg text, p_accent text) returns uuid
language plpgsql security definer set search_path = public as $$
declare pr products; did uuid;
  img_ok text := 'https://ypvmtozfboclzwinbvac.supabase.co/storage/v1/object/public/logos/' || p_supplier::text || '/';
begin
  if not is_supplier_admin(p_supplier) then raise exception 'forbidden'; end if;
  select * into pr from products where id = p_product and supplier_id = p_supplier and active;
  if not found then raise exception 'unknown product'; end if;
  if p_kind not in ('deal', 'new') or p_audience not in ('mine', 'all') or p_price is null or p_price <= 0
     or p_ends is null or p_ends < today_il() or p_ends > today_il() + 90 then raise exception 'deal bad input'; end if;
  if p_kind = 'deal' and p_price >= pr.price then raise exception 'deal price'; end if;
  if p_audience = 'all' and not supplier_may_show_all(p_supplier) then raise exception 'deal gold'; end if;
  if (select count(*) from deals d where d.supplier_id = p_supplier and deal_live(d)) >= 3 then raise exception 'deal limit'; end if;
  if p_image is not null and left(p_image, length(img_ok)) <> img_ok then raise exception 'deal bad input'; end if;
  insert into deals(supplier_id, product_id, kind, price, was_price, ends_on, audience, image_url, bg, accent)
  values (p_supplier, p_product, p_kind, round(p_price, 2), case when p_kind = 'deal' then pr.price end, p_ends, p_audience,
    nullif(p_image, ''),
    case when p_bg ~ '^#[0-9A-Fa-f]{6}$' then p_bg end, case when p_accent ~ '^#[0-9A-Fa-f]{6}$' then p_accent end)
  returning id into did;
  return did;
end $$;

create or replace function end_deal(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update deals set ended_at = now() where id = p_id and ended_at is null and is_supplier_admin(supplier_id);
  if not found then raise exception 'forbidden'; end if;
end $$;

create or replace function admin_deals() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'supplier', s.name, 'name', pr.name, 'kind', d.kind,
      'price', d.price, 'was_price', d.was_price, 'ends_on', d.ends_on, 'audience', d.audience, 'hidden', d.hidden,
      'image', d.image_url) order by d.created_at desc), '[]'::jsonb)
  from deals d join suppliers s on s.id = d.supplier_id join products pr on pr.id = d.product_id
  where deal_live(d) and is_platform_admin()
$$;

create or replace function admin_hide_deal(p_id uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'forbidden'; end if;
  update deals set hidden = coalesce(p_on, false) where id = p_id;
end $$;

revoke execute on function supplier_may_show_all(uuid) from public, anon;
revoke execute on function store_deals() from public, anon;
revoke execute on function supplier_deals(uuid) from public, anon;
revoke execute on function save_deal(uuid, uuid, text, numeric, date, text, text, text, text) from public, anon;
revoke execute on function end_deal(uuid) from public, anon;
revoke execute on function admin_deals() from public, anon;
revoke execute on function admin_hide_deal(uuid, boolean) from public, anon;
grant execute on function supplier_may_show_all(uuid) to authenticated;
grant execute on function store_deals() to authenticated;
grant execute on function supplier_deals(uuid) to authenticated;
grant execute on function save_deal(uuid, uuid, text, numeric, date, text, text, text, text) to authenticated;
grant execute on function end_deal(uuid) to authenticated;
grant execute on function admin_deals() to authenticated;
grant execute on function admin_hide_deal(uuid, boolean) to authenticated;
