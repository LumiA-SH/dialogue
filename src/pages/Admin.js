import React, { useCallback, useEffect, useState } from 'react';
import { Shield, Plus, Copy, RefreshCw, Trash2, Eye, EyeOff, ChevronDown } from 'lucide-react';
import { adminAuthAction } from '../lib/api';
import AdminUsers from '../components/AdminUsers';
import '../styles/pbp-admin-users.css';

function formatDate(value) {
    if (!value) return '-';

    return new Date(value).toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

export default function Admin({ onError }) {
    const [userName, setUserName] = useState('');
    const [targetUserId, setTargetUserId] = useState('');
    const [issued, setIssued] = useState(null);
    const [busy, setBusy] = useState(false);

    const [tokens, setTokens] = useState([]);
    const [tokenLoading, setTokenLoading] = useState(true);
    const [revealed, setRevealed] = useState(null);
    const [revealBusy, setRevealBusy] = useState(null);

    const loadTokens = useCallback(async () => {
        setTokenLoading(true);

        try {
            const result = await adminAuthAction('list-active-codes');
            setTokens(Array.isArray(result.tokens) ? result.tokens : []);
        } catch (err) {
            onError(err.message);
        } finally {
            setTokenLoading(false);
        }
    }, [onError]);

    useEffect(() => {
        loadTokens();
    }, [loadTokens]);

    async function createUser(event) {
        event.preventDefault();
        if (!userName.trim() || busy) return;

        setBusy(true);
        setIssued(null);
        setRevealed(null);

        try {
            const result = await adminAuthAction('create-user', {
                user_name: userName.trim()
            });

            setIssued(result);
            setTargetUserId(result.user_id);
            setUserName('');
            await loadTokens();
        } catch (err) {
            onError(err.message);
        } finally {
            setBusy(false);
        }
    }

    async function rotateCode() {
        const userId = targetUserId.trim();
        if (!userId || busy) return;

        if (!window.confirm('기존 접속 코드를 폐기하고 새 코드를 발급할까요?')) {
            return;
        }

        setBusy(true);
        setIssued(null);
        setRevealed(null);

        try {
            const result = await adminAuthAction('rotate-code', {
                user_id: userId
            });

            setIssued(result);
            await loadTokens();
        } catch (err) {
            onError(err.message);
        } finally {
            setBusy(false);
        }
    }

    async function revokeCode() {
        const userId = targetUserId.trim();
        if (!userId || busy) return;

        if (!window.confirm('이 사용자의 접속 코드를 폐기할까요? 기존 코드로는 다시 로그인할 수 없습니다.')) {
            return;
        }

        setBusy(true);

        try {
            await adminAuthAction('revoke-code', {
                user_id: userId
            });

            setIssued(null);
            setRevealed(null);
            await loadTokens();
            window.alert('접속 코드가 폐기되었습니다.');
        } catch (err) {
            onError(err.message);
        } finally {
            setBusy(false);
        }
    }

    async function copyCode(code) {
        if (!code) return;

        try {
            await navigator.clipboard.writeText(code);
            window.alert('접속 코드를 복사했습니다.');
        } catch (err) {
            onError('접속 코드 복사에 실패했습니다.');
        }
    }

    async function toggleReveal(token) {
        if (revealed?.token_id === token.token_id) {
            setRevealed(null);
            return;
        }

        if (revealBusy) return;

        setRevealed(null);
        setRevealBusy(token.token_id);

        try {
            const result = await adminAuthAction('reveal-code', {
                token_id: token.token_id
            });

            setRevealed({
                token_id: token.token_id,
                code: result.code
            });
        } catch (err) {
            onError(err.message);
        } finally {
            setRevealBusy(null);
        }
    }

    function handleTokenToggle(event) {
        if (!event.currentTarget.open) {
            setRevealed(null);
        }
    }

    return (
        <>
            <div className="section-heading">
                <div>
                    <h1><Shield size={24} /> 관리자</h1>
                    <p>사용자 계정 및 접속 코드 관리</p>
                </div>
            </div>

            <AdminUsers
                refreshKey={issued?.code}
                onError={onError}
                onSelectCode={id => {
                    setTargetUserId(id);
                    document.getElementById('admin-target-id')?.focus();
                }}
                onDeleted={async id => {
                    if (targetUserId === id) setTargetUserId('');
                    setIssued(null);
                    setRevealed(null);
                    await loadTokens();
                }} />

            <section className="panel">
                <h2>사용자 생성</h2>

                <form className="form-body" onSubmit={createUser}>
                    <label htmlFor="admin-user-name">사용자 닉네임</label>
                    <input id="admin-user-name" maxLength={24} value={userName} onChange={event => setUserName(event.target.value)} placeholder="새 사용자 이름" disabled={busy} required />

                    <div className="admin-auth-actions">
                        <button className="primary" type="submit" disabled={busy || !userName.trim()}>
                            <Plus size={17} /> 사용자 생성 및 코드 발급
                        </button>
                    </div>
                </form>
            </section>

            <section className="panel">
                <h2>접속 코드 관리</h2>

                <div className="form-body">
                    <label htmlFor="admin-target-id">사용자 ID</label>
                    <input id="admin-target-id" value={targetUserId} onChange={event => setTargetUserId(event.target.value)} placeholder="사용자 UUID" disabled={busy} />

                    <div className="admin-auth-actions">
                        <button className="secondary" type="button" onClick={rotateCode} disabled={busy || !targetUserId.trim()}>
                            <RefreshCw size={17} /> 접속 코드 재발급
                        </button>
                        <button className="danger-outline" type="button" onClick={revokeCode} disabled={busy || !targetUserId.trim()}>
                            <Trash2 size={17} /> 접속 코드 폐기
                        </button>
                    </div>
                </div>
            </section>

            {issued?.code && (
                <section className="panel">
                    <h2>발급된 접속 코드</h2>
                    <p className="notice">새로 발급한 접속 코드입니다. 이후에도 아래 발급 토큰 목록에서 확인할 수 있습니다.</p>

                    <div className="form-body">
                        <label htmlFor="issued-user-id">사용자 ID</label>
                        <input id="issued-user-id" value={issued.user_id || ''} readOnly />

                        <label htmlFor="issued-code">접속 코드</label>
                        <input id="issued-code" value={issued.code} readOnly />

                        <button className="primary" type="button" onClick={() => copyCode(issued.code)}>
                            <Copy size={17} /> 코드 복사
                        </button>
                    </div>
                </section>
            )}

            <details className="panel admin-token-details" onToggle={handleTokenToggle}>
                <summary className="admin-token-summary">
                    <div className="admin-token-summary-text">
                        <strong>발급 토큰</strong>
                        <span>{tokenLoading ? '조회 중...' : `현재 활성 토큰 ${tokens.length}개`}</span>
                    </div>

                    <ChevronDown className="admin-token-chevron" size={20} />
                </summary>

                <div className="admin-token-content">
                    <div className="admin-token-toolbar">
                        <p>현재 사용 가능한 접속 토큰만 표시됩니다.</p>

                        <button className="secondary" type="button" onClick={loadTokens} disabled={tokenLoading}>
                            <RefreshCw size={15} /> 새로고침
                        </button>
                    </div>

                    {tokenLoading && (
                        <p className="admin-token-empty">활성 토큰을 조회하고 있습니다.</p>
                    )}

                    {!tokenLoading && tokens.length === 0 && (
                        <p className="admin-token-empty">현재 활성화된 토큰이 없습니다.</p>
                    )}

                    {!tokenLoading && tokens.length > 0 && (
                        <div className="admin-token-list">
                            {tokens.map(token => (
                                <div className="admin-token-item" key={token.token_id}>
                                    <div className="admin-token-item-header">
                                        <div className="admin-token-user">
                                            <strong>{token.user_name}</strong>
                                            <span className="admin-token-status">활성</span>
                                        </div>

                                        <div className="admin-token-actions">
                                            <button className="secondary" type="button" onClick={() => setTargetUserId(token.user_id)}>
                                                관리 대상 선택
                                            </button>

                                            {token.recoverable && (
                                                <button className="secondary" type="button" onClick={() => toggleReveal(token)} disabled={Boolean(revealBusy)}>
                                                    {revealed?.token_id === token.token_id ? (
                                                        <><EyeOff size={15} /> 숨기기</>
                                                    ) : (
                                                        <><Eye size={15} /> {revealBusy === token.token_id ? '확인 중...' : '토큰 보기'}</>
                                                    )}
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    <div className="admin-token-meta">
                                        <span>사용자 ID: {token.user_id}</span>
                                        <span>발급일: {formatDate(token.created_at)}</span>
                                        <span>만료일: {token.expires_at ? formatDate(token.expires_at) : '없음'}</span>
                                    </div>

                                    {!token.recoverable && (
                                        <p className="admin-token-unavailable">
                                            기존 발급 토큰은 원문을 복구할 수 없습니다. 원문 확인이 필요하면 재발급해 주세요.
                                        </p>
                                    )}

                                    {revealed?.token_id === token.token_id && (
                                        <div className="admin-token-value">
                                            <input type="text" value={revealed.code} aria-label={`${token.user_name}의 접속 토큰`} readOnly />

                                            <button className="primary" type="button" onClick={() => copyCode(revealed.code)}>
                                                <Copy size={15} /> 복사
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </details>
        </>
    );
}