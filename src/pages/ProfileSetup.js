import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import Avatar from '../components/Avatar';

export default function ProfileSetup({ userId, onSaved, onLogout }) {
    const [name, setName] = useState('User');
    const [file, setFile] = useState(null);
    const [preview, setPreview] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => {
        if (!file) { setPreview(''); return; }
        const url = URL.createObjectURL(file);
        setPreview(url);
        return () => URL.revokeObjectURL(url);
    }, [file]);
    async function save(event) {
        event.preventDefault();
        if (busy || !name.trim()) return;
        setBusy(true);
        setError('');
        let uploadedPath;
        let saved = false;
        try {
            let portrait = null;
            if (file) {
                const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[file.type];
                const path = `${userId}/${crypto.randomUUID()}.${extension}`;
                const { error: uploadError } = await supabase.storage.from('pbp-profile-images').upload(path, file, { contentType: file.type });
                if (uploadError) throw uploadError;
                uploadedPath = path;
                portrait = supabase.storage.from('pbp-profile-images').getPublicUrl(path).data.publicUrl;
            }
            const { data, error: saveError } = await supabase.from('user').update({ user_name: name.trim(), user_portrait: portrait, profile_completed: true })
                .eq('user_id', userId).select().single();
            if (saveError) throw saveError;
            saved = true;
            onSaved(data);
        } catch (err) {
            if (uploadedPath && !saved) await supabase.storage.from('pbp-profile-images').remove([uploadedPath]);
            setError(err.message || '프로필 저장에 실패했습니다.');
        } finally { setBusy(false); }
    }
    return (
        <div className="center-screen">
            <form className="panel form-body" onSubmit={save}>
                <h1>처음 오셨군요</h1>
                <p>사용할 닉네임과 인장을 설정해 주세요. 인장은 나중에 등록해도 됩니다.</p>
                {error && <p className="alert" role="alert">{error}</p>}
                <Avatar src={preview} name={name} size={80} />
                <label htmlFor="setup-name">닉네임</label>
                <input id="setup-name" value={name} maxLength={24} required disabled={busy} onChange={event => setName(event.target.value)} />
                <label htmlFor="setup-portrait">인장 이미지 (최대 5MB)</label>
                <input id="setup-portrait" type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={busy} onChange={event => {
                    const image = event.target.files?.[0];
                    if (!image) return;
                    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(image.type) || image.size > 5 * 1024 * 1024) {
                        setError('JPG·PNG·WebP·GIF 이미지를 최대 5MB까지 등록할 수 있습니다.');
                        event.target.value = '';
                        return;
                    }
                    setFile(image);
                    setError('');
                }} />
                <button className="primary" disabled={busy || !name.trim()}>{busy ? '저장 중...' : '프로필 저장 후 시작'}</button>
                <button className="secondary" type="button" disabled={busy} onClick={onLogout}>로그아웃</button>
            </form>
        </div>
    );
}
