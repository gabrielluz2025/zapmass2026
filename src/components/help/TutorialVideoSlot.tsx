import React from 'react';
import { TUTORIAL_VIDEOS } from './tutorialMedia';

type Props = {
  sectionId: string;
};

export const TutorialVideoSlot: React.FC<Props> = ({ sectionId }) => {
  const cfg = TUTORIAL_VIDEOS[sectionId];
  if (!cfg || (!cfg.youtubeId && !cfg.src)) return null;

  return (
    <div className="tu-video-slot tu-no-print">
      <div className="tu-video-slot-head">
        <span>🎬 Vídeo</span>
        <strong>{cfg.title}</strong>
      </div>
      {cfg.youtubeId ? (
        <div className="tu-video-frame">
          <iframe
            title={cfg.title}
            src={`https://www.youtube.com/embed/${cfg.youtubeId}`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      ) : null}
      {cfg.src ? (
        <video className="tu-video-native" controls preload="metadata" src={cfg.src}>
          Seu navegador não reproduz este vídeo.
        </video>
      ) : null}
    </div>
  );
};
