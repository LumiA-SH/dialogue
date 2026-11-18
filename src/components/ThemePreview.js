import React from 'react';
import { Send } from 'lucide-react';
import '../styles/pbp-theme-preview.css';

const sampleImage = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='480' height='180' viewBox='0 0 480 180'%3E%3Crect width='480' height='180' fill='%23cbdff6'/%3E%3Ccircle cx='365' cy='45' r='23' fill='%23fff7db'/%3E%3Cpath d='M0 160L130 45L260 160L350 80L480 180H0' fill='%238ca9ce'/%3E%3C/svg%3E";

export default function ThemePreview({ colors, inputStyle = 'messenger', sendShortcut = 'shift_enter' }) {
    const theme = {
        '--preview-main': colors.ui_main_color,
        '--preview-sub': colors.ui_sub_color,
        '--preview-border': colors.ui_border_color,
        '--preview-system': colors.ui_system_text_color,
        '--preview-body': colors.ui_body_text_color
    };

    const shortcutLabel = sendShortcut === 'ctrl_enter' ? 'Ctrl + Enter' : 'Shift + Enter';

    return (
        <section className="pbp-theme-preview" style={theme} aria-label="RP 화면 색상 미리보기">
            <header className="pbp-preview-header">
                <div className="pbp-preview-room-info">
                    <strong>미리보기 RP방</strong>
                    <small>UI 색상 확인용 샘플 화면</small>
                </div>

                <span className="pbp-preview-online">
                    <i aria-hidden="true" />
                    접속 중
                </span>
            </header>

            <div className="pbp-preview-log">
                <div className="pbp-preview-reading-title">
                    <h2>미리보기 RP방</h2>
                    <p>이야기의 한 장면을 미리 살펴보세요.</p>
                </div>

                <div className="pbp-preview-date">
                    2026년 11월 18일
                </div>

                <article className="pbp-preview-message">
                    <div className="pbp-preview-avatar is-first">A</div>

                    <div className="pbp-preview-message-column">
                        <div className="pbp-preview-message-meta">
                            <strong>캐릭터 A</strong>
                            <time>09:01</time>
                        </div>

                        <div className="pbp-preview-message-bubble is-first">
                            <p>오늘은 어떤 이야기가 시작될까요?</p>
                            <p>조용한 새벽, 창밖으로 희미한 빛이 스며들고 있었습니다.</p>
                        </div>
                    </div>
                </article>

                <article className="pbp-preview-message is-narration">
                    <div className="pbp-preview-narration">
                        <p>창밖으로 푸른 새벽빛이 스며듭니다. 멀리서 새들의 울음소리가 들려옵니다.</p>
                        <small>나레이션 · 09:02</small>
                    </div>
                </article>

                <article className="pbp-preview-message">
                    <div className="pbp-preview-avatar is-second">B</div>

                    <div className="pbp-preview-message-column">
                        <div className="pbp-preview-message-meta">
                            <strong>캐릭터 B</strong>
                            <time>09:03</time>
                        </div>

                        <div className="pbp-preview-message-bubble is-second">
                            <p>함께 다음 장면으로 가 보아요.</p>
                            <p>그렇게 말하며 가볍게 미소를 지었습니다.</p>
                        </div>
                    </div>
                </article>

                <article className="pbp-preview-message">
                    <div className="pbp-preview-avatar is-first">A</div>

                    <div className="pbp-preview-message-column">
                        <div className="pbp-preview-message-meta">
                            <strong>캐릭터 A</strong>
                            <time>09:04</time>
                        </div>

                        <div className="pbp-preview-message-bubble is-first">
                            <p>이곳의 풍경을 함께 바라봅니다.</p>
                            <img src={sampleImage} alt="이미지 메시지 샘플" />
                        </div>
                    </div>
                </article>
            </div>

            <footer className={`pbp-preview-composer${inputStyle === 'twitter' ? ' is-twitter' : ''}`}>
                <div className="pbp-preview-composer-header">
                    <div className="pbp-preview-composer-character">
                        <span className="pbp-preview-avatar is-first">A</span>
                        <strong>캐릭터 A</strong>
                    </div>

                    <span className="pbp-preview-composer-mode">
                        {inputStyle === 'twitter' ? '트위터 방식' : '메신저 방식'}
                    </span>
                </div>

                <div className="pbp-preview-input">
                    <span>RP 내용을 입력하세요…</span>
                </div>

                <div className="pbp-preview-composer-footer">
                    <small>전송 단축키: {shortcutLabel}</small>

                    <span className="pbp-preview-send" aria-label="전송 버튼 미리보기">
                        <Send size={16} />
                    </span>
                </div>
            </footer>
        </section>
    );
}