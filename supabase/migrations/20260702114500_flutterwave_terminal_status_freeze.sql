-- Enforce terminal-state immutability at the database layer.
-- Once a Flutterwave projection row reaches completed/failed, status cannot
-- be downgraded by out-of-order updates.

create or replace function public.enforce_flutterwave_terminal_status_freeze()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(coalesce(old.status, '')) in ('completed','failed')
     and new.status is distinct from old.status then
    -- Keep terminal status immutable rather than failing the update.
    new.status := old.status;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_flutterwave_collections_terminal_status_freeze on public.flutterwave_collections;
create trigger trg_flutterwave_collections_terminal_status_freeze
before update on public.flutterwave_collections
for each row
execute function public.enforce_flutterwave_terminal_status_freeze();

drop trigger if exists trg_flutterwave_transfers_terminal_status_freeze on public.flutterwave_transfers;
create trigger trg_flutterwave_transfers_terminal_status_freeze
before update on public.flutterwave_transfers
for each row
execute function public.enforce_flutterwave_terminal_status_freeze();
