/* No authenticated API responses or RP logs are cached. */
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
    event.waitUntil((async () => {
        let payload = {};
        try { payload = event.data?.json() || {}; } catch (_) { /* Display a safe fallback. */ }
        const roomId = Number(payload.room_id);
        const url = new URL(self.registration.scope);
        if (Number.isSafeInteger(roomId) && roomId > 0) url.hash = `room=${roomId}`;
        await self.registration.showNotification(payload.title || '다이얼로그 · 새 RP', {
            body: payload.body || '새로운 RP 메시지가 도착했습니다.',
            icon: new URL('icons/icon-192.png', self.registration.scope).href,
            badge: new URL('icons/icon-192.png', self.registration.scope).href,
            tag: payload.message_id ? `pbp-${payload.message_id}` : 'pbp-new-message',
            data: { url: url.href },
            timestamp: Date.now()
        });
    })());
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil((async () => {
        const scope = new URL(self.registration.scope);
        const target = new URL(event.notification.data?.url || scope.href, scope);
        if (target.origin !== scope.origin || target.pathname !== scope.pathname) return;
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const existing = windows.find(client => {
            const url = new URL(client.url);
            return url.origin === scope.origin && url.pathname.startsWith(scope.pathname);
        });
        if (existing) {
            const navigated = await existing.navigate(target.href);
            await (navigated || existing).focus();
        } else await self.clients.openWindow(target.href);
    })());
});
