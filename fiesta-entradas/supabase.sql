-- =====================================================================
--  ENTRADAS FIESTA · Pega TODO esto en Supabase → SQL Editor → Run
-- =====================================================================

-- Ajustes editables (cambia aquí cuántas entradas llevan chupito)
create table if not exists public.ajustes (
  clave text primary key,
  valor text not null
);
insert into public.ajustes (clave, valor)
values ('limite_primeras', '50')
on conflict (clave) do nothing;

-- Tabla de entradas
create table if not exists public.entradas (
  id            uuid primary key default gen_random_uuid(),
  numero        integer generated always as identity unique,
  token         uuid not null unique default gen_random_uuid(),  -- lo que va dentro del QR
  nombre        text not null,
  email         text not null,
  telefono      text,
  tipo          text not null check (tipo in ('primera', 'normal')),
  email_enviado boolean not null default false,
  usada_en      timestamptz,                                      -- null = aún no ha entrado
  creada_en     timestamptz not null default now()
);

create index if not exists entradas_email_idx on public.entradas (email);

-- Decide automáticamente el tipo al crear la entrada:
-- mientras haya menos de N "primeras" → 'primera' (copa + chupito), si no → 'normal' (copa).
-- El advisory lock evita que dos taquillas a la vez se lleven la misma plaza.
create or replace function public.asignar_tipo_entrada()
returns trigger
language plpgsql
as $$
declare
  limite int;
  primeras int;
begin
  perform pg_advisory_xact_lock(424242);
  select coalesce((select valor::int from public.ajustes where clave = 'limite_primeras'), 50)
    into limite;
  select count(*) into primeras from public.entradas where tipo = 'primera';
  new.tipo := case when primeras < limite then 'primera' else 'normal' end;
  return new;
end;
$$;

drop trigger if exists trg_asignar_tipo on public.entradas;
create trigger trg_asignar_tipo
  before insert on public.entradas
  for each row execute function public.asignar_tipo_entrada();

-- Seguridad: activamos RLS sin políticas → nadie puede leer/escribir
-- con la clave pública. Solo el servidor (con la clave secreta) accede.
alter table public.entradas enable row level security;
alter table public.ajustes  enable row level security;

-- ---------------------------------------------------------------------
-- RESET (úsalo DESPUÉS DE HACER PRUEBAS, antes de vender de verdad):
--   truncate public.entradas restart identity;
-- ---------------------------------------------------------------------
