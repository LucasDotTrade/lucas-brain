create table if not exists cases (
  id uuid default gen_random_uuid() primary key,
  client_email text not null,
  document_type text not null,
  verdict text not null,
  issues jsonb default '[]',
  advice_summary text,
  created_at timestamptz default now()
);
