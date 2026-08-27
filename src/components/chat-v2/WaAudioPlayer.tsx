import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Barras decorativas estáticas — leve, sem lib de waveform. */
function useWaveBars(count: number): number[] {
  return useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const base = 0.22 + Math.abs(Math.sin(i * 0.55)) * 0.45;
        return Math.min(1, base + ((i * 7) % 5) * 0.04);
      }),
    [count]
  );
}

type Props = {
  src: string;
  side: 'in' | 'out';
};

export const WaAudioPlayer: React.FC<Props> = ({ src, side }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const bars = useWaveBars(32);
  const progress = duration > 0 ? current / duration : 0;

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const onLoaded = () => setDuration(el.duration || 0);
    const onTime = () => setCurrent(el.currentTime || 0);
    const onEnded = () => {
      setPlaying(false);
      setCurrent(0);
    };

    el.addEventListener('loadedmetadata', onLoaded);
    el.addEventListener('durationchange', onLoaded);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('ended', onEnded);
    if (el.readyState >= 1) onLoaded();

    return () => {
      el.removeEventListener('loadedmetadata', onLoaded);
      el.removeEventListener('durationchange', onLoaded);
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('ended', onEnded);
    };
  }, [src]);

  const toggle = useCallback(async () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
      return;
    }
    try {
      await el.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
    }
  }, [playing]);

  const seek = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = audioRef.current;
      if (!el || !duration) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      el.currentTime = ratio * duration;
      setCurrent(el.currentTime);
    },
    [duration]
  );

  const timeLabel =
    playing || current > 0.5 ? formatTime(current) : formatTime(duration);

  return (
    <div className={`wa-audio wa-audio--${side}`} data-playing={playing ? 'true' : 'false'}>
      <button
        type="button"
        className="wa-audio__play"
        onClick={toggle}
        aria-label={playing ? 'Pausar áudio' : 'Reproduzir áudio'}
      >
        {playing ? <Pause size={18} strokeWidth={2.5} /> : <Play size={18} strokeWidth={2.5} />}
      </button>

      <div className="wa-audio__track-wrap">
        <div
          className="wa-audio__wave"
          role="slider"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={current}
          tabIndex={0}
          onClick={seek}
          onKeyDown={(e) => {
            const el = audioRef.current;
            if (!el || !duration) return;
            if (e.key === 'ArrowRight') {
              el.currentTime = Math.min(duration, el.currentTime + 5);
            } else if (e.key === 'ArrowLeft') {
              el.currentTime = Math.max(0, el.currentTime - 5);
            }
          }}
        >
          {bars.map((h, i) => {
            const filled = (i + 1) / bars.length <= progress;
            return (
              <span
                key={i}
                className="wa-audio__bar"
                style={{ height: `${Math.round(h * 100)}%`, opacity: filled ? 1 : 0.38 }}
              />
            );
          })}
          <span className="wa-audio__scrub" style={{ left: `${progress * 100}%` }} />
        </div>
        <span className="wa-audio__time">{timeLabel}</span>
      </div>

      <audio ref={audioRef} src={src} preload="metadata" className="wa-audio__native" />
    </div>
  );
};
