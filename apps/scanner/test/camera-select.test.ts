import { describe, expect, it } from 'vitest';
import { createDedupe, nextCamera, pickBackCamera } from '../src/lib/camera-select.js';

describe('selección de cámara', () => {
  it('prefiere la trasera por etiqueta (Android)', () => {
    const cams = [
      { deviceId: 'a', label: 'camera2 1, facing front' },
      { deviceId: 'b', label: 'camera2 0, facing back' },
      { deviceId: 'c', label: 'camera2 2, facing back (ultra wide)' }
    ];
    expect(pickBackCamera(cams)?.deviceId).toBe('b');
  });

  it('entiende etiquetas en español e iOS', () => {
    expect(pickBackCamera([{ deviceId: 'f', label: 'Cámara frontal' }, { deviceId: 'r', label: 'Cámara trasera' }])?.deviceId).toBe('r');
    expect(pickBackCamera([{ deviceId: 'f', label: 'Front Camera' }, { deviceId: 'r', label: 'Back Camera' }])?.deviceId).toBe('r');
  });

  it('sin etiquetas (sin permiso aún) elige la última', () => {
    expect(pickBackCamera([{ deviceId: 'x', label: '' }, { deviceId: 'y', label: '' }])?.deviceId).toBe('y');
  });

  it('con una sola cámara la usa; sin cámaras devuelve undefined', () => {
    expect(pickBackCamera([{ deviceId: 'solo', label: 'FaceTime HD' }])?.deviceId).toBe('solo');
    expect(pickBackCamera([])).toBeUndefined();
  });

  it('rota a la siguiente cámara', () => {
    const cams = [{ deviceId: '1', label: '' }, { deviceId: '2', label: '' }, { deviceId: '3', label: '' }];
    expect(nextCamera(cams, '1')?.deviceId).toBe('2');
    expect(nextCamera(cams, '3')?.deviceId).toBe('1');
    expect(nextCamera(cams, undefined)?.deviceId).toBe('1');
    expect(nextCamera([], '1')).toBeUndefined();
  });
});

describe('deduplicación de lecturas', () => {
  it('ignora el mismo código dentro de la ventana y lo acepta después', () => {
    const d = createDedupe(2500);
    expect(d.accept('TP1.a.b', 0)).toBe(true);
    expect(d.accept('TP1.a.b', 1000)).toBe(false);
    expect(d.accept('TP1.c.d', 1100)).toBe(true);
    expect(d.accept('TP1.a.b', 1200)).toBe(true); // otro código entre medias reinicia
    expect(d.accept('TP1.a.b', 3800)).toBe(true);
    expect(d.accept('', 4000)).toBe(false);
    d.reset();
    expect(d.accept('TP1.a.b', 4001)).toBe(true);
  });
});
