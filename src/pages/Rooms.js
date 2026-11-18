import React, { useEffect, useState } from 'react';
import { BookOpen, Plus, UserPlus, Lock, Globe, Check, X, Search } from 'lucide-react';
import RoomForm from '../components/RoomForm';
import Modal from '../components/Modal';
import { roomAction } from '../lib/api';
import { renderRpMarkdown } from './RoomView';

function formatDate(value) {
    return value
        ? new Date(value).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
        : '';
}

function getUnreadCount(room) {
    const count = Number(room.unread_count ?? room.unreadCount ?? 0);
    return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
}

function getMessagePreview(room) {
    const text = room.last_message_text || room.last_message?.text;

    if (typeof text === 'string' && text.trim()) {
        return text.trim().replace(/\s+/g, ' ');
    }

    if (room.is_member) return '이야기를 이어서 작성할 수 있어요.';
    if (room.is_invited) return '초대 수락 후 입장할 수 있어요.';
    if (room.is_public) return '새로운 이야기에 참여해 보세요.';

    return '비공개 RP방';
}

function RoomCard({ room, onSelect, onInvite, joiningRoomId }) {
    const unreadCount = getUnreadCount(room);
    const hasInviteButton = Boolean(room.is_member);
    const isJoining = joiningRoomId === room.room_id;

    return (
        <article className={`pbp-room-card${hasInviteButton ? ' has-invite' : ''}`}>
            <button
                className="pbp-room-card-main"
                onClick={() => onSelect(room)}
                disabled={Boolean(joiningRoomId)}
                aria-label={`${room.room_name} ${room.is_member ? '입장' : '참여'}`}
            >
                <span className="pbp-room-cover">
                    {room.room_img
                        ? <img src={room.room_img} alt="" />
                        : <BookOpen size={26} />}
                </span>

                <span className="pbp-room-info">
                    <strong className="pbp-room-name">{room.room_name}</strong>

                    <span className="pbp-room-preview" style={{ fontSynthesis: 'weight style' }} dangerouslySetInnerHTML={{ __html: renderRpMarkdown(getMessagePreview(room), true) }} />

                    <span className="pbp-room-meta">
                        <span className="pbp-room-date">{formatDate(room.created_at)}</span>

                        <span className="pbp-room-visibility">
                            {room.is_public
                                ? <Globe size={12} />
                                : <Lock size={12} />}
                            {room.is_public ? '공개' : '비공개'}
                        </span>

                        <span>
                            {isJoining
                                ? '참여 중...'
                                : room.is_member
                                    ? '참여 중'
                                    : room.is_invited
                                        ? '초대 수락 대기'
                                        : '참여 가능'}
                        </span>
                    </span>
                </span>
            </button>

            {unreadCount > 0 && (
                <span className="pbp-unread-badge" aria-label={`새 메시지 ${unreadCount}개`}>
                    {unreadCount > 99 ? '99+' : unreadCount}
                </span>
            )}

            {hasInviteButton && (
                <button
                    className="pbp-room-invite-button"
                    onClick={() => onInvite(room)}
                    aria-label={`${room.room_name} 사용자 초대`}
                    title="사용자 초대"
                >
                    <UserPlus size={16} />
                    <span>초대</span>
                </button>
            )}
        </article>
    );
}

export default function Rooms({ rooms, invites = [], isAdmin, onSelect, onReload, onError, joiningRoomId }) {
    const [editingRoom, setEditingRoom] = useState(null);
    const [formOpen, setFormOpen] = useState(false);
    const [inviteRoom, setInviteRoom] = useState(null);
    const [inviteSearch, setInviteSearch] = useState('');
    const [users, setUsers] = useState([]);
    const [usersLoading, setUsersLoading] = useState(false);
    const [sendingUserId, setSendingUserId] = useState(null);
    const [processingInvite, setProcessingInvite] = useState(null);
    const [notice, setNotice] = useState('');
    const [roomSearch, setRoomSearch] = useState('');

    useEffect(() => {
        if (!inviteRoom) return;

        let active = true;
        setUsersLoading(true);

        const timeout = setTimeout(async () => {
            try {
                const result = await roomAction('list-users', {
                    search: inviteSearch.trim(),
                    limit: 100
                });

                if (active) setUsers(result.users || []);
            } catch (err) {
                if (active) onError(err.message);
            } finally {
                if (active) setUsersLoading(false);
            }
        }, 200);

        return () => {
            active = false;
            clearTimeout(timeout);
        };
    }, [inviteRoom, inviteSearch, onError]);

    function openCreate() {
        setEditingRoom(null);
        setFormOpen(true);
    }

    function closeForm() {
        setFormOpen(false);
        setEditingRoom(null);
    }

    async function handleSaved() {
        onReload();
        closeForm();
    }

    function openInvite(room) {
        setInviteRoom(room);
        setInviteSearch('');
        setUsers([]);
        setNotice('');
    }

    async function sendInvite(userId) {
        if (!inviteRoom || sendingUserId) return;

        setSendingUserId(userId);

        try {
            await roomAction('invite', {
                room_id: inviteRoom.room_id,
                invited_user_id: userId
            });

            setNotice('초대를 보냈습니다. 상대방이 수락하면 함께 이용할 수 있어요.');
        } catch (err) {
            onError(err.message);
        } finally {
            setSendingUserId(null);
        }
    }

    async function respondInvite(invite, accept) {
        if (processingInvite) return;

        setProcessingInvite(invite.invite_id);

        try {
            await roomAction(accept ? 'accept-invite' : 'decline-invite', {
                invite_id: invite.invite_id
            });

            onReload();
            setNotice(accept
                ? '초대를 수락했습니다. 방 목록에서 입장할 수 있어요.'
                : '초대를 거절했습니다.'
            );
        } catch (err) {
            onError(err.message);
        } finally {
            setProcessingInvite(null);
        }
    }

    const keyword = roomSearch.trim().toLocaleLowerCase('ko-KR');

    const filteredRooms = rooms.filter(room =>
        room.room_name.toLocaleLowerCase('ko-KR').includes(keyword)
    );

    const unreadRooms = filteredRooms
        .filter(room => room.is_member && getUnreadCount(room) > 0)
        .sort((a, b) => new Date(a.last_message_at || 0) - new Date(b.last_message_at || 0));

    const joinedRooms = filteredRooms
        .filter(room => room.is_member && getUnreadCount(room) === 0)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const discoverRooms = filteredRooms.filter(room => !room.is_member);

    function renderCards(items) {
        return (
            <div className="pbp-room-grid">
                {items.map(room => (
                    <RoomCard
                        key={room.room_id}
                        room={room}
                        onSelect={onSelect}
                        onInvite={openInvite}
                        joiningRoomId={joiningRoomId}
                    />
                ))}
            </div>
        );
    }

    return (
        <div className="pbp-home">
            <div className="pbp-home-toolbar">
                <div className="pbp-home-heading">
                    <h1>RP방</h1>
                </div>

                <div className="pbp-home-actions">
                    <div className="pbp-room-search">
                        <Search size={17} aria-hidden="true" />
                        <label className="pbp-visually-hidden" htmlFor="room-search">
                            방 검색
                        </label>
                        <input
                            id="room-search"
                            type="search"
                            value={roomSearch}
                            onChange={event => setRoomSearch(event.target.value)}
                            placeholder="방 이름 검색"
                        />
                    </div>

                    {isAdmin && (
                        <button className="primary pbp-new-room-button" onClick={openCreate}>
                            <Plus size={18} />
                            새 방
                        </button>
                    )}
                </div>
            </div>

            {notice && (
                <p className="notice pbp-room-notice" role="status">
                    {notice}
                </p>
            )}

            {invites.length > 0 && (
                <section className="pbp-invite-panel">
                    <div className="pbp-home-section-heading">
                        <h2>받은 초대</h2>
                        <span>{invites.length}건</span>
                    </div>

                    <div className="pbp-invite-list">
                        {invites.map(invite => (
                            <div className="pbp-invite-item" key={invite.invite_id}>
                                <div className="pbp-invite-information">
                                    <strong>
                                        {invite.room?.room_name || `방 #${invite.room_id}`}
                                    </strong>
                                    <p>
                                        {invite.inviter_name}님의 초대 · {formatDate(invite.created_at)}
                                    </p>
                                </div>

                                <div className="pbp-invite-actions">
                                    <button
                                        className="primary"
                                        disabled={Boolean(processingInvite)}
                                        onClick={() => respondInvite(invite, true)}
                                    >
                                        <Check size={16} />
                                        수락
                                    </button>

                                    <button
                                        className="secondary"
                                        disabled={Boolean(processingInvite)}
                                        onClick={() => respondInvite(invite, false)}
                                    >
                                        <X size={16} />
                                        거절
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {unreadRooms.length > 0 && (
                <section className="pbp-home-section pbp-unread-section">
                    <div className="pbp-home-section-heading">
                        <h2>새 메시지</h2>
                        <span>{unreadRooms.length}개의 방</span>
                    </div>

                    {renderCards(unreadRooms)}
                </section>
            )}

            <section className="pbp-home-section">
                <div className="pbp-home-section-heading">
                    <h2>참여 중인 RP방</h2>
                    <span>{joinedRooms.length}개의 방</span>
                </div>

                {joinedRooms.length > 0
                    ? renderCards(joinedRooms)
                    : <div className="pbp-home-empty">표시할 RP방이 없습니다.</div>}
            </section>

            {discoverRooms.length > 0 && (
                <section className="pbp-home-section">
                    <div className="pbp-home-section-heading">
                        <h2>참여 가능한 RP방</h2>
                        <span>{discoverRooms.length}개의 방</span>
                    </div>

                    {renderCards(discoverRooms)}
                </section>
            )}

            {formOpen && (
                <RoomForm
                    room={editingRoom}
                    onClose={closeForm}
                    onSaved={handleSaved}
                />
            )}

            {inviteRoom && (
                <Modal
                    title={`${inviteRoom.room_name} · 사용자 초대`}
                    onClose={() => setInviteRoom(null)}
                >
                    <div className="form-body pbp-invite-form">
                        <label htmlFor="room-invite-search">
                            초대할 사용자 검색
                        </label>

                        <input
                            id="room-invite-search"
                            type="search"
                            value={inviteSearch}
                            onChange={event => setInviteSearch(event.target.value)}
                            placeholder="닉네임으로 검색"
                        />

                        {notice && (
                            <p className="notice" role="status">
                                {notice}
                            </p>
                        )}

                        <div className="pbp-invite-candidates">
                            {usersLoading && (
                                <p className="muted">사용자를 조회하고 있어요...</p>
                            )}

                            {!usersLoading && !users.length && (
                                <p className="muted">검색된 사용자가 없어요.</p>
                            )}

                            {!usersLoading && users.map(user => (
                                <div className="pbp-invite-item" key={user.user_id}>
                                    <span>{user.user_name}</span>

                                    <button
                                        className="secondary"
                                        disabled={Boolean(sendingUserId)}
                                        onClick={() => sendInvite(user.user_id)}
                                    >
                                        <UserPlus size={15} />
                                        초대
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                </Modal>
            )}
        </div>
    );
}