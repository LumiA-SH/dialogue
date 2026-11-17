import React, { useCallback, useEffect, useState } from 'react';
import { BookOpen, Settings, LogOut, Users, MessageSquare, Shield } from 'lucide-react';
import { supabase, isConfigured } from '../lib/supabase';
import { getRows, loginWithCode, roomAction } from '../lib/api';

import Avatar from '../components/Avatar';
import RoomForm from '../components/RoomForm';

import Login from '../pages/Login';
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

export default function AppRouter() {
    const [session, setSession] = useState(null);
    const [profile, setProfile] = useState(null);
    const [rooms, setRooms] = useState([]);
    const [invites, setInvites] = useState([]);
    const [characters, setCharacters] = useState([]);
    const [preferences, setPreferences] = useState(null);

    const [view, setView] = useState('rooms');
    const [room, setRoom] = useState(null);
    const [roomFormOpen, setRoomFormOpen] = useState(false);
    const [joiningRoomId, setJoiningRoomId] = useState(null);
    const [accountMenuOpen, setAccountMenuOpen] = useState(false);

    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(true);
    const [refresh, setRefresh] = useState(0);

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

    function navigate(nextView) {
        setView(nextView);
        setRoom(null);
        setError('');
        setAccountMenuOpen(false);
    }

    async function selectRoom(selectedRoom) {
        if (joiningRoomId) return;

        if (!selectedRoom.is_member && !selectedRoom.is_public) {
            setError('비공개방은 받은 초대를 수락한 뒤 입장할 수 있습니다.');
            return;
        }

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
        setRoom(null);
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

    return (
        <div className={`app pbp-app${isRoomOpen ? ' pbp-app-room' : ''}`} style={theme}>
            {!isRoomOpen && (
                <header className="topbar pbp-global-header">
                    <button className="brand pbp-brand" onClick={() => navigate('rooms')}>
                        <BookOpen size={23} />
                        <span>다이얼로그</span>
                    </button>

                    <div className="pbp-desktop-account">
                        <Avatar src={profile?.user_portrait} name={userName} size={35} />
                        <strong className="pbp-account-name">{userName}</strong>

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
                                <div className="pbp-account-popup-name">{userName}</div>
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
                                room={room}
                                userId={session.user.id}
                                characters={characters}
                                preferences={preferences}
                                onBack={closeRoom}
                                onEdit={() => setRoomFormOpen(true)}
                                onError={setError}
                            />
                        )}

                        {view === 'characters' && (
                            <Characters
                                characters={characters}
                                userId={session.user.id}
                                onReload={reload}
                                onError={setError}
                            />
                        )}

                        {view === 'settings' && (
                            <SettingsPage
                                profile={profile}
                                preferences={preferences}
                                userId={session.user.id}
                                onSaved={reload}
                                onError={setError}
                            />
                        )}

                        {view === 'admin' && isAdmin && (
                            <Admin onError={setError} />
                        )}
                    </div>
                </main>
            </div>

            {roomFormOpen && room && (
                <RoomForm
                    room={room}
                    onClose={() => setRoomFormOpen(false)}
                    onSaved={handleRoomSaved}
                />
            )}
        </div>
    );
}