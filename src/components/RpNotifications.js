import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

export default function RpNotifications({ userId, enabled, roomId, onOpen, onRefresh }) {
    const [notice, setNotice] = useState(null);
    const current = useRef({ enabled, roomId, onRefresh });
    current.current = { enabled, roomId, onRefresh };
    useEffect(() => {
        const seen = new Set();
        let timer;
        const channel = supabase.channel(`pbp-notifications-${userId}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, ({ new: message }) => {
            if (seen.has(message.message_id)) return;
            seen.add(message.message_id);
            if (seen.size > 500) seen.delete(seen.values().next().value);
            clearTimeout(timer);
            timer = setTimeout(() => current.current.onRefresh(), 250);
            if (message.user_id === userId || !current.current.enabled) return;
            if (message.room_id === current.current.roomId && document.visibilityState === 'visible') return;
            setNotice({ roomId: message.room_id, id: message.message_id });
        }).subscribe();
        const refresh = () => { if (document.visibilityState === 'visible') current.current.onRefresh(); };
        document.addEventListener('visibilitychange', refresh);
        return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', refresh); supabase.removeChannel(channel); };
    }, [userId]);
    useEffect(() => { if (!enabled || notice?.roomId === roomId) setNotice(null); }, [enabled, roomId, notice?.roomId]);
    if (!notice) return null;
    return <div className="pbp-rp-notification" role="status"><button type="button" onClick={() => { onOpen(notice.roomId); setNotice(null); }}>다른 방에 새 RP가 도착했습니다. 열기</button><button type="button" aria-label="알림 닫기" onClick={() => setNotice(null)}>닫기</button></div>;
}
