import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

const THROTTLE_MS = 1500;
const IDLE_MS = 4000;
const REMOTE_TTL_MS = 6000;
const EMPTY = { connected: false, users: [], typing: false };

export function createSitePresence(client, userId, onChange) {
    const entries = new Map();
    const clientId = crypto.randomUUID();
    let disposed = false, loading = false, refreshAgain = false;
    let snapshot = {};

    function emit() {
        if (disposed) return;
        const next = {};
        const now = Date.now();
        entries.forEach((entry, roomId) => {
            const users = new Set();
            let typing = false;
            const present = new Set();
            if (entry.joined) Object.values(entry.channel.presenceState()).flat().forEach(meta => {
                if (meta.room_id !== roomId || !meta.user_id || meta.user_id === userId) return;
                users.add(meta.user_id);
                const key = meta.client_id || meta.presence_ref;
                if (!key) return;
                present.add(key);
                const previous = entry.remote.get(key);
                if (!meta.typing) entry.remote.delete(key);
                else {
                    if (!previous || previous.sequence !== meta.typing_sequence) {
                        entry.remote.set(key, { sequence: meta.typing_sequence, until: now + REMOTE_TTL_MS });
                    }
                    if (entry.remote.get(key).until > now) typing = true;
                }
            });
            entry.remote.forEach((_, key) => { if (!present.has(key)) entry.remote.delete(key); });
            next[roomId] = { connected: entry.joined, users: [...users].sort(), typing };
        });
        if (JSON.stringify(next) !== JSON.stringify(snapshot)) {
            snapshot = next;
            onChange(next);
        }
    }

    function publish(entry) {
        entry.sequence += 1;
        // Serialize updates so an earlier "typing" cannot overtake a later stop.
        const sequence = entry.sequence;
        entry.queue = entry.queue.catch(() => {}).then(async () => {
            if (disposed || entries.get(entry.roomId) !== entry || !entry.joined || sequence !== entry.sequence) return;
            const result = await entry.channel.track({
                user_id: userId, room_id: entry.roomId, client_id: clientId,
                typing: entry.typing, typing_sequence: sequence
            });
            if (!disposed && entries.get(entry.roomId) === entry && result !== 'ok') {
                entry.joined = false;
                emit();
            }
        }).catch(() => {
            if (!disposed && entries.get(entry.roomId) === entry) { entry.joined = false; emit(); }
        });
    }

    function stopTyping(entry) {
        clearTimeout(entry.idleTimer);
        clearTimeout(entry.throttleTimer);
        entry.throttleTimer = null;
        if (!entry.typing) return;
        entry.typing = false;
        publish(entry);
    }

    function setTyping(roomId, typing) {
        const entry = entries.get(roomId);
        if (!entry || disposed) return;
        if (!typing || !entry.joined) { stopTyping(entry); return; }
        clearTimeout(entry.idleTimer);
        entry.idleTimer = setTimeout(() => stopTyping(entry), IDLE_MS);
        const elapsed = Date.now() - entry.lastSent;
        if (!entry.typing || elapsed >= THROTTLE_MS) {
            entry.typing = true;
            entry.lastSent = Date.now();
            publish(entry);
        } else if (!entry.throttleTimer) {
            entry.throttleTimer = setTimeout(() => {
                entry.throttleTimer = null;
                if (entry.typing) { entry.lastSent = Date.now(); publish(entry); }
            }, THROTTLE_MS - elapsed);
        }
    }

    function remove(entry) {
        clearTimeout(entry.idleTimer);
        clearTimeout(entry.throttleTimer);
        entry.joined = false;
        entry.sequence += 1;
        // Queue cleanup after any in-flight track to avoid restoring stale presence.
        entry.queue.catch(() => {}).then(() => entry.channel.untrack()).catch(() => {}).finally(() => {
            client.removeChannel(entry.channel).catch(() => {});
        });
    }

    function add(roomId) {
        const channel = client.channel(`pbp-presence-${roomId}`, { config: { private: true, presence: { key: clientId } } });
        const entry = { roomId, channel, joined: false, typing: false, sequence: 0, lastSent: 0, remote: new Map(), queue: Promise.resolve() };
        entries.set(roomId, entry);
        channel.on('presence', { event: 'sync' }, emit).subscribe(status => {
            if (disposed || entries.get(roomId) !== entry) return;
            entry.joined = status === 'SUBSCRIBED';
            if (entry.joined) publish(entry);
            else { stopTyping(entry); entry.remote.clear(); }
            emit();
        });
    }

    async function refresh() {
        if (disposed || navigator.onLine === false) return;
        if (loading) { refreshAgain = true; return; }
        loading = true;
        try {
            const roomIds = new Set();
            for (let offset = 0; ; offset += 1000) {
                const { data, error } = await client.from('room_user').select('room_id').eq('user_id', userId).order('room_id').range(offset, offset + 999);
                if (error) throw error;
                if (disposed) return;
                data.forEach(member => roomIds.add(member.room_id));
                if (data.length < 1000) break;
            }
            entries.forEach((entry, id) => { if (!roomIds.has(id)) { entries.delete(id); remove(entry); } });
            roomIds.forEach(id => { if (!entries.has(id)) add(id); });
            emit();
        } catch (_) {
            // Existing memberships remain until a successful refresh; RLS still gates each channel.
        } finally {
            loading = false;
            if (refreshAgain && !disposed) { refreshAgain = false; refresh(); }
        }
    }

    function offline() {
        entries.forEach(entry => {
            entry.joined = false;
            stopTyping(entry);
            entry.remote.clear();
        });
        emit();
    }

    function hidePage() {
        entries.forEach(entry => {
            stopTyping(entry);
            entry.joined = false;
            entry.queue.catch(() => {}).then(() => entry.channel.untrack()).catch(() => {});
        });
        emit();
    }

    function resume() {
        if (disposed || navigator.onLine === false) return;
        entries.forEach(entry => {
            if (entry.channel.state === 'joined') { entry.joined = true; publish(entry); }
        });
        refresh();
    }

    const refreshTimer = setInterval(refresh, 30000);
    const expiryTimer = setInterval(emit, 500);
    window.addEventListener('offline', offline);
    window.addEventListener('online', resume);
    window.addEventListener('pagehide', hidePage);
    window.addEventListener('pageshow', resume);
    window.addEventListener('focus', refresh);
    refresh();

    return {
        refresh,
        setTyping,
        dispose() {
            disposed = true;
            clearInterval(refreshTimer);
            clearInterval(expiryTimer);
            window.removeEventListener('offline', offline);
            window.removeEventListener('online', resume);
            window.removeEventListener('pagehide', hidePage);
            window.removeEventListener('pageshow', resume);
            window.removeEventListener('focus', refresh);
            entries.forEach(remove);
            entries.clear();
        }
    };
}

export function useSitePresence(userId, currentRoomId, refreshKey) {
    const [rooms, setRooms] = useState({});
    const service = useRef(null);
    useEffect(() => {
        setRooms({});
        if (!userId || !supabase) return;
        const current = createSitePresence(supabase, userId, setRooms);
        service.current = current;
        return () => { current.dispose(); if (service.current === current) service.current = null; };
    }, [userId]);
    useEffect(() => { service.current?.refresh(); }, [currentRoomId, refreshKey]);
    const onTypingChange = useCallback((roomId, typing) => service.current?.setTyping(roomId, typing), []);
    return { roomPresence: rooms[currentRoomId] || EMPTY, onTypingChange };
}
