-- 2.0: cartons. A product can have units per carton and a cheaper price for a whole carton.
-- Order lines keep qty in units; place_order splits each line into whole cartons + leftover units.
alter table products add column if not exists pack_size int, add column if not exists pack_price numeric;
alter table products add constraint products_pack_ok check (
  (pack_size is null or pack_size between 2 and 1000) and
  (pack_price is null or (pack_price > 0 and pack_size is not null)));

alter table order_lines add column if not exists packs int not null default 0,
  add column if not exists pack_size int, add column if not exists pack_price numeric;

-- The store's catalog with carton info. The carton deal counts only when it is cheaper
-- than buying the same units one by one (at this store's price).
create or replace function store_catalog_packs(p_store uuid)
returns table(id uuid, sku text, name text, category text, subcategory text, price numeric, sort int,
              special boolean, pack_size int, pack_price numeric)
language sql stable security definer set search_path = public as $$
  select c.id, c.sku, c.name, c.category, c.subcategory, c.price, c.sort, c.special, p.pack_size,
         case when p.pack_price < c.price * p.pack_size then p.pack_price end
  from store_catalog(p_store) c join products p on p.id = c.id
  order by c.category, c.sort, c.name;
$$;
revoke all on function store_catalog_packs(uuid) from public, anon;
grant execute on function store_catalog_packs(uuid) to authenticated;

create or replace function place_order(p_store uuid, p_lines jsonb, p_note text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare st stores; oid uuid; num int; tot numeric := 0; l jsonb; p record; q int; n int := 0; k int; lt numeric;
begin
  if not is_store_member(p_store) then raise exception 'forbidden'; end if;
  select * into st from stores where id = p_store;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'empty order'; end if;
  if jsonb_array_length(p_lines) > 500 then raise exception 'too many lines'; end if;
  update suppliers set next_order_no = next_order_no + 1 where id = st.supplier_id returning next_order_no - 1 into num;
  insert into orders(supplier_id, store_id, number, created_by, note)
    values (st.supplier_id, st.id, num, auth.uid(), left(coalesce(p_note, ''), 1000)) returning id into oid;
  for l in select * from jsonb_array_elements(p_lines) loop
    q := (l->>'qty')::int;
    if q is null or q < 1 or q > 9999 then raise exception 'bad qty'; end if;
    select c.* into p from store_catalog_packs(p_store) c where c.id = (l->>'product_id')::uuid;
    if not found then raise exception 'unknown product'; end if;
    k := case when p.pack_price is not null then q / p.pack_size else 0 end;
    lt := k * coalesce(p.pack_price, 0) + (q - k * coalesce(p.pack_size, 0)) * p.price;
    insert into order_lines(order_id, product_id, sku, name, qty, price, note, packs, pack_size, pack_price)
      values (oid, p.id, p.sku, p.name, q, p.price, left(coalesce(l->>'note', ''), 300), k, p.pack_size,
              case when k > 0 then p.pack_price end);
    tot := tot + lt; n := n + 1;
  end loop;
  update orders set total = tot where id = oid;
  return jsonb_build_object('id', oid, 'number', num, 'total', tot, 'lines', n);
end $$;

-- Price list import: optional "pack_size" / "pack_price" columns. Rows without them keep what the product had.
create or replace function import_products(p_supplier uuid, p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare r jsonb; n int := 0; i int := 0; ps int; pp numeric; has boolean;
begin
  if not is_supplier_admin(p_supplier) then raise exception 'forbidden'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    continue when coalesce(trim(r->>'sku'), '') = '' or coalesce(trim(r->>'name'), '') = '';
    has := r ? 'pack_size';
    ps := nullif(trim(r->>'pack_size'), '')::numeric::int;
    if ps is not null and (ps < 2 or ps > 1000) then ps := null; end if;
    pp := nullif(trim(r->>'pack_price'), '')::numeric;
    if ps is null or pp <= 0 then pp := null; end if;
    insert into products(supplier_id, sku, name, category, subcategory, price, sort, active, pack_size, pack_price)
    values (p_supplier, trim(r->>'sku'), trim(r->>'name'), coalesce(nullif(trim(r->>'category'), ''), 'כללי'),
            coalesce(trim(r->>'subcategory'), ''), coalesce(nullif(r->>'price', '')::numeric, 0), i, true, ps, pp)
    on conflict (supplier_id, sku) do update set name = excluded.name, category = excluded.category,
      subcategory = excluded.subcategory, price = excluded.price, sort = excluded.sort, active = true,
      pack_size = case when has then excluded.pack_size else products.pack_size end,
      pack_price = case when has then excluded.pack_price else products.pack_price end;
    n := n + 1;
  end loop;
  return n;
end $$;
