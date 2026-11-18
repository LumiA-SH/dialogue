import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Plus, PenLine, Unlink, Settings, Users, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import Modal from './Modal';
import Avatar from './Avatar';
import CharacterForm from './CharacterForm';
import '../styles/pbp-room-characters.css';

export default function RoomCharacterManager({ roomId, userId, characters, links, selected, onLinksChange, onSelect, onCharacterSaved, onClose }) {
    const [adding, setAdding] = useState(false);
    const [showAddOptions, setShowAddOptions] = useState(false);
    const [managing, setManaging] = useState(null);
    const [form, setForm] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const lock = useRef(false);
    const popupRef = useRef(null);

    const ownCharacters = characters.filter(character => character.user_id === userId);
    const connected = character => links.some(link => link.character_id === character.character_id && link.is_active !== false);
    const visible = ownCharacters.filter(character => adding ? !connected(character) : connected(character));
    const pickerOpen = !adding && !showAddOptions && !managing && !form;

    useLayoutEffect(() => {
        if (!pickerOpen) return;

        const popup = popupRef.current;
        const composer = popup?.closest('.pbp-composer-wrap');
        const panel = popup?.closest('.pbp-rp-panel');

        if (!popup || !composer || !panel) return;

        function updatePopupHeight() {
            const composerTop = composer.getBoundingClientRect().top;
            const panelTop = panel.getBoundingClientRect().top;
            const viewportTop = window.visualViewport?.offsetTop || 0;
            const available = composerTop - Math.max(panelTop + 8, viewportTop) - 8;

            popup.style.maxHeight = `${Math.max(70, Math.min(430, Math.floor(available)))}px`;
        }

        updatePopupHeight();

        const observer = typeof ResizeObserver !== 'undefined'
            ? new ResizeObserver(updatePopupHeight)
            : null;

        observer?.observe(composer);
        observer?.observe(panel);

        window.addEventListener('resize', updatePopupHeight);
        window.visualViewport?.addEventListener('resize', updatePopupHeight);

        return () => {
            observer?.disconnect();
            window.removeEventListener('resize', updatePopupHeight);
            window.visualViewport?.removeEventListener('resize', updatePopupHeight);
        };
    }, [pickerOpen]);

    useEffect(() => {
        if (!pickerOpen) return;

        function handleOutside(event) {
            if (!popupRef.current?.contains(event.target)) onClose();
        }

        function handleKeyDown(event) {
            if (event.key === 'Escape') onClose();
        }

        document.addEventListener('pointerdown', handleOutside);
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener('pointerdown', handleOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [pickerOpen, onClose]);

    async function run(action) {
        if (lock.current) return;

        lock.current = true;
        setBusy(true);
        setError('');

        try {
            await action();
        } catch (err) {
            setError(err.message || '캐릭터 처리에 실패했습니다.');
        } finally {
            lock.current = false;
            setBusy(false);
        }
    }

    async function connect(character) {
        const existing = links.find(link => link.character_id === character.character_id);

        const query = existing
            ? supabase.from('room_character').update({ is_active: true }).eq('room_id', roomId).eq('character_id', character.character_id)
            : supabase.from('room_character').insert({ room_id: roomId, character_id: character.character_id, is_active: true });

        const { data, error: saveError } = await query.select().single();

        if (saveError) throw saveError;

        onLinksChange(previous => [...previous.filter(link => link.character_id !== character.character_id), data]);
        setAdding(false);
        setShowAddOptions(false);
        await onSelect(character);
    }

    async function disconnect(character) {
        if (!window.confirm(`'${character.character_name}'의 방 연결을 해제할까요? 계정 캐릭터와 과거 RP 로그는 유지됩니다. 완전 삭제는 메인 캐릭터 탭에서 진행하세요.`)) return;

        await run(async () => {
            const { error: selectionError } = await supabase.from('room_user').update({ selected_character_id: null })
                .eq('room_id', roomId).eq('user_id', userId).eq('selected_character_id', character.character_id);

            if (selectionError) throw selectionError;
            if (selected === character.character_id) await onSelect(null, false);

            const { data, error: unlinkError } = await supabase.from('room_character').update({ is_active: false })
                .eq('room_id', roomId).eq('character_id', character.character_id).select().single();

            if (unlinkError) throw unlinkError;

            onLinksChange(previous => previous.map(link => link.character_id === character.character_id ? data : link));
            setManaging(null);
        });
    }

    async function saved(character) {
        const creating = !form.character;

        onCharacterSaved(character);
        setForm(null);
        setManaging(null);

        if (creating) await run(() => connect(character));
    }

    function openEditor(character) {
        setError('');
        setManaging(null);
        setShowAddOptions(false);
        setForm({ character });
    }

    if (form) {
        return <CharacterForm character={form.character} userId={userId} allowDelete={false} onClose={() => setForm(null)} onSaved={saved} onError={setError} inlineError={error} />;
    }

    if (managing) {
        return (
            <Modal title={`${managing.character_name} 설정`} onClose={() => { if (!busy) setManaging(null); }}>
                <div className="form-body pbp-room-characters">
                    {error && <p className="alert" role="alert">{error}</p>}

                    <div className="pbp-room-character-options">
                        <button className="secondary" type="button" disabled={busy} onClick={() => openEditor(managing)}>
                            <PenLine size={18} />
                            <span>캐릭터 수정</span>
                        </button>
                        <button className="secondary" type="button" disabled={busy} onClick={() => disconnect(managing)}>
                            <Unlink size={18} />
                            <span>이 방에서 연결 해제</span>
                        </button>
                    </div>

                    <p className="pbp-room-character-help">연결을 해제해도 계정에 등록된 캐릭터와 기존 RP 기록은 유지됩니다.</p>
                </div>
            </Modal>
        );
    }

    if (showAddOptions) {
        return (
            <Modal title="캐릭터 추가" onClose={() => setShowAddOptions(false)}>
                <div className="form-body pbp-room-characters">
                    <div className="pbp-room-character-options">
                        <button className="secondary" type="button" disabled={busy} onClick={() => { setShowAddOptions(false); setAdding(true); }}>
                            <Users size={18} />
                            <span>기존 캐릭터 불러오기</span>
                        </button>
                        <button className="secondary" type="button" disabled={busy} onClick={() => openEditor(null)}>
                            <Plus size={18} />
                            <span>새 캐릭터 만들기</span>
                        </button>
                    </div>
                </div>
            </Modal>
        );
    }

    if (adding) {
        return (
            <Modal title="기존 캐릭터 불러오기" onClose={() => { if (!busy) setAdding(false); }}>
                <div className="form-body pbp-room-characters">
                    {error && <p className="alert" role="alert">{error}</p>}

                    <div className="pbp-room-character-list">
                        {visible.map(character => (
                            <button className="pbp-room-character-select pbp-room-character-import" type="button" key={character.character_id} disabled={busy} onClick={() => run(() => connect(character))}>
                                <Avatar src={character.character_portrait} name={character.character_name} size={48} />
                                <span className="pbp-room-character-name">{character.character_name}</span>
                                <small>{links.some(link => link.character_id === character.character_id) ? '재연결' : '불러오기'}</small>
                            </button>
                        ))}
                    </div>

                    {!visible.length && <p className="notice">불러올 기존 캐릭터가 없습니다.</p>}

                    <button className="pbp-room-character-add" type="button" disabled={busy} onClick={() => openEditor(null)}>
                        <Plus size={17} />
                        <span>새 캐릭터 만들기</span>
                    </button>
                </div>
            </Modal>
        );
    }

    return (
        <div className="pbp-character-picker-popup" ref={popupRef} role="dialog" aria-label="캐릭터 선택">
            <div className="pbp-character-picker-header">
                <strong>캐릭터</strong>
                <button type="button" disabled={busy} aria-label="캐릭터 선택 닫기" onClick={onClose}>
                    <X size={18} />
                </button>
            </div>

            <div className="pbp-character-picker-body">
                {error && <p className="alert" role="alert">{error}</p>}

                <div className="pbp-room-character-list">
                    {visible.map(character => (
                        <div className={`pbp-room-character-row${selected === character.character_id ? ' is-selected' : ''}`} key={character.character_id}>
                            <button className="pbp-room-character-select" type="button" disabled={busy} aria-pressed={selected === character.character_id} onClick={() => run(() => onSelect(character))}>
                                <Avatar src={character.character_portrait} name={character.character_name} size={48} />
                                <span className="pbp-room-character-name">{character.character_name}</span>
                                {selected === character.character_id && <small>선택 중</small>}
                            </button>

                            <button className="pbp-room-character-gear" type="button" disabled={busy} aria-label={`${character.character_name} 설정`} title="캐릭터 설정" onClick={() => { setError(''); setManaging(character); }}>
                                <Settings size={18} />
                            </button>
                        </div>
                    ))}
                </div>

                {!visible.length && <p className="pbp-room-character-empty">이 방에 연결된 캐릭터가 없습니다.</p>}

                <button className="pbp-room-character-add" type="button" disabled={busy} onClick={() => { setError(''); setShowAddOptions(true); }}>
                    <Plus size={18} />
                    <span>캐릭터 추가</span>
                </button>
            </div>
        </div>
    );
}