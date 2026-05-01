import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

interface QrCanvasProps {
  /** Conteúdo bruto do QR (string que o WhatsApp envia em `qr`). */
  value: string;
  /** Tamanho em pixels (default 220). */
  size?: number;
  /** Margem em módulos (default 1; reduz “moldura” branca). */
  margin?: number;
  /** Cor escura do QR (default preto). */
  darkColor?: string;
  /** Cor clara do QR (default branco). */
  lightColor?: string;
  /** Classe extra para o canvas. */
  className?: string;
  /** Texto alt visível para leitores de ecrã. */
  ariaLabel?: string;
}

/**
 * Renderiza o QR localmente via `qrcode` em `<canvas>`. Sem depender de servidores externos
 * (ex.: `api.qrserver.com`), o QR aparece imediatamente após o evento do socket. Em caso
 * de falha rara da geração, mostra fallback de texto para o utilizador poder tentar de novo.
 */
export const QrCanvas: React.FC<QrCanvasProps> = ({
  value,
  size = 220,
  margin = 1,
  darkColor = '#0F172A',
  lightColor = '#FFFFFF',
  className,
  ariaLabel
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!canvasRef.current || !value) return;
    setError(null);
    const dpr = typeof window !== 'undefined' ? Math.max(1, Math.min(3, window.devicePixelRatio || 1)) : 1;
    const drawSize = Math.round(size * dpr);
    QRCode.toCanvas(canvasRef.current, value, {
      width: drawSize,
      margin,
      errorCorrectionLevel: 'M',
      color: { dark: darkColor, light: lightColor }
    })
      .then(() => {
        if (cancelled || !canvasRef.current) return;
        canvasRef.current.style.width = `${size}px`;
        canvasRef.current.style.height = `${size}px`;
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Falha ao desenhar QR');
      });
    return () => {
      cancelled = true;
    };
  }, [value, size, margin, darkColor, lightColor]);

  if (error) {
    return (
      <div
        role="img"
        aria-label={ariaLabel || 'QR Code indisponível'}
        className={`flex items-center justify-center text-[11px] text-red-500 ${className || ''}`}
        style={{ width: size, height: size }}
      >
        Falha ao gerar QR: {error}
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={ariaLabel || 'QR Code'}
      className={className}
      style={{ width: size, height: size, imageRendering: 'pixelated' }}
    />
  );
};
