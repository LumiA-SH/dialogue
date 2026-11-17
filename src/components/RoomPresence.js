import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import '../styles/pbp-presence.css';

export default function RoomPresence({ roomId, userId }) {
    const [state, setState] = useState({ connected: false, users: [] });
    useEffect(() => {
        let active = true;
        let joined = false;
        setState({ connected: false, users: [] });
        const channel = supabase.channel(`pbp-presence-${roomId}`, { config: { private: true, presence: { key: userId } } });
        const sync = () => {
            if (!active || !joined) return;
            const users = [...new Set(Object.values(channel.presenceState()).flat().filter(item => item.room_id === roomId).map(item => item.user_id))];
            setState({ connected: true, users });
        };
        const offline = () => { joined = false; if (active) setState({ connected: false, users: [] }); };
        const track = async () => {
            if (!active || !joined) return;
            const result = await channel.track({ user_id: userId, room_id: roomId });
            if (result !== 'ok') offline();
        };
        channel.on('presence', { event: 'sync' }, sync).subscribe(status => {
            if (!active) return;
            if (status === 'SUBSCRIBED') { joined = true; track(); }
            else offline();
        });
        const pagehide = () => { channel.untrack(); offline(); };
        const pageshow = () => { if (active) { joined = channel.state === 'joined'; track(); } };
        window.addEventListener('offline', offline);
        window.addEventListener('pagehide', pagehide);
        window.addEventListener('pageshow', pageshow);
        return () => {
            active = false;
            window.removeEventListener('offline', offline);
            window.removeEventListener('pagehide', pagehide);
            window.removeEventListener('pageshow', pageshow);
            channel.untrack();
            supabase.removeChannel(channel);
        };
    }, [roomId, userId]);
    const others = state.users.filter(id => id !== userId).length;
    const label = !state.connected ? '접속 상태 연결 중' : others ? `상대방 ${others}명 접속 중` : '상대방 미접속';
    return <span className={`pbp-presence${state.connected && others ? ' is-online' : ''}`} role="status" aria-label={label} title={label}><span className="pbp-presence-dot" /></span>;
}
