alter table cases add column if not exists outcome text;
alter table cases add column if not exists bank_feedback text;
alter table cases add column if not exists lesson_learned text;
alter table cases add column if not exists outcome_recorded_at timestamptz;
