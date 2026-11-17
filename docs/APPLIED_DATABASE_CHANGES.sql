-- Applied migration audit. Reference only; do not re-run against the current project.
-- Project: yftkqcqewashjqynltig

-- 20261117134924 pbp_room_presence_access
create policy pbp_presence_read on realtime.messages for select to authenticated using (
extension = 'presence' and exists (select 1 from public.room_user ru where ru.user_id = (select auth.uid()) and (select realtime.topic()) = 'pbp-presence-' || ru.room_id::text));
create policy pbp_presence_write on realtime.messages for insert to authenticated with check (
extension = 'presence' and exists (select 1 from public.room_user ru where ru.user_id = (select auth.uid()) and (select realtime.topic()) = 'pbp-presence-' || ru.room_id::text));

-- 20261117135045 pbp_initial_profile_setup
alter table public."user" add column profile_completed boolean not null default true;
alter table public."user" alter column profile_completed set default false;
grant select (profile_completed), update (profile_completed) on public."user" to authenticated;

-- 20261117135510 pbp_account_status_fields
alter table public."user" add column is_active boolean not null default true, add column expires_at timestamptz; grant select (is_active,expires_at) on public."user" to authenticated;

-- 20261117140032 pbp_web_push_delivery
-- Run once only after reviewing existing schema; no keys belong in this file.
create extension if not exists pg_net with schema extensions;
create table public.push_deliveries (
    message_id uuid not null references public.messages(message_id) on delete cascade,
    subscription_id uuid not null references public.push_subscriptions(subscription_id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (message_id, subscription_id)
);
alter table public.push_deliveries enable row level security;
revoke all on public.push_deliveries from anon, authenticated;
grant all on public.push_deliveries to service_role;
create function private.pbp_notify_message() returns trigger language plpgsql security definer set search_path='' as $$
declare hook_secret text;
begin
    select decrypted_secret into hook_secret from vault.decrypted_secrets where name='pbp_push_hook_secret' limit 1;
    if hook_secret is null then return new; end if;
    perform net.http_post(
        url := 'https://yftkqcqewashjqynltig.supabase.co/functions/v1/pbp-push',
        headers := jsonb_build_object('Content-Type','application/json','x-pbp-hook-secret',hook_secret),
        body := jsonb_build_object('action','deliver','message_id',new.message_id),
        timeout_milliseconds := 10000
    );
    return new;
end;
$$;
revoke all on function private.pbp_notify_message() from public,anon,authenticated;
create trigger pbp_notify_message after insert on public.messages for each row execute function private.pbp_notify_message();

-- 20261117140203 pbp_account_status_access
create function private.pbp_account_active() returns boolean language sql stable security definer set search_path='' as $$
select exists(select 1 from public."user" u where u.user_id=(select auth.uid()) and u.is_active and (u.expires_at is null or u.expires_at>now()))
$$;
revoke all on function private.pbp_account_active() from public,anon;
grant execute on function private.pbp_account_active() to authenticated;
create policy pbp_active_account on public."user" as restrictive for all to authenticated using ((select private.pbp_account_active())) with check ((select private.pbp_account_active()));
create policy pbp_active_account on public."rooms" as restrictive for all to authenticated using ((select private.pbp_account_active())) with check ((select private.pbp_account_active()));
create policy pbp_active_account on public."room_user" as restrictive for all to authenticated using ((select private.pbp_account_active())) with check ((select private.pbp_account_active()));
create policy pbp_active_account on public."room_character" as restrictive for all to authenticated using ((select private.pbp_account_active())) with check ((select private.pbp_account_active()));
create policy pbp_active_account on public."characters" as restrictive for all to authenticated using ((select private.pbp_account_active())) with check ((select private.pbp_account_active()));
create policy pbp_active_account on public."messages" as restrictive for all to authenticated using ((select private.pbp_account_active())) with check ((select private.pbp_account_active()));
create policy pbp_active_account on public."settings" as restrictive for all to authenticated using ((select private.pbp_account_active())) with check ((select private.pbp_account_active()));
create policy pbp_active_account on public."room_invites" as restrictive for all to authenticated using ((select private.pbp_account_active())) with check ((select private.pbp_account_active()));
create policy pbp_active_presence on realtime.messages as restrictive for all to authenticated using ((select private.pbp_account_active())) with check ((select private.pbp_account_active()));

-- 20261117140717 pbp_require_active_character_for_new_messages
create policy pbp_active_character_insert on public.messages as restrictive for insert to authenticated with check (character_id is null or exists (select 1 from public.room_character rc where rc.room_id=messages.room_id and rc.character_id=messages.character_id and rc.is_active));

