-- Add default_rsu and default_cda to requirement_list.
-- When set, the treatment plan modal auto-fills these values for new records.
-- NULL means no default (fields stay empty). Users can always override.

ALTER TABLE requirement_list
  ADD COLUMN default_rsu numeric NULL,
  ADD COLUMN default_cda numeric NULL;
