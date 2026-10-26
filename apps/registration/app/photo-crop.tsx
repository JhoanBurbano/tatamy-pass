'use client';

/**
 * Recorte cuadrado en el navegador: elige una imagen, arrastra para encuadrar y usa el
 * control de zoom. Exporta un JPEG de 600×600 (≈ 60–120 KB) como data URL.
 */
import { useEffect, useRef, useState } from 'react';

const OUT = 600;
const VIEW = 200;

export function PhotoCrop({ label, value, onChange, hint }: { label: string; value?: string; onChange: (dataUrl: string | undefined) => void; hint?: string }) {
  const [img, setImg] = useState<HTMLImageElement>();
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [error, setError] = useState<string>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Escala base: la imagen cubre el cuadrado (cover).
  const base = img ? Math.max(VIEW / img.width, VIEW / img.height) : 1;

  function clampOffset(o: { x: number; y: number }, z = zoom) {
    if (!img) return o;
    const w = img.width * base * z; const h = img.height * base * z;
    const maxX = Math.max(0, (w - VIEW) / 2); const maxY = Math.max(0, (h - VIEW) / 2);
    return { x: Math.max(-maxX, Math.min(maxX, o.x)), y: Math.max(-maxY, Math.min(maxY, o.y)) };
  }

  useEffect(() => {
    const c = canvasRef.current; if (!c || !img) return;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, VIEW, VIEW);
    const s = base * zoom; const w = img.width * s; const h = img.height * s;
    ctx.drawImage(img, (VIEW - w) / 2 + offset.x, (VIEW - h) / 2 + offset.y, w, h);
  }, [img, zoom, offset, base]);

  function exportCrop(z = zoom, o = offset) {
    if (!img) return;
    const c = document.createElement('canvas'); c.width = OUT; c.height = OUT;
    const ctx = c.getContext('2d')!;
    const k = OUT / VIEW; const s = base * z * k; const w = img.width * s; const h = img.height * s;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, OUT, OUT);
    ctx.drawImage(img, (OUT - w) / 2 + o.x * k, (OUT - h) / 2 + o.y * k, w, h);
    onChange(c.toDataURL('image/jpeg', 0.82));
  }

  async function pick(file: File | undefined) {
    setError(undefined);
    if (!file) return;
    if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type) && !/\.(jpe?g|png|webp)$/i.test(file.name)) { setError('Elige una foto JPG o PNG.'); return; }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      if (image.width < 300 || image.height < 300) { setError('La foto es muy pequeña. Necesita al menos 400 × 500 píxeles.'); return; }
      setImg(image); setZoom(1); setOffset({ x: 0, y: 0 });
      // exportar de inmediato con el encuadre centrado
      const b = Math.max(VIEW / image.width, VIEW / image.height);
      const c = document.createElement('canvas'); c.width = OUT; c.height = OUT;
      const ctx = c.getContext('2d')!; const k = OUT / VIEW; const w = image.width * b * k; const h = image.height * b * k;
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, OUT, OUT); ctx.drawImage(image, (OUT - w) / 2, (OUT - h) / 2, w, h);
      onChange(c.toDataURL('image/jpeg', 0.82));
    };
    image.onerror = () => { URL.revokeObjectURL(url); setError('No pude abrir esa imagen. Prueba con otra.'); };
    image.src = url;
  }

  return (
    <div>
      <span className="label">{label}</span>
      <div className="photo-box">
        {img ? (
          <canvas ref={canvasRef} width={VIEW} height={VIEW} aria-label="Encuadre de la foto: arrastra para mover"
            onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
            onPointerMove={(e) => { if (!drag.current) return; setOffset(clampOffset({ x: drag.current.ox + (e.clientX - drag.current.x), y: drag.current.oy + (e.clientY - drag.current.y) })); }}
            onPointerUp={(e) => { if (!drag.current) return; drag.current = null; (e.target as HTMLElement).releasePointerCapture(e.pointerId); exportCrop(); }}
          />
        ) : value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="preview" src={value} alt="Foto elegida" />
        ) : (
          <div className="photo-empty">Foto de frente, cara completa y fondo claro. Se usa para la credencial.</div>
        )}
        <div className="stack" style={{ gap: 8 }}>
          <input ref={inputRef} type="file" accept="image/*" capture="user" className="hidden-input" onChange={(e) => void pick(e.target.files?.[0])} />
          <div className="row">
            <button type="button" className="btn secondary sm" onClick={() => inputRef.current?.click()}>{img || value ? 'Cambiar foto' : 'Elegir foto'}</button>
            {(img || value) && <button type="button" className="btn ghost sm" onClick={() => { setImg(undefined); onChange(undefined); if (inputRef.current) inputRef.current.value = ''; }}>Quitar</button>}
          </div>
          {img && (
            <label><span className="label">Acercar</span>
              <input type="range" min={1} max={3} step={0.01} value={zoom} onChange={(e) => { const z = Number(e.target.value); setZoom(z); setOffset((o) => clampOffset(o, z)); }} onPointerUp={() => exportCrop()} onKeyUp={() => exportCrop()} />
            </label>
          )}
          <p className="small muted" style={{ margin: 0 }}>{hint ?? 'Arrastra la foto para encuadrar la cara. Se guarda recortada en cuadrado.'}</p>
          {error && <div className="err">{error}</div>}
        </div>
      </div>
    </div>
  );
}
