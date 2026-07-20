/**
 * Vídeos reais do tutorial.
 * Preencha youtubeId e/ou src (ex.: /tutorial/conexoes.mp4 em public/tutorial/).
 * Seções sem entrada aqui usam só a demo animada.
 */
export type TutorialVideoConfig = {
  title: string;
  youtubeId?: string;
  /** Caminho público, ex.: /tutorial/campanhas.mp4 */
  src?: string;
};

export const TUTORIAL_VIDEOS: Record<string, TutorialVideoConfig> = {
  // Exemplo quando tiver gravação:
  // conexoes: { title: 'Como conectar um chip', youtubeId: 'xxxxxxxxxxx' },
  // campanhas: { title: 'Criar campanha', src: '/tutorial/campanhas.mp4' },
};
