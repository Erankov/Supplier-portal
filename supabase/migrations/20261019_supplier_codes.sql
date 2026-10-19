-- 1.7: new suppliers sign up only with a one-time code that the site owner makes; it lasts 15 minutes.
-- Both tables have RLS on and no grants: only the functions below touch them.

create table if not exists platform_admins (user_id uuid primary key references auth.users(id) on update cascade);
alter table platform_admins enable row level security;
-- The site owner (Eran) is added by user id when this is applied.

create table if not exists supplier_codes (
  code text primary key,
  created_by uuid references auth.users(id) on update cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_by uuid references auth.users(id) on update cascade,
  used_at timestamptz,
  supplier_id uuid references suppliers(id) on update cascade
);
alter table supplier_codes enable row level security;

create or replace function is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;

create or replace function new_supplier_code() returns jsonb
language plpgsql security definer set search_path = public as $$
declare c text; e timestamptz := now() + interval '15 minutes';
begin
  if not is_platform_admin() then raise exception 'forbidden'; end if;
  loop
    c := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists (select 1 from supplier_codes where code = c);
  end loop;
  insert into supplier_codes(code, created_by, expires_at) values (c, auth.uid(), e);
  return jsonb_build_object('code', c, 'expires_at', e);
end $$;

-- Checks and uses up the code in the same transaction that opens the supplier account.
create or replace function create_supplier_with_code(p_name text, p_email text default null, p_code text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare sid uuid; sc supplier_codes;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if exists (select 1 from supplier_members where user_id = auth.uid()) then raise exception 'already a supplier'; end if;
  select * into sc from supplier_codes where code = upper(trim(coalesce(p_code, ''))) for update;
  if not found or sc.used_at is not null or sc.expires_at < now() then raise exception 'supplier code invalid'; end if;
  insert into suppliers(name, order_email) values (trim(p_name), nullif(trim(coalesce(p_email, '')), '')) returning id into sid;
  insert into supplier_members(supplier_id, user_id) values (sid, auth.uid());
  update supplier_codes set used_by = auth.uid(), used_at = now(), supplier_id = sid where code = sc.code;
  return sid;
end $$;

-- The old open signup is closed.
create or replace function create_supplier(p_name text, p_email text default null)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  raise exception 'supplier code required';
end $$;

revoke execute on function is_platform_admin() from public, anon;
revoke execute on function new_supplier_code() from public, anon;
revoke execute on function create_supplier_with_code(text, text, text) from public, anon;
grant execute on function is_platform_admin() to authenticated;
grant execute on function new_supplier_code() to authenticated;
grant execute on function create_supplier_with_code(text, text, text) to authenticated;
