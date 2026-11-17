import React, { useEffect, useState } from 'react';
import { enablePush, pushSupport, removeDevicePush } from '../lib/pwa';
import { supabase } from '../lib/supabase';

export default function PushSettings({ userId, enabled, onChange }) {
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [subscribed, setSubscribed] = useState(false);
    const support = pushSupport();
    useEffect(() => {
        let active = true;
        if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistration(`${process.env.PUBLIC_URL || ''}/`).then(registration => registration?.pushManager?.getSubscription()).then(subscription => { if (active) setSubscribed(Boolean(subscription)); }).catch(() => {});
        return () => { active = false; };
    }, []);
    async function change(next, permission, inAppOnly = false) {
        setBusy(true);
        setMessage('');
        try {
            if (next && !support && !inAppOnly) { await enablePush(permission); setSubscribed(true); }
            if (!next) { await removeDevicePush(); setSubscribed(false); }
            const { error } = await supabase.from('settings').upsert({ user_id: userId, notification_enabled: next }, { onConflict: 'user_id' });
            if (error) throw error;
            onChange(next);
            setMessage(next ? '알림을 켰습니다.' : '알림을 끄고 이 기기의 구독을 해제했습니다.');
        } catch (err) { setMessage(err.message); }
        finally { setBusy(false); }
    }
    return <div className="form-body">
        <h3>신규 RP 알림</h3>
        <p>알림 설정: {enabled ? '켜짐' : '꺼짐'} · 이 기기 푸시: {subscribed ? '구독됨' : '미구독'}</p>
        {support && <p className="notice">{support}</p>}
        <p className="muted">iPhone·iPad는 iOS/iPadOS 16.4 이상에서 홈 화면 앱으로 실행해 주세요. 알림 권한이 거부되었다면 브라우저 사이트 설정 또는 iOS 설정 → 알림에서 변경할 수 있습니다.</p>
        <div className="pbp-admin-user-actions">
            <button className="secondary" type="button" disabled={busy} onClick={() => {
                // iOS requires the permission prompt directly inside a user gesture.
                const permission = !support ? Notification.requestPermission() : Promise.resolve('unsupported');
                change(true, permission);
            }}>{support ? '인앱 알림 켜기' : '이 기기 알림 켜기'}</button>
            {!support && <button className="secondary" type="button" disabled={busy} onClick={() => change(true, null, true)}>인앱 알림만 켜기</button>}
            <button className="secondary" type="button" disabled={busy || (!enabled && !subscribed)} onClick={() => change(false)}>알림 끄기</button>
        </div>
        {message && <p role="status">{message}</p>}
    </div>;
}
