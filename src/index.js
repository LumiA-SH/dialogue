import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { registerPwa } from './lib/pwa';
import './styles.css';
import './styles/pbp-layout.css';
import './styles/pbp-pwa.css';

createRoot(document.getElementById('root')).render(<App />);

registerPwa().catch(() => {});

if (window.visualViewport) {
    const resize = () => { if (window.visualViewport.scale === 1) document.documentElement.style.setProperty('--pbp-viewport-height', `${window.visualViewport.height}px`); };
    window.visualViewport.addEventListener('resize', resize);
    resize();
}
