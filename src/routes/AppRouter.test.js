import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import AppRouter from './AppRouter';
import { getRows, roomAction } from '../lib/api';

let mockSession = null, mockAuthChanged, mockPrivate = false, mockMember = true, mockCompleted = true;
jest.mock('../lib/supabase', () => ({
    isConfigured: true,
    supabase: { auth: {
        getSession: async () => ({ data: { session: mockSession } }),
        onAuthStateChange: callback => { mockAuthChanged = callback; return { data: { subscription: { unsubscribe() {} } } }; }
    } }
}));
jest.mock('../lib/api', () => ({
    getRows: jest.fn(async table => {
        if (table === 'user') return [{ user_id: 'me', user_name: 'User', role: 2, profile_completed: mockCompleted }];
        if (table === 'rooms') return [{ room_id: 4, room_name: 'Deep Room', is_public: !mockPrivate }];
        if (table === 'room_user') return mockMember ? [{ room_id: 4, user_id: 'me' }] : [];
        return [];
    }),
    roomAction: jest.fn(async () => ({ rooms: [], invites: [] }))
}));
jest.mock('../components/RpNotifications', () => () => null);
jest.mock('../pages/Login', () => () => <p>Login screen</p>);
jest.mock('../pages/RoomView', () => ({ room }) => <p>Opened room {room.room_id}</p>);
jest.mock('../pages/Rooms', () => () => <p>Room list</p>);
jest.mock('../pages/ProfileSetup', () => ({ onSaved }) => <button onClick={() => onSaved({ user_id: 'me', profile_completed: true })}>Complete profile</button>);

let container, root;
beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    mockSession = null; mockPrivate = false; mockMember = true; mockCompleted = true;
    window.history.replaceState(null, '', '/pbp_1.0/#room=4');
    container = document.createElement('div');
    root = createRoot(container);
    jest.clearAllMocks();
    getRows.mockImplementation(async table => {
        if (table === 'user') return [{ user_id: 'me', user_name: 'User', role: 2, profile_completed: mockCompleted }];
        if (table === 'rooms') return [{ room_id: 4, room_name: 'Deep Room', is_public: !mockPrivate }];
        if (table === 'room_user') return mockMember ? [{ room_id: 4, user_id: 'me' }] : [];
        return [];
    });
    roomAction.mockResolvedValue({ rooms: [], invites: [] });
});
afterEach(() => act(() => root.unmount()));
test('notification deep link waits for login and then opens the room', async () => {
    await act(async () => root.render(<AppRouter />));
    expect(container.textContent).toContain('Login screen');
    expect(window.location.hash).toBe('#room=4');
    await act(async () => mockAuthChanged('SIGNED_IN', { user: { id: 'me' } }));
    expect(container.textContent).toContain('Opened room 4');
});
test('private room deep link cannot bypass membership', async () => {
    mockSession = { user: { id: 'me' } };
    mockPrivate = true; mockMember = false;
    await act(async () => root.render(<AppRouter />));
    expect(container.textContent).not.toContain('Opened room');
    expect(container.textContent).toContain('접근할 권한');
    expect(roomAction.mock.calls.some(call => call[0] === 'join')).toBe(false);
});
test('existing completed profiles do not see first-login setup on refresh', async () => {
    mockSession = { user: { id: 'me' } };
    window.history.replaceState(null, '', '/pbp_1.0/');
    await act(async () => root.render(<AppRouter />));
    expect(container.textContent).toContain('Room list');
    expect(container.textContent).not.toContain('Complete profile');
});
