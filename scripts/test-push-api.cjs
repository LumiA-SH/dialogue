const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const { createRequire } = require('module');
const project = createRequire(require('path').join(__dirname, '../package.json'));
const source = fs.readFileSync(require('path').join(__dirname, '../supabase/functions/pbp-push/index.ts'), 'utf8').replace(/^import .*\n/gm, '');
const code = project('@babel/core').transformSync(source, { filename: 'index.ts', configFile: false, babelrc: false, presets: [project.resolve('@babel/preset-typescript')] }).code;
async function scenario(body, options = {}) {
    let handler;
    const sent = [], calls = [];
    const admin = { auth: { getClaims: async () => ({ data: { claims: { sub: 'viewer' } } }) }, from(table) {
        const filters = {};
        let op = 'select';
        const query = {
            select() { return query; }, eq(key, value) { filters[key] = value; return query; },
            neq(key, value) { filters['not_'+key] = value; return query; },
            or(value) { filters.or = value; return query; },
            insert(values) { op = 'insert'; calls.push({ table, op, values }); return query; },
            upsert(values) { op = 'upsert'; calls.push({ table, op, values }); return query; },
            delete() { op = 'delete'; return query; },
            maybeSingle() { return Promise.resolve(result()); },
            then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); }
        };
        function result() {
            calls.push({ table, op, filters: { ...filters } });
            if (op === 'delete') return { error: null };
            if (table === 'user') return { data: { is_active: options.active !== false } };
            if (table === 'messages' && filters.or) {
                assert.equal(filters.room_id, 4);
                assert.equal(filters.message_id, 'read-cursor');
                assert.match(filters.or, /created_at\.gt\.2026-11-18T00:00:00.123456Z/);
                return { data: options.read ? { message_id: 'read-cursor' } : null, error: options.readError ? { message: 'Read failed' } : null };
            }
            if (table === 'messages') return { data: { message_id: '11111111-1111-4111-8111-111111111111', room_id: 4, user_id: 'author', created_at: '2026-11-18T00:00:00.123456Z' } };
            if (table === 'room_user' && filters.user_id) {
                assert.equal(filters.user_id, 'peer');
                assert.equal(filters.room_id, 4);
                return { data: options.left ? null : { last_read_message_id: options.noCursor ? null : 'read-cursor' } };
            }
            if (table === 'room_user') { assert.equal(filters.not_user_id, 'author'); return { data: [{ user_id: 'peer' }] }; }
            if (table === 'settings') return { data: { notification_enabled: options.enabled !== false } };
            if (table === 'push_subscriptions' && op === 'select') return { data: [1,2].map(id => ({ subscription_id: id, endpoint: 'https://web.push.apple.com/test'+id, p256dh: 'key', auth_secret: 'secret' })) };
            if (table === 'push_deliveries' && op === 'insert') return { error: options.duplicate ? { code: '23505' } : null };
            return { data: [], error: null };
        }
        return query;
    } };
    const webpush = { setVapidDetails() {}, async sendNotification(subscription, payload, deliveryOptions) { assert.equal(deliveryOptions.TTL, 86400); sent.push(subscription); if (options.expired) throw { statusCode: 410 }; } };
    vm.runInNewContext(code, { createClient: () => admin, webpush, Deno: { env: { get: () => 'configured' }, serve: value => { handler = value; } }, Response, URL, Date, console, setTimeout: callback => { callback(); } });
    const response = await handler(new Request('https://example.test', { method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json', 'x-pbp-hook-secret': options.hook === false ? 'invalid' : 'configured' }, body: JSON.stringify(body) }));
    return { response, sent, calls };
}
(async () => {
    const body = { action: 'deliver', message_id: '11111111-1111-4111-8111-111111111111' };
    assert.equal((await scenario(body, { hook: false })).response.status, 401);
    assert.equal((await scenario(body, { enabled: false })).sent.length, 0);
    assert.equal((await scenario(body, { active: false })).sent.length, 0);
    assert.equal((await scenario(body, { duplicate: true })).sent.length, 0);
    assert.equal((await scenario(body)).sent.length, 2);
    assert.equal((await scenario(body, { noCursor: true })).sent.length, 2);
    assert.equal((await scenario(body, { read: true })).sent.length, 0);
    assert.equal((await scenario(body, { left: true })).sent.length, 0);
    const failedRead = await scenario(body, { readError: true });
    assert.equal(failedRead.response.status, 500);
    assert.equal(failedRead.sent.length, 0);
    const expired = await scenario(body, { expired: true });
    assert.equal(expired.calls.filter(call => call.table === 'push_subscriptions' && call.op === 'delete').length, 2);
    const unsubscribe = await scenario({ action: 'unsubscribe', endpoint: 'https://web.push.apple.com/test' });
    assert.equal(unsubscribe.calls.find(call => call.table === 'push_subscriptions' && call.op === 'delete').filters.user_id, 'viewer');
    const invalid = await scenario({ action: 'subscribe', subscription: { endpoint: 'http://127.0.0.1/private', keys: { p256dh: 'a'.repeat(87), auth: 'a'.repeat(22) } } });
    assert.equal(invalid.response.status, 400);
    console.log('PASS: push webhook auth, preferences, inactive recipient, duplicate suppression, 2 devices, server read exclusion, missing membership, read failure, unchanged TTL, expired cleanup, owner-only unsubscribe, SSRF rejection');
})().catch(error => { console.error(error); process.exitCode = 1; });
