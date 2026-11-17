import { pushAction } from './api';

export function pushSupport() {
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (ios && !standalone) return 'iPhone·iPad에서는 Safari 공유 메뉴 → 홈 화면에 추가 후 앱을 열어 알림을 켜 주세요. 일반 웹 이용은 계속 가능합니다.';
    if (!window.isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return '이 환경은 Web Push를 지원하지 않습니다. 앱을 열어 두면 인앱 알림을 받을 수 있습니다.';
    return '';
}

export async function registerPwa() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return null;
    const base = new URL(`${process.env.PUBLIC_URL || ''}/`, window.location.origin);
    return navigator.serviceWorker.register(new URL('service-worker.js', base).href, { scope: base.pathname });
}

function decodeKey(key) {
    const value = atob(key.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - key.length % 4) % 4));
    return Uint8Array.from(value, char => char.charCodeAt(0));
}

export async function enablePush(permissionPromise) {
    if (await permissionPromise !== 'granted') throw new Error('알림 권한이 허용되지 않았습니다. 브라우저 또는 iOS 설정에서 알림 권한을 변경해 주세요.');
    const { publicKey } = await pushAction('config');
    if (!publicKey) throw new Error('푸시 서버 키 설정이 아직 완료되지 않았습니다. 인앱 알림은 사용할 수 있습니다.');
    const registration = await registerPwa();
    if (!registration) throw new Error('서비스 워커를 사용할 수 없습니다.');
    await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (subscription && subscription.options.applicationServerKey && Array.from(new Uint8Array(subscription.options.applicationServerKey)).join() !== Array.from(decodeKey(publicKey)).join()) {
        await pushAction('unsubscribe', { endpoint: subscription.endpoint });
        await subscription.unsubscribe();
        subscription = null;
    }
    subscription = subscription || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeKey(publicKey) });
    await pushAction('subscribe', { subscription: subscription.toJSON() });
    return subscription;
}

export async function removeDevicePush() {
    if (!('serviceWorker' in navigator)) return;
    const base = new URL(`${process.env.PUBLIC_URL || ''}/`, window.location.origin);
    const registration = await navigator.serviceWorker.getRegistration(base.href);
    const subscription = await registration?.pushManager?.getSubscription();
    if (!subscription) return;
    // Stop browser delivery even if the server cleanup request fails.
    let cleanupError;
    try { await pushAction('unsubscribe', { endpoint: subscription.endpoint }); } catch (error) { cleanupError = error; }
    const removed = await subscription.unsubscribe();
    if (!removed) throw cleanupError || new Error('이 기기의 알림 구독을 해제하지 못했습니다.');
}
