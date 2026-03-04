create table announcement_dismissals (
  user_email text not null,
  announcement_id uuid not null,
  dismissed_at timestamp with time zone default now(),
  primary key (user_email, announcement_id)
);
