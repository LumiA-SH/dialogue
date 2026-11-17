import React from 'react';
import '../styles/pbp-theme-preview.css';

export default function ThemePreview({ colors }) {
    const theme = { '--preview-main': colors.ui_main_color, '--preview-sub': colors.ui_sub_color, '--preview-border': colors.ui_border_color, '--preview-system': colors.ui_system_text_color, '--preview-body': colors.ui_body_text_color };
    return <section className="pbp-theme-preview" style={theme} aria-label="RP 화면 색상 미리보기">
        <header><strong>미리보기 RP방</strong><span className="pbp-preview-online" aria-label="접속 중" /></header>
        <div className="pbp-preview-log">
            <div className="pbp-preview-narration">창밖으로 푸른 새벽빛이 스며듭니다.<small>나레이션 · 09:00</small></div>
            <article><strong>캐릭터 A <small>09:01</small></strong><p>오늘은 어떤 이야기가 시작될까요?</p></article>
            <article><strong>캐릭터 B <small>09:02</small></strong><p>함께 다음 장면으로 가 보아요.</p></article>
            <article><strong>캐릭터 A <small>09:03</small></strong><img alt="이미지 메시지 미리보기" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='480' height='180' viewBox='0 0 480 180'%3E%3Crect width='480' height='180' fill='%23cbdff6'/%3E%3Ccircle cx='365' cy='45' r='23' fill='%23fff7db'/%3E%3Cpath d='M0 160L130 45L260 160L350 80L480 180H0' fill='%238ca9ce'/%3E%3C/svg%3E" /></article>
        </div>
        <footer><strong>캐릭터 A</strong><div>글을 입력하세요…<span>➤</span></div></footer>
    </section>;
}
