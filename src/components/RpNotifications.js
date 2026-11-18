import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

async function wasRead(userId, message) {
    const { data: member, error } = await supabase.from('room_user').select('last_read_message_id').eq('room_id', message.room_id).eq('user_id', userId).maybeSingle();
    if (error) throw error;
    if (!member) return true;
    if (!member.last_read_message_id) return false;
    const { data: read, error: readError } = await supabase.from('messages').select('message_id').eq('room_id', message.room_id).eq('message_id', member.last_read_message_id)
        .or(`created_at.gt.${message.created_at},and(created_at.eq.${message.created_at},message_id.gte.${message.message_id})`).maybeSingle();
    if (readError) throw readError;
    return Boolean(read);
}

export default function RpNotifications({ userId, enabled, roomId, onOpen, onRefresh }) {
    const [notice, setNotice] = useState(null);
    const current = useRef({ enabled, roomId, onRefresh });
    current.current = { enabled, roomId, onRefresh };
    useEffect(() => {
        const seen = new Set();
        let timer;
        let active = true;
        let latestNotice = 0;
        const channel = supabase.channel(`pbp-notifications-${userId}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async ({ new: message }) => {
            if (seen.has(message.message_id)) return;
            seen.add(message.message_id);
            if (seen.size > 500) seen.delete(seen.values().next().value);
            clearTimeout(timer);
            timer = setTimeout(() => current.current.onRefresh(), 250);
            if (message.user_id === userId || !current.current.enabled) return;
            if (message.room_id === current.current.roomId && document.visibilityState === 'visible') return;
            const request = ++latestNotice;
            let read = false;
            try { read = await wasRead(userId, message); }
            catch (error) { if (process.env.NODE_ENV === 'development') console.debug('[PBP notice read check]', error.message); }
            if (!active || request !== latestNotice || read || !current.current.enabled) return;
            if (message.room_id === current.current.roomId && document.visibilityState === 'visible') return;
            setNotice({ roomId: message.room_id, id: message.message_id });
        }).subscribe();
        const refresh = () => { if (document.visibilityState === 'visible') current.current.onRefresh(); };
        document.addEventListener('visibilitychange', refresh);
        return () => { active = false; clearTimeout(timer); document.removeEventListener('visibilitychange', refresh); supabase.removeChannel(channel); };
    }, [userId]);
    useEffect(() => { if (!enabled || notice?.roomId === roomId) setNotice(null); }, [enabled, roomId, notice?.roomId]);
    if (!notice) return null;
    return <div className="pbp-rp-notification" role="status"><button type="button" onClick={() => { onOpen(notice.roomId); setNotice(null); }}>다른 방에 새 RP가 도착했습니다. 열기</button><button type="button" aria-label="알림 닫기" onClick={() => setNotice(null)}>닫기</button></div>;
}
