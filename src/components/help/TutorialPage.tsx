import React, { useCallback, useRef, useState } from 'react';
import { pdf } from '@react-pdf/renderer';
import { ZapMassPDF } from './ZapMassPDF';
import { TUTORIAL_SECTIONS, type ContentBlock, type TutorialSection } from './tutorialSections';
import { ILLUSTRATIONS } from './tutorialIllustrations';
import { TutorialDemoPlayer } from './TutorialDemoPlayer';
import { TutorialVideoSlot } from './TutorialVideoSlot';
import { useAppView } from '../../context/AppViewContext';

const PrintAndDemoStyles = () => (
  <style>{`
    @media print {
      .tu-no-print { display: none !important; }
      .tu-root { background: white !important; color: #111 !important; }
      .tu-section { break-inside: avoid; page-break-inside: avoid; }
      .tu-section-card {
        background: #f8f9fa !important;
        border: 1px solid #dee2e6 !important;
        box-shadow: none !important;
        color: #111 !important;
      }
      .tu-section-title { color: #111 !important; }
      .tu-section-text, .tu-list-text, .tu-step-text { color: #333 !important; }
      .tu-tip { background: #e8f5e9 !important; border-color: #4caf50 !important; color: #1b5e20 !important; }
      .tu-illu { filter: saturate(0.7) brightness(1.2); }
      .tu-download-btn { display: none !important; }
      .tu-toc { display: none !important; }
      .tu-header { background: #111 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
    .tu-root * { box-sizing: border-box; }
    .tu-illu { width: 100%; max-height: 180px; border-radius: 10px; display: block; }
    .tu-section-card {
      background: var(--card, #161b22);
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,0.08);
      padding: 28px;
      margin-bottom: 32px;
    }
    .tu-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin: 16px 0; }
    .tu-grid-item { background: rgba(255,255,255,0.04); border-radius: 10px; padding: 14px; border: 1px solid rgba(255,255,255,0.06); }
    .tu-list-item { display: flex; gap: 10px; align-items: flex-start; margin: 10px 0; }
    .tu-checklist-item { display: flex; gap: 10px; align-items: center; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
    .tu-step { display: flex; gap: 12px; align-items: flex-start; margin: 8px 0; padding: 10px; background: rgba(255,255,255,0.03); border-radius: 8px; }
    .tu-step-num { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 800; flex-shrink: 0; color: #fff; }
    .tu-tip { border-left: 3px solid #10b981; background: rgba(16,185,129,0.08); border-radius: 0 8px 8px 0; padding: 12px 16px; margin: 16px 0; }
    .tu-warning { border-left: 3px solid #f59e0b; background: rgba(245,158,11,0.1); border-radius: 0 8px 8px 0; padding: 12px 16px; margin: 16px 0; color: #c9d1d9; font-size: 14px; line-height: 1.6; }
    .tu-path { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0 0 14px; font-size: 12px; color: #8b949e; }
    .tu-path-crumb { background: rgba(255,255,255,0.06); padding: 3px 10px; border-radius: 6px; color: #c9d1d9; font-weight: 600; }
    .tu-path-sep { opacity: 0.5; }
    .tu-goto {
      margin: 0 0 16px;
      padding: 8px 14px;
      border-radius: 8px;
      border: 1px solid rgba(16,185,129,0.4);
      background: rgba(16,185,129,0.12);
      color: #10b981;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
    }
    .tu-goto:hover { background: rgba(16,185,129,0.22); }
    .tu-toc-btn.is-active { outline: 2px solid currentColor; outline-offset: 1px; }
    @media (min-width: 768px) {
      .tu-section-layout { display: grid; grid-template-columns: 1fr minmax(280px, 340px); gap: 20px; align-items: start; }
      .tu-section-layout.no-demo { grid-template-columns: 1fr; }
    }

    /* Demo player */
    .tu-demo-player {
      background: #0d1117;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px;
      overflow: hidden;
      margin: 8px 0 4px;
    }
    .tu-demo-player-head {
      display: flex; flex-direction: column; gap: 2px;
      padding: 10px 12px;
      background: #161b22;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .tu-demo-player-label { font-size: 10px; font-weight: 700; color: #10b981; text-transform: uppercase; letter-spacing: 0.04em; }
    .tu-demo-player-title { font-size: 13px; font-weight: 700; color: #e6edf3; }
    .tu-demo-stage { min-height: 168px; background: #090e13; }
    .tu-demo-caption { margin: 0; padding: 10px 12px; font-size: 12px; line-height: 1.45; color: #c9d1d9; background: #0d1117; }
    .tu-demo-progress { height: 3px; background: #21262d; }
    .tu-demo-progress-bar { height: 100%; transition: width 0.35s ease; }
    .tu-demo-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 12px; background: #161b22; }
    .tu-demo-ctrl {
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(255,255,255,0.05);
      color: #e6edf3;
      border-radius: 6px;
      padding: 5px 10px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }
    .tu-demo-ctrl:hover { background: rgba(255,255,255,0.1); }
    .tu-demo-frame-num { margin-left: auto; font-size: 11px; color: #8b949e; }

    .tu-demo-shell { display: flex; min-height: 168px; font-size: 11px; color: #e6edf3; }
    .tu-demo-side {
      width: 88px; flex-shrink: 0; background: #111827; padding: 8px 6px;
      border-right: 1px solid #1f2937; display: flex; flex-direction: column; gap: 4px;
    }
    .tu-demo-brand { display: flex; align-items: center; gap: 5px; font-weight: 800; font-size: 10px; color: #10b981; margin-bottom: 6px; }
    .tu-demo-dot { width: 7px; height: 7px; border-radius: 50%; background: #10b981; box-shadow: 0 0 6px #10b981; }
    .tu-demo-nav { padding: 4px 6px; border-radius: 5px; color: #8b949e; font-size: 9px; }
    .tu-demo-nav.is-active { background: rgba(16,185,129,0.15); color: #10b981; font-weight: 700; }
    .tu-demo-main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    .tu-demo-top { padding: 6px 10px; background: #161b22; border-bottom: 1px solid #1f2937; font-weight: 700; font-size: 11px; }
    .tu-demo-body { padding: 10px; display: flex; flex-direction: column; gap: 8px; }
    .tu-demo-kpis { display: flex; gap: 6px; }
    .tu-demo-kpi {
      flex: 1; background: #161b22; border-radius: 8px; padding: 8px; border-left: 2px solid #10b981;
      display: flex; flex-direction: column; gap: 2px;
    }
    .tu-demo-kpi strong { font-size: 14px; }
    .tu-demo-kpi span { font-size: 8px; color: #8b949e; }
    .tu-demo-card { background: #161b22; border-radius: 8px; padding: 8px 10px; border: 1px solid #21262d; }
    .tu-demo-card.muted { color: #8b949e; font-size: 10px; }
    .tu-demo-shortcuts { display: flex; flex-wrap: wrap; gap: 6px; }
    .tu-demo-btn {
      border: none; border-radius: 6px; padding: 6px 10px; font-size: 10px; font-weight: 700;
      background: #21262d; color: #e6edf3; cursor: default;
    }
    .tu-demo-btn.accent { background: #10b981; color: #fff; }
    .tu-demo-btn.pulse { animation: tu-pulse 1.4s ease-in-out infinite; }
    @keyframes tu-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0.5); }
      50% { box-shadow: 0 0 0 6px rgba(16,185,129,0); }
    }
    .tu-demo-row-between { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .tu-demo-h { font-weight: 700; font-size: 12px; }
    .tu-demo-chip-row { display: flex; flex-direction: column; gap: 6px; }
    .tu-demo-chip {
      background: #161b22; border: 1px solid #21262d; border-radius: 8px; padding: 8px 10px;
      display: flex; align-items: center; gap: 8px; font-size: 11px;
    }
    .tu-demo-chip.highlight { border-color: #10b981; background: rgba(16,185,129,0.1); }
    .tu-demo-chip.off { opacity: 0.7; }
    .tu-demo-chip .dot { width: 8px; height: 8px; border-radius: 50%; }
    .tu-demo-chip .dot.on { background: #10b981; }
    .tu-demo-chip .dot.off { background: #f59e0b; }
    .tu-demo-qr-wrap { display: flex; gap: 12px; align-items: center; }
    .tu-demo-qr {
      width: 72px; height: 72px; background: #fff; border-radius: 8px; padding: 6px; flex-shrink: 0;
    }
    .tu-demo-qr-inner {
      width: 100%; height: 100%;
      background:
        linear-gradient(#111 0 0) 0 0 / 30% 30%,
        linear-gradient(#111 0 0) 100% 0 / 30% 30%,
        linear-gradient(#111 0 0) 0 100% / 30% 30%,
        repeating-linear-gradient(90deg,#111 0 2px,transparent 2px 5px),
        repeating-linear-gradient(#111 0 2px,transparent 2px 5px);
      background-repeat: no-repeat;
      opacity: 0.85;
    }
    .tu-demo-field {
      background: #21262d; border-radius: 6px; padding: 6px 8px; font-size: 10px; color: #c9d1d9;
    }
    .tu-demo-hint { margin: 0; font-size: 10px; color: #8b949e; line-height: 1.4; }
    .tu-demo-alert {
      border-radius: 8px; padding: 8px 10px; font-size: 11px; font-weight: 600;
      background: rgba(245,158,11,0.12); color: #f59e0b;
    }
    .tu-demo-alert.ok { background: rgba(16,185,129,0.12); color: #10b981; }
    .tu-demo-steps { display: flex; gap: 4px; flex-wrap: wrap; }
    .tu-demo-step {
      flex: 1; min-width: 56px; text-align: center; padding: 5px 4px; border-radius: 6px;
      background: #161b22; border: 1px solid #21262d; font-size: 8px; color: #8b949e;
    }
    .tu-demo-step.on { border-color: #10b981; color: #10b981; background: rgba(16,185,129,0.12); font-weight: 700; }
    .tu-demo-step.done { border-color: #3b82f6; color: #93c5fd; }
    .tu-demo-msg {
      background: #161b22; border-radius: 8px; padding: 10px; font-size: 11px;
      border: 1px solid #21262d; font-family: ui-monospace, monospace;
    }
    .tu-demo-preview {
      background: #0a3d1f; color: #10b981; border-radius: 12px; padding: 6px 10px;
      font-size: 10px; align-self: flex-end; max-width: 85%;
    }
    .tu-demo-filters { display: flex; flex-wrap: wrap; gap: 4px; }
    .tu-demo-filters span {
      padding: 3px 8px; border-radius: 12px; font-size: 9px; background: #161b22; color: #8b949e;
    }
    .tu-demo-filters span.on { background: rgba(16,185,129,0.2); color: #10b981; font-weight: 700; }
    .tu-demo-chat { display: flex; gap: 0; min-height: 110px; border: 1px solid #21262d; border-radius: 8px; overflow: hidden; }
    .tu-demo-chat-list { width: 38%; background: #111827; padding: 6px; display: flex; flex-direction: column; gap: 4px; }
    .tu-demo-chat-item { padding: 6px; border-radius: 5px; font-size: 9px; color: #8b949e; background: transparent; }
    .tu-demo-chat-item.on { background: rgba(16,185,129,0.15); color: #10b981; font-weight: 700; }
    .tu-demo-chat-pane { flex: 1; padding: 8px; display: flex; flex-direction: column; gap: 6px; justify-content: flex-end; background: #0d1117; }
    .tu-demo-chat-pane.muted { color: #8b949e; font-size: 10px; justify-content: center; align-items: center; }
    .bubble { max-width: 88%; padding: 5px 8px; border-radius: 8px; font-size: 9px; line-height: 1.35; }
    .bubble.in { align-self: flex-start; background: #161b22; color: #e6edf3; }
    .bubble.out { align-self: flex-end; background: #065f46; color: #ecfdf5; }

    .tu-video-slot {
      margin: 12px 0 4px;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.1);
      overflow: hidden;
      background: #0d1117;
    }
    .tu-video-slot-head {
      display: flex; flex-direction: column; gap: 2px;
      padding: 10px 12px; background: #161b22; font-size: 10px; color: #a855f7; font-weight: 700;
    }
    .tu-video-slot-head strong { color: #e6edf3; font-size: 13px; }
    .tu-video-frame { position: relative; padding-bottom: 56.25%; height: 0; background: #000; }
    .tu-video-frame iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
    .tu-video-native { width: 100%; display: block; max-height: 360px; background: #000; }
  `}</style>
);

function renderBlock(block: ContentBlock, bi: number, sec: TutorialSection) {
  if (block.type === 'intro' || block.type === 'text') {
    return (
      <p key={bi} className="tu-section-text" style={{ color: '#c9d1d9', fontSize: 15, lineHeight: 1.7, margin: '0 0 16px' }}>
        {block.text}
      </p>
    );
  }
  if (block.type === 'path') {
    return (
      <div key={bi} className="tu-path tu-no-print">
        {block.crumbs.map((c, i) => (
          <React.Fragment key={`${c}-${i}`}>
            {i > 0 && <span className="tu-path-sep">→</span>}
            <span className="tu-path-crumb">{c}</span>
          </React.Fragment>
        ))}
      </div>
    );
  }
  if (block.type === 'tip') {
    return (
      <div key={bi} className="tu-tip">
        <span style={{ fontWeight: 700, color: '#10b981' }}>💡 Dica: </span>
        <span style={{ color: '#c9d1d9', fontSize: 14 }}>{block.text}</span>
      </div>
    );
  }
  if (block.type === 'warning') {
    return (
      <div key={bi} className="tu-warning">
        <span style={{ fontWeight: 700, color: '#f59e0b' }}>⚠️ Atenção: </span>
        {block.text}
      </div>
    );
  }
  if (block.type === 'list' && block.items) {
    return (
      <div key={bi} style={{ margin: '16px 0' }}>
        {block.title && <p style={{ margin: '0 0 10px', fontWeight: 700, color: '#e6edf3', fontSize: 14 }}>{block.title}</p>}
        {block.items.map((item, ii) => (
          <div key={ii} className="tu-list-item">
            <span style={{ fontSize: 18, flexShrink: 0, lineHeight: 1.2 }}>{item.icon}</span>
            <span className="tu-list-text" style={{ color: '#c9d1d9', fontSize: 14, lineHeight: 1.6 }}>{item.text}</span>
          </div>
        ))}
      </div>
    );
  }
  if (block.type === 'steps' && block.items) {
    return (
      <div key={bi} style={{ margin: '16px 0' }}>
        {block.title && <p style={{ margin: '0 0 10px', fontWeight: 700, color: '#e6edf3', fontSize: 14 }}>{block.title}</p>}
        {block.items.map((item, ii) => (
          <div key={ii} className="tu-step">
            <div className="tu-step-num" style={{ background: sec.color }}>{ii + 1}</div>
            <span className="tu-step-text" style={{ color: '#c9d1d9', fontSize: 14, lineHeight: 1.6, paddingTop: 4 }}>
              {item.replace(/^\d️⃣\s*/, '')}
            </span>
          </div>
        ))}
      </div>
    );
  }
  if (block.type === 'grid' && block.items) {
    return (
      <div key={bi} className="tu-grid">
        {block.items.map((item, ii) => (
          <div key={ii} className="tu-grid-item">
            <div style={{ fontSize: 24, marginBottom: 8 }}>{item.icon}</div>
            <div style={{ fontWeight: 700, color: '#e6edf3', fontSize: 13, marginBottom: 4 }}>{item.title}</div>
            <div style={{ color: '#8b949e', fontSize: 12, lineHeight: 1.5 }}>{item.desc}</div>
          </div>
        ))}
      </div>
    );
  }
  if (block.type === 'checklist' && block.items) {
    return (
      <div key={bi} style={{ margin: '16px 0' }}>
        {block.title && <p style={{ margin: '0 0 10px', fontWeight: 700, color: '#e6edf3', fontSize: 14 }}>{block.title}</p>}
        {block.items.map((item, ii) => (
          <div key={ii} className="tu-checklist-item">
            <span style={{ color: '#10b981', fontSize: 16, flexShrink: 0 }}>☑</span>
            <span style={{ color: '#c9d1d9', fontSize: 14 }}>{item}</span>
          </div>
        ))}
      </div>
    );
  }
  return null;
}

export const TutorialPage: React.FC = () => {
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);
  const { setCurrentView } = useAppView();

  const handleDownload = useCallback(async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const blob = await pdf(<ZapMassPDF />).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ZapMass-Guia-Completo.pdf';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Erro ao gerar PDF:', err);
    } finally {
      setDownloading(false);
    }
  }, [downloading]);

  const scrollTo = (id: string) => {
    const el = document.getElementById(`section-${id}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveSection(id);
  };

  return (
    <>
      <PrintAndDemoStyles />
      <div
        className="tu-root"
        style={{ minHeight: '100vh', background: 'var(--bg, #09090b)', color: 'var(--text, #f0f2f8)', fontFamily: 'system-ui, sans-serif' }}
        ref={topRef}
      >
        <div
          className="tu-header"
          style={{
            background: 'linear-gradient(135deg, #0a3d1f 0%, #0d1117 50%, #1a1033 100%)',
            padding: '40px 24px 32px',
            textAlign: 'center',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <div style={{ fontSize: 48, marginBottom: 12 }}>📱</div>
          <h1 style={{ fontSize: 32, fontWeight: 900, margin: 0, letterSpacing: '-0.03em', color: '#fff' }}>
            ZapMass — Guia Completo
          </h1>
          <p style={{ color: '#8b949e', marginTop: 10, fontSize: 16, maxWidth: 560, margin: '10px auto 0' }}>
            Explicações detalhadas, caminho no menu e demos animadas das telas do sistema
          </p>
          <button
            onClick={handleDownload}
            className="tu-download-btn tu-no-print"
            style={{
              marginTop: 24,
              padding: '12px 28px',
              background: downloading ? '#059669' : '#10b981',
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              fontSize: 15,
              fontWeight: 700,
              cursor: downloading ? 'wait' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              boxShadow: '0 4px 20px rgba(16,185,129,0.4)',
              opacity: downloading ? 0.8 : 1,
            }}
          >
            {downloading ? '⏳ Gerando PDF...' : '⬇️ Baixar como PDF'}
          </button>
          <p className="tu-no-print" style={{ color: '#8b949e', fontSize: 12, marginTop: 8 }}>
            Nas seções abaixo: demos com play/pause. Quando houver vídeo gravado, ele aparece automaticamente.
          </p>
        </div>

        <div style={{ maxWidth: 980, margin: '0 auto', padding: '0 16px 60px' }}>
          <div
            className="tu-toc tu-no-print"
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 20,
              background: 'var(--card, #161b22)',
              borderRadius: 12,
              padding: '16px 20px',
              margin: '24px 0',
              border: '1px solid rgba(255,255,255,0.08)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
            }}
          >
            <p style={{ margin: '0 0 12px', fontWeight: 700, color: '#e6edf3', fontSize: 14 }}>📑 Índice rápido</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {TUTORIAL_SECTIONS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`tu-toc-btn${activeSection === s.id ? ' is-active' : ''}`}
                  onClick={() => scrollTo(s.id)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 20,
                    border: `1px solid ${s.color}40`,
                    background: `${s.color}10`,
                    color: s.color,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {s.icon} {s.title}
                </button>
              ))}
            </div>
          </div>

          {TUTORIAL_SECTIONS.map((sec) => {
            const Illu = sec.illuKey ? ILLUSTRATIONS[sec.illuKey] : null;
            const hasDemo = Boolean(sec.demoId);

            return (
              <div key={sec.id} id={`section-${sec.id}`} className="tu-section" style={{ marginBottom: 40 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 12,
                      background: `${sec.color}20`,
                      border: `2px solid ${sec.color}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 22,
                      flexShrink: 0,
                    }}
                  >
                    {sec.icon}
                  </div>
                  <div>
                    <h2 className="tu-section-title" style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#e6edf3', letterSpacing: '-0.02em' }}>
                      {sec.title}
                    </h2>
                    <div style={{ width: 40, height: 3, borderRadius: 2, background: sec.color, marginTop: 4 }} />
                  </div>
                </div>

                <div className="tu-section-card">
                  {sec.viewId && (
                    <button type="button" className="tu-goto tu-no-print" onClick={() => setCurrentView(sec.viewId!)}>
                      Ir para esta área no sistema →
                    </button>
                  )}

                  <div className={`tu-section-layout${hasDemo ? '' : ' no-demo'}`}>
                    <div>
                      {Illu && (
                        <div style={{ marginBottom: 16 }}>
                          <Illu />
                        </div>
                      )}
                      {sec.content.map((block, bi) => renderBlock(block, bi, sec))}
                    </div>
                    {hasDemo && sec.demoId && (
                      <div>
                        <TutorialDemoPlayer demoId={sec.demoId} accent={sec.color} />
                        <TutorialVideoSlot sectionId={sec.id} />
                      </div>
                    )}
                  </div>
                  {!hasDemo && <TutorialVideoSlot sectionId={sec.id} />}
                </div>
              </div>
            );
          })}

          <div style={{ textAlign: 'center', padding: '32px 0', borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: 20 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🚀</div>
            <p style={{ color: '#8b949e', fontSize: 14, margin: 0 }}>ZapMass — Plataforma de Gestão de WhatsApp</p>
            <p style={{ color: '#6e7681', fontSize: 12, marginTop: 6 }}>
              Dúvidas? Use o Assistente IA ou o suporte dentro da plataforma.
            </p>
            <button
              onClick={handleDownload}
              className="tu-download-btn tu-no-print"
              style={{
                marginTop: 20,
                padding: '10px 24px',
                background: downloading ? '#059669' : '#10b981',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 700,
                cursor: downloading ? 'wait' : 'pointer',
                opacity: downloading ? 0.8 : 1,
              }}
            >
              {downloading ? '⏳ Gerando...' : '⬇️ Baixar este guia em PDF'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
