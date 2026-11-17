import React, { useEffect, useState } from 'react';
import { BookOpen, Plus, UserPlus, Lock, Globe, Check, X } from 'lucide-react';
import RoomForm from '../components/RoomForm';
import Modal from '../components/Modal';
import { roomAction } from '../lib/api';

function formatDate(value) {
    return value
        ? new Date(value).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
        : '';
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
            setNotice(accept ? '초대를 수락했습니다. 방 목록에서 입장할 수 있어요.' : '초대를 거절했습니다.');
        } catch (err) {
            onError(err.message);
        } finally {
            setProcessingInvite(null);
        }
    }

    const filteredRooms = rooms.filter(room => room.room_name.toLocaleLowerCase('ko-KR')
        .includes(roomSearch.trim().toLocaleLowerCase('ko-KR')));

    return (
        <>
            <div className="section-heading">
                <div>
                    <h1>RP방</h1>
                    <p>함께 만들어가는 이야기의 목록</p>
                </div>

                {isAdmin && (
                    <button className="primary" onClick={openCreate}>
                        <Plus size={18} /> 새 방
                    </button>
                )}
            </div>

            {notice && <p className="notice" role="status">{notice}</p>}

            {invites.length > 0 && (
                <section className="panel">
                    <h2>받은 초대 ({invites.length})</h2>
                    <div className="room-invite-list">
                        {invites.map(invite => (
                            <div className="room-invite-item" key={invite.invite_id}>
                                <div>
                                    <strong>{invite.room?.room_name || `방 #${invite.room_id}`}</strong>
                                    <p className="muted">{invite.inviter_name}님의 초대 · {formatDate(invite.created_at)}</p>
                                </div>
                                <div className="room-invite-actions">
                                    <button className="primary" disabled={Boolean(processingInvite)} onClick={() => respondInvite(invite, true)}>
                                        <Check size={16} /> 수락
                                    </button>
                                    <button className="secondary" disabled={Boolean(processingInvite)} onClick={() => respondInvite(invite, false)}>
                                        <X size={16} /> 거절
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            <div className="room-search">
                <label htmlFor="room-search">방 검색</label>
                <input id="room-search" type="search" value={roomSearch} onChange={event => setRoomSearch(event.target.value)} placeholder="방 이름으로 검색" />
            </div>

            <div className="room-grid">
                {filteredRooms.map(room => (
                    <div className="room-card-container" key={room.room_id}>
                        <button className="room-card" onClick={() => onSelect(room)} disabled={Boolean(joiningRoomId)}>
                            <div className="room-cover">
                                {room.room_img
                                    ? <img src={room.room_img} alt="" />
                                    : <BookOpen size={30} />}
                            </div>

                            <div className="room-card-text">
                                <strong>{room.room_name}</strong>
                                <span>#{room.room_id} · {formatDate(room.created_at)}</span>
                                <span className="room-status">
                                    {room.is_public ? <Globe size={13} /> : <Lock size={13} />}
                                    {room.is_public ? '공개방' : '비공개방'}
                                    {' · '}
                                    {room.is_member ? '참여 중' : room.is_invited ? '초대 수락 대기' : '클릭하여 참여'}
                                </span>
                            </div>
                        </button>

                        {room.is_member && (
                            <button className="secondary room-invite-button" onClick={() => openInvite(room)}>
                                <UserPlus size={16} /> 사용자 초대
                            </button>
                        )}
                    </div>
                ))}
            </div>

            {!filteredRooms.length && <div className="empty">조회할 수 있는 RP방이 없어요.</div>}

            {formOpen && (
                <RoomForm room={editingRoom} onClose={closeForm} onSaved={handleSaved} />
            )}

            {inviteRoom && (
                <Modal title={`${inviteRoom.room_name} · 사용자 초대`} onClose={() => setInviteRoom(null)}>
                    <div className="form-body">
                        <label htmlFor="room-invite-search">초대할 사용자 검색</label>
                        <input id="room-invite-search" type="search" value={inviteSearch} onChange={event => setInviteSearch(event.target.value)} placeholder="닉네임으로 검색" />
                        {notice && <p className="notice" role="status">{notice}</p>}

                        <div className="room-invite-candidates">
                            {usersLoading && <p className="muted">사용자를 조회하고 있어요...</p>}
                            {!usersLoading && !users.length && <p className="muted">검색된 사용자가 없어요.</p>}
                            {!usersLoading && users.map(user => (
                                <div className="room-invite-item" key={user.user_id}>
                                    <span>{user.user_name}</span>
                                    <button className="secondary" disabled={Boolean(sendingUserId)} onClick={() => sendInvite(user.user_id)}>
                                        <UserPlus size={15} /> 초대
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                </Modal>
            )}
        </>
    );
}
