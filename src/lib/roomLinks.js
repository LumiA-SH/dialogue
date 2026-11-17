export function readRoomLink(hash = window.location.hash) {
    const value = new URLSearchParams(hash.replace(/^#/, '')).get('room');
    return /^[1-9]\d*$/.test(value || '') && Number.isSafeInteger(Number(value)) && Number(value) <= 2147483647 ? Number(value) : null;
}

export function writeRoomLink(roomId) {
    const url = new URL(window.location.href);
    url.hash = roomId ? `room=${roomId}` : '';
    window.history.replaceState(null, '', url);
}
