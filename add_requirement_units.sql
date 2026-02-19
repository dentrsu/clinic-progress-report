-- Add unit columns to requirement_list
ALTER TABLE public.requirement_list
```sql
ADD COLUMN rsu_unit text,
ADD COLUMN cda_unit text;
```

COMMENT ON COLUMN public.requirement_list.rsu_unit IS 'Unit of measurement for RSU requirement (e.g., Case, Arch, Canal)';
COMMENT ON COLUMN public.requirement_list.cda_unit IS 'Unit of measurement for CDA requirement (e.g., Case, Arch, Canal)';
