const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const handlers = {};
const notifications = [];
const visits = [];
let windows = [];
const self = { registration: { scope: 'https://lumia-sh.github.io/pbp_1.0/', showNotification: async (title, data) => notifications.push({ title, data }) }, addEventListener: (name, handler) => { handlers[name] = handler; }, clients: { matchAll: async () => windows, openWindow: async url => visits.push(url), claim: async () => {} }, skipWaiting: async () => {} };
vm.runInNewContext(fs.readFileSync(require('path').join(__dirname, '../public/service-worker.js'), 'utf8'), { self, URL, Date });
async function event(name, payload) { let task; handlers[name]({ ...payload, waitUntil: value => { task = value; } }); await task; }
(async () => {
    await event('push', { data: { json: () => ({ room_id: 32, message_id: 'message-1' }) } });
    assert.equal(notifications[0].data.data.url, 'https://lumia-sh.github.io/pbp_1.0/#room=32');
    assert.equal(notifications[0].data.tag, 'pbp-message-1');
    const notification = { data: notifications[0].data.data, close: () => {} };
    await event('notificationclick', { notification });
    assert.deepEqual(visits, ['https://lumia-sh.github.io/pbp_1.0/#room=32']);
    let focused = false;
    windows = [{ url: 'https://lumia-sh.github.io/pbp_1.0/', navigate: async url => { visits.push(url); return { focus: async () => { focused = true; } }; } }];
    await event('notificationclick', { notification });
    assert.equal(focused, true);
    const before = visits.length;
    await event('notificationclick', { notification: { close() {}, data: { url: 'https://evil.test/' } } });
    assert.equal(visits.length, before);
    await event('push', { data: { json: () => { throw new Error('malformed'); } } });
    assert.equal(notifications.length, 2);
    console.log('PASS: SW push, GitHub Pages link, new window, existing window reuse, foreign URL rejection, malformed payload fallback');
})().catch(error => { console.error(error); process.exitCode = 1; });
