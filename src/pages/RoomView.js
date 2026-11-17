import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ArrowLeft, Send, Image as ImageIcon, PenLine, Trash2,
    Download, Settings, Plus, ChevronDown, ChevronUp, X,
    PanelLeftClose, PanelLeftOpen
} from 'lucide-react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { supabase } from '../lib/supabase';
import { getRows, saveRow, deleteRow } from '../lib/api';
import Modal from '../components/Modal';
import Avatar from '../components/Avatar';
import formatDate from '../utils/formatDate';
import escapeHtml from '../utils/escapeHtml';
import '../styles/pbp-room-view.css';

const IMAGE_BUCKET = 'pbp-message-images';
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const DEFAULT_CHARACTER_COLOR = '#527EC2';
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export default function RoomView({ room, userId, characters, preferences, onBack, onEdit, onError }) {
    const [messages, setMessages] = useState([]);
    const [roomCharacters, setRoomCharacters] = useState([]);
    const [membership, setMembership] = useState(null);
    const [selected, setSelected] = useState('');
    const [narration, setNarration] = useState(false);
    const [text, setText] = useState('');
    const [imageFile, setImageFile] = useState(null);
    const [imagePreview, setImagePreview] = useState('');
    const [editing, setEditing] = useState(null);
    const [showCharacters, setShowCharacters] = useState(false);
    const [sending, setSending] = useState(false);

    const [composerExpanded, setComposerExpanded] = useState(false);
    const [mobileSceneOpen, setMobileSceneOpen] = useState(false);
    const [sceneCollapsed, setSceneCollapsed] = useState(false);
    const [sceneWidth, setSceneWidth] = useState(62);
    const [viewImage, setViewImage] = useState(null);

    const bottomRef = useRef(null);
    const containerRef = useRef(null);
    const fileInputRef = useRef(null);
    const textareaRef = useRef(null);
    const resizingRef = useRef(false);

    const sceneImage = room.scene_img || room.room_bg_img || room.room_background_image || room.room_img || '';
    const twitterMode = preferences?.input_style === 'twitter';
    const showComposer = !twitterMode || composerExpanded;
    const sendShortcut = preferences?.send_shortcut === 'alt_enter' ? 'alt_enter' : 'shift_enter';

    const load = useCallback(async () => {
        try {
            const [messageRows, roomCharacterRows, members] = await Promise.all([
                getRows('messages', query => query.eq('room_id', room.room_id).order('created_at', { ascending: true }).limit(500)),
                getRows('room_character', query => query.eq('room_id', room.room_id)),
                getRows('room_user', query => query.eq('room_id', room.room_id).eq('user_id', userId))
            ]);

            setMessages(messageRows);
            setRoomCharacters(roomCharacterRows);
            setMembership(members[0] || null);

            if (members[0]?.selected_character_id) {
                setSelected(value => value || members[0].selected_character_id);
            }
        } catch (err) {
            onError(err.message);
        }
    }, [room.room_id, userId, onError]);

    useEffect(() => {
        load();
    }, [load]);

    useEffect(() => {
        const channel = supabase.channel(`pbp-room-${room.room_id}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'messages',
                filter: `room_id=eq.${room.room_id}`
            }, () => load())
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [room.room_id, load]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages.length]);

    useEffect(() => {
        if (!imageFile) {
            setImagePreview('');
            return;
        }

        const objectUrl = URL.createObjectURL(imageFile);
        setImagePreview(objectUrl);

        return () => URL.revokeObjectURL(objectUrl);
    }, [imageFile]);

    useEffect(() => {
        if (composerExpanded) {
            textareaRef.current?.focus();
        }
    }, [composerExpanded]);

    const availableCharacters = characters.filter(character =>
        roomCharacters.some(link => link.character_id === character.character_id)
    );

    const currentCharacter = availableCharacters.find(character =>
        character.character_id === selected
    );

    function getCharacterColor(value) {
        return COLOR_PATTERN.test(value || '')
            ? value.toUpperCase()
            : DEFAULT_CHARACTER_COLOR;
    }

    function handleImageChange(event) {
        const file = event.target.files?.[0];
        if (!file) return;

        if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
            onError('JPG, PNG, WebP, GIF 이미지만 등록할 수 있습니다.');
            event.target.value = '';
            return;
        }

        if (file.size > MAX_IMAGE_SIZE) {
            onError('이미지는 최대 5MB까지 등록할 수 있습니다.');
            event.target.value = '';
            return;
        }

        setImageFile(file);
        setComposerExpanded(true);
    }

    function removeAttachedImage() {
        setImageFile(null);

        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    }

    async function uploadImage(file) {
        const extension = {
            'image/jpeg': 'jpg',
            'image/png': 'png',
            'image/webp': 'webp',
            'image/gif': 'gif'
        }[file.type];

        const path = `${room.room_id}/${crypto.randomUUID()}.${extension}`;

        const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, file, {
            contentType: file.type,
            upsert: false
        });

        if (error) throw error;

        const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
        return data.publicUrl;
    }

    async function send() {
        if (sending) return;

        if (!membership) {
            onError('방 참여자로 등록되어 있지 않습니다.');
            return;
        }

        if (!text.trim() && !imageFile) return;

        if (!narration && !selected) {
            onError('캐릭터를 먼저 선택하세요.');
            return;
        }

        const character = availableCharacters.find(item =>
            item.character_id === selected
        );

        if (!narration && !character) {
            onError('현재 방에 등록된 본인 캐릭터만 사용할 수 있습니다.');
            return;
        }

        setSending(true);

        try {
            const imageUrl = imageFile ? await uploadImage(imageFile) : null;

            await saveRow('messages', {
                room_id: room.room_id,
                user_id: userId,
                character_id: narration ? null : selected,
                message_type: narration ? 'narration' : 'character',
                text: text.trim() || null,
                img: imageUrl,
                character_name_snapshot: narration ? null : character.character_name,
                character_portrait_snapshot: narration ? null : character.character_portrait,
                character_color_snapshot: narration
                    ? null
                    : getCharacterColor(character.character_color)
            });

            setText('');
            removeAttachedImage();

            if (twitterMode) {
                setComposerExpanded(false);
            }

            await load();
        } catch (err) {
            onError(err.message);
        } finally {
            setSending(false);
        }
    }

    async function removeMessage(message) {
        if (!window.confirm('이 메시지를 삭제할까요?')) return;

        try {
            await deleteRow('messages', 'message_id', message.message_id);
            await load();
        } catch (err) {
            onError(err.message);
        }
    }

    async function saveEdit() {
        if (!editing) return;

        try {
            await saveRow('messages', {
                text: editing.text.trim() || null,
                img: editing.img || null
            }, 'message_id', editing.message_id);

            setEditing(null);
            await load();
        } catch (err) {
            onError(err.message);
        }
    }

    function exportHtml() {
        const lines = messages.map(message => {
            const name = message.character_name_snapshot ||
                (message.message_type === 'narration' ? '나레이션' : '캐릭터');

            const content = DOMPurify.sanitize(marked.parse(message.text || ''));

            const image = message.img
                ? `<p><a href="${escapeHtml(message.img)}">첨부 이미지</a></p>`
                : '';

            return `<article><h3>${escapeHtml(name)} · ${escapeHtml(formatDate(message.created_at))}</h3><div>${content}</div>${image}</article>`;
        }).join('\n');

        const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>${escapeHtml(room.room_name)}</title>
<style>
body { max-width: 760px; margin: 40px auto; padding: 20px; font: 16px/1.7 sans-serif; }
article { border-bottom: 1px solid #ddd; padding: 16px 0; }
h3 { font-size: 15px; }
</style>
</head>
<body>
<h1>${escapeHtml(room.room_name)}</h1>
${lines}
</body>
</html>`;

        const url = URL.createObjectURL(new Blob([html], {
            type: 'text/html;charset=utf-8'
        }));

        const link = document.createElement('a');
        link.href = url;
        link.download = `pbp-room-${room.room_id}.html`;
        link.click();

        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function onKeyDown(event) {
        if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;

        const shouldSend = sendShortcut === 'alt_enter'
            ? event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey
            : event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;

        if (!shouldSend) return;

        event.preventDefault();
        send();
    }

    async function selectCharacter(character) {
        setSelected(character.character_id);
        setShowCharacters(false);

        const { error } = await supabase.from('room_user')
            .update({ selected_character_id: character.character_id })
            .eq('room_id', room.room_id)
            .eq('user_id', userId);

        if (error) onError(error.message);
    }

    async function connectCharacter(character) {
        try {
            const { error } = await supabase.from('room_character').insert({
                room_id: room.room_id,
                character_id: character.character_id
            });

            if (error) throw error;

            setRoomCharacters(previous => [
                ...previous,
                {
                    room_id: room.room_id,
                    character_id: character.character_id
                }
            ]);

            await selectCharacter(character);
        } catch (err) {
            onError(err.message);
        }
    }

    function beginResize(event) {
        if (event.button !== 0) return;

        resizingRef.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
    }

    function resizeScene(event) {
        if (!resizingRef.current || !containerRef.current) return;

        const bounds = containerRef.current.getBoundingClientRect();
        const percent = ((event.clientX - bounds.left) / bounds.width) * 100;

        setSceneWidth(Math.max(20, Math.min(70, percent)));
    }

    function finishResize(event) {
        resizingRef.current = false;

        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    }

    function renderMessage(message, index) {
        const date = new Date(message.created_at).toDateString();
        const previousDate = index
            ? new Date(messages[index - 1].created_at).toDateString()
            : null;

        const isNarration = message.message_type === 'narration';
        const isOwnMessage = message.user_id === userId;
        const characterColor = getCharacterColor(message.character_color_snapshot);

        const isEdited = message.updated_at &&
            new Date(message.updated_at).getTime() >
            new Date(message.created_at).getTime() + 1000;

        const messageTime = new Date(message.created_at).toLocaleTimeString('ko-KR', {
            hour: 'numeric',
            minute: '2-digit'
        });

        const messageContent = (
            <div className="pbp-rp-message-content">
                {message.img && (
                    <button
                        className="pbp-rp-image-button"
                        type="button"
                        title="이미지 확대"
                        onClick={() => setViewImage(message.img)}
                    >
                        <img
                            className="pbp-rp-message-image"
                            src={message.img}
                            alt="첨부 이미지"
                        />
                    </button>
                )}

                {message.text && (
                    <div
                        className="message-body pbp-rp-message-body"
                        dangerouslySetInnerHTML={{
                            __html: DOMPurify.sanitize(marked.parse(message.text))
                        }}
                    />
                )}
            </div>
        );

        const messageActions = isOwnMessage && (
            <div className="pbp-rp-inline-actions">
                <button
                    type="button"
                    onClick={() => setEditing({
                        ...message,
                        text: message.text || '',
                        img: message.img || ''
                    })}
                >
                    <PenLine size={13} />
                    수정
                </button>

                <button
                    type="button"
                    className="danger"
                    onClick={() => removeMessage(message)}
                >
                    <Trash2 size={13} />
                    삭제
                </button>
            </div>
        );

        return (
            <React.Fragment key={message.message_id}>
                {date !== previousDate && (
                    <div className="date-divider pbp-rp-date">
                        {new Date(message.created_at).toLocaleDateString('ko-KR', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                        })}
                    </div>
                )}

                <article
                    className={`pbp-rp-message${isNarration ? ' pbp-rp-narration' : ''}`}
                    style={isNarration ? undefined : {
                        '--pbp-character-color': characterColor
                    }}
                >
                    {isNarration ? (
                        <div className="pbp-rp-narration-content">
                            {messageContent}

                            <time className="pbp-rp-narration-time">
                                {isEdited ? '수정됨 · ' : ''}
                                {messageTime}
                            </time>
                        </div>
                    ) : (
                        <div className="pbp-rp-character-row">
                            <button
                                className="pbp-rp-portrait-button"
                                type="button"
                                title="캐릭터 인장 보기"
                                onClick={() => {
                                    if (message.character_portrait_snapshot) {
                                        setViewImage(message.character_portrait_snapshot);
                                    }
                                }}
                            >
                                <Avatar
                                    src={message.character_portrait_snapshot}
                                    name={message.character_name_snapshot}
                                    size={40}
                                />
                            </button>

                            <div className="pbp-rp-character-column">
                                <div className="pbp-rp-message-header">
                                    <strong className="pbp-rp-message-name">
                                        {message.character_name_snapshot || '캐릭터'}
                                    </strong>

                                    {isEdited && (
                                        <span className="pbp-rp-edited">
                                            수정됨
                                        </span>
                                    )}

                                    <time className="pbp-rp-message-time">
                                        {messageTime}
                                    </time>
                                </div>

                                <div className="pbp-rp-message-bubble">
                                    {messageContent}
                                </div>
                            </div>
                        </div>
                    )}

                    {messageActions}
                </article>
            </React.Fragment>
        );
    }

    return (
        <div
            ref={containerRef}
            className={`room-view pbp-room-view${sceneCollapsed ? ' pbp-scene-collapsed' : ''}`}
            style={{ '--pbp-scene-width': `${sceneWidth}%` }}
        >
            <aside className="pbp-scene-stage" aria-label="RP방 장면 이미지">
                {sceneImage ? (
                    <>
                        <img
                            className="pbp-scene-blur"
                            src={sceneImage}
                            alt=""
                        />

                        <img
                            className="pbp-scene-image"
                            src={sceneImage}
                            alt="현재 방의 장면"
                        />
                    </>
                ) : (
                    <div className="pbp-scene-placeholder">
                        <ImageIcon size={32} />
                        <span>배경 이미지가 등록되지 않았습니다.</span>
                    </div>
                )}

                <button
                    className="pbp-scene-back"
                    type="button"
                    onClick={onBack}
                    title="방 목록"
                >
                    <ArrowLeft size={21} />
                </button>

                <div className="pbp-scene-actions">
                    <button type="button" onClick={onEdit}>
                        <Settings size={15} />
                        방 설정
                    </button>

                    <button
                        type="button"
                        title="배경 영역 접기"
                        aria-label="배경 영역 접기"
                        onClick={() => setSceneCollapsed(true)}
                    >
                        <PanelLeftClose size={17} />
                    </button>
                </div>
            </aside>

            {!sceneCollapsed && (
                <div
                    className="pbp-scene-resizer"
                    role="separator"
                    aria-label="배경 이미지와 RP 로그 영역 너비 조절"
                    aria-orientation="vertical"
                    tabIndex={0}
                    onPointerDown={beginResize}
                    onPointerMove={resizeScene}
                    onPointerUp={finishResize}
                    onPointerCancel={finishResize}
                    onKeyDown={event => {
                        if (event.key === 'ArrowLeft') {
                            setSceneWidth(value => Math.max(20, value - 3));
                        }

                        if (event.key === 'ArrowRight') {
                            setSceneWidth(value => Math.min(70, value + 3));
                        }
                    }}
                />
            )}

            <section className="pbp-rp-panel">
                <header className="room-header pbp-rp-header">
                    <button
                        className="icon-button pbp-rp-mobile-back"
                        type="button"
                        onClick={onBack}
                        title="방 목록"
                        aria-label="방 목록"
                    >
                        <ArrowLeft size={21} />
                    </button>

                    {sceneCollapsed && (
                        <button
                            className="icon-button pbp-rp-restore-scene"
                            type="button"
                            title="배경 영역 펼치기"
                            onClick={() => setSceneCollapsed(false)}
                        >
                            <PanelLeftOpen size={20} />
                        </button>
                    )}

                    <div className="room-title pbp-rp-title">
                        <h1>{room.room_name}</h1>
                    </div>

                    <div className="pbp-rp-header-actions">
                        <button
                            className="icon-button"
                            type="button"
                            title="HTML 로그 백업"
                            onClick={exportHtml}
                        >
                            <Download size={19} />
                        </button>

                        <button
                            className="icon-button"
                            type="button"
                            title="방 설정"
                            onClick={onEdit}
                        >
                            <Settings size={19} />
                        </button>
                    </div>
                </header>

                <div className={`pbp-mobile-scene${mobileSceneOpen ? ' is-open' : ''}`}>
                    <button
                        className="pbp-mobile-scene-toggle"
                        type="button"
                        onClick={() => setMobileSceneOpen(previous => !previous)}
                        aria-expanded={mobileSceneOpen}
                    >
                        배경
                        {mobileSceneOpen
                            ? <ChevronUp size={17} />
                            : <ChevronDown size={17} />}
                    </button>

                    {mobileSceneOpen && (
                        <div className="pbp-mobile-scene-image">
                            {sceneImage
                                ? <img src={sceneImage} alt="현재 방의 장면" />
                                : <span>등록된 배경 이미지가 없습니다.</span>}
                        </div>
                    )}
                </div>

                <div className="message-list pbp-rp-log">
                    <div className="pbp-rp-reading">
                        <div className="pbp-rp-reading-title">
                            <h2>{room.room_name}</h2>
                        </div>

                        {messages.map(renderMessage)}

                        {!messages.length && (
                            <div className="empty">
                                아직 기록된 이야기가 없어요.
                            </div>
                        )}

                        <div ref={bottomRef} />
                    </div>
                </div>

                <div className={`pbp-composer-wrap${twitterMode ? ' pbp-composer-twitter' : ''}`}>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        onChange={handleImageChange}
                        hidden
                    />

                    {!composerExpanded && twitterMode && (
                        <div className="pbp-composer-floating">
                            {text.trim() && (
                                <button
                                    className="pbp-composer-draft"
                                    type="button"
                                    onClick={() => setComposerExpanded(true)}
                                >
                                    {text.trim().replace(/\s+/g, ' ').slice(0, 55)}
                                </button>
                            )}

                            <button
                                className="pbp-composer-fab"
                                type="button"
                                title="RP 작성"
                                onClick={() => setComposerExpanded(true)}
                            >
                                <Plus size={25} />
                            </button>
                        </div>
                    )}

                    {showComposer && (
                        <section className={`composer pbp-composer-expanded${narration ? ' is-narration' : ''}`}>
                            <div className="pbp-composer-heading">
                                {narration ? (
                                    <div className="pbp-composer-identity">
                                        <span className="pbp-narration-icon">N</span>
                                        <strong>나레이션</strong>
                                    </div>
                                ) : (
                                    <button
                                        className="pbp-composer-character"
                                        type="button"
                                        onClick={() => setShowCharacters(true)}
                                    >
                                        <Avatar
                                            src={currentCharacter?.character_portrait}
                                            name={currentCharacter?.character_name}
                                            size={49}
                                        />

                                        <strong>
                                            {currentCharacter?.character_name || '캐릭터 선택'}
                                        </strong>

                                        <ChevronDown size={17} />
                                    </button>
                                )}

                                <button
                                    className={`pbp-narration-toggle${narration ? ' active' : ''}`}
                                    type="button"
                                    aria-pressed={narration}
                                    onClick={() => setNarration(value => !value)}
                                >
                                    나레이션
                                </button>

                                {twitterMode && (
                                    <button
                                        className="pbp-composer-icon"
                                        type="button"
                                        title="작성창 접기"
                                        onClick={() => setComposerExpanded(false)}
                                    >
                                        <X size={18} />
                                    </button>
                                )}
                            </div>

                            <div className="pbp-composer-input-box">
                                {imagePreview && (
                                    <div className="pbp-composer-attachment">
                                        <img
                                            src={imagePreview}
                                            alt="첨부 이미지 미리보기"
                                        />

                                        <button
                                            type="button"
                                            onClick={removeAttachedImage}
                                            title="첨부 제거"
                                        >
                                            <X size={14} />
                                        </button>
                                    </div>
                                )}

                                <textarea
                                    ref={textareaRef}
                                    value={text}
                                    onChange={event => setText(event.target.value)}
                                    onKeyDown={onKeyDown}
                                    placeholder={narration ? '나레이션을 입력하세요...' : '글을 입력하세요...'}
                                    rows={2}
                                />

                                <div className="pbp-composer-footer">
                                    <button
                                        className="pbp-composer-icon"
                                        type="button"
                                        title="이미지 첨부"
                                        onClick={() => fileInputRef.current?.click()}
                                    >
                                        <ImageIcon size={19} />
                                    </button>

                                    <span className="pbp-composer-shortcut">
                                        {sendShortcut === 'alt_enter' ? 'Alt' : 'Shift'} + Enter 전송 · Enter 줄바꿈
                                    </span>

                                    <button
                                        className="pbp-composer-send"
                                        type="button"
                                        disabled={sending || (!text.trim() && !imageFile)}
                                        onClick={send}
                                        title="전송"
                                    >
                                        <Send size={19} />
                                    </button>
                                </div>
                            </div>
                        </section>
                    )}
                </div>
            </section>

            {showCharacters && (
                <Modal title="이 방에서 사용할 캐릭터" onClose={() => setShowCharacters(false)}>
                    <div className="form-body">
                        <div className="character-picker">
                            {characters.map(character => {
                                const connected = roomCharacters.some(
                                    link => link.character_id === character.character_id
                                );

                                return (
                                    <button
                                        key={character.character_id}
                                        className={selected === character.character_id ? 'picker-item active' : 'picker-item'}
                                        onClick={() => connected
                                            ? selectCharacter(character)
                                            : connectCharacter(character)}
                                    >
                                        <Avatar
                                            src={character.character_portrait}
                                            name={character.character_name}
                                            size={40}
                                        />

                                        <span>{character.character_name}</span>
                                        <small>{connected ? '선택' : '방에 연결'}</small>
                                    </button>
                                );
                            })}
                        </div>

                        {!characters.length && (
                            <p className="notice">
                                등록된 캐릭터가 없습니다. 캐릭터 메뉴에서 먼저 추가해 주세요.
                            </p>
                        )}
                    </div>
                </Modal>
            )}

            {editing && (
                <Modal title="메시지 수정" onClose={() => setEditing(null)}>
                    <div className="form-body">
                        <label>본문</label>

                        <textarea
                            rows={6}
                            value={editing.text}
                            onChange={event => setEditing({
                                ...editing,
                                text: event.target.value
                            })}
                        />

                        <label>이미지 URL</label>

                        <input value={editing.img} onChange={event => setEditing({
                                ...editing, img: event.target.value
                            })}
                        />

                        <button className="primary full" disabled={!editing.text.trim() && !editing.img.trim()} onClick={saveEdit} >
                            수정 저장
                        </button>
                    </div>
                </Modal>
            )}

            {viewImage && (
                <Modal title="이미지 확대" onClose={() => setViewImage(null)}>
                    <div className="pbp-rp-image-viewer">
                        <img src={viewImage} alt="확대 이미지" />
                    </div>
                </Modal>
            )}
        </div>
    );
}