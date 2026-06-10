import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Move, ZoomIn } from 'lucide-react';
import { Button, Modal } from '../ui';
import { cropSquarePhoto, type PhotoCropParams } from '../../utils/profilePhotoCrop';

const VIEW_SIZE = 280;

type Props = {
  file: File | null;
  onClose: () => void;
  onConfirm: (dataUrl: string) => void;
};

export const ProfilePhotoCropModal: React.FC<Props> = ({ file, onClose, onConfirm }) => {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [previewUrl, setPreviewUrl] = useState('');
  const [objectUrl, setObjectUrl] = useState('');

  const params: PhotoCropParams = { zoom, panX, panY };

  const refreshPreview = useCallback(() => {
    const img = imgRef.current;
    if (!img?.naturalWidth) return;
    try {
      setPreviewUrl(
        cropSquarePhoto(img, { zoom, panX, panY }, file?.type.includes('webp') ? 'image/webp' : 'image/jpeg')
      );
    } catch {
      /* ignore preview errors */
    }
  }, [zoom, panX, panY, file?.type]);

  useEffect(() => {
    if (!file) {
      imgRef.current = null;
      setReady(false);
      setPreviewUrl('');
      setObjectUrl('');
      setZoom(1);
      setPanX(0);
      setPanY(0);
      return;
    }
    let cancelled = false;
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      imgRef.current = img;
      setReady(true);
      setZoom(1);
      setPanX(0);
      setPanY(0);
    };
    img.onerror = () => {
      if (!cancelled) onClose();
    };
    img.src = url;
    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [file, onClose]);

  useEffect(() => {
    if (!ready) return;
    refreshPreview();
  }, [ready, refreshPreview]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, panX, panY };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setPanX(drag.panX + (e.clientX - drag.x));
    setPanY(drag.panY + (e.clientY - drag.y));
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const handleConfirm = () => {
    const img = imgRef.current;
    if (!img) return;
    const mime = file?.type.includes('webp') ? 'image/webp' : 'image/jpeg';
    const dataUrl = cropSquarePhoto(img, params, mime);
    onConfirm(dataUrl);
  };

  const coverStyle = (): React.CSSProperties => {
    const img = imgRef.current;
    if (!img?.naturalWidth) return {};
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const coverScale = (VIEW_SIZE / Math.min(iw, ih)) * zoom;
    const dw = iw * coverScale;
    const dh = ih * coverScale;
    return {
      width: dw,
      height: dh,
      transform: `translate(${panX}px, ${panY}px)`,
      maxWidth: 'none'
    };
  };

  return (
    <Modal
      isOpen={!!file}
      onClose={onClose}
      title="Ajustar foto"
      subtitle="Arraste para centralizar e use o zoom para enquadrar."
      size="sm"
      footer={
        <div className="flex justify-end gap-2 w-full">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" variant="primary" disabled={!ready} onClick={handleConfirm}>
            Usar foto
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div
          className="relative mx-auto overflow-hidden rounded-2xl border cursor-grab active:cursor-grabbing"
          style={{
            width: VIEW_SIZE,
            height: VIEW_SIZE,
            borderColor: 'var(--border-subtle)',
            background: '#0f172a'
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {ready && objectUrl && (
            <img
              src={objectUrl}
              alt=""
              draggable={false}
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 select-none pointer-events-none"
              style={coverStyle()}
            />
          )}
          <div
            className="absolute inset-0 pointer-events-none rounded-2xl ring-2 ring-inset ring-white/20"
            aria-hidden
          />
        </div>

        <p className="text-[11px] flex items-center justify-center gap-1.5" style={{ color: 'var(--text-3)' }}>
          <Move className="w-3.5 h-3.5" />
          Arraste a imagem para reposicionar
        </p>

        <label className="block space-y-1.5">
          <span className="text-[11px] font-semibold flex items-center gap-1.5" style={{ color: 'var(--text-2)' }}>
            <ZoomIn className="w-3.5 h-3.5" />
            Zoom
          </span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.02}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-full accent-emerald-500"
          />
        </label>

        {previewUrl && (
          <div className="flex items-center gap-3 pt-1">
            <img
              src={previewUrl}
              alt="Prévia"
              className="w-14 h-14 rounded-xl object-cover border"
              style={{ borderColor: 'var(--border-subtle)' }}
            />
            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
              Prévia do recorte quadrado que será salva no perfil.
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
};
