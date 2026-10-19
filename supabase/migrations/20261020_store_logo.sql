-- 2.3: a business picture per store (uploaded by the supplier to the logos bucket, in its own folder)
alter table stores add column if not exists logo_url text;
alter table stores add constraint stores_logo_url_ok check (logo_url is null or (logo_url ~ '^https://' and length(logo_url) < 600));
