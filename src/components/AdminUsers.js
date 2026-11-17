import React, { useCallback, useEffect, useState } from 'react';
import { adminAuthAction } from '../lib/api';
import Avatar from './Avatar';

export default function AdminUsers({ refreshKey, onSelectCode, onError }) {
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
        } catch (err) { onError(err.message); }
        finally { setBusy(false); }
    }, [page, onError]);
    useEffect(() => { load(); }, [load, refreshKey]);
    async function change(user, status) {
        const label = { activate: '활성화', deactivate: '비활성화', expire: '만료 처리' }[status];
        if (busy || !window.confirm(`${user.user_name} 계정을 ${label}할까요?`)) return;
        setBusy(true);
        try {
            await adminAuthAction('set-user-status', { user_id: user.user_id, status });
            await load();
        } catch (err) { onError(err.message); }
        finally { setBusy(false); }
    }
    return (
        <section className="panel">
            <h2>사용자 계정 ({total})</h2>
            <button className="secondary" type="button" disabled={busy} onClick={load}>목록 새로고침</button>
            <div className="form-body">
                {users.map(user => {
                    const expired = user.expires_at && new Date(user.expires_at).getTime() <= Date.now();
                    const status = expired ? '만료' : user.is_active ? '활성' : '비활성';
                    return <div className="panel" key={user.user_id}>
                        <div className="profile-row"><Avatar src={user.user_portrait} name={user.user_name} size={40} /><strong>{user.user_name}</strong><span>{status}{user.role === 1 ? ' · 관리자' : ''}</span></div>
                        <div className="pbp-admin-user-actions">
                            <button className="secondary" type="button" disabled={busy} onClick={() => onSelectCode(user.user_id)}>접속 코드 관리</button>
                            <button className="secondary" type="button" disabled={busy || user.user_id === actor || (user.is_active && !expired)} onClick={() => change(user, 'activate')}>활성화</button>
                            <button className="secondary" type="button" disabled={busy || user.user_id === actor || !user.is_active} onClick={() => change(user, 'deactivate')}>비활성화</button>
                            <button className="danger" type="button" disabled={busy || user.user_id === actor || expired} onClick={() => change(user, 'expire')}>만료 처리</button>
                        </div>
                    </div>;
                })}
                {!users.length && <p>{busy ? '조회 중...' : '등록된 사용자가 없습니다.'}</p>}
                <div className="pbp-admin-user-actions">
                    <button className="secondary" type="button" disabled={busy || page === 0} onClick={() => setPage(value => value - 1)}>이전</button>
                    <span>{page + 1}페이지</span>
                    <button className="secondary" type="button" disabled={busy || (page + 1) * 50 >= total} onClick={() => setPage(value => value + 1)}>다음</button>
                </div>
            </div>
        </section>
    );
}
