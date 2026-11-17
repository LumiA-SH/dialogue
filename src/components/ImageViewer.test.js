import { clampTransform } from './ImageViewer';
test('image zoom remains bounded and reset restores original fit', () => {
    const viewport = { width: 300, height: 400 }, image = { width: 300, height: 200 };
    expect(clampTransform({ scale: 9, x: 9999, y: -9999 }, viewport, image)).toEqual({ scale: 5, x: 600, y: -300 });
    const reset = clampTransform({ scale: 0, x: 50, y: 40 }, viewport, image);
    expect(reset.scale).toBe(1);
    expect(Math.abs(reset.x)).toBe(0);
    expect(Math.abs(reset.y)).toBe(0);
});
