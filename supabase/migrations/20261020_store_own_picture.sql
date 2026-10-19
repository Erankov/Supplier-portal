-- 2.4: the store sets its own business picture. It uploads to logos/stores/<its user id>/...
-- and the picture is set on every store record the user belongs to (one per supplier).
create policy logos_store_write on storage.objects for insert to authenticated
  with check (bucket_id = 'logos' and (storage.foldername(name))[1] = 'stores'
              and (storage.foldername(name))[2] = auth.uid()::text);

-- Only a picture this user uploaded to its own folder in the logos bucket.
create or replace function set_my_store_picture(p_url text)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_url is not null and (length(p_url) >= 600 or position('/storage/v1/object/public/logos/stores/' || auth.uid()::text || '/' in p_url) = 0
     or p_url !~ '^https://[a-z0-9]+\.supabase\.co/') then raise exception 'bad url'; end if;
  update stores set logo_url = p_url
   where id in (select store_id from store_members where user_id = auth.uid());
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function set_my_store_picture(text) from public, anon;
grant execute on function set_my_store_picture(text) to authenticated;
