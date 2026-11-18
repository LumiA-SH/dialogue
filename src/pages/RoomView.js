import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, Send, Image as ImageIcon, BookOpen, PenLine, Trash2, Download, Settings, Plus, ChevronDown, ChevronUp, X, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import { supabase } from '../lib/supabase';
import { getRows, saveRow } from '../lib/api';
import Modal from '../components/Modal';
import Avatar from '../components/Avatar';
import RoomCharacterManager from '../components/RoomCharacterManager';
import RoomPresence from '../components/RoomPresence';
import ImageViewer from '../components/ImageViewer';
import formatDate from '../utils/formatDate';
import escapeHtml from '../utils/escapeHtml';
import '../styles/pbp-room-view.css';

const IMAGE_BUCKET = 'pbp-message-images';
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const DEFAULT_CHARACTER_COLOR = '#527EC2';
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const BOTTOM_THRESHOLD = 64;

// Keep all other Markdown syntax literal; use the same renderer for screen and backup.
const rpMarkdown = new Marked({
    gfm: true,
    breaks: true,
    tokenizer: {
        code() {}, fences() {}, heading() {}, hr() {}, blockquote() {}, list() {}, html() {}, def() {}, table() {}, lheading() {},
        codespan() {}, link() {}, reflink() {}, autolink() {}, url() {}, del() {},
        emStrong(src) { if (src.startsWith('*')) return false; },
        paragraph(src) {
            const match = /^([^\n]+(?:\n(?![ \t]*\n)[^\n]+)*)/.exec(src);
            if (match) return { type: 'paragraph', raw: match[0], text: match[0], tokens: this.lexer.inline(match[0]) };
        }
    }
});

export function renderRpMarkdown(text, inline = false) {
    const escaped = escapeHtml(String(text || '').replace(/\r\n?/g, '\n'));
    const content = rpMarkdown.parseInline(escaped);
    const html = inline || !escaped ? content : `<p>${content}</p>`;
    return DOMPurify.sanitize(html, { ALLOWED_TAGS: inline ? ['em', 'strong'] : ['p', 'br', 'em', 'strong'], ALLOWED_ATTR: [] });
}

function isMessageAfter(message, previous) {
    if (!previous) return true;

    const messageTime = new Date(message.created_at).getTime();
    const previousTime = new Date(previous.created_at).getTime();

    if (messageTime !== previousTime) return messageTime > previousTime;
    return String(message.message_id) > String(previous.message_id);
}

function isNearBottom(element) {
    if (!element) return false;
    return element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_THRESHOLD;
}

export default function RoomView({ room, userId, characters, preferences, onCharacterSaved, onBack, onEdit, onError, presence, onTypingChange, beforeLeaveRef }) {
    const [messages, setMessages] = useState([]);
    const [roomCharacters, setRoomCharacters] = useState([]);
    const [membership, setMembership] = useState(null);
    const [selected, setSelected] = useState('');
    const [narration, setNarration] = useState(false);
    const [text, setText] = useState('');
    const [imageFile, setImageFile] = useState(null);
    const [imagePreview, setImagePreview] = useState('');
    const [editing, setEditing] = useState(null);
    const [touchMessageId, setTouchMessageId] = useState(null);

    useEffect(() => {
        function selectTouchMessage(event) {
            if (event.pointerType === 'mouse') return;
            const message = event.target.closest?.('[data-touch-message-id]');
            setTouchMessageId(message?.dataset.touchMessageId || null);
        }
        document.addEventListener('pointerdown', selectTouchMessage, true);
        return () => document.removeEventListener('pointerdown', selectTouchMessage, true);
    }, []);
    const [showCharacters, setShowCharacters] = useState(false);
    const [sending, setSending] = useState(false);

    useEffect(() => {
        if (!text.trim() || sending) onTypingChange?.(room.room_id, false);
    }, [text, sending, room.room_id, onTypingChange]);

    useEffect(() => () => onTypingChange?.(room.room_id, false), [room.room_id, onTypingChange]);

    const [composerExpanded, setComposerExpanded] = useState(false);
    const [mobileSceneOpen, setMobileSceneOpen] = useState(false);
    const [sceneCollapsed, setSceneCollapsed] = useState(false);
    const [sceneWidth, setSceneWidth] = useState(62);
    const [viewImage, setViewImage] = useState(null);

    const [initialReady, setInitialReady] = useState(false);
    const [unreadStartId, setUnreadStartId] = useState(null);

    const containerRef = useRef(null);
    const logRef = useRef(null);
    const unreadDividerRef = useRef(null);
    const fileInputRef = useRef(null);
    const textareaRef = useRef(null);
    const resizingRef = useRef(false);

    const initialComputedRef = useRef(false);
    const initialScrollDoneRef = useRef(false);
    const atBottomRef = useRef(false);
    const previousLastIdRef = useRef(null);
    const readCursorRef = useRef(null);
    const readWriteRef = useRef(Promise.resolve());
    const leavingRef = useRef(false);

    const [liveScene, setLiveScene] = useState(null);
    const sceneImage = liveScene?.roomId === room.room_id ? liveScene.image : room.scene_img || room.room_bg_img || room.room_background_image || room.room_img || '';

    useEffect(() => { setLiveScene(null); }, [room.room_id, room.scene_img, room.room_img]);

    useEffect(() => {
        let active = true;
        let latestRequest = 0;
        async function refreshScene() {
            const request = ++latestRequest;
            const { data, error } = await supabase.from('rooms').select('room_id,scene_img,room_img').eq('room_id', room.room_id).maybeSingle();
            if (!active || request !== latestRequest) return;
            if (error) { onError(error.message); return; }
            if (data) setLiveScene({ roomId: data.room_id, image: data.scene_img || data.room_img || '' });
        }
        const channel = supabase.channel(`pbp-scene-${room.room_id}`)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `room_id=eq.${room.room_id}` }, refreshScene)
            .subscribe((status, error) => {
                if (process.env.NODE_ENV === 'development') console.debug('[PBP scene]', { roomId: room.room_id, status, message: error?.message });
                if (status === 'SUBSCRIBED') refreshScene();
            });
        const visible = () => { if (document.visibilityState === 'visible') refreshScene(); };
        document.addEventListener('visibilitychange', visible);
        window.addEventListener('pageshow', visible);
        window.addEventListener('online', visible);
        return () => {
            active = false;
            document.removeEventListener('visibilitychange', visible);
            window.removeEventListener('pageshow', visible);
            window.removeEventListener('online', visible);
            supabase.removeChannel(channel);
        };
    }, [room.room_id, onError]);
    const twitterMode = preferences?.input_style === 'twitter';
    const showComposer = !twitterMode || composerExpanded;
    const sendShortcut = ['ctrl_enter', 'alt_enter'].includes(preferences?.send_shortcut) ? 'ctrl_enter' : 'shift_enter';

    const load = useCallback(async () => {
        try {
            const [messageRows, roomCharacterRows, members] = await Promise.all([
                getRows('messages', query => query.eq('room_id', room.room_id).order('created_at', { ascending: false }).order('message_id', { ascending: false }).limit(500)),
                getRows('room_character', query => query.eq('room_id', room.room_id)),
                getRows('room_user', query => query.eq('room_id', room.room_id).eq('user_id', userId))
            ]);

            const orderedMessages = [...messageRows].reverse();
            const member = members[0] || null;

            if (!initialComputedRef.current) {
                const lastReadId = member?.last_read_message_id;
                let lastReadMessage = null;
                let firstUnreadMessage = null;

                if (lastReadId) {
                    lastReadMessage = orderedMessages.find(message => message.message_id === lastReadId);

                    if (!lastReadMessage) {
                        const rows = await getRows('messages', query => query.eq('room_id', room.room_id).eq('message_id', lastReadId).limit(1));
                        lastReadMessage = rows[0] || null;
                    }
                }

                if (lastReadMessage) {
                    readCursorRef.current = lastReadMessage;
                    firstUnreadMessage = orderedMessages.find(message => message.user_id !== userId && isMessageAfter(message, lastReadMessage));
                }

                // 과거 읽음 위치가 없으면 기존 로그를 전부 미확인으로 처리하지 않습니다.
                // 최초 진입 시 최신 메시지부터 보여주고 하단 위치를 읽음 기준으로 저장합니다.
                setUnreadStartId(firstUnreadMessage?.message_id || null);
                initialComputedRef.current = true;
            }

            setMessages(orderedMessages);
            setRoomCharacters(roomCharacterRows);
            setMembership(member);

            if (member?.selected_character_id) {
                setSelected(value => {
                    const id = value || member.selected_character_id;
                    return roomCharacterRows.some(link => link.character_id === id && link.is_active !== false) ? id : '';
                });
            }

            setInitialReady(true);
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
        const refreshDeletedMessage = event => {
            if (event.detail?.roomId === room.room_id) load();
        };
        window.addEventListener('pbp-message-deleted', refreshDeletedMessage);
        return () => window.removeEventListener('pbp-message-deleted', refreshDeletedMessage);
    }, [room.room_id, load]);

    const persistRead = useCallback((message) => {
        if (document.visibilityState !== 'visible') return readWriteRef.current;
        if (!message || !isMessageAfter(message, readCursorRef.current)) {
            return readWriteRef.current;
        }

        readCursorRef.current = message;

        const task = readWriteRef.current.catch(() => {}).then(async () => {
            const { error } = await supabase.rpc('pbp_message_operation', { p_room_id: room.room_id, p_message_id: message.message_id, p_action: 'read' });
            if (error) throw error;
        });

        readWriteRef.current = task;

        task.catch(err => {
            if (readCursorRef.current?.message_id === message.message_id) {
                readCursorRef.current = null;
            }

            onError(`읽음 저장 실패: ${err.message}`);
        });

        return task;
    }, [room.room_id, onError]);

    // 첫 화면이 표시되기 전에 스크롤 위치를 설정합니다.
    useLayoutEffect(() => {
        if (!initialReady || initialScrollDoneRef.current || !logRef.current) return;

        const log = logRef.current;
        const lastMessage = messages[messages.length - 1];

        if (unreadStartId && unreadDividerRef.current) {
            const logTop = log.getBoundingClientRect().top;
            const dividerTop = unreadDividerRef.current.getBoundingClientRect().top;
            log.scrollTop += dividerTop - logTop - 18;
        } else {
            log.scrollTop = log.scrollHeight - log.clientHeight;
        }

        initialScrollDoneRef.current = true;
        atBottomRef.current = isNearBottom(log);
        previousLastIdRef.current = lastMessage?.message_id || null;

        if (atBottomRef.current && lastMessage) {
            persistRead(lastMessage);
        }
    }, [initialReady, messages, unreadStartId, persistRead]);

    // 이후 새 메시지가 도착했을 때는 현재 스크롤 위치를 고려합니다.
    useEffect(() => {
        if (!initialScrollDoneRef.current || !logRef.current) return;

        const log = logRef.current;
        const lastMessage = messages[messages.length - 1];
        const lastId = lastMessage?.message_id || null;

        if (lastId && lastId !== previousLastIdRef.current) {
            if (atBottomRef.current || lastMessage.user_id === userId) {
                log.scrollTop = log.scrollHeight - log.clientHeight;
                persistRead(lastMessage);
            } else if (!unreadStartId && previousLastIdRef.current) {
                const previousIndex = messages.findIndex(message => message.message_id === previousLastIdRef.current);
                const newMessages = messages.slice(previousIndex >= 0 ? previousIndex + 1 : 0);
                const firstNew = newMessages.find(message => message.user_id !== userId);

                if (firstNew) setUnreadStartId(firstNew.message_id);
            }
        }

        previousLastIdRef.current = lastId;
    }, [messages, unreadStartId, userId, persistRead]);

    useEffect(() => {
        const viewport = window.visualViewport;
        const resize = () => {
            if (atBottomRef.current && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
        };
        const visible = () => {
            if (document.visibilityState === 'visible') {
                load();
                if (isNearBottom(logRef.current)) persistRead(messages[messages.length - 1]);
            }
        };
        viewport?.addEventListener('resize', resize);
        document.addEventListener('visibilitychange', visible);
        return () => { viewport?.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', visible); };
    }, [load, messages, persistRead]);

    function handleLogScroll() {
        const nearBottom = isNearBottom(logRef.current);
        atBottomRef.current = nearBottom;

        if (nearBottom && messages.length) {
            persistRead(messages[messages.length - 1]);
        }
    }

    async function prepareLeave() {
        const lastMessage = messages[messages.length - 1];

        if (isNearBottom(logRef.current) && lastMessage) {
            await persistRead(lastMessage).catch(() => {});
        } else {
            await readWriteRef.current.catch(() => {});
        }
    }

    useLayoutEffect(() => {
        if (!beforeLeaveRef) return;
        beforeLeaveRef.current = prepareLeave;
        return () => { beforeLeaveRef.current = null; };
    });

    async function handleBack() {
        if (leavingRef.current) return;
        leavingRef.current = true;
        await prepareLeave();
        onBack();
    }

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
        if (composerExpanded) textareaRef.current?.focus();
    }, [composerExpanded]);

    const resizeMessengerInput = useCallback(() => {
        const input = textareaRef.current;
        if (twitterMode || !input) return;
        // Read the existing responsive CSS baseline before measuring wrapped content.
        input.style.removeProperty('height');
        const styles = window.getComputedStyle(input);
        const baseline = parseFloat(styles.height) || input.offsetHeight;
        const border = (parseFloat(styles.borderTopWidth) || 0) + (parseFloat(styles.borderBottomWidth) || 0);
        const cssMaximum = parseFloat(styles.maxHeight) || Infinity;
        const visibleHeight = window.visualViewport?.height || window.innerHeight;
        const maximum = Math.max(baseline, Math.min(cssMaximum, visibleHeight * 0.45));
        input.style.overflowY = 'hidden';
        input.style.height = '0px';
        const contentHeight = input.scrollHeight + border;
        input.style.height = `${Math.min(maximum, Math.max(baseline, contentHeight))}px`;
        input.style.overflowY = contentHeight > maximum ? 'auto' : 'hidden';
    }, [twitterMode]);

    useLayoutEffect(() => { resizeMessengerInput(); }, [text, resizeMessengerInput]);

    useLayoutEffect(() => {
        const input = textareaRef.current;
        if (twitterMode || !input) return;
        const originalResize = input.style.resize;
        input.style.resize = 'none';
        let width = input.getBoundingClientRect().width;
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
            const nextWidth = input.getBoundingClientRect().width;
            if (nextWidth !== width) { width = nextWidth; resizeMessengerInput(); }
        });
        observer?.observe(input);
        window.addEventListener('resize', resizeMessengerInput);
        const viewport = window.visualViewport;
        viewport?.addEventListener('resize', resizeMessengerInput);
        return () => {
            observer?.disconnect();
            window.removeEventListener('resize', resizeMessengerInput);
            viewport?.removeEventListener('resize', resizeMessengerInput);
            input.style.removeProperty('height');
            input.style.removeProperty('overflow-y');
            input.style.resize = originalResize;
        };
    }, [twitterMode, resizeMessengerInput]);

    const availableCharacters = characters.filter(character =>
        roomCharacters.some(link => link.character_id === character.character_id && link.is_active !== false)
    );

    const currentCharacter = availableCharacters.find(character => character.character_id === selected);

    function getCharacterColor(value) {
        return COLOR_PATTERN.test(value || '') ? value.toUpperCase() : DEFAULT_CHARACTER_COLOR;
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
        if (fileInputRef.current) fileInputRef.current.value = '';
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

        const character = availableCharacters.find(item => item.character_id === selected);

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
                character_color_snapshot: narration ? null : getCharacterColor(character.character_color)
            });

            setText('');
            removeAttachedImage();

            if (twitterMode) setComposerExpanded(false);
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
            const { data: deletedId, error: deleteError } = await supabase.rpc('pbp_message_operation', { p_room_id: room.room_id, p_message_id: message.message_id, p_action: 'delete' });
            if (deleteError) throw deleteError;
            if (deletedId !== message.message_id) throw new Error('메시지 삭제 결과를 확인하지 못했습니다.');
            await load();
        } catch (err) {
            onError(err.message);
        }
    }

    async function saveEdit() {
        const draft = editing;
        if (!draft || draft.editSaving) return;

        const hasImage = Boolean(draft.editImageFile || (!draft.editImageRemoved && draft.img));
        if (!draft.text.trim() && !hasImage) return;

        setEditing(current => current ? { ...current, editSaving: true } : current);

        try {
            let imageUrl = draft.editImageRemoved ? null : draft.img || null;

            if (draft.editImageFile) {
                imageUrl = await uploadImage(draft.editImageFile);
            }

            await saveRow('messages', {
                text: draft.text.trim() || null,
                img: imageUrl
            }, 'message_id', draft.message_id);

            if (draft.editPreviewUrl) URL.revokeObjectURL(draft.editPreviewUrl);

            setEditing(null);
            await load();
        } catch (err) {
            setEditing(current => current ? { ...current, editSaving: false } : current);
            onError(err.message);
        }
    }

    async function exportHtml() {
        try {
            const exported = [];
            const cutoff = new Date().toISOString();
            for (let offset = 0; ; offset += 1000) {
                const page = await getRows('messages', query => query.eq('room_id', room.room_id).lte('created_at', cutoff).order('created_at').order('message_id').range(offset, offset + 999));
                exported.push(...page);
                if (page.length < 1000) break;
            }
        const lines = exported.map(message => {
            const name = message.character_name_snapshot || (message.message_type === 'narration' ? '나레이션' : '캐릭터');
            const content = renderRpMarkdown(message.text);
            const image = message.img ? `<p><a href="${escapeHtml(message.img)}">첨부 이미지</a></p>` : '';

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

        const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `pbp-room-${room.room_id}.html`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (err) { onError(`로그 백업 실패: ${err.message}`); }
    }

    function onKeyDown(event) {
        if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;

        const shouldSend = sendShortcut === 'ctrl_enter'
            ? event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey
            : event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;

        if (!shouldSend) return;

        event.preventDefault();
        send();
    }

    async function selectCharacter(character, persist = true) {
        const id = character?.character_id || null;
        if (persist) {
            const { error } = await supabase.from('room_user').update({ selected_character_id: id })
                .eq('room_id', room.room_id).eq('user_id', userId).select().single();
            if (error) throw error;
        }
        setSelected(id || '');
        if (character) setShowCharacters(false);
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
        const previousDate = index ? new Date(messages[index - 1].created_at).toDateString() : null;
        const isNarration = message.message_type === 'narration';
        const isOwnMessage = message.user_id === userId;
        const characterColor = getCharacterColor(message.character_color_snapshot);

        const isEdited = message.updated_at &&
            new Date(message.updated_at).getTime() > new Date(message.created_at).getTime() + 1000;

        const messageTime = new Date(message.created_at).toLocaleTimeString('ko-KR', {
            hour: 'numeric',
            minute: '2-digit'
        });

        const messageContent = (
            <div className="pbp-rp-message-content">
                {message.img && (
                    <button className="pbp-rp-image-button" type="button" title="이미지 확대" onClick={() => setViewImage(message.img)}>
                        <img className="pbp-rp-message-image" src={message.img} alt="첨부 이미지" />
                    </button>
                )}

                {message.text && (
                    <div className="message-body pbp-rp-message-body" dangerouslySetInnerHTML={{
                        __html: renderRpMarkdown(message.text)
                    }} />
                )}
            </div>
        );

        const messageActions = isOwnMessage && (
            <div className="pbp-rp-inline-actions">
                <button type="button" onClick={() => setEditing({ ...message, text: message.text || '', img: message.img || '' })}>
                    <PenLine size={13} /> 수정
                </button>
                <button type="button" className="danger" onClick={() => removeMessage(message)}>
                    <Trash2 size={13} /> 삭제
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

                {message.message_id === unreadStartId && (
                    <div className="pbp-rp-unread-divider" ref={unreadDividerRef} role="separator" aria-label="읽지 않은 메시지">
                        <span>읽지 않은 메시지</span>
                    </div>
                )}

                <article data-touch-message-id={isOwnMessage ? message.message_id : undefined} className={`pbp-rp-message${isNarration ? ' pbp-rp-narration' : ''}${isOwnMessage && touchMessageId === String(message.message_id) ? ' is-touch-active' : ''}`}
                         style={isNarration ? undefined : { '--pbp-character-color': characterColor }}>
                    {isNarration ? (
                        <div className="pbp-rp-narration-content">
                            {messageContent}
                            <time className="pbp-rp-narration-time">{isEdited ? '수정됨 · ' : ''}{messageTime}</time>
                        </div>
                    ) : (
                        <div className="pbp-rp-character-row">
                            <button className="pbp-rp-portrait-button" type="button" title="캐릭터 인장 보기" onClick={() => {
                                if (message.character_portrait_snapshot) setViewImage(message.character_portrait_snapshot);
                            }}>
                                <Avatar src={message.character_portrait_snapshot} name={message.character_name_snapshot} size={40} />
                            </button>

                            <div className="pbp-rp-character-column">
                                <div className="pbp-rp-message-header">
                                    <strong className="pbp-rp-message-name">{message.character_name_snapshot || '캐릭터'}</strong>
                                    {isEdited && <span className="pbp-rp-edited">수정됨</span>}
                                    <time className="pbp-rp-message-time">{messageTime}</time>
                                </div>

                                <div className="pbp-rp-message-bubble">{messageContent}</div>
                            </div>
                        </div>
                    )}

                    {messageActions}
                </article>
            </React.Fragment>
        );
    }

    return (
        <div ref={containerRef} className={`room-view pbp-room-view${sceneCollapsed ? ' pbp-scene-collapsed' : ''}`}
             style={{ '--pbp-scene-width': `${sceneWidth}%` }}>
            <aside className="pbp-scene-stage" aria-label="RP방 장면 이미지">
                {sceneImage ? (
                    <>
                        <img className="pbp-scene-blur" src={sceneImage} alt="" />
                        <img className="pbp-scene-image" src={sceneImage} alt="현재 방의 장면" />
                    </>
                ) : (
                    <div className="pbp-scene-placeholder">
                        <BookOpen size={48} />
                    </div>
                )}

                <button className="pbp-scene-back" type="button" onClick={handleBack} title="뒤로가기">
                    <ArrowLeft size={21} />
                </button>

                <div className="pbp-scene-actions">
                    <button type="button" title="배경 영역 접기" aria-label="배경 영역 접기" onClick={() => setSceneCollapsed(true)}>
                        <PanelLeftClose size={17} />
                    </button>
                </div>
            </aside>

            {!sceneCollapsed && (
                <div className="pbp-scene-resizer" role="separator" aria-label="배경 이미지와 RP 로그 영역 너비 조절"
                     aria-orientation="vertical" tabIndex={0} onPointerDown={beginResize} onPointerMove={resizeScene}
                     onPointerUp={finishResize} onPointerCancel={finishResize} onKeyDown={event => {
                    if (event.key === 'ArrowLeft') setSceneWidth(value => Math.max(20, value - 3));
                    if (event.key === 'ArrowRight') setSceneWidth(value => Math.min(70, value + 3));
                }} />
            )}

            <section className="pbp-rp-panel">
                <header className="room-header pbp-rp-header">
                    <button className="icon-button pbp-rp-mobile-back" type="button" onClick={handleBack} title="뒤로가기" aria-label="뒤로가기">
                        <ArrowLeft size={21} />
                    </button>

                    {sceneCollapsed && (
                        <button className="icon-button pbp-rp-restore-scene" type="button" title="배경 영역 펼치기" onClick={() => setSceneCollapsed(false)}>
                            <PanelLeftOpen size={20} />
                        </button>
                    )}

                    <div className="room-title pbp-rp-title">
                        <h1><span className="pbp-rp-title-text">{room.room_name}</span><RoomPresence presence={presence} /></h1>
                    </div>

                    <div className="pbp-rp-header-actions">
                        <button className="icon-button" type="button" title="HTML 로그 백업" onClick={exportHtml}>
                            <Download size={19} />
                        </button>
                        <button className="icon-button" type="button" title="방 설정" onClick={onEdit}>
                            <Settings size={19} />
                        </button>
                    </div>
                </header>

                <div className={`pbp-mobile-scene${mobileSceneOpen ? ' is-open' : ''}`}>
                    <button className="pbp-mobile-scene-toggle" type="button" onClick={() => setMobileSceneOpen(value => !value)} aria-expanded={mobileSceneOpen}>
                        배경 {mobileSceneOpen ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
                    </button>

                    {mobileSceneOpen && (
                        <div className="pbp-mobile-scene-image">
                            {sceneImage ? (
                                <img src={sceneImage} alt="현재 방의 장면" />
                            ) : (
                                <div className="pbp-scene-placeholder">
                                    <BookOpen size={40} />
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="message-list pbp-rp-log" ref={logRef} onScroll={handleLogScroll}>
                    <div className="pbp-rp-reading">
                        <div className="pbp-rp-reading-title">
                            <h2>{room.room_name}</h2>
                        </div>

                        {messages.map(renderMessage)}
                        {!messages.length && <div className="empty">아직 기록된 이야기가 없어요.</div>}
                    </div>
                </div>


                <div className={`pbp-composer-wrap${twitterMode ? ' pbp-composer-twitter' : ''}`}>
                    <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={handleImageChange} hidden />

                    {showCharacters && (
                        <RoomCharacterManager roomId={room.room_id} userId={userId} characters={characters} links={roomCharacters} selected={selected} onLinksChange={setRoomCharacters} onSelect={selectCharacter} onCharacterSaved={onCharacterSaved} onClose={() => setShowCharacters(false)} />
                    )}

                    {!composerExpanded && twitterMode && (

                        <div className="pbp-composer-floating">
                            {(text.trim() || imagePreview) && (
                                <button className="pbp-composer-draft" type="button" onClick={() => setComposerExpanded(true)}>
                                    {imagePreview && <img src={imagePreview} alt="작성 중인 첨부 이미지" />}
                                    {text.trim().replace(/\s+/g, ' ').slice(0, 55) || '이미지 첨부 초안'}
                                </button>
                            )}
                            <button className="pbp-composer-fab" type="button" title="RP 작성" onClick={() => setComposerExpanded(true)}>
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
                                    <button className="pbp-composer-character" type="button" onClick={() => setShowCharacters(true)}>
                                        <Avatar src={currentCharacter?.character_portrait} name={currentCharacter?.character_name} size={49} />
                                        <strong>{currentCharacter?.character_name || '캐릭터 선택'}</strong>
                                        <ChevronDown size={17} />
                                    </button>
                                )}

                                <button className={`pbp-narration-toggle${narration ? ' active' : ''}`} type="button" aria-pressed={narration} onClick={() => setNarration(value => !value)}>
                                    나레이션
                                </button>

                                {twitterMode && (
                                    <button className="pbp-composer-icon" type="button" title="작성창 접기" onClick={() => setComposerExpanded(false)}>
                                        <X size={18} />
                                    </button>
                                )}
                            </div>

                            <div className="pbp-composer-input-box">
                                {imagePreview && (
                                    <div className="pbp-composer-attachment">
                                        <img src={imagePreview} alt="첨부 이미지 미리보기" />
                                        <button type="button" onClick={removeAttachedImage} title="첨부 제거"><X size={14} /></button>
                                    </div>
                                )}

                                <textarea ref={textareaRef} value={text} onChange={event => { setText(event.target.value); onTypingChange?.(room.room_id, Boolean(event.target.value.trim())); }} onKeyDown={onKeyDown}
                                          placeholder={narration ? '나레이션을 입력하세요...' : '글을 입력하세요...'} rows={2} />

                                <div className="pbp-composer-footer">
                                    <button className="pbp-composer-icon" type="button" title="이미지 첨부" onClick={() => fileInputRef.current?.click()}>
                                        <ImageIcon size={19} />
                                    </button>
                                    <span className="pbp-composer-shortcut">
                                        {sendShortcut === 'ctrl_enter' ? 'Ctrl' : 'Shift'} + Enter 전송 · Enter 줄바꿈
                                    </span>
                                    <button className="pbp-composer-send" type="button" disabled={sending || (!text.trim() && !imageFile)} onClick={send} title="전송">
                                        <Send size={19} />
                                    </button>
                                </div>
                            </div>
                        </section>
                    )}
                </div>
            </section>

            {editing && (
                <Modal title="메시지 수정" onClose={() => {
                    if (editing.editSaving) return;
                    if (editing.editPreviewUrl) URL.revokeObjectURL(editing.editPreviewUrl);
                    setEditing(null);
                }}>
                    <div className="form-body">
                        <label>본문</label>
                        <textarea rows={6} value={editing.text} disabled={editing.editSaving}
                                  onChange={event => setEditing({ ...editing, text: event.target.value })} />

                        <label>첨부 이미지</label>

                        {(editing.editPreviewUrl || (!editing.editImageRemoved && editing.img)) && (
                            <button className="pbp-rp-image-button" type="button" title="이미지 확대"
                                    onClick={() => setViewImage(editing.editPreviewUrl || editing.img)}>
                                <img className="pbp-rp-message-image" style={{ maxHeight: 180 }}
                                     src={editing.editPreviewUrl || editing.img} alt="첨부 이미지 미리보기" />
                            </button>
                        )}

                        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                            <label className="secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, margin: 0, cursor: 'pointer' }}>
                                <ImageIcon size={16} />
                                {editing.editPreviewUrl || (!editing.editImageRemoved && editing.img) ? '이미지 변경' : '이미지 첨부'}
                                <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden disabled={editing.editSaving}
                                       onChange={event => {
                                           const file = event.target.files?.[0];
                                           event.target.value = '';
                                           if (!file) return;

                                           if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
                                               onError('JPG, PNG, WebP, GIF 이미지만 등록할 수 있습니다.');
                                               return;
                                           }

                                           if (file.size > MAX_IMAGE_SIZE) {
                                               onError('이미지는 최대 5MB까지 등록할 수 있습니다.');
                                               return;
                                           }

                                           const previewUrl = URL.createObjectURL(file);
                                           if (editing.editPreviewUrl) URL.revokeObjectURL(editing.editPreviewUrl);

                                           setEditing({
                                               ...editing,
                                               editImageFile: file,
                                               editImageRemoved: false,
                                               editPreviewUrl: previewUrl
                                           });
                                       }} />
                            </label>

                            {(editing.editImageFile || (!editing.editImageRemoved && editing.img)) && (
                                <button className="danger-outline" type="button" disabled={editing.editSaving}
                                        onClick={() => {
                                            if (editing.editPreviewUrl) URL.revokeObjectURL(editing.editPreviewUrl);
                                            setEditing({
                                                ...editing,
                                                editImageFile: null,
                                                editImageRemoved: true,
                                                editPreviewUrl: ''
                                            });
                                        }}>
                                    <Trash2 size={16} /> 이미지 제거
                                </button>
                            )}

                            {editing.editImageRemoved && editing.img && (
                                <button className="secondary" type="button" disabled={editing.editSaving}
                                        onClick={() => setEditing({ ...editing, editImageRemoved: false })}>
                                    기존 이미지 복구
                                </button>
                            )}
                        </div>

                        <button className="primary full" type="button"
                                disabled={editing.editSaving || (!editing.text.trim() && !editing.editImageFile && (editing.editImageRemoved || !editing.img))}
                                onClick={saveEdit}>
                            {editing.editSaving ? '저장 중...' : '수정 저장'}
                        </button>
                    </div>
                </Modal>
            )}

            {viewImage && (
                <ImageViewer src={viewImage} onClose={() => setViewImage(null)} />
            )}
        </div>
    );
}