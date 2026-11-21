import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, KeyRound, Check, Ban, Clock3, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { adminAuthAction } from '../lib/api';
import Avatar from './Avatar';

const PAGE_SIZE = 50;

export default function AdminUsers({ refreshKey, onSelectCode, onDeleted, onError }) {
    const [users, setUsers] = useState([]);
    const [actor, setActor] = useState('');
    const [page, setPage] = useState(0);
    const [total, setTotal] = useState(0);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        setBusy(true);

        try {
            const result = await adminAuthAction('list-users', { page });
            setUsers(result.users || []);
            setTotal(result.total || 0);
            setActor(result.actor_id);
        } catch (err) {
            onError(err.message);
        } finally {
            setBusy(false);
        }
    }, [page, onError]);

    useEffect(() => {
        load();
    }, [load, refreshKey]);

    async function change(user, status) {
        const label = {
            activate: '활성화',
            deactivate: '비활성화',
            expire: '만료 처리'
        }[status];

        if (busy || !window.confirm(`${user.user_name} 계정을 ${label}할까요?`)) return;

        setBusy(true);

        try {
            await adminAuthAction('set-user-status', {
                user_id: user.user_id,
                status
            });

            await load();
        } catch (err) {
            onError(err.message);
        } finally {
            setBusy(false);
        }
    }

    async function deleteUser(user) {
        if (busy || user.user_id === actor) return;

        const confirmed = window.confirm(
            `'${user.user_name}' 계정을 완전히 삭제할까요?\n\n` +
            `사용자 ID: ${user.user_id}\n\n` +
            '계정과 접속 코드가 삭제되며 복구할 수 없습니다.\n' +
            'RP 기록이 남아 있는 계정은 삭제되지 않습니다.'
        );

        if (!confirmed) return;

        setBusy(true);

        try {
            await adminAuthAction('delete-user', {
                user_id: user.user_id
            });

            if (page > 0 && users.length === 1) {
                setPage(value => value - 1);
            } else {
                await load();
            }

            await onDeleted?.(user.user_id);
        } catch (err) {
            onError(err.message || '계정을 삭제하지 못했습니다.');
        } finally {
            setBusy(false);
        }
    }

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    function renderUser(user) {
        const isSelf = user.user_id === actor;
        const expired = Boolean(user.expires_at && new Date(user.expires_at).getTime() <= Date.now());
        const active = user.is_active && !expired;
        const status = expired ? '만료' : active ? '활성' : '비활성';
        const statusClass = expired ? 'expired' : active ? 'active' : 'inactive';

        return (
            <div className="pbp-admin-user-row" key={user.user_id}>
                <div className="pbp-admin-user-info">
                    <Avatar src={user.user_portrait} name={user.user_name} size={40} />

                    <div className="pbp-admin-user-details">
                        <div className="pbp-admin-user-name">
                            <strong>{user.user_name}</strong>
                            {isSelf && <span className="pbp-admin-user-self">본인</span>}
                            <span className="pbp-admin-user-id" title={user.user_id}>
                                {user.user_id.slice(0, 8)}
                            </span>
                        </div>

                        <div className="pbp-admin-user-meta">
                            <span className={`pbp-admin-user-status is-${statusClass}`}>{status}</span>
                            <span className="pbp-admin-user-role">{user.role === 1 ? '관리자' : '일반 사용자'}</span>

                            {user.profile_completed === false && (
                                <span className="pbp-admin-user-incomplete">프로필 미완료</span>
                            )}
                        </div>
                    </div>
                </div>

                <div className="pbp-admin-user-actions">
                    <button className="secondary pbp-admin-user-code" type="button" disabled={busy} onClick={() => onSelectCode(user.user_id)}>
                        <KeyRound size={15} />
                        접속 코드 관리
                    </button>

                    {!isSelf && !active && (
                        <button className="secondary pbp-admin-user-activate" type="button" disabled={busy} onClick={() => change(user, 'activate')}>
                            <Check size={15} />
                            활성화
                        </button>
                    )}

                    {!isSelf && active && (
                        <>
                            <button className="secondary" type="button" disabled={busy} onClick={() => change(user, 'deactivate')}>
                                <Ban size={15} />
                                비활성화
                            </button>

                            <button className="danger-outline pbp-admin-user-expire" type="button" disabled={busy} onClick={() => change(user, 'expire')}>
                                <Clock3 size={15} />
                                만료 처리
                            </button>
                        </>
                    )}

                    {!isSelf && (
                        <button className="danger-outline pbp-admin-user-delete" type="button" disabled={busy} onClick={() => deleteUser(user)}>
                            <Trash2 size={15} />
                            삭제
                        </button>
                    )}
                </div>
            </div>
        );
    }

    return (
        <section className="panel pbp-admin-users">
            <div className="pbp-admin-users-header">
                <div className="pbp-admin-users-heading">
                    <h2>사용자 계정</h2>
                    <span>{total}명</span>
                </div>

                <button className="secondary pbp-admin-users-refresh" type="button" disabled={busy} onClick={load}>
                    <RefreshCw size={15} className={busy ? 'is-loading' : ''} />
                    새로고침
                </button>
            </div>

            <div className="pbp-admin-user-list">
                {users.map(renderUser)}

                {!users.length && (
                    <div className="pbp-admin-users-empty">
                        {busy ? '사용자 목록을 불러오는 중입니다.' : '등록된 사용자가 없습니다.'}
                    </div>
                )}
            </div>

            {total > 0 && (
                <div className="pbp-admin-users-pagination">
                    <button className="secondary" type="button" disabled={busy || page === 0} onClick={() => setPage(value => value - 1)} aria-label="이전 페이지">
                        <ChevronLeft size={16} />
                        이전
                    </button>

                    <span className="pbp-admin-users-page">
                        <strong>{page + 1}</strong> / {totalPages} 페이지
                    </span>

                    <button className="secondary" type="button" disabled={busy || page + 1 >= totalPages} onClick={() => setPage(value => value + 1)} aria-label="다음 페이지">
                        다음
                        <ChevronRight size={16} />
                    </button>
                </div>
            )}
        </section>
    );
}