import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import Avatar from '../components/Avatar';
import PushSettings from '../components/PushSettings';
import ThemePreview from '../components/ThemePreview';

const PROFILE_BUCKET = 'pbp-profile-images';
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const THEME_SAVE_DELAY = 700;

const defaultColors = {
    ui_main_color: '#EAF2FF',
    ui_sub_color: '#FFFFFF',
    ui_border_color: '#B9CBE5',
    ui_system_text_color: '#243B53',
    ui_body_text_color: '#243B53'
};

const colorLabels = {
    ui_main_color: '메인',
    ui_sub_color: '서브',
    ui_border_color: '외곽선',
    ui_system_text_color: '시스템 텍스트',
    ui_body_text_color: '본문 텍스트'
};

const colorKeys = Object.keys(defaultColors);
const colorPattern = /^#[0-9a-fA-F]{6}$/;

function createForm(preferences) {
    const source = preferences || {};
    const colors = {};

    colorKeys.forEach(key => {
        colors[key] = colorPattern.test(source[key]) ? source[key] : defaultColors[key];
    });

    return {
        input_style: source.input_style === 'twitter' ? 'twitter' : 'messenger',
        send_shortcut: ['ctrl_enter', 'alt_enter'].includes(source.send_shortcut) ? 'ctrl_enter' : 'shift_enter',
        notification_enabled: Boolean(source.notification_enabled),
        ...colors
    };
}

function getColors(form) {
    return Object.fromEntries(colorKeys.map(key => [key, form[key]]));
}

function sameColors(first, second) {
    return colorKeys.every(key => first[key] === second[key]);
}

export default function Settings({ profile, preferences, userId, onSaved, onNotificationChange, onError }) {
    const [name, setName] = useState(profile?.user_name || 'User');
    const [portrait, setPortrait] = useState(profile?.user_portrait || '');
    const [imageFile, setImageFile] = useState(null);
    const [imagePreview, setImagePreview] = useState('');
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState(() => createForm(preferences));
    const [choiceSaving, setChoiceSaving] = useState(false);
    const [choiceStatus, setChoiceStatus] = useState({ type: '', text: '' });
    const [themeStatus, setThemeStatus] = useState('idle');
    const [themeError, setThemeError] = useState('');
    const [previewOpen, setPreviewOpen] = useState(() => Boolean(window.history.state?.dialogueThemePreview));
    const imageInputRef = useRef(null);

    const formRef = useRef(form);
    const choiceBusyRef = useRef(false);
    const profileBusyRef = useRef(false);
    const confirmedColorsRef = useRef(getColors(form));
    const themeTimerRef = useRef(null);
    const themeInFlightRef = useRef(null);
    const saveThemeRef = useRef(null);
    const mountedRef = useRef(true);
    const currentUserRef = useRef(userId);
    const preferencesReadyRef = useRef(preferences != null);
    const locallyChangedRef = useRef(false);

    useEffect(() => {
        setName(profile?.user_name || 'User');
        setPortrait(profile?.user_portrait || '');
    }, [profile?.user_name, profile?.user_portrait]);

    useEffect(() => {
        const userChanged = currentUserRef.current !== userId;
        const preferencesArrived = !preferencesReadyRef.current && preferences != null;

        if (!userChanged && !preferencesArrived) return;

        currentUserRef.current = userId;
        preferencesReadyRef.current = preferences != null;

        if (userChanged || !locallyChangedRef.current) {
            const next = createForm(preferences);
            formRef.current = next;
            confirmedColorsRef.current = getColors(next);
            setForm(next);
        }
    }, [preferences, userId]);

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
        function syncPreview() {
            setPreviewOpen(Boolean(window.history.state?.dialogueThemePreview));
        }

        window.addEventListener('popstate', syncPreview);
        return () => window.removeEventListener('popstate', syncPreview);
    }, []);

    const persistTheme = useCallback(async () => {
        window.clearTimeout(themeTimerRef.current);
        themeTimerRef.current = null;

        while (themeInFlightRef.current) {
            await themeInFlightRef.current;
        }

        const colors = getColors(formRef.current);

        if (sameColors(colors, confirmedColorsRef.current)) {
            if (mountedRef.current) setThemeStatus('saved');
            return true;
        }

        if (mountedRef.current) {
            setThemeStatus('saving');
            setThemeError('');
        }

        const task = (async () => {
            try {
                const { error } = await supabase.from('settings').upsert({
                    user_id: userId,
                    ...colors
                }, { onConflict: 'user_id' });

                if (error) throw error;

                confirmedColorsRef.current = colors;
                onSaved?.();

                if (mountedRef.current && sameColors(getColors(formRef.current), colors)) {
                    setThemeStatus('saved');
                }

                return true;
            } catch (err) {
                if (mountedRef.current) {
                    setThemeStatus('error');
                    setThemeError(err.message || 'UI 색상을 저장하지 못했습니다.');
                }

                return false;
            }
        })();

        themeInFlightRef.current = task;

        const succeeded = await task;
        themeInFlightRef.current = null;

        if (succeeded && mountedRef.current && !sameColors(getColors(formRef.current), confirmedColorsRef.current)) {
            themeTimerRef.current = window.setTimeout(() => {
                void saveThemeRef.current?.();
            }, THEME_SAVE_DELAY);
        }

        return succeeded;
    }, [userId, onSaved]);

    saveThemeRef.current = persistTheme;

    useEffect(() => {
        mountedRef.current = true;

        return () => {
            mountedRef.current = false;
            window.clearTimeout(themeTimerRef.current);

            void (async () => {
                if (themeInFlightRef.current) {
                    await themeInFlightRef.current;
                }

                const colors = getColors(formRef.current);
                if (sameColors(colors, confirmedColorsRef.current)) return;

                try {
                    const { error } = await supabase.from('settings').upsert({
                        user_id: userId,
                        ...colors
                    }, { onConflict: 'user_id' });

                    if (!error) onSaved?.();
                } catch (err) {
                    // 화면 이탈 중 저장 오류는 현재 화면에 표시할 수 없습니다.
                }
            })();
        };
    }, [userId, onSaved]);

    function updateForm(patch) {
        const next = { ...formRef.current, ...patch };
        formRef.current = next;
        locallyChangedRef.current = true;
        setForm(next);
    }

    async function selectOption(key, value) {
        if (choiceBusyRef.current || formRef.current[key] === value) return;

        const previousValue = formRef.current[key];

        choiceBusyRef.current = true;
        setChoiceSaving(true);
        setChoiceStatus({ type: 'saving', text: '설정을 저장하고 있습니다.' });
        updateForm({ [key]: value });

        try {
            const { error } = await supabase.from('settings').upsert({
                user_id: userId,
                [key]: value
            }, { onConflict: 'user_id' });

            if (error) throw error;

            setChoiceStatus({ type: 'success', text: '설정이 저장되었습니다.' });
            onSaved?.();
        } catch (err) {
            updateForm({ [key]: previousValue });
            setChoiceStatus({
                type: 'error',
                text: `저장에 실패했습니다. ${err.message || '다시 시도해 주세요.'}`
            });
        } finally {
            choiceBusyRef.current = false;
            setChoiceSaving(false);
        }
    }

    function updateColors(patch) {
        const next = { ...formRef.current, ...patch };

        if (sameColors(getColors(next), getColors(formRef.current))) return;

        updateForm(patch);
        setThemeStatus('pending');
        setThemeError('');

        window.clearTimeout(themeTimerRef.current);
        themeTimerRef.current = window.setTimeout(() => {
            void saveThemeRef.current?.();
        }, THEME_SAVE_DELAY);
    }

    function resetColors() {
        updateColors(defaultColors);
    }

    function openPreview() {
        if (previewOpen) return;

        window.history.pushState({
            ...window.history.state,
            dialogueThemePreview: true
        }, '', window.location.href);

        setPreviewOpen(true);
    }

    function closePreview() {
        void persistTheme();

        if (window.history.state?.dialogueThemePreview) {
            window.history.back();
        } else {
            setPreviewOpen(false);
        }
    }

    function handleImageChange(event) {
        const file = event.target.files?.[0];
        if (!file) return;

        if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
            onError?.('JPG, PNG, WebP, GIF 이미지만 등록할 수 있습니다.');
            event.target.value = '';
            return;
        }

        if (file.size > MAX_IMAGE_SIZE) {
            onError?.('이미지는 최대 5MB까지 등록할 수 있습니다.');
            event.target.value = '';
            return;
        }

        setImageFile(file);
    }

    async function uploadPortrait(file) {
        const extension = {
            'image/jpeg': 'jpg',
            'image/png': 'png',
            'image/webp': 'webp',
            'image/gif': 'gif'
        }[file.type];

        const path = `${userId}/${crypto.randomUUID()}.${extension}`;

        const { error } = await supabase.storage.from(PROFILE_BUCKET).upload(path, file, {
            contentType: file.type,
            upsert: false
        });

        if (error) throw error;

        const { data } = supabase.storage.from(PROFILE_BUCKET).getPublicUrl(path);
        return data.publicUrl;
    }

    async function save(event) {
        event.preventDefault();
        if (profileBusyRef.current) return;

        const trimmedName = name.trim();

        if (!trimmedName) {
            onError?.('닉네임을 입력해 주세요.');
            return;
        }

        profileBusyRef.current = true;
        setSaving(true);

        try {
            const portraitUrl = imageFile ? await uploadPortrait(imageFile) : portrait;

            const { error } = await supabase.from('user')
                .update({
                    user_name: trimmedName,
                    user_portrait: portraitUrl || null
                })
                .eq('user_id', userId);

            if (error) throw error;

            setPortrait(portraitUrl);
            setImageFile(null);

            if (onSaved) await onSaved();
            window.alert('프로필을 저장했습니다.');
        } catch (err) {
            onError?.(err.message || '프로필 저장에 실패했습니다.');
        } finally {
            profileBusyRef.current = false;
            setSaving(false);
        }
    }

    function getThemeMessage() {
        if (themeStatus === 'pending') return '변경 사항을 자동 저장할 예정입니다.';
        if (themeStatus === 'saving') return 'UI 색상을 저장하고 있습니다.';
        if (themeStatus === 'saved') return 'UI 색상이 저장되었습니다.';
        if (themeStatus === 'error') return themeError;
        return '색상을 변경하면 자동으로 저장됩니다.';
    }

    if (previewOpen) {
        return (
            <div className="pbp-theme-editor">
                <div className="section-heading pbp-theme-editor-heading">
                    <div>
                        <h1>UI 색상 편집</h1>
                        <p>실제 RP방과 비슷한 화면에서 색상을 확인하세요.</p>
                    </div>

                    <button className="secondary pbp-theme-back" type="button" onClick={closePreview}>
                        설정으로 돌아가기
                    </button>
                </div>

                <div className="pbp-theme-editor-layout">
                    <div className="pbp-theme-editor-stage">
                        <ThemePreview colors={form} inputStyle={form.input_style} sendShortcut={form.send_shortcut} />
                    </div>

                    <section className="panel pbp-theme-editor-controls">
                        <h2>UI 색상</h2>
                        <p className="muted">색상 변경 사항은 미리보기에 즉시 적용됩니다.</p>

                        <div className="pbp-theme-color-list">
                            {Object.entries(colorLabels).map(([key, label]) => (
                                <label className="pbp-theme-color-field" key={key}>
                                    <span>{label}</span>

                                    <div className="pbp-theme-color-input">
                                        <input type="color" value={form[key]} onChange={event => updateColors({ [key]: event.target.value })} />
                                        <code>{form[key].toUpperCase()}</code>
                                    </div>
                                </label>
                            ))}
                        </div>

                        <button className="secondary pbp-theme-reset" type="button" onClick={resetColors}>
                            기본 색상으로 초기화
                        </button>

                        <p className={`pbp-theme-save-status is-${themeStatus}`} role="status" aria-live="polite">
                            {getThemeMessage()}
                        </p>

                        {themeStatus === 'error' && (
                            <button className="secondary" type="button" onClick={() => void persistTheme()}>
                                저장 다시 시도
                            </button>
                        )}

                        <p className="muted pbp-theme-help">
                            UI 색상은 사용자별로 저장됩니다. 캐릭터 RP 강조색은 변경되지 않습니다.
                        </p>
                    </section>
                </div>
            </div>
        );
    }

    return (
        <>
            <div className="section-heading">
                <div>
                    <h1>설정</h1>
                    <p>프로필과 글쓰기 환경을 설정하세요.</p>
                </div>
            </div>

            <form className="settings-form" onSubmit={save}>
                <section className="panel">
                    <h2>오너 프로필</h2>

                    <div className="profile-row">
                        <Avatar src={imagePreview || portrait} name={name} size={64} />

                        <div className="field-stack">
                            <label htmlFor="profile-name">닉네임</label>
                            <input id="profile-name" maxLength={24} required value={name} onChange={event => setName(event.target.value)} />

                            <label htmlFor="profile-image">인장 이미지</label>
                            <input ref={imageInputRef} id="profile-image" className="pbp-profile-file-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={handleImageChange} disabled={saving} />

                            <div className="pbp-profile-image-actions">
                                <button className="secondary pbp-profile-image-icon" type="button" title="이미지 선택" aria-label="이미지 선택" onClick={() => {
                                    if (imageInputRef.current) {
                                        imageInputRef.current.value = '';
                                        imageInputRef.current.click();
                                    }
                                }} disabled={saving}>
                                    <ImagePlus size={18} />
                                </button>

                                {(imagePreview || portrait) && (
                                    <button className="secondary pbp-profile-image-icon" type="button" title="이미지 제거" aria-label="이미지 제거" onClick={() => {
                                        setImageFile(null);
                                        setPortrait('');
                                        if (imageInputRef.current) imageInputRef.current.value = '';
                                    }} disabled={saving}>
                                        <Trash2 size={18} />
                                    </button>
                                )}
                                <span>이미지 선택 / 이미지 제거</span>

                                {imageFile && <span className="pbp-profile-file-name">{imageFile.name}</span>}
                            </div>
                        </div>
                    </div>
                </section>

                <details className="panel">
                    <summary style={{ cursor: 'pointer' }}>
                        <h2 style={{ display: 'inline', margin: 0 }}>글쓰기 설정</h2>
                    </summary>

                    <div style={{ marginTop: 23 }}>
                        <label id="input-style-label">입력 방식</label>

                        <div className="pbp-theme-choice-row" role="group" aria-labelledby="input-style-label">
                            <button className="pbp-theme-choice" type="button" aria-pressed={form.input_style === 'messenger'} disabled={choiceSaving} onClick={() => selectOption('input_style', 'messenger')}>
                                메신저 방식
                            </button>
                            <button className="pbp-theme-choice" type="button" aria-pressed={form.input_style === 'twitter'} disabled={choiceSaving} onClick={() => selectOption('input_style', 'twitter')}>
                                트위터 방식
                            </button>
                        </div>

                        <label id="send-shortcut-label">전송 단축키</label>

                        <div className="pbp-theme-choice-row" role="group" aria-labelledby="send-shortcut-label">
                            <button className="pbp-theme-choice" type="button" aria-pressed={form.send_shortcut === 'shift_enter'} disabled={choiceSaving} onClick={() => selectOption('send_shortcut', 'shift_enter')}>
                                Shift + Enter
                            </button>
                            <button className="pbp-theme-choice" type="button" aria-pressed={form.send_shortcut === 'ctrl_enter'} disabled={choiceSaving} onClick={() => selectOption('send_shortcut', 'ctrl_enter')}>
                                Ctrl + Enter
                            </button>
                        </div>

                        <p className="muted pbp-theme-shortcut-help">
                            Enter는 줄바꿈이며, 선택한 단축키를 누르면 RP가 전송됩니다.
                        </p>

                        {choiceStatus.text && (
                            <p className={`pbp-theme-save-status is-${choiceStatus.type}`} role="status" aria-live="polite">
                                {choiceStatus.text}
                            </p>
                        )}

                        <div className="pbp-push-settings-box">
                            <PushSettings userId={userId} enabled={form.notification_enabled} onChange={enabled => {
                                updateForm({ notification_enabled: enabled });
                                onNotificationChange?.(enabled);
                            }} />
                        </div>
                    </div>
                </details>

                <details className="panel pbp-theme-settings-panel">
                    <summary style={{ cursor: 'pointer' }}>
                        <h2 style={{ display: 'inline', margin: 0 }}>UI 색상</h2>
                    </summary>

                    <div style={{ marginTop: 23 }}>
                        <p className="muted">
                            실제 RP방과 비슷한 미리보기 화면에서 UI 색상을 편집할 수 있습니다.
                        </p>

                        <div className="pbp-theme-color-swatches" aria-label="현재 UI 색상">
                            {colorKeys.map(key => (
                                <span key={key} title={`${colorLabels[key]}: ${form[key]}`} style={{ backgroundColor: form[key] }} />
                            ))}
                        </div>

                        <button className="secondary pbp-theme-launch" type="button" onClick={openPreview}>
                            UI 색상 미리보기 및 편집
                        </button>

                        {themeStatus !== 'idle' && (
                            <p className={`pbp-theme-save-status is-${themeStatus}`} role="status">
                                {getThemeMessage()}
                            </p>
                        )}
                    </div>
                </details>

                <button className="primary save-button" type="submit" disabled={saving || !name.trim()}>
                    {saving ? '저장 중...' : '프로필 저장'}
                </button>
            </form>
        </>
    );
}