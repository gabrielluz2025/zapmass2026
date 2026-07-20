import React, { useCallback, useEffect, useState } from 'react';
import { TUTORIAL_DEMOS } from './tutorialDemos';

type Props = {
  demoId: string;
  accent?: string;
};

const FRAME_MS = 2200;

export const TutorialDemoPlayer: React.FC<Props> = ({ demoId, accent = '#10b981' }) => {
  const demo = TUTORIAL_DEMOS[demoId];
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(true);

  const total = demo?.frames.length ?? 0;

  const next = useCallback(() => {
    if (!total) return;
    setFrame((f) => (f + 1) % total);
  }, [total]);

  useEffect(() => {
    setFrame(0);
    setPlaying(true);
  }, [demoId]);

  useEffect(() => {
    if (!playing || total < 2) return;
    const t = window.setInterval(next, FRAME_MS);
    return () => window.clearInterval(t);
  }, [playing, total, next]);

  if (!demo) return null;

  const current = demo.frames[frame];
  const progress = total ? ((frame + 1) / total) * 100 : 0;

  return (
    <div className="tu-demo-player tu-no-print">
      <div className="tu-demo-player-head">
        <span className="tu-demo-player-label">▶ Demo animada</span>
        <span className="tu-demo-player-title">{demo.title}</span>
      </div>
      <div className="tu-demo-stage">{current.render()}</div>
      <p className="tu-demo-caption">{current.caption}</p>
      <div className="tu-demo-progress">
        <div className="tu-demo-progress-bar" style={{ width: `${progress}%`, background: accent }} />
      </div>
      <div className="tu-demo-controls">
        <button
          type="button"
          className="tu-demo-ctrl"
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? 'Pausar' : 'Reproduzir'}
        >
          {playing ? '⏸ Pausar' : '▶ Play'}
        </button>
        <button
          type="button"
          className="tu-demo-ctrl"
          onClick={() => {
            setFrame(0);
            setPlaying(true);
          }}
        >
          ↺ Reiniciar
        </button>
        <button type="button" className="tu-demo-ctrl" onClick={next}>
          Próximo →
        </button>
        <span className="tu-demo-frame-num">
          {frame + 1}/{total}
        </span>
      </div>
    </div>
  );
};
