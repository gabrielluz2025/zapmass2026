import React from 'react';

/** Ilustrações SVG estáticas por seção do tutorial. */

export const IlluDashboard = () => (
  <svg viewBox="0 0 320 180" fill="none" xmlns="http://www.w3.org/2000/svg" className="tu-illu">
    <rect width="320" height="180" rx="14" fill="#0d1117"/>
    <rect x="12" y="12" width="88" height="56" rx="8" fill="#161b22" stroke="#10b981" strokeWidth="1.2"/>
    <text x="56" y="38" textAnchor="middle" fill="#10b981" fontSize="18" fontWeight="800">847</text>
    <text x="56" y="54" textAnchor="middle" fill="#8b949e" fontSize="9">Envios hoje</text>
    <rect x="116" y="12" width="88" height="56" rx="8" fill="#161b22" stroke="#3b82f6" strokeWidth="1.2"/>
    <text x="160" y="38" textAnchor="middle" fill="#3b82f6" fontSize="18" fontWeight="800">5</text>
    <text x="160" y="54" textAnchor="middle" fill="#8b949e" fontSize="9">Chips online</text>
    <rect x="220" y="12" width="88" height="56" rx="8" fill="#161b22" stroke="#f59e0b" strokeWidth="1.2"/>
    <text x="264" y="38" textAnchor="middle" fill="#f59e0b" fontSize="18" fontWeight="800">98%</text>
    <text x="264" y="54" textAnchor="middle" fill="#8b949e" fontSize="9">Taxa de sucesso</text>
    <rect x="12" y="82" width="296" height="84" rx="8" fill="#161b22"/>
    <text x="24" y="100" fill="#8b949e" fontSize="9" fontWeight="600">ENVIOS POR DIA</text>
    {[40, 65, 50, 80, 60, 90, 75, 95, 70, 85, 100, 88].map((h, i) => (
      <rect key={i} x={24 + i * 22} y={158 - h * 0.5} width="14" height={h * 0.5} rx="3"
        fill={i === 11 ? '#10b981' : '#1f6feb'} opacity={i === 11 ? 1 : 0.6}/>
    ))}
  </svg>
);

export const IlluConexoes = () => (
  <svg viewBox="0 0 320 180" fill="none" xmlns="http://www.w3.org/2000/svg" className="tu-illu">
    <rect width="320" height="180" rx="14" fill="#0d1117"/>
    {[0, 1, 2].map((i) => (
      <g key={i} transform={`translate(12,${12 + i * 56})`}>
        <rect width="296" height="48" rx="8" fill="#161b22"/>
        <circle cx="28" cy="24" r="14" fill={i < 2 ? '#0a3d1f' : '#3d1f0a'}/>
        <text x="28" y="29" textAnchor="middle" fill={i === 2 ? '#f59e0b' : '#10b981'} fontSize="16">
          {i === 2 ? '📵' : '📱'}
        </text>
        <rect x="56" y="10" width="120" height="8" rx="4" fill="#21262d"/>
        <rect x="56" y="24" width="80" height="6" rx="3" fill="#21262d"/>
        <circle cx="260" cy="24" r="8" fill={i < 2 ? '#10b981' : '#f59e0b'}/>
        <text x="260" y="28" textAnchor="middle" fill="#fff" fontSize="8" fontWeight="700">
          {i < 2 ? 'ON' : 'OFF'}
        </text>
      </g>
    ))}
  </svg>
);

export const IlluChat = () => (
  <svg viewBox="0 0 320 180" fill="none" xmlns="http://www.w3.org/2000/svg" className="tu-illu">
    <rect width="320" height="180" rx="14" fill="#0d1117"/>
    <rect x="0" y="0" width="100" height="180" rx="14" fill="#161b22"/>
    {[0, 1, 2, 3].map((i) => (
      <g key={i} transform={`translate(8,${12 + i * 40})`}>
        <circle cx="14" cy="14" r="12" fill={['#10b981', '#3b82f6', '#f59e0b', '#a855f7'][i]} opacity="0.3"/>
        <rect x="32" y="6" width="50" height="7" rx="3" fill="#21262d"/>
        <rect x="32" y="18" width="38" height="5" rx="2" fill="#21262d" opacity="0.6"/>
        {i === 0 && <circle cx="80" cy="7" r="7" fill="#10b981"/>}
        {i === 0 && <text x="80" y="11" textAnchor="middle" fill="#fff" fontSize="8" fontWeight="800">3</text>}
      </g>
    ))}
    <rect x="104" y="0" width="216" height="180" rx="14" fill="#090e13"/>
    <rect x="112" y="140" width="200" height="32" rx="8" fill="#161b22"/>
    <rect x="120" y="148" width="140" height="16" rx="6" fill="#21262d"/>
    <rect x="280" y="148" width="24" height="16" rx="6" fill="#10b981"/>
    {[{ x: 130, y: 80, w: 120, out: false }, { x: 168, y: 110, w: 80, out: true }].map((b, i) => (
      <rect key={i} x={b.x} y={b.y} width={b.w} height="24" rx="8"
        fill={b.out ? '#0a3d1f' : '#161b22'}/>
    ))}
  </svg>
);

export const IlluCampanhas = () => (
  <svg viewBox="0 0 320 180" fill="none" xmlns="http://www.w3.org/2000/svg" className="tu-illu">
    <rect width="320" height="180" rx="14" fill="#0d1117"/>
    <rect x="12" y="12" width="296" height="40" rx="8" fill="#161b22"/>
    <text x="28" y="36" fill="#e6edf3" fontSize="13" fontWeight="700">Nova campanha — Broadcast Studio</text>
    <rect x="220" y="20" width="80" height="24" rx="6" fill="#10b981"/>
    <text x="260" y="36" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="700">▶ Disparar</text>
    {[{ l: '1. Público', c: '#3b82f6' }, { l: '2. Mensagem', c: '#10b981' }, { l: '3. Canais', c: '#8b949e' }, { l: '4. Revisão', c: '#8b949e' }].map((s, i) => (
      <g key={i} transform={`translate(${12 + i * 76},64)`}>
        <rect width="68" height="40" rx="8" fill={i < 2 ? '#161b22' : '#0d1117'} stroke={s.c} strokeWidth={i === 1 ? 2 : 1} strokeOpacity={i < 2 ? 1 : 0.3}/>
        <circle cx="34" cy="14" r="8" fill={s.c} opacity={i < 2 ? 1 : 0.3}/>
        <text x="34" y="18" textAnchor="middle" fill="#fff" fontSize="9" fontWeight="800">{i + 1}</text>
        <text x="34" y="34" textAnchor="middle" fill={s.c} fontSize="8" opacity={i < 2 ? 1 : 0.4}>{s.l.slice(3)}</text>
      </g>
    ))}
    <rect x="12" y="116" width="192" height="52" rx="8" fill="#161b22"/>
    <text x="24" y="135" fill="#8b949e" fontSize="9">Mensagem</text>
    <rect x="24" y="142" width="168" height="18" rx="4" fill="#21262d"/>
    <text x="32" y="155" fill="#e6edf3" fontSize="9">Olá {'{nome}'}, tudo bem? 👋</text>
    <rect x="216" y="116" width="92" height="52" rx="8" fill="#161b22"/>
    <text x="228" y="135" fill="#8b949e" fontSize="9">Prévia ao vivo</text>
    <rect x="240" y="142" width="60" height="18" rx="8" fill="#0a3d1f"/>
    <text x="270" y="155" textAnchor="middle" fill="#10b981" fontSize="8">Olá João 👋</text>
  </svg>
);

export const IlluContatos = () => (
  <svg viewBox="0 0 320 180" fill="none" xmlns="http://www.w3.org/2000/svg" className="tu-illu">
    <rect width="320" height="180" rx="14" fill="#0d1117"/>
    <rect x="0" y="0" width="80" height="180" rx="14" fill="#161b22"/>
    {['Todos', 'Quentes', 'Mornos', 'Frios', 'Aniversário'].map((t, i) => (
      <g key={i} transform={`translate(8,${16 + i * 32})`}>
        <rect width="64" height="24" rx="6" fill={i === 0 ? '#10b981' : 'transparent'} fillOpacity="0.15"
          stroke={i === 0 ? '#10b981' : 'transparent'}/>
        <text x="32" y="16" textAnchor="middle" fill={i === 0 ? '#10b981' : '#8b949e'} fontSize="10">{t}</text>
      </g>
    ))}
    <rect x="84" y="0" width="236" height="36" rx="0" fill="#161b22"/>
    <rect x="92" y="10" width="140" height="16" rx="6" fill="#21262d"/>
    <text x="104" y="22" fill="#8b949e" fontSize="9">🔍 Buscar contatos...</text>
    <rect x="248" y="10" width="64" height="16" rx="6" fill="#10b981"/>
    <text x="280" y="22" textAnchor="middle" fill="#fff" fontSize="9" fontWeight="700">+ Importar</text>
    {[{ n: 'Ana Silva', p: '47 9912-7001', t: '🔥' }, { n: 'Carlos Melo', p: '48 9876-5432', t: '🌡️' }, { n: 'Maria Oliveira', p: '11 91234-5678', t: '❄️' }].map((c, i) => (
      <g key={i} transform={`translate(84,${44 + i * 44})`}>
        <rect width="236" height="36" fill={i % 2 === 0 ? '#0d1117' : '#0a0d12'}/>
        <circle cx="20" cy="18" r="12" fill={['#10b981', '#f59e0b', '#3b82f6'][i]} opacity="0.3"/>
        <text x="20" y="23" textAnchor="middle" fill={['#10b981', '#f59e0b', '#3b82f6'][i]} fontSize="13">{['A', 'C', 'M'][i]}</text>
        <text x="42" y="13" fill="#e6edf3" fontSize="10" fontWeight="600">{c.n}</text>
        <text x="42" y="26" fill="#8b949e" fontSize="9">{c.p}</text>
        <text x="198" y="22" fill="#e6edf3" fontSize="14">{c.t}</text>
      </g>
    ))}
  </svg>
);

export const IlluRelatorios = () => (
  <svg viewBox="0 0 320 180" fill="none" xmlns="http://www.w3.org/2000/svg" className="tu-illu">
    <rect width="320" height="180" rx="14" fill="#0d1117"/>
    <rect x="12" y="12" width="296" height="24" rx="6" fill="#161b22"/>
    {['7 dias', '30 dias', '3 meses'].map((t, i) => (
      <g key={i}>
        <rect x={20 + i * 72} y="16" width="64" height="16" rx="4" fill={i === 1 ? '#10b981' : 'transparent'}/>
        <text x={52 + i * 72} y="28" textAnchor="middle" fill={i === 1 ? '#fff' : '#8b949e'} fontSize="10">{t}</text>
      </g>
    ))}
    <rect x="224" y="16" width="76" height="16" rx="4" fill="#21262d"/>
    <text x="262" y="28" textAnchor="middle" fill="#8b949e" fontSize="9">⬇ Exportar CSV</text>
    {[{ v: '12.847', l: 'Mensagens', c: '#10b981' }, { v: '98.4%', l: 'Sucesso', c: '#3b82f6' }, { v: '4.2%', l: 'Respostas', c: '#a855f7' }].map((m, i) => (
      <g key={i} transform={`translate(${12 + i * 102},48)`}>
        <rect width="94" height="42" rx="6" fill="#161b22"/>
        <text x="47" y="18" textAnchor="middle" fill={m.c} fontSize="15" fontWeight="800">{m.v}</text>
        <text x="47" y="34" textAnchor="middle" fill="#8b949e" fontSize="9">{m.l}</text>
      </g>
    ))}
    <rect x="12" y="102" width="296" height="66" rx="8" fill="#161b22"/>
    <text x="24" y="118" fill="#8b949e" fontSize="9" fontWeight="600">MAPA DE CALOR — HORÁRIOS DE ENVIO</text>
    {Array.from({ length: 7 }, (_, d) =>
      Array.from({ length: 8 }, (_, h) => (
        <rect key={`${h}-${d}`} x={24 + d * 40} y={126 + h * 4.5} width="36" height="3.5" rx="1"
          fill="#10b981" opacity={0.25 + ((h + d) % 5) * 0.15}/>
      ))
    )}
  </svg>
);

export const IlluAquecimento = () => (
  <svg viewBox="0 0 320 180" fill="none" xmlns="http://www.w3.org/2000/svg" className="tu-illu">
    <rect width="320" height="180" rx="14" fill="#0d1117"/>
    <text x="160" y="30" textAnchor="middle" fill="#f59e0b" fontSize="13" fontWeight="700">Plano de Aquecimento</text>
    {[{ d: 'Dia 1-3', v: 20, c: '#10b981' }, { d: 'Dia 4-7', v: 50, c: '#3b82f6' }, { d: 'Sem. 2', v: 100, c: '#a855f7' }, { d: 'Sem. 3', v: 180, c: '#f59e0b' }, { d: 'Sem. 4+', v: 300, c: '#ef4444' }].map((s, i) => (
      <g key={i} transform={`translate(${20 + i * 58},40)`}>
        <rect x="4" y={110 - s.v * 0.36} width="48" height={s.v * 0.36} rx="4" fill={s.c} opacity="0.8"/>
        <text x="28" y={104 - s.v * 0.36} textAnchor="middle" fill={s.c} fontSize="10" fontWeight="700">{s.v}</text>
        <text x="28" y="128" textAnchor="middle" fill="#8b949e" fontSize="8">{s.d}</text>
      </g>
    ))}
    <text x="160" y="158" textAnchor="middle" fill="#8b949e" fontSize="9">msgs/dia — aumento gradual reduz risco de bloqueio</text>
  </svg>
);

export const IlluPools = () => (
  <svg viewBox="0 0 320 180" fill="none" xmlns="http://www.w3.org/2000/svg" className="tu-illu">
    <rect width="320" height="180" rx="14" fill="#0d1117"/>
    <rect x="110" y="12" width="100" height="36" rx="10" fill="#161b22" stroke="#10b981" strokeWidth="1.5"/>
    <text x="160" y="28" textAnchor="middle" fill="#10b981" fontSize="10" fontWeight="800">⚡ Pool Principal</text>
    <text x="160" y="42" textAnchor="middle" fill="#8b949e" fontSize="8">Rodízio igual</text>
    {[{ x: 20, y: 78, n: 'Chip 1', ok: true }, { x: 120, y: 78, n: 'Chip 2', ok: true }, { x: 220, y: 78, n: 'Chip 3', ok: false }].map((c, i) => (
      <g key={i}>
        <line x1={160} y1={48} x2={c.x + 40} y2={c.y} stroke="#8b949e" strokeWidth="1" strokeDasharray="3 2"/>
        <rect x={c.x} y={c.y} width="80" height="36" rx="8" fill="#161b22" stroke={c.ok ? '#10b981' : '#ef4444'} strokeWidth="1.2"/>
        <circle cx={c.x + 12} cy={c.y + 18} r="5" fill={c.ok ? '#10b981' : '#ef4444'}/>
        <text x={c.x + 40} y={c.y + 14} textAnchor="middle" fill="#e6edf3" fontSize="9" fontWeight="700">{c.n}</text>
        <text x={c.x + 40} y={c.y + 27} textAnchor="middle" fill={c.ok ? '#10b981' : '#ef4444'} fontSize="8">{c.ok ? 'Online' : 'Offline'}</text>
      </g>
    ))}
    <rect x="64" y="130" width="192" height="28" rx="8" fill="#1a2030" stroke="#3b82f6" strokeWidth="1"/>
    <text x="160" y="143" textAnchor="middle" fill="#3b82f6" fontSize="9" fontWeight="700">🔀 Chip 3 offline → Failover automático</text>
    <text x="160" y="154" textAnchor="middle" fill="#8b949e" fontSize="8">Chip 1 e Chip 2 assumem os envios</text>
  </svg>
);

export const IlluConfiguracoes = () => (
  <svg viewBox="0 0 320 180" fill="none" xmlns="http://www.w3.org/2000/svg" className="tu-illu">
    <rect width="320" height="180" rx="14" fill="#0d1117"/>
    {['Disparo', 'Aparência', 'Notificações', 'Conta', 'Termos'].map((t, i) => (
      <g key={i}>
        <rect x={12 + i * 58} y="12" width="50" height="24" rx="6"
          fill={i === 0 ? '#10b981' : '#161b22'} fillOpacity={i === 0 ? 0.2 : 1}
          stroke={i === 0 ? '#10b981' : 'transparent'}/>
        <text x={37 + i * 58} y="28" textAnchor="middle" fill={i === 0 ? '#10b981' : '#8b949e'} fontSize="8">{t}</text>
      </g>
    ))}
    <rect x="12" y="48" width="296" height="120" rx="8" fill="#161b22"/>
    {[{ l: 'Intervalo mínimo entre envios', v: '8s' }, { l: 'Intervalo máximo', v: '20s' }, { l: 'Limite diário por chip', v: '400' }, { l: 'Silêncio noturno', v: '22h–7h' }].map((r, i) => (
      <g key={i} transform={`translate(12,${56 + i * 28})`}>
        <text x="12" y="18" fill="#e6edf3" fontSize="10">{r.l}</text>
        <rect x="220" y="6" width="60" height="18" rx="5" fill="#21262d"/>
        <text x="250" y="19" textAnchor="middle" fill="#10b981" fontSize="10" fontWeight="700">{r.v}</text>
      </g>
    ))}
  </svg>
);

export const IlluFluxo = () => (
  <svg viewBox="0 0 320 180" fill="none" xmlns="http://www.w3.org/2000/svg" className="tu-illu">
    <rect width="320" height="180" rx="14" fill="#0d1117"/>
    <rect x="100" y="12" width="120" height="32" rx="8" fill="#0a3d1f" stroke="#10b981" strokeWidth="1.5"/>
    <text x="160" y="32" textAnchor="middle" fill="#10b981" fontSize="10" fontWeight="700">📤 Etapa 1: &quot;Olá!&quot;</text>
    <line x1="160" y1="44" x2="160" y2="68" stroke="#8b949e" strokeWidth="1.5" strokeDasharray="4 2"/>
    <rect x="100" y="68" width="120" height="32" rx="8" fill="#1e2d3f" stroke="#3b82f6" strokeWidth="1.5"/>
    <text x="160" y="88" textAnchor="middle" fill="#3b82f6" fontSize="10" fontWeight="700">💬 Aguarda resposta</text>
    <line x1="100" y1="84" x2="48" y2="84" stroke="#8b949e" strokeWidth="1.5"/>
    <line x1="48" y1="84" x2="48" y2="130" stroke="#8b949e" strokeWidth="1.5"/>
    <line x1="48" y1="130" x2="80" y2="130" stroke="#8b949e" strokeWidth="1.5"/>
    <rect x="80" y="114" width="80" height="32" rx="8" fill="#1f1a0a" stroke="#f59e0b" strokeWidth="1.5"/>
    <text x="120" y="134" textAnchor="middle" fill="#f59e0b" fontSize="9" fontWeight="700">Opção &quot;SIM&quot;</text>
    <line x1="220" y1="84" x2="272" y2="84" stroke="#8b949e" strokeWidth="1.5"/>
    <line x1="272" y1="84" x2="272" y2="130" stroke="#8b949e" strokeWidth="1.5"/>
    <line x1="272" y1="130" x2="240" y2="130" stroke="#8b949e" strokeWidth="1.5"/>
    <rect x="160" y="114" width="80" height="32" rx="8" fill="#1f100a" stroke="#ef4444" strokeWidth="1.5"/>
    <text x="200" y="134" textAnchor="middle" fill="#ef4444" fontSize="9" fontWeight="700">Opção &quot;NÃO&quot;</text>
    <text x="160" y="170" textAnchor="middle" fill="#8b949e" fontSize="9">Fluxo por resposta — automatiza o diálogo</text>
  </svg>
);

export const ILLUSTRATIONS: Record<string, React.FC> = {
  painel: IlluDashboard,
  conexoes: IlluConexoes,
  pools: IlluPools,
  'bate-papo': IlluChat,
  campanhas: IlluCampanhas,
  'fluxo-resposta': IlluFluxo,
  contatos: IlluContatos,
  relatorios: IlluRelatorios,
  aquecimento: IlluAquecimento,
  configuracoes: IlluConfiguracoes,
};
