-- OPER: Exam Class II and Exam Class V
-- Records saved under Class II / Class V with is_exam=true are counted toward these requirements.
-- is_selectable=false keeps them out of the treatment_plan dropdown (students pick Class II/V instead).

UPDATE requirement_list
SET
  aggregation_config = '{"type":"count_exam","source_ids":["f75caaa1-ae50-41e3-b9d8-aeebfe63c58a"]}',
  is_selectable      = false
WHERE requirement_id = 'dfe5e5bd-a929-4f83-a55a-52cad61c559e'; -- Exam Class II

UPDATE requirement_list
SET
  aggregation_config = '{"type":"count_exam","source_ids":["c63b2e7e-6997-4b07-8141-ba2528027dc0"]}',
  is_selectable      = false
WHERE requirement_id = 'bbb7021d-5664-4f41-9c28-5e8bab9abff5'; -- Exam Class V
