import React, { useRef, useState } from 'react';
import { Plus, PenLine, Unlink } from 'lucide-react';
import { supabase } from '../lib/supabase';
import Modal from './Modal';
import Avatar from './Avatar';
import CharacterForm from './CharacterForm';
import '../styles/pbp-room-characters.css';

export default function RoomCharacterManager({ roomId, userId, characters, links, selected, onLinksChange, onSelect, onCharacterSaved, onClose }) {
    const [adding, setAdding] = useState(false);
    const [form, setForm] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const lock = useRef(false);
    const ownCharacters = characters.filter(character => character.user_id === userId);
    const connected = character => links.some(link => link.character_id === character.character_id && link.is_active !== false);
    const visible = ownCharacters.filter(character => adding ? !connected(character) : connected(character));

    async function run(action) {
        if (lock.current) return;
        lock.current = true;
        setBusy(true);
        setError('');
        try { await action(); } catch (err) { setError(err.message || '캐릭터 처리에 실패했습니다.'); }
        finally { lock.current = false; setBusy(false); }
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
        await onSelect(character);
    }

    async function disconnect(character) {
        if (!window.confirm(`'${character.character_name}'의 방 연결을 해제할까요? 계정 캐릭터와 과거 RP 로그는 유지됩니다. 완전 삭제는 메인 캐릭터 탭에서 진행하세요.`)) return;
        await run(async () => {
            // Clear only this character's persisted selection; preserve concurrent selections.
            const { error: selectionError } = await supabase.from('room_user').update({ selected_character_id: null })
                .eq('room_id', roomId).eq('user_id', userId).eq('selected_character_id', character.character_id);
            if (selectionError) throw selectionError;
            if (selected === character.character_id) await onSelect(null, false);
            const { data, error: unlinkError } = await supabase.from('room_character').update({ is_active: false })
                .eq('room_id', roomId).eq('character_id', character.character_id).select().single();
            if (unlinkError) throw unlinkError;
            onLinksChange(previous => previous.map(link => link.character_id === character.character_id ? data : link));
        });
    }

    async function saved(character) {
        const creating = !form.character;
        onCharacterSaved(character);
        setForm(null);
        if (creating) await run(() => connect(character));
    }

    if (form) return <CharacterForm character={form.character} userId={userId} allowDelete={false} onClose={() => setForm(null)} onSaved={saved} onError={setError} inlineError={error} />;

    return (
        <Modal title={adding ? '이 방에 캐릭터 추가' : '이 방에서 사용할 캐릭터'} onClose={() => { if (!busy) onClose(); }}>
            <div className="form-body pbp-room-characters">
                {error && <p className="alert" role="alert">{error}</p>}
                <p className="notice">내 캐릭터를 선택하거나 관리합니다. 연결 해제 시 계정 캐릭터와 과거 RP 로그는 보존됩니다. 완전 삭제는 메인 캐릭터 탭에서 진행하세요.</p>
                <div className="character-picker">
                    {visible.map(character => (
                        <div className="pbp-room-character-row" key={character.character_id}>
                            <button type="button" className={`picker-item${selected === character.character_id && !adding ? ' active' : ''}`} disabled={busy} aria-pressed={!adding && selected === character.character_id} onClick={() => run(() => adding ? connect(character) : onSelect(character))}>
                                <Avatar src={character.character_portrait} name={character.character_name} size={40} />
                                <span>{character.character_name}</span>
                                <small>{adding ? (links.some(link => link.character_id === character.character_id) ? '재연결' : '방에 추가') : selected === character.character_id ? '선택 중' : '선택'}</small>
                            </button>
                            {!adding && <div className="pbp-room-character-actions">
                                <button className="secondary" type="button" disabled={busy} aria-label={`${character.character_name} 수정`} onClick={() => { setError(''); setForm({ character }); }}><PenLine size={16} />수정</button>
                                <button className="secondary" type="button" disabled={busy} aria-label={`${character.character_name} 연결 해제`} onClick={() => disconnect(character)}><Unlink size={16} />연결 해제</button>
                            </div>}
                        </div>
                    ))}
                </div>
                {!visible.length && <p className="notice">{adding ? '추가할 기존 캐릭터가 없습니다.' : '이 방에 연결된 내 캐릭터가 없습니다.'}</p>}
                <div className="pbp-room-character-actions">
                    <button className="secondary" type="button" disabled={busy} onClick={() => setAdding(value => !value)}>{adding ? '연결된 캐릭터로 돌아가기' : '기존 캐릭터 추가'}</button>
                    <button className="primary" type="button" disabled={busy} onClick={() => { setError(''); setForm({ character: null }); }}><Plus size={17} />새 캐릭터 생성</button>
                </div>
            </div>
        </Modal>
    );
}
