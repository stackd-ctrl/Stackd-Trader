-- STACKD TRADER — Allow the anon role to READ dashboard tables.
--
-- The browser uses the anon key. STACKD TRADER is a single-operator app, so
-- the dashboard is intentionally readable without a user login. WRITES still
-- require the service role, which lives server-side only.
--
-- Run AFTER 002_day2_data_engine.sql.

-- Drop the authenticated-only read policies.
drop policy if exists "auth read trades"          on public.trades;
drop policy if exists "auth read signals"         on public.signals;
drop policy if exists "auth read daily_summaries" on public.daily_summaries;
drop policy if exists "auth read bot_status"      on public.bot_status;
drop policy if exists "auth read risk_settings"   on public.risk_settings;
drop policy if exists "auth read news"            on public.news;
drop policy if exists "auth read calendar"        on public.calendar_events;
drop policy if exists "auth read bot_event_log"   on public.bot_event_log;

-- Public-read (anon + authenticated) replacements.
create policy "public read trades"          on public.trades          for select using (true);
create policy "public read signals"         on public.signals         for select using (true);
create policy "public read daily_summaries" on public.daily_summaries for select using (true);
create policy "public read bot_status"      on public.bot_status      for select using (true);
create policy "public read risk_settings"   on public.risk_settings   for select using (true);
create policy "public read news"            on public.news            for select using (true);
create policy "public read calendar"        on public.calendar_events for select using (true);
create policy "public read bot_event_log"   on public.bot_event_log   for select using (true);
