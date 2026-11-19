-- Run after schema.sql as the owner of the dedicated Ponto database.
-- Create the LOGIN role ponto_app separately so its password stays out of this file.
begin;
revoke create on schema public from public;
grant usage on schema public to ponto_app;

grant select, insert (name, email, phone, password_hash), update (initial_balance)
  on table profiles to ponto_app;
grant select, insert, update, delete on table entries to ponto_app;
grant select, insert on table invoice_payments to ponto_app;
grant select, insert, update, delete on table auth_rate_limits to ponto_app;
grant usage on sequence profiles_id_seq, entries_id_seq to ponto_app;
commit;
