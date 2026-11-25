alter table profiles add column if not exists card_close_day smallint not null default 31
  check (card_close_day between 1 and 31);
alter table profiles add column if not exists card_due_day smallint not null default 10
  check (card_due_day between 1 and 31);

create table if not exists invoice_cycles (
  owner_id bigint not null references profiles(id),
  period date not null,
  closes_on date not null,
  due_on date not null check (due_on > closes_on),
  primary key (owner_id, period)
);

alter table entries drop constraint if exists entries_method_check;
alter table entries add constraint entries_method_check
  check (method in ('CREDIT','DEBIT','PIX','CASH','BOLETO') and (method <> 'BOLETO' or kind = 'EXPENSE'));
alter table entries add column if not exists invoice_period date;
alter table entries add column if not exists installment_group uuid;
alter table entries add column if not exists installment_number smallint;
alter table entries add column if not exists installment_count smallint;

insert into invoice_cycles (owner_id, period, closes_on, due_on)
select owner_id, period, (period + interval '1 month' - interval '1 day')::date,
       (period + interval '1 month' + interval '9 days')::date
from (
  select owner_id, coalesce(invoice_period, date_trunc('month', day)::date) as period
  from entries where method = 'CREDIT'
  union
  select owner_id, period from invoice_payments
) as existing
on conflict (owner_id, period) do nothing;

alter table entries drop constraint if exists entries_card_cycle;
alter table entries add constraint entries_card_cycle foreign key (owner_id, invoice_period)
  references invoice_cycles(owner_id, period);
alter table entries drop constraint if exists entries_installment_shape;
alter table entries add constraint entries_installment_shape check (
  (invoice_period is null or method = 'CREDIT')
  and (
    (installment_group is null and installment_number is null and installment_count is null)
    or (invoice_period is not null and installment_group is not null and installment_number is not null
      and installment_count is not null and installment_count between 2 and 60
      and installment_number between 1 and installment_count)
  )
);
create index if not exists entries_owner_invoice on entries(owner_id, invoice_period);
create unique index if not exists entries_installment_number on entries(owner_id, installment_group, installment_number)
  where installment_group is not null;
