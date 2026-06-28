-- Allow tiered fee rows for the same product/currency by amount bands.
-- Previous constraint (product, currency) blocked corridor tier packs.

alter table public.fee_schedule
  drop constraint if exists fee_schedule_product_currency_key;

-- Unique per exact band definition.
create unique index if not exists fee_schedule_product_currency_band_uniq
  on public.fee_schedule (
    product,
    currency,
    min_total,
    coalesce(max_total, '-1'::numeric)
  );

-- Helpful lookup index for fee engine queries.
create index if not exists fee_schedule_product_currency_range_idx
  on public.fee_schedule (product, currency, min_total, max_total);

