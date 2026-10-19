-- 1.5: each store can have its own catalog (only chosen products) and its own prices.
-- A store_products row is a special price; for a store with custom_catalog it also means "in its catalog".

alter table stores add column if not exists custom_catalog boolean not null default false;

create table if not exists store_products (
  store_id uuid not null references stores(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  price numeric check (price >= 0),
  primary key (store_id, product_id)
);
create index if not exists store_products_product on store_products(product_id);
alter table store_products enable row level security;
-- Tables created through the Supabase connector get no API grants; RLS below still limits rows.
grant select, insert, update, delete on table store_products to authenticated;

-- Only the supplier reads and edits it; stores get their catalog through store_catalog().
create policy store_products_admin on store_products for all
  using (exists (select 1 from stores s where s.id = store_id and is_supplier_admin(s.supplier_id)))
  with check (exists (select 1 from stores s join products p on p.supplier_id = s.supplier_id
                      where s.id = store_id and p.id = product_id and is_supplier_admin(s.supplier_id)));

-- What a store sees: active products, only its own when it has a custom catalog, at its price.
create or replace function store_catalog(p_store uuid)
returns table (id uuid, sku text, name text, category text, subcategory text, price numeric, sort int, special boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.sku, p.name, p.category, p.subcategory, coalesce(sp.price, p.price), p.sort, sp.price is not null
  from stores st
  join products p on p.supplier_id = st.supplier_id and p.active
  left join store_products sp on sp.store_id = st.id and sp.product_id = p.id
  where st.id = p_store and is_store_member(p_store)
    and (not st.custom_catalog or sp.product_id is not null)
  order by p.category, p.sort, p.name;
$$;

-- The supplier saves a store's catalog from the site straight into store_products (allowed by the policy above).

-- Orders: only products the store may see, at the store's price.
create or replace function place_order(p_store uuid, p_lines jsonb, p_note text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare st stores; oid uuid; num int; tot numeric := 0; l jsonb; p record; q int; n int := 0;
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
    select c.* into p from store_catalog(p_store) c where c.id = (l->>'product_id')::uuid;
    if not found then raise exception 'unknown product'; end if;
    insert into order_lines(order_id, product_id, sku, name, qty, price, note)
      values (oid, p.id, p.sku, p.name, q, p.price, left(coalesce(l->>'note', ''), 300));
    tot := tot + p.price * q; n := n + 1;
  end loop;
  update orders set total = tot where id = oid;
  return jsonb_build_object('id', oid, 'number', num, 'total', tot, 'lines', n);
end $$;

revoke execute on function store_catalog(uuid) from public, anon;
grant execute on function store_catalog(uuid) to authenticated;
