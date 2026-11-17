import React, { useRef, useState } from 'react';
import Modal from './Modal';
import '../styles/pbp-image-viewer.css';

export function clampTransform(value, viewport, image) {
    const scale = Math.min(5, Math.max(1, value.scale));
    const maxX = Math.max(0, (image.width * scale - viewport.width) / 2);
    const maxY = Math.max(0, (image.height * scale - viewport.height) / 2);
    return { scale, x: Math.min(maxX, Math.max(-maxX, value.x)), y: Math.min(maxY, Math.max(-maxY, value.y)) };
}

export default function ImageViewer({ src, onClose }) {
    const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
    const current = useRef(transform);
    const viewportRef = useRef(null);
    const imageRef = useRef(null);
    const pointers = useRef(new Map());
    const gesture = useRef(null);
    function update(value) {
        const viewport = viewportRef.current;
        const image = imageRef.current;
        const next = clampTransform(value, { width: viewport.clientWidth, height: viewport.clientHeight }, { width: image.offsetWidth, height: image.offsetHeight });
        current.current = next;
        setTransform(next);
    }
    function baseline() {
        const points = [...pointers.current.values()];
        gesture.current = { points, transform: { ...current.current } };
    }
    function pointerDown(event) {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        baseline();
    }
    function pointerMove(event) {
        if (!pointers.current.has(event.pointerId)) return;
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const points = [...pointers.current.values()];
        const start = gesture.current;
        if (points.length === 1) update({ ...start.transform, x: start.transform.x + points[0].x - start.points[0].x, y: start.transform.y + points[0].y - start.points[0].y });
        else if (points.length >= 2 && start.points.length >= 2) {
            const distance = list => Math.hypot(list[1].x - list[0].x, list[1].y - list[0].y);
            const scale = Math.max(1, Math.min(5, start.transform.scale * distance(points) / Math.max(1, distance(start.points))));
            const bounds = viewportRef.current.getBoundingClientRect();
            const center = list => ({ x: (list[0].x + list[1].x) / 2 - bounds.left - bounds.width / 2, y: (list[0].y + list[1].y) / 2 - bounds.top - bounds.height / 2 });
            const from = center(start.points), to = center(points), ratio = scale / start.transform.scale;
            update({ scale, x: to.x - (from.x - start.transform.x) * ratio, y: to.y - (from.y - start.transform.y) * ratio });
        }
    }
    function pointerEnd(event) { pointers.current.delete(event.pointerId); baseline(); }
    return <Modal title="이미지 확대" onClose={onClose} wide>
        <div className="pbp-image-tools"><button type="button" className="secondary" onClick={() => update({ ...current.current, scale: current.current.scale - 0.5 })}>축소</button><span>{Math.round(transform.scale * 100)}%</span><button type="button" className="secondary" onClick={() => update({ ...current.current, scale: current.current.scale + 0.5 })}>확대</button><button type="button" className="secondary" onClick={() => update({ scale: 1, x: 0, y: 0 })}>초기화</button></div>
        <div className="pbp-touch-image-viewer" ref={viewportRef} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} onLostPointerCapture={pointerEnd}>
            <img ref={imageRef} src={src} alt="확대 이미지" draggable={false} style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }} />
        </div>
    </Modal>;
}
