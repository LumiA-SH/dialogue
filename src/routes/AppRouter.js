import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Settings, LogOut, Users, MessageSquare, Shield } from 'lucide-react';
import { supabase, isConfigured } from '../lib/supabase';
import { getRows, loginWithCode, roomAction } from '../lib/api';

import Avatar from '../components/Avatar';
import RoomForm from '../components/RoomForm';

import Login from '../pages/Login';
import ProfileSetup from '../pages/ProfileSetup';
import RpNotifications from '../components/RpNotifications';
import { removeDevicePush } from '../lib/pwa';
import { readRoomLink } from '../lib/roomLinks';
import { useSitePresence } from '../lib/sitePresence';
import Rooms from '../pages/Rooms';
import RoomView from '../pages/RoomView';
import Characters from '../pages/Characters';
import SettingsPage from '../pages/Settings';
import Admin from '../pages/Admin';

const defaultColors = {
    ui_main_color: '#EAF2FF',
    ui_sub_color: '#FFFFFF',
    ui_border_color: '#B9CBE5',
    ui_system_text_color: '#243B53',
    ui_body_text_color: '#243B53'
};

function readPageRoute() {
    const roomId = readRoomLink();
    const page = window.location.hash.slice(1);
    return { view: !roomId && ['characters', 'settings', 'admin'].includes(page) ? page : 'rooms', roomId };
}

function writePageRoute(route, userId, depth, replace = false) {
    const url = new URL(window.location.href);
    url.hash = route.roomId ? 'room=' + route.roomId : route.view === 'rooms' ? '' : route.view;
    window.history[replace ? 'replaceState' : 'pushState']({ pbpNavigation: { ...route, userId, depth } }, '', url);
}

export default function AppRouter() {
    const [session, setSession] = useState(null);
    const [profile, setProfile] = useState(null);
    const [rooms, setRooms] = useState([]);
    const [invites, setInvites] = useState([]);
    const [characters, setCharacters] = useState([]);
    const [preferences, setPreferences] = useState(null);
    const [notificationOverride, setNotificationOverride] = useState(null);

    const [view, setView] = useState(() => readPageRoute().view);
    const roomExitRef = useRef(null);
    const navigationRequest = useRef(0);
    const navigationUrl = useRef(window.location.href);
    const [room, setRoom] = useState(null);
    const [deepLinkId, setDeepLinkId] = useState(() => readRoomLink());
    const [roomFormOpen, setRoomFormOpen] = useState(false);
    const [joiningRoomId, setJoiningRoomId] = useState(null);
    const [accountMenuOpen, setAccountMenuOpen] = useState(false);

    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(true);
    const [refresh, setRefresh] = useState(0);
    const { roomPresence, onTypingChange } = useSitePresence(session?.user.id, room?.room_id, refresh);

    const reload = useCallback(() => {
        setRefresh(value => value + 1);
    }, []);

    useEffect(() => {
        if (!supabase) {
            setLoading(false);
            return;
        }

        let active = true;

        supabase.auth.getSession().then(({ data, error: sessionError }) => {
            if (!active) return;

            if (sessionError) setError(sessionError.message);
            setSession(data.session);
            setLoading(false);
        }).catch(err => {
            if (!active) return;

            setError(err.message);
            setLoading(false);
        });

        const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
            setSession(nextSession);
        });

        return () => {
            active = false;
            listener.subscription.unsubscribe();
        };
    }, []);

    useEffect(() => {
        if (!session) {
            setProfile(null);
            setRooms([]);
            setInvites([]);
            setCharacters([]);
            setPreferences(null);
            setNotificationOverride(null);
            return;
        }

        let active = true;

        async function loadData() {
            try {
                const [users, roomResult, inviteResult, characterRows, settingsRows] = await Promise.all([
                    getRows('user', query => query.eq('user_id', session.user.id)),
                    roomAction('list', { limit: 100 }),
                    roomAction('list-invites'),
                    getRows('characters', query => query.eq('user_id', session.user.id).order('created_at', { ascending: false })),
                    getRows('settings', query => query.eq('user_id', session.user.id))
                ]);

                if (!active) return;

                setProfile(users[0] || null);
                setRooms(roomResult.rooms || []);
                setInvites(inviteResult.invites || []);
                setCharacters(characterRows);
                setPreferences(settingsRows[0] || null);
                setError('');
            } catch (err) {
                if (active) setError(err.message);
            }
        }

        loadData();

        return () => {
            active = false;
        };
    }, [session, refresh]);

    const showRoute = useCallback(route => {
        setRoom(null);
        setView(route.view);
        setDeepLinkId(route.roomId || null);
        setRoomFormOpen(false);
        setError('');
        setAccountMenuOpen(false);
    }, []);

    useEffect(() => {
        if (!session?.user.id) return;
        const entry = window.history.state?.pbpNavigation;
        const route = readPageRoute();
        writePageRoute(route, session.user.id, entry?.userId === session.user.id ? entry.depth : 0, true);
        navigationUrl.current = window.location.href;
        showRoute(route);
        const changed = async () => {
            if (navigationUrl.current === window.location.href) return;
            navigationUrl.current = window.location.href;
            const request = ++navigationRequest.current;
            const saved = window.history.state?.pbpNavigation;
            const next = saved && saved.userId !== session.user.id ? { view: 'rooms', roomId: null } : readPageRoute();
            if (roomExitRef.current) await roomExitRef.current();
            if (request !== navigationRequest.current) return;
            writePageRoute(next, session.user.id, saved?.userId === session.user.id ? saved.depth : 0, true);
            navigationUrl.current = window.location.href;
            showRoute(next);
            reload();
        };
        window.addEventListener('popstate', changed);
        window.addEventListener('hashchange', changed);
        return () => {
            navigationRequest.current += 1;
            window.removeEventListener('popstate', changed);
            window.removeEventListener('hashchange', changed);
        };
    }, [session?.user.id, showRoute, reload]);

    useEffect(() => {
        if (!session?.user.id || !profile || profile.profile_completed === false || !deepLinkId) return;
        let active = true;
        async function openLink() {
            try {
                const [found, members] = await Promise.all([
                    getRows('rooms', query => query.eq('room_id', deepLinkId).limit(1)),
                    getRows('room_user', query => query.eq('room_id', deepLinkId).eq('user_id', session.user.id))
                ]);
                const target = found[0];
                if (!target || (!members.length && !target.is_public)) throw new Error('이 방에 접근할 권한이 없거나 방이 삭제되었습니다.');
                if (!members.length) await roomAction('join', { room_id: deepLinkId });
                if (!active) return;
                setRoom({ ...target, is_member: true });
                setView('rooms');
                setAccountMenuOpen(false);
                setError('');
                setDeepLinkId(null);
            } catch (err) {
                if (active) { setError(err.message); setDeepLinkId(null); setRoom(null); setView('rooms'); writePageRoute({ view: 'rooms', roomId: null }, session.user.id, window.history.state?.pbpNavigation?.depth || 0, true); navigationUrl.current = window.location.href; }
            }
        }
        openLink();
        return () => { active = false; };
    }, [session, profile, deepLinkId]);

    async function openNotification(id) {
        if (room?.room_id === id) return;
        const request = ++navigationRequest.current;
        if (roomExitRef.current) await roomExitRef.current();
        if (request !== navigationRequest.current) return;
        recordRoute({ view: 'rooms', roomId: id });
        showRoute({ view: 'rooms', roomId: id });
    }

    async function login(code) {
        setBusy(true);
        setError('');

        try {
            await loginWithCode(code);
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    }

    async function logout() {
        try {
            await removeDevicePush();
            const { error: logoutError } = await supabase.auth.signOut();
            if (logoutError) throw logoutError;

            setSession(null);
            setRoom(null);
            setView('rooms');
            setRoomFormOpen(false);
            setAccountMenuOpen(false);
        } catch (err) {
            setError(err.message);
        }
    }

    useEffect(() => {
        if (profile && profile.role !== 1 && view === 'admin') {
            const next = { view: 'rooms', roomId: null };
            writePageRoute(next, session?.user.id, window.history.state?.pbpNavigation?.depth || 0, true);
            navigationUrl.current = window.location.href;
            showRoute(next);
        }
    }, [profile, view, session?.user.id, showRoute]);

    function recordRoute(next) {
        navigationRequest.current += 1;
        const saved = window.history.state?.pbpNavigation;
        const depth = saved?.userId === session?.user.id ? saved.depth : 0;
        writePageRoute({ view, roomId: room?.room_id || null }, session?.user.id, depth, true);
        writePageRoute(next, session?.user.id, depth + 1);
        navigationUrl.current = window.location.href;
    }

    function goBack() {
        const saved = window.history.state?.pbpNavigation;
        if (saved?.userId === session?.user.id && saved.depth > 0) {
            window.history.back();
        } else {
            navigationRequest.current += 1;
            const next = { view: 'rooms', roomId: null };
            writePageRoute(next, session?.user.id, 0, true);
            navigationUrl.current = window.location.href;
            showRoute(next);
        }
    }

    function navigate(nextView) {
        if (view === nextView && !room) return;
        const next = { view: nextView, roomId: null };
        recordRoute(next);
        showRoute(next);
    }

    async function selectRoom(selectedRoom) {
        if (joiningRoomId) return;

        if (!selectedRoom.is_member && !selectedRoom.is_public) {
            setError('비공개방은 받은 초대를 수락한 뒤 입장할 수 있습니다.');
            return;
        }

        const request = ++navigationRequest.current;
        setJoiningRoomId(selectedRoom.room_id);
        setError('');

        try {
            if (!selectedRoom.is_member) {
                await roomAction('join', { room_id: selectedRoom.room_id });

                setRooms(previous => previous.map(item =>
                    item.room_id === selectedRoom.room_id
                        ? { ...item, is_member: true, is_invited: false }
                        : item
                ));
            }

            if (request !== navigationRequest.current) return;
            recordRoute({ view: 'rooms', roomId: selectedRoom.room_id });
            setDeepLinkId(null);
            setRoom({ ...selectedRoom, is_member: true });
            setView('rooms');
            setAccountMenuOpen(false);
        } catch (err) {
            setError(err.message);
        } finally {
            setJoiningRoomId(null);
        }
    }

    function closeRoom() {
        goBack();
        reload();
    }

    async function handleRoomSaved(savedRoom) {
        if (savedRoom && room?.room_id === savedRoom.room_id) {
            setRoom(previous => ({ ...previous, ...savedRoom }));
        }

        reload();
        setRoomFormOpen(false);
    }

    const colors = {
        ...defaultColors,
        ...Object.fromEntries(
            Object.keys(defaultColors).map(key => [
                key,
                preferences?.[key] || defaultColors[key]
            ])
        )
    };

    const theme = {
        '--main': colors.ui_main_color,
        '--sub': colors.ui_sub_color,
        '--border': colors.ui_border_color,
        '--system-text': colors.ui_system_text_color,
        '--body-text': colors.ui_body_text_color
    };

    const isAdmin = profile?.role === 1;
    const isRoomOpen = view === 'rooms' && Boolean(room);
    const userName = profile?.user_name || 'User';

    if (loading) {
        return <div className="center-screen">연결 확인 중...</div>;
    }

    if (!isConfigured) {
        return (
            <div className="center-screen setup">
                <h1>Supabase 설정 필요</h1>
                <p><code>.env</code> 파일에 공개용 Supabase 키를 입력하세요.</p>
                <p>설정 방법은 README.md를 확인하세요.</p>
            </div>
        );
    }

    if (!session) {
        return <Login onLogin={login} error={error} busy={busy} />;
    }

    if (!profile) {
        return <div className="center-screen"><p>{error || '프로필 확인 중...'}</p><button className="secondary" onClick={reload}>다시 시도</button><button className="secondary" onClick={logout}>로그아웃</button></div>;
    }

    if (profile.profile_completed === false) {
        return <ProfileSetup userId={session.user.id} onLogout={logout} onSaved={saved => { setProfile(saved); setView('rooms'); reload(); }} />;
    }

    return (
        <div className={`app pbp-app${isRoomOpen ? ' pbp-app-room' : ''}`} style={theme}>
            <RpNotifications userId={session.user.id} enabled={notificationOverride ?? preferences?.notification_enabled} roomId={room?.room_id} onOpen={openNotification} onRefresh={reload} />
            {!isRoomOpen && (
                <header className="topbar pbp-global-header">
                    <button className="brand pbp-brand" onClick={() => navigate('rooms')}>
                        <BookOpen size={23} />
                        <span>DIALOGUE</span>
                    </button>

                    <div className="pbp-desktop-account">
                        <Avatar src={profile?.user_portrait} name={userName} size={35} />
                        <button className="secondary pbp-account-name" onClick={() => navigate('settings')} title="프로필 수정">{userName} · 프로필 수정</button>

                        <button className="pbp-logout-button" onClick={logout}>
                            <LogOut size={17} />
                            로그아웃
                        </button>
                    </div>

                    <div className="pbp-mobile-account">
                        <button
                            className="pbp-account-trigger"
                            aria-label="계정 메뉴"
                            aria-expanded={accountMenuOpen}
                            onClick={() => setAccountMenuOpen(previous => !previous)}
                        >
                            <Avatar src={profile?.user_portrait} name={userName} size={32} />
                        </button>

                        {accountMenuOpen && (
                            <div className="pbp-account-popup">
                                <div className="pbp-account-popup-name"><Avatar src={profile?.user_portrait} name={userName} size={40} />{userName}</div>
                                <button onClick={() => navigate('settings')}>프로필 수정</button>
                                <button onClick={logout}>
                                    <LogOut size={16} />
                                    로그아웃
                                </button>
                            </div>
                        )}
                    </div>
                </header>
            )}

            <div className={`layout pbp-shell${isRoomOpen ? ' pbp-shell-room' : ''}`}>
                {!isRoomOpen && (
                    <aside className="sidebar pbp-sidebar">
                        <nav className="pbp-navigation" aria-label="주 메뉴">
                            <button
                                className={`nav pbp-nav-item${view === 'rooms' ? ' active' : ''}`}
                                onClick={() => navigate('rooms')}
                                title="RP방"
                            >
                                <MessageSquare size={19} />
                                <span>RP방</span>
                            </button>

                            <button
                                className={`nav pbp-nav-item${view === 'characters' ? ' active' : ''}`}
                                onClick={() => navigate('characters')}
                                title="캐릭터"
                            >
                                <Users size={19} />
                                <span>캐릭터</span>
                            </button>

                            <button
                                className={`nav pbp-nav-item${view === 'settings' ? ' active' : ''}`}
                                onClick={() => navigate('settings')}
                                title="설정"
                            >
                                <Settings size={19} />
                                <span>설정</span>
                            </button>

                            {isAdmin && (
                                <button
                                    className={`nav pbp-nav-item${view === 'admin' ? ' active' : ''}`}
                                    onClick={() => navigate('admin')}
                                    title="관리자"
                                >
                                    <Shield size={19} />
                                    <span>관리자</span>
                                </button>
                            )}
                        </nav>
                    </aside>
                )}

                <main className={`content pbp-content${isRoomOpen ? ' pbp-content-room' : ''}`}>
                    <div className={isRoomOpen ? 'pbp-room-wrapper' : 'pbp-page'}>
                        {error && (
                            <div className="alert" role="alert">
                                {error}
                                <button onClick={() => setError('')}>닫기</button>
                            </div>
                        )}

                        {view === 'rooms' && !room && (
                            <Rooms
                                rooms={rooms}
                                onBack={goBack}
                                invites={invites}
                                isAdmin={isAdmin}
                                joiningRoomId={joiningRoomId}
                                onSelect={selectRoom}
                                onReload={reload}
                                onError={setError}
                            />
                        )}

                        {view === 'rooms' && room && (
                            <RoomView
                                key={room.room_id}
                                presence={roomPresence}
                                onTypingChange={onTypingChange}
                                room={room}
                                userId={session.user.id}
                                characters={characters}
                                onCharacterSaved={saved => setCharacters(previous => [saved, ...previous.filter(item => item.character_id !== saved.character_id)])}
                                preferences={preferences}
                                onBack={closeRoom}
                                beforeLeaveRef={roomExitRef}
                                onEdit={() => setRoomFormOpen(true)}
                                onError={setError}
                            />
                        )}

                        {view === 'characters' && (
                            <Characters
                                characters={characters}
                                onBack={goBack}
                                userId={session.user.id}
                                onReload={reload}
                                onError={setError}
                            />
                        )}

                        {view === 'settings' && (
                            <SettingsPage
                                onBack={goBack}
                                profile={profile}
                                preferences={preferences}
                                userId={session.user.id}
                                onSaved={reload}
                                onNotificationChange={setNotificationOverride}
                                onError={setError}
                            />
                        )}

                        {view === 'admin' && isAdmin && (
                            <Admin onError={setError} onBack={goBack} />
                        )}
                    </div>
                </main>
            </div>

            {roomFormOpen && room && (
                <RoomForm room={room} canManage={isAdmin} onClose={() => setRoomFormOpen(false)} onSaved={handleRoomSaved}
                          onDeleted={() => {
                              setRoom(null);
                              setRoomFormOpen(false);
                              reload();
                          }}
                />
            )}
        </div>
    );
}