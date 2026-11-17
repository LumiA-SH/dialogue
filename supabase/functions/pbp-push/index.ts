import { createClient } from 'npm:@supabase/supabase-js@2.57.0';
import webpush from 'npm:web-push@3.6.7';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-pbp-hook-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });
const active = (user: any) => user?.is_active && (!user.expires_at || new Date(user.expires_at).getTime() > Date.now());
const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
const subject = Deno.env.get('VAPID_SUBJECT');
const hookSecret = Deno.env.get('PBP_PUSH_HOOK_SECRET');
const configured = Boolean(publicKey && privateKey && subject && hookSecret);
if (configured) webpush.setVapidDetails(subject!, publicKey!, privateKey!);

function validEndpoint(value: unknown) {
    if (typeof value !== 'string' || value.length > 4096) return false;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
            (url.hostname === 'fcm.googleapis.com' || url.hostname === 'updates.push.services.mozilla.com' || url.hostname.endsWith('.push.services.mozilla.com') || url.hostname === 'web.push.apple.com' || url.hostname.endsWith('.notify.windows.com'));
    } catch { return false; }
}

async function deliver(messageId: string) {
    const { data: message, error } = await admin.from('messages').select('message_id,room_id,user_id,created_at').eq('message_id', messageId).maybeSingle();
    if (error) throw error;
    if (!message) return;
    const { data: members, error: membersError } = await admin.from('room_user').select('user_id').eq('room_id', message.room_id).neq('user_id', message.user_id);
    if (membersError) throw membersError;
    for (const member of members || []) {
        const [{ data: preference, error: preferenceError }, { data: user, error: userError }] = await Promise.all([
            admin.from('settings').select('notification_enabled').eq('user_id', member.user_id).maybeSingle(),
            admin.from('user').select('is_active,expires_at').eq('user_id', member.user_id).maybeSingle()
        ]);
        if (preferenceError || userError) throw preferenceError || userError;
        if (!preference?.notification_enabled || !active(user)) continue;
        const { data: subscriptions, error: subscriptionError } = await admin.from('push_subscriptions').select('*').eq('user_id', member.user_id);
        if (subscriptionError) throw subscriptionError;
        for (const subscription of subscriptions || []) {
            if (!validEndpoint(subscription.endpoint)) continue;
            const { error: claimError } = await admin.from('push_deliveries').insert({ message_id: messageId, subscription_id: subscription.subscription_id });
            if (claimError?.code === '23505') continue;
            if (claimError) throw claimError;
            try {
                await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth_secret } }, JSON.stringify({ title: '다이얼로그 · 새 RP', body: '상대방이 새로운 RP를 남겼습니다.', room_id: message.room_id, message_id: messageId }), { TTL: 86400, timeout: 10000 });
            } catch (error: any) {
                if (error.statusCode === 404 || error.statusCode === 410) {
                    const { error: removeError } = await admin.from('push_subscriptions').delete().eq('subscription_id', subscription.subscription_id);
                    if (removeError) throw removeError;
                } else {
                    await admin.from('push_deliveries').delete().eq('message_id', messageId).eq('subscription_id', subscription.subscription_id);
                    throw error;
                }
            }
        }
    }
}

Deno.serve(async request => {
    if (request.method === 'OPTIONS') return new Response(null, { headers });
    if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
    try {
        const body = await request.json();
        if (body.action === 'deliver') {
            if (!hookSecret || request.headers.get('x-pbp-hook-secret') !== hookSecret) return reply({ error: 'Unauthorized' }, 401);
            if (!configured) return reply({ error: 'Push is not configured' }, 503);
            if (typeof body.message_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.message_id)) return reply({ error: 'Invalid message' }, 400);
            await deliver(body.message_id);
            return reply({ ok: true });
        }
        const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
        if (!token) return reply({ error: '로그인이 필요합니다.' }, 401);
        const { data: claims, error: authError } = await admin.auth.getClaims(token);
        const userId = claims?.claims?.sub;
        if (authError || !userId) return reply({ error: '유효하지 않은 세션입니다.' }, 401);
        const { data: user, error: userError } = await admin.from('user').select('is_active,expires_at').eq('user_id', userId).maybeSingle();
        if (userError) throw userError;
        // A signed-in user may remove only their own device, including after deactivation.
        if (body.action === 'unsubscribe') {
            if (typeof body.endpoint !== 'string') return reply({ error: 'Invalid endpoint' }, 400);
            const { error } = await admin.from('push_subscriptions').delete().eq('user_id', userId).eq('endpoint', body.endpoint);
            if (error) throw error;
            return reply({ ok: true });
        }
        if (!active(user)) return reply({ error: '비활성화되었거나 만료된 계정입니다.' }, 403);
        if (body.action === 'config') return reply({ publicKey: configured ? publicKey : null });
        if (body.action === 'subscribe') {
            if (!configured) return reply({ error: '푸시 서버 설정이 필요합니다.' }, 503);
            const subscription = body.subscription;
            if (!validEndpoint(subscription?.endpoint) || !/^[A-Za-z0-9_-]{87,88}$/.test(subscription?.keys?.p256dh || '') || !/^[A-Za-z0-9_-]{22,24}$/.test(subscription?.keys?.auth || '')) return reply({ error: '올바르지 않은 구독 정보입니다.' }, 400);
            const { error } = await admin.from('push_subscriptions').upsert({ user_id: userId, endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth_secret: subscription.keys.auth }, { onConflict: 'endpoint' });
            if (error) throw error;
            return reply({ ok: true });
        }
        return reply({ error: '지원하지 않는 작업입니다.' }, 400);
    } catch (error) {
        console.error('PBP push operation failed', { name: (error as Error)?.name });
        return reply({ error: '알림 처리에 실패했습니다. 다시 시도해 주세요.' }, 500);
    }
});
