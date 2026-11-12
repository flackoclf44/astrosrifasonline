-- ASTROS | Base transacional para Pix e disponibilidade
-- Execute no SQL Editor de um projeto Supabase antes de ativar o frontend.
-- NUNCA disponibilize a chave service_role no GitHub Pages.

create table if not exists public.astros_orders (
  id uuid primary key default gen_random_uuid(),
  numbers integer[] not null,
  buyer_email text not null,
  amount_cents integer not null check (amount_cents > 0),
  status text not null default 'reserved'
    check (status in ('reserved','pending','approved','expired','failed','review')),
  payment_id text unique,
  pix_payload text,
  pix_image_base64 text,
  created_at timestamptz not null default now(),
  reservation_expires_at timestamptz not null default (now() + interval '45 minutes'),
  updated_at timestamptz not null default now()
);

create table if not exists public.astros_tickets (
  number integer primary key check (number between 1 and 150),
  status text not null default 'available'
    check (status in ('available','blocked','reserved','sold')),
  order_id uuid references public.astros_orders(id),
  updated_at timestamptz not null default now(),
  constraint astros_ticket_association check (
    (status in ('reserved','sold') and order_id is not null)
    or (status in ('available','blocked') and order_id is null)
  )
);

insert into public.astros_tickets(number)
select generate_series(1,150)
on conflict (number) do nothing;

-- Preserve os números que você já bloqueou manualmente.
update public.astros_tickets
set status = 'blocked', order_id = null, updated_at=now()
where number in (10,24) and status in ('available','blocked');

create index if not exists astros_orders_pending_idx
  on public.astros_orders(status,reservation_expires_at);

alter table public.astros_orders enable row level security;
alter table public.astros_tickets enable row level security;
revoke all on public.astros_orders from anon, authenticated;
revoke all on public.astros_tickets from anon, authenticated;

-- Reserva atômica: transações concorrentes nunca conseguem o mesmo número.
create or replace function public.astros_reserve(p_numbers integer[],p_email text)
returns uuid
language plpgsql security definer set search_path=public
as $$
declare
  v_id uuid;
  v_count integer;
  v_n integer;
begin
  v_count := cardinality(p_numbers);
  if p_numbers is null or v_count not between 1 and 20 or
     exists (select 1 from unnest(p_numbers) n where n is null or n < 1 or n > 150) or
     (select count(distinct n) from unnest(p_numbers) n) <> v_count then
    raise exception 'Seleção de números inválida';
  end if;
  if p_email is null or length(p_email)>254 or p_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Email inválido';
  end if;
  -- Limite simples contra reservas abusivas; complemente com rate limit na borda.
  if (select count(*) from public.astros_orders
      where lower(buyer_email)=lower(p_email)
        and created_at > now() - interval '1 hour') >= 3 then
    raise exception 'Muitas tentativas. Aguarde antes de gerar outro Pix';
  end if;

  -- FOR UPDATE em ordem fixa evita corrida entre clientes.
  for v_n in select number from public.astros_tickets
             where number=any(p_numbers) order by number for update loop
    if (select status from public.astros_tickets where number=v_n) <> 'available' then
      raise exception 'Um ou mais números já estão reservados ou vendidos';
    end if;
  end loop;
  if (select count(*) from public.astros_tickets where number=any(p_numbers)) <> v_count then
    raise exception 'Número inexistente';
  end if;

  insert into public.astros_orders (numbers,buyer_email,amount_cents)
  values (p_numbers,lower(p_email),v_count*250)
  returning id into v_id;

  update public.astros_tickets
     set status='reserved',order_id=v_id,updated_at=now()
   where number=any(p_numbers) and status='available';
  if not found then
    raise exception 'Falha ao reservar os números';
  end if;
  return v_id;
end;
$$;

create or replace function public.astros_save_pix(
  p_id uuid, p_payment_id text, p_payload text, p_qr_base64 text
)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.astros_orders
     set status='pending', payment_id=p_payment_id,
         pix_payload=p_payload,pix_image_base64=p_qr_base64,updated_at=now()
   where id=p_id and status='reserved'
     and (payment_id is null or payment_id=p_payment_id);
end;
$$;

-- Somente chamado pelo backend DEPOIS de confirmar no provedor:
-- status approved, valor exato, Pix e external_reference igual ao pedido.
create or replace function public.astros_approve(
  p_id uuid, p_payment_id text
)
returns text language plpgsql security definer set search_path=public as $$
declare
  v_order public.astros_orders%rowtype;
  v_count integer;
begin
  select * into v_order from public.astros_orders where id=p_id for update;
  if not found then return 'unknown'; end if;
  if v_order.status='approved' then
    if v_order.payment_id=p_payment_id then return 'approved'; end if;
    return 'review';
  end if;
  if v_order.status not in ('reserved','pending') or
     (v_order.payment_id is not null and v_order.payment_id<>p_payment_id) then
    update public.astros_orders set status='review',updated_at=now() where id=p_id;
    return 'review';
  end if;
  select count(*) into v_count from public.astros_tickets
   where order_id=p_id and status='reserved' and number=any(v_order.numbers);
  if v_count<>cardinality(v_order.numbers) then
    update public.astros_orders set status='review',payment_id=p_payment_id,updated_at=now()
      where id=p_id;
    return 'review';
  end if;

  update public.astros_tickets set status='sold',updated_at=now()
    where order_id=p_id and status='reserved';
  update public.astros_orders set status='approved',payment_id=p_payment_id,
    updated_at=now() where id=p_id;
  return 'approved';
end;
$$;

-- Libera apenas após o provedor informar que a cobrança terminou SEM pagamento.
create or replace function public.astros_release(
  p_id uuid
)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform 1 from public.astros_orders where id=p_id for update;
  update public.astros_tickets set status='available',order_id=null,updated_at=now()
   where order_id=p_id and status='reserved'
     and exists(select 1 from public.astros_orders where id=p_id
                and status in ('reserved','pending'));
  update public.astros_orders set status='expired',updated_at=now()
   where id=p_id and status in ('reserved','pending');
end;
$$;

revoke all on function public.astros_reserve(integer[],text) from public,anon,authenticated;
revoke all on function public.astros_save_pix(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.astros_approve(uuid,text) from public,anon,authenticated;
revoke all on function public.astros_release(uuid) from public,anon,authenticated;
grant execute on function public.astros_reserve(integer[],text) to service_role;
grant execute on function public.astros_save_pix(uuid,text,text,text) to service_role;
grant execute on function public.astros_approve(uuid,text) to service_role;
grant execute on function public.astros_release(uuid) to service_role;
