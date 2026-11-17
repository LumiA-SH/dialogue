import React from 'react';
import '../styles/pbp-presence.css';

export default function RoomPresence({ presence }) {
    const { connected = false, users = [], typing = false } = presence || {};
    const label = !connected ? '접속 상태 연결 중' : users.length ? `상대방 ${users.length}명 접속 중` : '상대방 미접속';
    return <span className={`pbp-presence${connected && users.length ? ' is-online' : ''}`} role="status" aria-label={typing ? `${label} · 입력 중…` : label} title={label}><span className="pbp-presence-dot" />{connected && typing && <span className="pbp-presence-typing">입력 중…</span>}</span>;
}
