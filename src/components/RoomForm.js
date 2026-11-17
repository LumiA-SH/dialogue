import React, { useEffect, useState } from 'react';
import { ImagePlus, Trash2, Download, Save } from 'lucide-react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { supabase } from '../lib/supabase';
import { adminRoomAction, getRows } from '../lib/api';
import Modal from './Modal';
import formatDate from '../utils/formatDate';
import escapeHtml from '../utils/escapeHtml';

const BUCKET = 'pbp-room-images';
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export default function RoomForm({ room = null, onClose, onSaved, onDeleted, canManage = true }) {
    const [roomName, setRoomName] = useState(room?.room_name || '');
    const [roomImg, setRoomImg] = useState(room?.room_img || '');
    const [sceneImg, setSceneImg] = useState(room?.scene_img || '');
    const [isPublic, setIsPublic] = useState(room?.is_public !== false);
    const [imageFile, setImageFile] = useState(null);
    const [sceneFile, setSceneFile] = useState(null);
    const [imagePreview, setImagePreview] = useState(room?.room_img || '');
    const [scenePreview, setScenePreview] = useState(room?.scene_img || '');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const isEdit = Boolean(room?.room_id);

    useEffect(() => {
        if (!imageFile) {
            setImagePreview(roomImg);
            return;
        }

        const url = URL.createObjectURL(imageFile);
        setImagePreview(url);
        return () => URL.revokeObjectURL(url);
    }, [imageFile, roomImg]);

    useEffect(() => {
        if (!sceneFile) {
            setScenePreview(sceneImg);
            return;
        }

        const url = URL.createObjectURL(sceneFile);
        setScenePreview(url);
        return () => URL.revokeObjectURL(url);
    }, [sceneFile, sceneImg]);

    function selectFile(event, setter) {
        const file = event.target.files?.[0];
        if (!file) return;

        if (!ALLOWED_TYPES.includes(file.type)) {
            setError('JPG, PNG, WebP, GIF 이미지만 등록할 수 있습니다.');
            event.target.value = '';
            return;
        }

        if (file.size > MAX_FILE_SIZE) {
            setError('이미지는 최대 5MB까지 등록할 수 있습니다.');
            event.target.value = '';
            return;
        }

        setter(file);
        setError('');
        event.target.value = '';
    }

    async function uploadImage(file, folder) {
        const extension = {
            'image/jpeg': 'jpg',
            'image/png': 'png',
            'image/webp': 'webp',
            'image/gif': 'gif'
        }[file.type];

        const path = `${folder}/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
            contentType: file.type,
            upsert: false
        });

        if (uploadError) throw uploadError;

        const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
        return { path, url: data.publicUrl };
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (saving || !canManage) return;

        const name = roomName.trim();

        if (!name) {
            setError('방 이름을 입력해 주세요.');
            return;
        }

        setSaving(true);
        setError('');

        const uploadedPaths = [];
        let completed = false;

        try {
            let nextRoomImg = roomImg || null;
            let nextSceneImg = sceneImg || null;

            if (imageFile) {
                const uploaded = await uploadImage(imageFile, 'rooms');
                nextRoomImg = uploaded.url;
                uploadedPaths.push(uploaded.path);
            }

            if (sceneFile) {
                const uploaded = await uploadImage(sceneFile, 'scenes');
                nextSceneImg = uploaded.url;
                uploadedPaths.push(uploaded.path);
            }

            const result = await adminRoomAction(isEdit ? 'update' : 'create', {
                ...(isEdit ? { room_id: room.room_id } : {}),
                room_name: name,
                room_img: nextRoomImg,
                scene_img: nextSceneImg,
                is_public: isPublic
            });

            completed = true;
            if (onSaved) await onSaved(result.room);
            onClose();
        } catch (err) {
            if (!completed && uploadedPaths.length) {
                try {
                    await supabase.storage.from(BUCKET).remove(uploadedPaths);
                } catch (_) {
                    // 원래 저장 오류를 우선 표시합니다.
                }
            }
            setError(err.message || '방 저장에 실패했습니다.');
        } finally {
            setSaving(false);
        }
    }

    async function handleDelete() {
        if (!isEdit || !canManage || saving) return;
        if (!window.confirm(`'${room.room_name}' RP방을 삭제할까요?\n이 방의 메시지와 참여 정보도 삭제됩니다.`)) return;

        setSaving(true);
        setError('');

        try {
            await adminRoomAction('delete', { room_id: room.room_id });
            if (onDeleted) await onDeleted();
            onClose();
        } catch (err) {
            setError(err.message || '방 삭제에 실패했습니다.');
        } finally {
            setSaving(false);
        }
    }

    async function exportHtml() {
        if (!isEdit || saving) return;

        setSaving(true);
        setError('');

        try {
            const messages = await getRows('messages', query => query.eq('room_id', room.room_id).order('created_at', { ascending: true }));
            const content = messages.map(message => {
                const name = message.message_type === 'narration' ? '나레이션' : message.character_name_snapshot || '캐릭터';
                const body = DOMPurify.sanitize(marked.parse(message.text || ''));
                const image = message.img ? `<p><a href="${escapeHtml(message.img)}">첨부 이미지</a></p>` : '';
                return `<article><h3>${escapeHtml(name)} · ${escapeHtml(formatDate(message.created_at))}</h3><div>${body}</div>${image}</article>`;
            }).join('\n');

            const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>${escapeHtml(room.room_name)}</title>
<style>
body { max-width: 760px; margin: 40px auto; padding: 20px; font: 16px/1.7 sans-serif; }
article { padding: 16px 0; border-bottom: 1px solid #ddd; }
h3 { font-size: 15px; }
</style>
</head>
<body>
<h1>${escapeHtml(room.room_name)}</h1>
${content}
</body>
</html>`;

            const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = `pbp-room-${room.room_id}.html`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (err) {
            setError(err.message || '로그 백업에 실패했습니다.');
        } finally {
            setSaving(false);
        }
    }

    return (
        <Modal title={isEdit ? 'RP방 설정' : '새 RP방 생성'} onClose={onClose}>
            <form className="room-form" onSubmit={handleSubmit}>
                <label htmlFor="room-name">방 이름</label>
                <input id="room-name" type="text" maxLength={60} value={roomName} onChange={event => setRoomName(event.target.value)} placeholder="RP방 이름을 입력해 주세요." disabled={saving || !canManage} required />

                {isEdit && (
                    <div className="room-form-created">
                        <strong>생성일</strong>
                        <span>{formatDate(room.created_at)}</span>
                    </div>
                )}

                <label>방 대표 이미지</label>
                <div className="room-form-image-field">
                    {imagePreview && <img className="room-form-preview" src={imagePreview} alt="방 대표 이미지 미리보기" />}
                    <div className="room-form-image-actions">
                        {canManage && (
                            <>
                                <label className="secondary" htmlFor="room-image"><ImagePlus size={16} /> 이미지 선택</label>
                                <input id="room-image" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={event => selectFile(event, setImageFile)} disabled={saving} hidden />
                                {imagePreview && (
                                    <button className="secondary" type="button" onClick={() => { setImageFile(null); setRoomImg(''); }} disabled={saving}>
                                        <Trash2 size={15} /> 제거
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                </div>

                <label>RP 장면 배경 이미지</label>
                <div className="room-form-image-field">
                    {scenePreview && <img className="room-form-preview" src={scenePreview} alt="장면 배경 이미지 미리보기" />}
                    <div className="room-form-image-actions">
                        {canManage && (
                            <>
                                <label className="secondary" htmlFor="room-scene-image"><ImagePlus size={16} /> 배경 선택</label>
                                <input id="room-scene-image" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={event => selectFile(event, setSceneFile)} disabled={saving} hidden />
                                {scenePreview && (
                                    <button className="secondary" type="button" onClick={() => { setSceneFile(null); setSceneImg(''); }} disabled={saving}>
                                        <Trash2 size={15} /> 제거
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                    {!scenePreview && <small>배경 미등록 시 방 대표 이미지를 대신 표시합니다.</small>}
                </div>

                <label className="checkbox-label" htmlFor="room-public">
                    <input id="room-public" type="checkbox" checked={isPublic} onChange={event => setIsPublic(event.target.checked)} disabled={saving || !canManage} />
                    공개방 (다른 사용자가 검색하고 즉시 참여할 수 있음)
                </label>

                {!isPublic && <p className="muted">비공개방은 초대받은 사용자만 참여할 수 있습니다.</p>}
                {error && <p className="form-error" role="alert">{error}</p>}

                <div className="room-form-footer">
                    <div className="room-form-management">
                        {isEdit && (
                            <button className="secondary" type="button" onClick={exportHtml} disabled={saving}>
                                <Download size={16} /> 로그 백업
                            </button>
                        )}
                        {isEdit && canManage && (
                            <button className="danger" type="button" onClick={handleDelete} disabled={saving}>
                                <Trash2 size={16} /> 방 삭제
                            </button>
                        )}
                    </div>

                    <div className="room-form-submit">
                        <button className="secondary" type="button" onClick={onClose} disabled={saving}>취소</button>
                        {canManage && (
                            <button className="primary" type="submit" disabled={saving || !roomName.trim()}>
                                <Save size={16} /> {saving ? '저장 중...' : isEdit ? '수정 저장' : '방 생성'}
                            </button>
                        )}
                    </div>
                </div>
            </form>
        </Modal>
    );
}