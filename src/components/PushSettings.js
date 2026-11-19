import React, { useEffect, useState } from 'react';
import { enablePush, pushSupport, removeDevicePush } from '../lib/pwa';
import { supabase } from '../lib/supabase';

function getStorageKey(userId) {
    return `dialogue-in-app-notifications:${userId}`;
}

function readSetting(userId, fallback) {
    try {
        const saved = window.localStorage.getItem(getStorageKey(userId));
        return saved === null ? Boolean(fallback) : saved === 'true';
    } catch {
        return Boolean(fallback);
    }
}

function storeSetting(userId, enabled) {
    try {
        window.localStorage.setItem(getStorageKey(userId), String(enabled));
    } catch {
        // 브라우저 저장소가 제한된 경우 현재 세션에서만 적용합니다.
    }
}

export default function PushSettings({ userId, enabled, onChange }) {
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [subscribed, setSubscribed] = useState(false);
    const [inAppEnabled, setInAppEnabled] = useState(() => readSetting(userId, enabled));
    const support = pushSupport();

    useEffect(() => {
        let active = true;

        setSubscribed(false);

        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistration(`${process.env.PUBLIC_URL || ''}/`)
                .then(registration => registration?.pushManager?.getSubscription())
                .then(subscription => {
                    if (active) setSubscribed(Boolean(subscription));
                })
                .catch(() => {});
        }

        return () => {
            active = false;
        };
    }, [userId]);

    useEffect(() => {
        setInAppEnabled(readSetting(userId, enabled));
    }, [userId, enabled]);

    async function changeDevice(next) {
        if (busy) return;

        setBusy(true);
        setMessage('');

        try {
            storeSetting(userId, inAppEnabled);

            if (next) {
                if (support) throw new Error(support);

                const permission = Notification.requestPermission();
                await enablePush(permission);
                setSubscribed(true);

                const { error } = await supabase.from('settings').upsert({
                    user_id: userId,
                    notification_enabled: true
                }, { onConflict: 'user_id' });

                if (error) throw error;

                setMessage('이 기기의 알림을 켰습니다.');
            } else {
                await removeDevicePush();
                setSubscribed(false);
                setMessage('이 기기의 알림 구독을 해제했습니다.');
            }
        } catch (err) {
            setMessage(err.message || '기기 알림 설정에 실패했습니다.');
        } finally {
            setBusy(false);
        }
    }

    function changeInApp(next) {
        if (busy) return;

        storeSetting(userId, next);
        setInAppEnabled(next);
        onChange?.(next);
        setMessage(next ? '인앱 알림을 켰습니다.' : '인앱 알림을 껐습니다.');
    }

    return (
        <div className="form-body pbp-notification-settings">
            <h3>알림 설정</h3>

            <label className="pbp-notification-toggle">
                <span>
                    <strong>기기 알림</strong>
                    <small>새 RP를 기기 알림으로 받습니다.</small>
                </span>
                <input type="checkbox" role="switch" checked={subscribed} disabled={busy || Boolean(support)} onChange={event => void changeDevice(event.target.checked)} />
            </label>

            <label className="pbp-notification-toggle">
                <span>
                    <strong>인앱 알림</strong>
                    <small>다이얼로그 이용 중 새 RP를 알려줍니다.</small>
                </span>
                <input type="checkbox" role="switch" checked={inAppEnabled} disabled={busy} onChange={event => changeInApp(event.target.checked)} />
            </label>

            {support && <p className="notice">{support}</p>}

            <p className="muted">
                iPhone·iPad 기기 알림은 iOS/iPadOS 16.4 이상에서 홈 화면 앱으로 실행해야 사용할 수 있습니다.
            </p>

            {message && <p role="status">{message}</p>}
        </div>
    );
}