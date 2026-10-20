-- 2.12: business details (phone, address, opening hours) for suppliers and stores.
alter table public.suppliers
  add column if not exists phone text,
  add column if not exists address text,
  add column if not exists hours text;
alter table public.stores
  add column if not exists address text,
  add column if not exists hours text;

grant select (phone, address, hours), update (phone, address, hours) on public.suppliers to authenticated;
grant select (address, hours), update (address, hours) on public.stores to authenticated;

-- A store member updates its own store's contact details (members have no UPDATE policy on stores).
create or replace function public.set_my_store_details(
  p_contact text, p_phone text, p_email text, p_address text, p_hours text)
returns void language sql security definer set search_path = public as $$
  update stores set
    contact = coalesce(nullif(trim(p_contact), ''), contact),
    phone   = nullif(trim(p_phone), ''),
    email   = nullif(trim(p_email), ''),
    address = nullif(trim(p_address), ''),
    hours   = nullif(trim(p_hours), '')
  where id in (select store_id from store_members where user_id = auth.uid());
$$;
revoke all on function public.set_my_store_details(text, text, text, text, text) from public, anon;
grant execute on function public.set_my_store_details(text, text, text, text, text) to authenticated;
