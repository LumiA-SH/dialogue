const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const { createRequire } = require('module');
const requireProject = createRequire(require('path').join(__dirname, '../package.json'));
const babel = requireProject('@babel/core');
const typePreset = requireProject.resolve('@babel/preset-typescript');
const actorId = '11111111-1111-4111-8111-111111111111';
const targetId = '22222222-2222-4222-8222-222222222222';
const source = fs.readFileSync(require('path').join(__dirname, '../supabase/functions/pbp-auth/index.ts'), 'utf8').replace(/^import .*\n/, '');
const code = babel.transformSync(source, { filename: 'index.ts', configFile: false, babelrc: false, presets: [typePreset] }).code;
async function check(action, actor, expected, extras = {}) {
    let handler;
    const writes = [];
    const admin = { auth: { getClaims: async () => ({ data: { claims: { sub: actorId } } }) }, from(table) {
        let updating = false;
        const query = {
            select() { return query; }, eq() { return query; }, order() { return query; },
            update(values) { updating = true; writes.push(values); return query; },
            single: async () => ({ data: actor }),
            maybeSingle: async () => ({ data: updating ? { user_id: targetId } : actor }),
            range: async () => ({ data: [], count: 0 })
        };
        return query;
    } };
    vm.runInNewContext(code, { createClient: () => admin, Deno: { env: { get: () => 'test' }, serve: value => { handler = value; } }, Response, crypto: require('crypto').webcrypto, TextEncoder, console, Date });
    const response = await handler(new Request('https://example.test', { method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' }, body: JSON.stringify({ action, user_id: targetId, status: 'deactivate', ...extras }) }));
    assert.equal(response.status, expected);
    if (expected !== 200) assert.equal(writes.length, 0);
}
(async () => {
    await check('list-users', { role: 2, is_active: true }, 403);
    await check('set-user-status', { role: 1, is_active: false }, 403);
    await check('set-user-status', { role: 1, is_active: true, expires_at: '2000-01-01' }, 403);
    await check('set-user-status', { role: 1, is_active: true }, 400, { user_id: actorId });
    await check('set-user-status', { role: 1, is_active: true }, 400, { status: 'invalid' });
    await check('set-user-status', { role: 1, is_active: true }, 200);
    await check('list-users', { role: 1, is_active: true }, 200);
    console.log('PASS: 7 admin API authorization/status checks');
})().catch(error => { console.error(error); process.exitCode = 1; });
