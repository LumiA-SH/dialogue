import { readRoomLink, writeRoomLink } from './roomLinks';
test('room deep links parse only valid PostgreSQL room IDs', () => {
    expect(readRoomLink('#room=12')).toBe(12);
    for (const hash of ['', '#room=-1', '#room=0', '#room=1.5', '#room=abc', '#room=2147483648']) expect(readRoomLink(hash)).toBeNull();
});
test('room navigation preserves the GitHub Pages base path', () => {
    window.history.replaceState(null, '', '/pbp_1.0/');
    writeRoomLink(17);
    expect(window.location.pathname).toBe('/pbp_1.0/');
    expect(window.location.hash).toBe('#room=17');
    writeRoomLink(null);
    expect(window.location.hash).toBe('');
});
