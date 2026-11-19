create table if not exists profiles (
  id bigint generated always as identity primary key,
  name varchar(80) not null,
  email varchar(254) unique,
  phone varchar(16) unique,
  password_hash varchar(150) not null,
  initial_balance numeric(12,2) not null default 0,
  check (email is not null or phone is not null)
);

create table if not exists entries (
  id bigint generated always as identity primary key,
  owner_id bigint not null references profiles(id),
  kind varchar(8) not null check (kind in ('EXPENSE', 'INCOME')),
  description varchar(120) not null,
  amount numeric(12,2) not null check (amount > 0),
  category varchar(30) not null,
  method varchar(10) not null check (method in ('CREDIT','DEBIT','PIX','CASH')),
  day date not null,
  check (kind <> 'INCOME' or method <> 'CREDIT')
);

create index if not exists entries_owner_day on entries(owner_id, day);

create table if not exists invoice_payments (
  owner_id bigint not null references profiles(id),
  period date not null,
  paid_on date not null,
  amount numeric not null check (amount > 0),
  primary key (owner_id, period)
);

create table if not exists auth_rate_limits (
  operation varchar(10) not null,
  client_address varchar(64) not null,
  expires_at timestamptz not null,
  attempts integer not null,
  primary key (operation, client_address)
);
create index if not exists auth_rate_limits_expiry on auth_rate_limits(expires_at);
