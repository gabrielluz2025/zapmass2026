import React from 'react';

export type DemoFrame = {
  caption: string;
  render: () => React.ReactNode;
};

export type TutorialDemo = {
  id: string;
  title: string;
  frames: DemoFrame[];
};

const Shell: React.FC<{
  activeNav: string;
  children: React.ReactNode;
  title?: string;
}> = ({ activeNav, children, title }) => {
  const nav = ['Painel', 'Conexões', 'Bate-papo', 'Campanhas', 'Contatos'];
  return (
    <div className="tu-demo-shell">
      <aside className="tu-demo-side">
        <div className="tu-demo-brand">
          <span className="tu-demo-dot" /> ZapMass
        </div>
        {nav.map((n) => (
          <div key={n} className={`tu-demo-nav${n === activeNav ? ' is-active' : ''}`}>
            {n}
          </div>
        ))}
      </aside>
      <div className="tu-demo-main">
        {title && <div className="tu-demo-top">{title}</div>}
        <div className="tu-demo-body">{children}</div>
      </div>
    </div>
  );
};

const demoPainel: TutorialDemo = {
  id: 'painel',
  title: 'Painel — visão do dia',
  frames: [
    {
      caption: 'Abra Principal → Painel. Veja os cartões de envios e chips.',
      render: () => (
        <Shell activeNav="Painel" title="Painel">
          <div className="tu-demo-kpis">
            <div className="tu-demo-kpi" style={{ borderColor: '#10b981' }}>
              <strong>847</strong>
              <span>Envios hoje</span>
            </div>
            <div className="tu-demo-kpi" style={{ borderColor: '#3b82f6' }}>
              <strong>5</strong>
              <span>Chips online</span>
            </div>
            <div className="tu-demo-kpi" style={{ borderColor: '#f59e0b' }}>
              <strong>98%</strong>
              <span>Sucesso</span>
            </div>
          </div>
          <div className="tu-demo-card muted">Gráfico de envios · atalhos abaixo</div>
        </Shell>
      ),
    },
    {
      caption: 'Use os atalhos para ir a Conexões ou Campanhas em um clique.',
      render: () => (
        <Shell activeNav="Painel" title="Painel">
          <div className="tu-demo-kpis">
            <div className="tu-demo-kpi" style={{ borderColor: '#10b981' }}>
              <strong>847</strong>
              <span>Envios hoje</span>
            </div>
            <div className="tu-demo-kpi" style={{ borderColor: '#3b82f6' }}>
              <strong>5</strong>
              <span>Chips online</span>
            </div>
          </div>
          <div className="tu-demo-shortcuts">
            <button type="button" className="tu-demo-btn accent">→ Conexões</button>
            <button type="button" className="tu-demo-btn">→ Campanhas</button>
            <button type="button" className="tu-demo-btn">→ Contatos</button>
          </div>
        </Shell>
      ),
    },
    {
      caption: 'Confirme chips online antes de qualquer disparo grande.',
      render: () => (
        <Shell activeNav="Painel" title="Painel">
          <div className="tu-demo-alert ok">✓ 5 chips online — operação saudável</div>
          <div className="tu-demo-card">Atalho Guia / Como usar também fica no Painel</div>
        </Shell>
      ),
    },
  ],
};

const demoConexoes: TutorialDemo = {
  id: 'conexoes',
  title: 'Conectar um chip',
  frames: [
    {
      caption: 'Menu Principal → Conexões → clique em Nova conexão.',
      render: () => (
        <Shell activeNav="Conexões" title="Conexões">
          <div className="tu-demo-row-between">
            <span className="tu-demo-h">Frota WhatsApp</span>
            <button type="button" className="tu-demo-btn accent pulse">+ Nova conexão</button>
          </div>
          <div className="tu-demo-chip-row">
            <div className="tu-demo-chip"><span className="dot on" /> Chip Marketing · Online</div>
            <div className="tu-demo-chip off"><span className="dot off" /> Chip Vendas · Offline</div>
          </div>
        </Shell>
      ),
    },
    {
      caption: 'Nomeie o chip e escaneie o QR no WhatsApp (Aparelhos conectados).',
      render: () => (
        <Shell activeNav="Conexões" title="Nova conexão">
          <div className="tu-demo-qr-wrap">
            <div className="tu-demo-qr">
              <div className="tu-demo-qr-inner" />
            </div>
            <div>
              <div className="tu-demo-field">Nome: Chip Marketing 2</div>
              <p className="tu-demo-hint">WhatsApp → Aparelhos conectados → escanear</p>
            </div>
          </div>
        </Shell>
      ),
    },
    {
      caption: 'Aguarde o status Online (ponto verde). Pronto para disparar.',
      render: () => (
        <Shell activeNav="Conexões" title="Conexões">
          <div className="tu-demo-chip-row">
            <div className="tu-demo-chip"><span className="dot on" /> Chip Marketing · Online</div>
            <div className="tu-demo-chip highlight"><span className="dot on" /> Chip Marketing 2 · Online ✓</div>
          </div>
        </Shell>
      ),
    },
  ],
};

const demoCampanhas: TutorialDemo = {
  id: 'campanhas',
  title: 'Broadcast Studio em 4 passos',
  frames: [
    {
      caption: 'Disparos → Campanhas → aba Nova. Passo 1: escolha o público.',
      render: () => (
        <Shell activeNav="Campanhas" title="Nova campanha">
          <div className="tu-demo-steps">
            {['Público', 'Mensagem', 'Canais', 'Revisão'].map((s, i) => (
              <div key={s} className={`tu-demo-step${i === 0 ? ' on' : ''}`}>{i + 1}. {s}</div>
            ))}
          </div>
          <div className="tu-demo-card">Lista: Clientes Março · 128 contatos</div>
        </Shell>
      ),
    },
    {
      caption: 'Passo 2: escreva a mensagem com {nome} e spintax.',
      render: () => (
        <Shell activeNav="Campanhas" title="Nova campanha">
          <div className="tu-demo-steps">
            {['Público', 'Mensagem', 'Canais', 'Revisão'].map((s, i) => (
              <div key={s} className={`tu-demo-step${i === 1 ? ' on' : i < 1 ? ' done' : ''}`}>{i + 1}. {s}</div>
            ))}
          </div>
          <div className="tu-demo-msg">{'{Olá|Oi} {nome}, tudo bem? 👋'}</div>
          <div className="tu-demo-preview">Prévia: Olá João, tudo bem? 👋</div>
        </Shell>
      ),
    },
    {
      caption: 'Passo 3: selecione chips ou um pool e o intervalo anti-ban.',
      render: () => (
        <Shell activeNav="Campanhas" title="Nova campanha">
          <div className="tu-demo-steps">
            {['Público', 'Mensagem', 'Canais', 'Revisão'].map((s, i) => (
              <div key={s} className={`tu-demo-step${i === 2 ? ' on' : i < 2 ? ' done' : ''}`}>{i + 1}. {s}</div>
            ))}
          </div>
          <div className="tu-demo-chip"><span className="dot on" /> Pool Marketing · intervalo 8–15s</div>
        </Shell>
      ),
    },
    {
      caption: 'Passo 4: revise e clique em Disparar agora (ou agende).',
      render: () => (
        <Shell activeNav="Campanhas" title="Nova campanha">
          <div className="tu-demo-steps">
            {['Público', 'Mensagem', 'Canais', 'Revisão'].map((s, i) => (
              <div key={s} className={`tu-demo-step${i === 3 ? ' on' : ' done'}`}>{i + 1}. {s}</div>
            ))}
          </div>
          <div className="tu-demo-row-between">
            <span className="tu-demo-hint">128 contatos · 2 chips · ~18 min</span>
            <button type="button" className="tu-demo-btn accent pulse">▶ Disparar agora</button>
          </div>
        </Shell>
      ),
    },
  ],
};

const demoContatos: TutorialDemo = {
  id: 'contatos',
  title: 'Importar e organizar contatos',
  frames: [
    {
      caption: 'Disparos → Contatos → Importar (CSV, Excel ou colar texto).',
      render: () => (
        <Shell activeNav="Contatos" title="Contatos">
          <div className="tu-demo-row-between">
            <div className="tu-demo-field" style={{ flex: 1 }}>🔍 Buscar...</div>
            <button type="button" className="tu-demo-btn accent pulse">+ Importar</button>
          </div>
          <div className="tu-demo-filters">
            <span className="on">Todos</span>
            <span>Quentes</span>
            <span>Mornos</span>
            <span>Frios</span>
          </div>
        </Shell>
      ),
    },
    {
      caption: 'Baixe o modelo, preencha nome e telefone, confirme a importação.',
      render: () => (
        <Shell activeNav="Contatos" title="Importar">
          <div className="tu-demo-card">Modelo CSV · nome, telefone, cidade…</div>
          <div className="tu-demo-alert ok">✓ 42 contatos prontos para importar</div>
          <button type="button" className="tu-demo-btn accent">Confirmar importação</button>
        </Shell>
      ),
    },
    {
      caption: 'Use temperatura e listas para segmentar a próxima campanha.',
      render: () => (
        <Shell activeNav="Contatos" title="Contatos">
          <div className="tu-demo-filters">
            <span>Todos</span>
            <span className="on">Quentes 🔥</span>
            <span>Mornos</span>
            <span>Frios</span>
          </div>
          <div className="tu-demo-chip">Ana Silva · 🔥 Quente</div>
          <div className="tu-demo-chip">Carlos Melo · 🔥 Quente</div>
        </Shell>
      ),
    },
  ],
};

const demoBatePapo: TutorialDemo = {
  id: 'bate-papo',
  title: 'Acompanhar respostas no chat',
  frames: [
    {
      caption: 'Principal → Bate-papo. Veja conversas de todos os chips.',
      render: () => (
        <Shell activeNav="Bate-papo" title="Bate-papo">
          <div className="tu-demo-chat">
            <div className="tu-demo-chat-list">
              <div className="tu-demo-chat-item on">Ana · 3 novas</div>
              <div className="tu-demo-chat-item">Carlos</div>
              <div className="tu-demo-chat-item">Maria</div>
            </div>
            <div className="tu-demo-chat-pane muted">Selecione uma conversa</div>
          </div>
        </Shell>
      ),
    },
    {
      caption: 'Abra quem respondeu à campanha e continue o atendimento.',
      render: () => (
        <Shell activeNav="Bate-papo" title="Bate-papo">
          <div className="tu-demo-chat">
            <div className="tu-demo-chat-list">
              <div className="tu-demo-chat-item on">Ana · 3 novas</div>
              <div className="tu-demo-chat-item">Carlos</div>
            </div>
            <div className="tu-demo-chat-pane">
              <div className="bubble in">Oi! Quero saber mais</div>
              <div className="bubble out">Olá Ana! Claro, te explico…</div>
            </div>
          </div>
        </Shell>
      ),
    },
    {
      caption: 'Filtre por não lidas para priorizar quem engajou.',
      render: () => (
        <Shell activeNav="Bate-papo" title="Bate-papo">
          <div className="tu-demo-filters">
            <span className="on">Não lidas</span>
            <span>Todos os canais</span>
          </div>
          <div className="tu-demo-alert ok">2 conversas aguardando resposta</div>
        </Shell>
      ),
    },
  ],
};

export const TUTORIAL_DEMOS: Record<string, TutorialDemo> = {
  painel: demoPainel,
  conexoes: demoConexoes,
  campanhas: demoCampanhas,
  contatos: demoContatos,
  'bate-papo': demoBatePapo,
};
