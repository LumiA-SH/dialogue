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
