import React, { useRef, useState, useCallback } from 'react';
import { pdf } from '@react-pdf/renderer';
import { ZapMassPDF } from './ZapMassPDF';

/* ─────────────────────────────────────────────────────────────
   ILUSTRAÇÕES SVG — uma por seção
   ───────────────────────────────────────────────────────────── */
const IlluDashboard = () => (
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
    {[40,65,50,80,60,90,75,95,70,85,100,88].map((h,i)=>(
      <rect key={i} x={24+i*22} y={158-h*0.5} width="14" height={h*0.5} rx="3"
        fill={i===11?"#10b981":"#1f6feb"} opacity={i===11?1:0.6}/>
    ))}
  </svg>
);

const IlluConexoes = () => (
  <svg viewBox="0 0 320 180" fill="none" xmlns="http://www.w3.org/2000/svg" className="tu-illu">
    <rect width="320" height="180" rx="14" fill="#0d1117"/>
    {[0,1,2].map(i=>(
      <g key={i} transform={`translate(12,${12+i*56})`}>
        <rect width="296" height="48" rx="8" fill="#161b22"/>
        <circle cx="28" cy="24" r="14" fill={i===0?"#0a3d1f":i===1?"#0a3d1f":"#3d1f0a"}/>
        <text x="28" y="29" textAnchor="middle" fill={i===2?"#f59e0b":"#10b981"} fontSize="16">
          {i===2?"📵":"📱"}
        </text>
        <rect x="56" y="10" width="120" height="8" rx="4" fill="#21262d"/>
        <rect x="56" y="24" width="80" height="6" rx="3" fill="#21262d"/>
        <circle cx="260" cy="24" r="8" fill={i<2?"#10b981":"#f59e0b"}/>
        <text x="260" y="28" textAnchor="middle" fill="#fff" fontSize="8" fontWeight="700">
          {i<2?"ON":"OFF"}
        </text>
      </g>
    ))}
    <rect x="12" y="168" width="80" height="0" rx="4" fill="#10b981"/>
  </svg>
);

const IlluChat = () => (
  <svg viewBox="0 0 320 180" fill="none" xmlns="http://www.w3.org/2000/svg" className="tu-illu">
    <rect width="320" height="180" rx="14" fill="#0d1117"/>
    <rect x="0" y="0" width="100" height="180" rx="14" fill="#161b22"/>
    {[0,1,2,3].map(i=>(
      <g key={i} transform={`translate(8,${12+i*40})`}>
        <circle cx="14" cy="14" r="12" fill={["#10b981","#3b82f6","#f59e0b","#a855f7"][i]} opacity="0.3"/>
        <rect x="32" y="6" width="50" height="7" rx="3" fill="#21262d"/>
        <rect x="32" y="18" width="38" height="5" rx="2" fill="#21262d" opacity="0.6"/>
        {i===0 && <circle cx="80" cy="7" r="7" fill="#10b981"/>}
        {i===0 && <text x="80" y="11" textAnchor="middle" fill="#fff" fontSize="8" fontWeight="800">3</text>}
      </g>
    ))}
    <rect x="104" y="0" width="216" height="180" rx="14" fill="#090e13"/>
    <rect x="112" y="140" width="200" height="32" rx="8" fill="#161b22"/>
    <rect x="120" y="148" width="140" height="16" rx="6" fill="#21262d"/>
    <rect x="280" y="148" width="24" height="16" rx="6" fill="#10b981"/>
    {[{x:130,y:80,w:120,out:false},{x:168,y:110,w:80,out:true}].map((b,i)=>(
      <rect key={i} x={b.x} y={b.y} width={b.w} height="24" rx="8"
        fill={b.out?"#0a3d1f":"#161b22"}/>
    ))}
  </svg>
);

const IlluCampanhas = () => (
  <svg viewBox="0 0 320 180" fill="none" xmlns="http://www.w3.org/2000/svg" className="tu-illu">
    <rect width="320" height="180" rx="14" fill="#0d1117"/>
    <rect x="12" y="12" width="296" height="40" rx="8" fill="#161b22"/>
    <text x="28" y="36" fill="#e6edf3" fontSize="13" fontWeight="700">Nova campanha — Broadcast Studio</text>
    <rect x="220" y="20" width="80" height="24" rx="6" fill="#10b981"/>
    <text x="260" y="36" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="700">▶ Disparar</text>
    {[{l:"1. Público",c:"#3b82f6"},{l:"2. Mensagem",c:"#10b981"},{l:"3. Canais",c:"#8b949e"},{l:"4. Revisão",c:"#8b949e"}].map((s,i)=>(
      <g key={i} transform={`translate(${12+i*76},64)`}>
        <rect width="68" height="40" rx="8" fill={i<2?"#161b22":"#0d1117"} stroke={s.c} strokeWidth={i===1?2:1} strokeOpacity={i<2?1:0.3}/>
        <circle cx="34" cy="14" r="8" fill={s.c} opacity={i<2?1:0.3}/>
        <text x="34" y="18" textAnchor="middle" fill="#fff" fontSize="9" fontWeight="800">{i+1}</text>
        <text x="34" y="34" textAnchor="middle" fill={s.c} fontSize="8" opacity={i<2?1:0.4}>{s.l.slice(3)}</text>
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

const IlluContatos = () => (
  <svg viewBox="0 0 320 180" fill="none" xmlns="http://www.w3.org/2000/svg" className="tu-illu">
    <rect width="320" height="180" rx="14" fill="#0d1117"/>
    <rect x="0" y="0" width="80" height="180" rx="14" fill="#161b22"/>
    {["Todos","Quentes","Mornos","Frios","Aniversário"].map((t,i)=>(
      <g key={i} transform={`translate(8,${16+i*32})`}>
        <rect width="64" height="24" rx="6" fill={i===0?"#10b981":"transparent"} fillOpacity="0.15"
          stroke={i===0?"#10b981":"transparent"}/>
        <text x="32" y="16" textAnchor="middle" fill={i===0?"#10b981":"#8b949e"} fontSize="10">{t}</text>
      </g>
    ))}
    <rect x="84" y="0" width="236" height="36" rx="0" fill="#161b22"/>
    <rect x="92" y="10" width="140" height="16" rx="6" fill="#21262d"/>
    <text x="104" y="22" fill="#8b949e" fontSize="9">🔍 Buscar contatos...</text>
    <rect x="248" y="10" width="64" height="16" rx="6" fill="#10b981"/>
    <text x="280" y="22" textAnchor="middle" fill="#fff" fontSize="9" fontWeight="700">+ Importar</text>
    {[{n:"Ana Silva",p:"47 9912-7001",t:"🔥"},{n:"Carlos Melo",p:"48 9876-5432",t:"🌡️"},{n:"Maria Oliveira",p:"11 91234-5678",t:"❄️"}].map((c,i)=>(
      <g key={i} transform={`translate(84,${44+i*44})`}>
        <rect width="236" height="36" fill={i%2===0?"#0d1117":"#0a0d12"}/>
        <circle cx="20" cy="18" r="12" fill={["#10b981","#f59e0b","#3b82f6"][i]} opacity="0.3"/>
        <text x="20" y="23" textAnchor="middle" fill={["#10b981","#f59e0b","#3b82f6"][i]} fontSize="13">{["A","C","M"][i]}</text>
        <text x="42" y="13" fill="#e6edf3" fontSize="10" fontWeight="600">{c.n}</text>
        <text x="42" y="26" fill="#8b949e" fontSize="9">{c.p}</text>
        <text x="198" y="22" fill="#e6edf3" fontSize="14">{c.t}</text>
      </g>
    ))}
  </svg>
);

const IlluRelatorios = () => (
  <svg viewBox="0 0 320 180" fill="none" xmlns="http://www.w3.org/2000/svg" className="tu-illu">
    <rect width="320" height="180" rx="14" fill="#0d1117"/>
    <rect x="12" y="12" width="296" height="24" rx="6" fill="#161b22"/>
    {["7 dias","30 dias","3 meses"].map((t,i)=>(
      <g key={i}>
        <rect x={20+i*72} y="16" width="64" height="16" rx="4" fill={i===1?"#10b981":"transparent"}/>
        <text x={52+i*72} y="28" textAnchor="middle" fill={i===1?"#fff":"#8b949e"} fontSize="10">{t}</text>
      </g>
    ))}
    <rect x="224" y="16" width="76" height="16" rx="4" fill="#21262d"/>
    <text x="262" y="28" textAnchor="middle" fill="#8b949e" fontSize="9">⬇ Exportar CSV</text>
    {[{v:"12.847",l:"Mensagens",c:"#10b981"},{v:"98.4%",l:"Sucesso",c:"#3b82f6"},{v:"4.2%",l:"Respostas",c:"#a855f7"}].map((m,i)=>(
      <g key={i} transform={`translate(${12+i*102},48)`}>
        <rect width="94" height="42" rx="6" fill="#161b22"/>
        <text x="47" y="18" textAnchor="middle" fill={m.c} fontSize="15" fontWeight="800">{m.v}</text>
        <text x="47" y="34" textAnchor="middle" fill="#8b949e" fontSize="9">{m.l}</text>
      </g>
    ))}
    <rect x="12" y="102" width="296" height="66" rx="8" fill="#161b22"/>
    <text x="24" y="118" fill="#8b949e" fontSize="9" fontWeight="600">MAPA DE CALOR — HORÁRIOS DE ENVIO</text>
    {Array.from({length:24},(_,h)=>Array.from({length:7},(_,d)=>{
      const v=Math.random();
      return <rect key={`${h}-${d}`} x={24+d*38} y={124+h*2} width="34" height="2" rx="1"
        fill="#10b981" opacity={v*0.8}/>;
    }))}
  </svg>
);

const IlluAquecimento = () => (
  <svg viewBox="0 0 320 180" fill="none" xmlns="http://www.w3.org/2000/svg" className="tu-illu">
    <rect width="320" height="180" rx="14" fill="#0d1117"/>
    <text x="160" y="30" textAnchor="middle" fill="#f59e0b" fontSize="13" fontWeight="700">Plano de Aquecimento</text>
    {[{d:"Dia 1-3",v:20,c:"#10b981"},{d:"Dia 4-7",v:50,c:"#3b82f6"},{d:"Sem. 2",v:100,c:"#a855f7"},{d:"Sem. 3",v:180,c:"#f59e0b"},{d:"Sem. 4+",v:300,c:"#ef4444"}].map((s,i)=>(
      <g key={i} transform={`translate(${20+i*58},40)`}>
        <rect x="4" y={110-s.v*0.36} width="48" height={s.v*0.36} rx="4" fill={s.c} opacity="0.8"/>
        <text x="28" y={104-s.v*0.36} textAnchor="middle" fill={s.c} fontSize="10" fontWeight="700">{s.v}</text>
        <text x="28" y="128" textAnchor="middle" fill="#8b949e" fontSize="8">{s.d}</text>
      </g>
    ))}
    <text x="160" y="158" textAnchor="middle" fill="#8b949e" fontSize="9">msgs/dia — aumento gradual reduz risco de bloqueio</text>
  </svg>
);

const IlluConfiguracoes = () => (
  <svg viewBox="0 0 320 180" fill="none" xmlns="http://www.w3.org/2000/svg" className="tu-illu">
    <rect width="320" height="180" rx="14" fill="#0d1117"/>
    {["Disparo","Aparência","Notificações","Minha conta","Termos"].map((t,i)=>(
      <rect key={i} x={12+i*58} y="12" width="50" height="24" rx="6"
        fill={i===0?"#10b981":"#161b22"} fillOpacity={i===0?0.2:1}
        stroke={i===0?"#10b981":"transparent"}/>
    ))}
    {["Disparo","Aparência","Notificações","Conta","Termos"].map((t,i)=>(
      <text key={i} x={37+i*58} y="28" textAnchor="middle" fill={i===0?"#10b981":"#8b949e"} fontSize="8">{t}</text>
    ))}
    <rect x="12" y="48" width="296" height="120" rx="8" fill="#161b22"/>
    {[{l:"Intervalo mínimo entre envios",v:"8s"},{l:"Intervalo máximo",v:"20s"},{l:"Limite diário por chip",v:"400"},{l:"Silêncio noturno",v:"22h–7h"}].map((r,i)=>(
      <g key={i} transform={`translate(12,${56+i*28})`}>
        <text x="12" y="18" fill="#e6edf3" fontSize="10">{r.l}</text>
        <rect x="220" y="6" width="60" height="18" rx="5" fill="#21262d"/>
        <text x="250" y="19" textAnchor="middle" fill="#10b981" fontSize="10" fontWeight="700">{r.v}</text>
      </g>
    ))}
    <rect x="224" y="152" width="76" height="10" rx="5" fill="#10b981"/>
    <text x="262" y="161" textAnchor="middle" fill="#fff" fontSize="9" fontWeight="700">Salvar</text>
  </svg>
);

const IlluFluxo = () => (
  <svg viewBox="0 0 320 180" fill="none" xmlns="http://www.w3.org/2000/svg" className="tu-illu">
    <rect width="320" height="180" rx="14" fill="#0d1117"/>
    <rect x="100" y="12" width="120" height="32" rx="8" fill="#0a3d1f" stroke="#10b981" strokeWidth="1.5"/>
    <text x="160" y="32" textAnchor="middle" fill="#10b981" fontSize="10" fontWeight="700">📤 Etapa 1: "Olá!"</text>
    <line x1="160" y1="44" x2="160" y2="68" stroke="#8b949e" strokeWidth="1.5" strokeDasharray="4 2"/>
    <rect x="100" y="68" width="120" height="32" rx="8" fill="#1e2d3f" stroke="#3b82f6" strokeWidth="1.5"/>
    <text x="160" y="88" textAnchor="middle" fill="#3b82f6" fontSize="10" fontWeight="700">💬 Aguarda resposta</text>
    <line x1="100" y1="84" x2="48" y2="84" stroke="#8b949e" strokeWidth="1.5"/>
    <line x1="48" y1="84" x2="48" y2="130" stroke="#8b949e" strokeWidth="1.5"/>
    <line x1="48" y1="130" x2="80" y2="130" stroke="#8b949e" strokeWidth="1.5"/>
    <rect x="80" y="114" width="80" height="32" rx="8" fill="#1f1a0a" stroke="#f59e0b" strokeWidth="1.5"/>
    <text x="120" y="134" textAnchor="middle" fill="#f59e0b" fontSize="9" fontWeight="700">Opção "SIM"</text>
    <line x1="220" y1="84" x2="272" y2="84" stroke="#8b949e" strokeWidth="1.5"/>
    <line x1="272" y1="84" x2="272" y2="130" stroke="#8b949e" strokeWidth="1.5"/>
    <line x1="272" y1="130" x2="240" y2="130" stroke="#8b949e" strokeWidth="1.5"/>
    <rect x="160" y="114" width="80" height="32" rx="8" fill="#1f100a" stroke="#ef4444" strokeWidth="1.5"/>
    <text x="200" y="134" textAnchor="middle" fill="#ef4444" fontSize="9" fontWeight="700">Opção "NÃO"</text>
    <text x="160" y="170" textAnchor="middle" fill="#8b949e" fontSize="9">Fluxo por resposta — automatiza o diálogo</text>
  </svg>
);

/* ─────────────────────────────────────────────────────────────
   SEÇÕES DO TUTORIAL
   ───────────────────────────────────────────────────────────── */
const sections = [
  {
    id: 'visao-geral',
    icon: '🚀',
    title: 'O que é o ZapMass',
    color: '#10b981',
    illu: null,
    content: [
      {
        type: 'intro',
        text: 'O ZapMass é uma plataforma web completa para gestão de mensagens no WhatsApp. Com ele você organiza contatos, conecta chips (números), dispara mensagens em massa com segurança e acompanha os resultados — tudo em um só lugar.',
      },
      {
        type: 'grid',
        items: [
          { icon: '📱', title: 'Múltiplos chips', desc: 'Conecte vários números WhatsApp e distribua envios entre eles' },
          { icon: '👥', title: 'Gestão de contatos', desc: 'Base organizada com filtros, listas, importação e temperatura' },
          { icon: '📣', title: 'Campanhas', desc: 'Disparos em massa, agendamento e fluxo por respostas' },
          { icon: '📊', title: 'Relatórios', desc: 'Métricas detalhadas, mapa de calor e exportação CSV' },
          { icon: '🛡️', title: 'Anti-bloqueio', desc: 'Intervalos automáticos, aquecimento de chips e limites diários' },
          { icon: '👨‍💼', title: 'Equipe', desc: 'Adicione funcionários com acesso controlado' },
        ],
      },
    ],
  },
  {
    id: 'painel',
    icon: '📊',
    title: 'Painel (Dashboard)',
    color: '#3b82f6',
    illu: <IlluDashboard />,
    content: [
      { type: 'text', text: 'O Painel é a primeira tela após o login. Ele mostra um resumo rápido de tudo que está acontecendo na sua conta em tempo real.' },
      {
        type: 'list',
        title: 'O que você encontra no Painel:',
        items: [
          { icon: '📈', text: 'Envios do dia, chips online e taxa de sucesso em cartões de destaque' },
          { icon: '📅', text: 'Gráfico de envios por dia dos últimos dias' },
          { icon: '🎂', text: 'Lista de contatos aniversariantes — com opção de mandar mensagem direto' },
          { icon: '⚡', text: 'Atalhos rápidos para Conexões, Campanhas e Contatos' },
          { icon: '🔔', text: 'Alertas importantes do sistema (chips offline, campanhas concluídas)' },
        ],
      },
      { type: 'tip', text: 'Dica: comece sempre pelo Painel para ver se seus chips estão online antes de disparar uma campanha.' },
    ],
  },
  {
    id: 'conexoes',
    icon: '📱',
    title: 'Conexões (Chips WhatsApp)',
    color: '#10b981',
    illu: <IlluConexoes />,
    content: [
      { type: 'text', text: 'Conexões são os números de WhatsApp conectados ao ZapMass. Cada "chip" é um número que pode enviar mensagens. Quanto mais chips, maior a capacidade de envio.' },
      {
        type: 'steps',
        title: 'Como adicionar um chip:',
        items: [
          'Clique em "Nova conexão" no canto superior direito',
          'Dê um nome ao chip (ex.: "Chip Marketing 1")',
          'Abra o WhatsApp no celular → Configurações → Aparelhos conectados',
          'Escaneie o QR Code que aparecer na tela',
          'Aguarde o status ficar "Online" (ponto verde)',
        ],
      },
      {
        type: 'list',
        title: 'Status dos chips:',
        items: [
          { icon: '🟢', text: 'Online — chip conectado e pronto para enviar' },
          { icon: '🟡', text: 'Conectando — aguardando sincronização com o WhatsApp' },
          { icon: '🔴', text: 'Offline — chip desconectado, precisa reconectar com QR Code' },
          { icon: '⚠️', text: 'Banido — número bloqueado pelo WhatsApp (veja Aquecimento)' },
        ],
      },
      { type: 'tip', text: 'Boas práticas: nunca use chip novo para disparos em massa imediatamente. Faça o aquecimento por pelo menos 2 semanas.' },
    ],
  },
  {
    id: 'bate-papo',
    icon: '💬',
    title: 'Bate-papo (Chat)',
    color: '#a855f7',
    illu: <IlluChat />,
    content: [
      { type: 'text', text: 'A aba de Bate-papo funciona como um WhatsApp Web dentro do ZapMass. Você vê todas as conversas dos seus chips organizadas em uma só interface.' },
      {
        type: 'list',
        title: 'Recursos do Bate-papo:',
        items: [
          { icon: '📋', text: 'Lista de conversas à esquerda com busca e filtros (não lidas, por canal)' },
          { icon: '💬', text: 'Painel de mensagens com histórico completo da conversa' },
          { icon: '🤖', text: 'Atendimento automático — robô responde enquanto você não está' },
          { icon: '📎', text: 'Envio de imagens, áudios, documentos e vídeos' },
          { icon: '✨', text: 'Sugestões de resposta com Inteligência Artificial' },
          { icon: '👥', text: 'Atribuição de atendimento para membros da equipe' },
        ],
      },
      { type: 'tip', text: 'Use o Bate-papo para acompanhar respostas de campanhas e fazer atendimento manual quando necessário.' },
    ],
  },
  {
    id: 'campanhas',
    icon: '📣',
    title: 'Campanhas',
    color: '#f59e0b',
    illu: <IlluCampanhas />,
    content: [
      { type: 'text', text: 'Campanhas é o coração do ZapMass. Aqui você cria e gerencia disparos em massa, programados ou por fluxo de respostas.' },
      {
        type: 'steps',
        title: 'Criando uma campanha em 4 passos:',
        items: [
          '1️⃣ Público — Escolha quem vai receber (lista, filtro por cidade/tag, números manuais)',
          '2️⃣ Mensagem — Escreva o texto, adicione variáveis {nome} {horario} e anexos',
          '3️⃣ Canais — Selecione os chips e configure o intervalo anti-ban',
          '4️⃣ Revisão — Confira tudo e clique em "Disparar agora" ou agende',
        ],
      },
      {
        type: 'grid',
        items: [
          { icon: '📢', title: 'Disparo único', desc: 'Uma mensagem para cada contato — ideal para avisos e promoções' },
          { icon: '🔀', title: 'Fluxo por resposta', desc: 'Sistema aguarda a resposta do contato para enviar a próxima mensagem' },
          { icon: '📅', title: 'Agendamento', desc: 'Programe o disparo para qualquer data e hora futura' },
          { icon: '🎲', title: 'Variáveis', desc: 'Personalize com {nome}, {cidade}, {horario} e spintax {Olá|Oi|Ei}' },
        ],
      },
      { type: 'tip', text: 'Use o Spintax para variar o início das mensagens: {Olá|Oi|Bom dia} — isso reduz o risco de bloqueio.' },
    ],
  },
  {
    id: 'fluxo-resposta',
    icon: '🔀',
    title: 'Fluxo por Resposta',
    color: '#3b82f6',
    illu: <IlluFluxo />,
    content: [
      { type: 'text', text: 'O Fluxo por Resposta é um recurso avançado que cria um diálogo automatizado. O sistema aguarda o contato responder antes de enviar a próxima mensagem.' },
      {
        type: 'list',
        title: 'Como funciona:',
        items: [
          { icon: '1️⃣', text: 'Você envia a mensagem inicial da campanha para todos os contatos' },
          { icon: '💬', text: 'O contato responde (qualquer texto, ou uma palavra-chave específica)' },
          { icon: '🤖', text: 'O sistema reconhece a resposta e envia automaticamente a próxima mensagem' },
          { icon: '🔀', text: 'Com múltiplas opções, cada resposta pode levar a um caminho diferente' },
          { icon: '🛑', text: 'Palavras como "sair" ou "parar" encerram o fluxo automaticamente' },
        ],
      },
      { type: 'tip', text: 'O sistema reconhece palavras mesmo com erros de acentuação, maiúsculas/minúsculas e variações — "SAIR", "Sair", "saír" são todos reconhecidos.' },
    ],
  },
  {
    id: 'contatos',
    icon: '👥',
    title: 'Contatos',
    color: '#10b981',
    illu: <IlluContatos />,
    content: [
      { type: 'text', text: 'A aba Contatos é sua base de dados de clientes. Importe, organize, filtre e gerencie todos os seus contatos em um só lugar.' },
      {
        type: 'list',
        title: 'Funcionalidades principais:',
        items: [
          { icon: '📥', text: 'Importar via CSV/Excel, vCard ou colar texto diretamente' },
          { icon: '🔥', text: 'Temperatura: Quente (engajado), Morno (moderado), Frio (inativo)' },
          { icon: '📋', text: 'Listas: organize contatos em grupos para disparos segmentados' },
          { icon: '🏷️', text: 'Tags: marque contatos com categorias personalizadas' },
          { icon: '🗺️', text: 'Mapa: visualize contatos geograficamente por DDD/cidade' },
          { icon: '🔍', text: 'Filtros avançados: aniversário, cidade, tag, temperatura, opt-out' },
        ],
      },
      {
        type: 'steps',
        title: 'Como importar contatos:',
        items: [
          'Clique em "Importar" no canto superior',
          'Escolha o formato: CSV, Excel ou colar texto',
          'Baixe o modelo para ver o formato correto das colunas',
          'Preencha com nome, telefone e dados opcionais',
          'Faça o upload e confirme a importação',
        ],
      },
    ],
  },
  {
    id: 'relatorios',
    icon: '📈',
    title: 'Relatórios',
    color: '#a855f7',
    illu: <IlluRelatorios />,
    content: [
      { type: 'text', text: 'A aba Relatórios mostra o desempenho das suas campanhas com gráficos, métricas e exportação de dados.' },
      {
        type: 'list',
        title: 'O que você encontra nos Relatórios:',
        items: [
          { icon: '📊', text: 'Total de mensagens enviadas, sucessos e falhas no período' },
          { icon: '📈', text: 'Taxa de entrega, abertura e resposta quando disponível' },
          { icon: '🗓️', text: 'Filtros por período: 7 dias, 30 dias ou 3 meses' },
          { icon: '🌡️', text: 'Mapa de calor: veja em quais horários e dias você mais envia' },
          { icon: '⬇️', text: 'Exportar CSV: baixe planilha completa para Excel ou Google Sheets' },
          { icon: '📋', text: 'Log detalhado por campanha com status de cada envio' },
        ],
      },
      { type: 'tip', text: 'Use o mapa de calor para descobrir os melhores horários de engajamento do seu público e agendar campanhas nesse intervalo.' },
    ],
  },
  {
    id: 'aquecimento',
    icon: '🔥',
    title: 'Aquecimento (Warmup)',
    color: '#f59e0b',
    illu: <IlluAquecimento />,
    content: [
      { type: 'text', text: 'O Aquecimento é essencial para chips novos. Ele "educa" o número enviando mensagens gradualmente, reduzindo o risco de bloqueio pelo WhatsApp.' },
      {
        type: 'steps',
        title: 'Plano de aquecimento recomendado:',
        items: [
          'Dias 1-3: até 20 mensagens por dia (conversas normais)',
          'Dias 4-7: até 50 mensagens por dia',
          'Semana 2: até 100 mensagens por dia',
          'Semana 3: até 200 mensagens por dia',
          'Semana 4+: até 300 mensagens por dia (máximo seguro)',
        ],
      },
      {
        type: 'list',
        title: 'Regras de ouro:',
        items: [
          { icon: '✅', text: 'Sempre aqueça chips novos por pelo menos 2 semanas antes de disparos em massa' },
          { icon: '✅', text: 'Use intervalos de no mínimo 8-15 segundos entre mensagens' },
          { icon: '❌', text: 'Nunca dispare para listas frias (sem opt-in) com chip novo' },
          { icon: '❌', text: 'Nunca ultrapassar 300 mensagens/dia por chip, mesmo aquecido' },
        ],
      },
    ],
  },
  {
    id: 'configuracoes',
    icon: '⚙️',
    title: 'Configurações',
    color: '#8b949e',
    illu: <IlluConfiguracoes />,
    content: [
      { type: 'text', text: 'As Configurações permitem personalizar o comportamento do sistema, definir limites de envio, notificações e aparência.' },
      {
        type: 'grid',
        items: [
          { icon: '⏱️', title: 'Disparo', desc: 'Intervalo mínimo/máximo entre mensagens, limite diário e modo silêncio noturno' },
          { icon: '🎨', title: 'Aparência', desc: 'Escolha entre tema claro ou escuro e cor de destaque' },
          { icon: '🔔', title: 'Notificações', desc: 'E-mail de alertas e URL de webhook para integrações' },
          { icon: '👤', title: 'Minha conta', desc: 'Dados do perfil, senha e informações do plano' },
          { icon: '📄', title: 'Termos', desc: 'LGPD, política do WhatsApp e aceite de responsabilidade' },
        ],
      },
      { type: 'tip', text: 'Configure o intervalo mínimo entre 8-15 segundos para reduzir riscos. Intervalos muito curtos aumentam a chance de bloqueio.' },
    ],
  },
  {
    id: 'boas-praticas',
    icon: '✅',
    title: 'Boas Práticas',
    color: '#10b981',
    illu: null,
    content: [
      { type: 'text', text: 'Seguir estas práticas garante maior entregabilidade e protege seus chips de bloqueio pelo WhatsApp.' },
      {
        type: 'checklist',
        title: 'Antes de cada campanha:',
        items: [
          'Verificar se os chips estão Online no painel Conexões',
          'Confirmar que a lista de contatos tem opt-in (autorização para receber)',
          'Personalizar a mensagem com {nome} e spintax para evitar cópias idênticas',
          'Definir intervalo mínimo de 8s entre mensagens nas Configurações',
          'Fazer um disparo de teste para 2-3 contatos antes do envio em massa',
          'Revisar todas as informações na tela de Revisão antes de confirmar',
        ],
      },
      {
        type: 'checklist',
        title: 'Para manter chips saudáveis:',
        items: [
          'Nunca ultrapassar 300 mensagens/dia por chip',
          'Sempre aquecer chips novos por 2+ semanas',
          'Não enviar para listas desatualizadas ou compradas',
          'Monitorar taxa de bloqueio nas métricas de saúde dos chips',
          'Pausar imediatamente campanhas com alta taxa de erro',
        ],
      },
    ],
  },
];

/* ─────────────────────────────────────────────────────────────
   CSS PARA IMPRESSÃO (PDF)
   ───────────────────────────────────────────────────────────── */
const PrintStyles = () => (
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
    @media (min-width: 640px) { .tu-inner-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; align-items: start; } }
  `}</style>
);

/* ─────────────────────────────────────────────────────────────
   COMPONENTE PRINCIPAL
   ───────────────────────────────────────────────────────────── */
export const TutorialPage: React.FC = () => {
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);

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
      <PrintStyles />
      <div className="tu-root" style={{ minHeight: '100vh', background: 'var(--bg, #09090b)', color: 'var(--text, #f0f2f8)', fontFamily: 'system-ui, sans-serif' }} ref={topRef}>

        {/* Header */}
        <div className="tu-header" style={{ background: 'linear-gradient(135deg, #0a3d1f 0%, #0d1117 50%, #1a1033 100%)', padding: '40px 24px 32px', textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📱</div>
          <h1 style={{ fontSize: 32, fontWeight: 900, margin: 0, letterSpacing: '-0.03em', color: '#fff' }}>
            ZapMass — Guia Completo
          </h1>
          <p style={{ color: '#8b949e', marginTop: 10, fontSize: 16, maxWidth: 500, margin: '10px auto 0' }}>
            Aprenda a usar cada área da plataforma, passo a passo
          </p>
          <button
            onClick={handleDownload}
            className="tu-download-btn tu-no-print"
            style={{ marginTop: 24, padding: '12px 28px', background: downloading ? '#059669' : '#10b981', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: downloading ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, boxShadow: '0 4px 20px rgba(16,185,129,0.4)', transition: 'all 0.2s', opacity: downloading ? 0.8 : 1 }}
          >
            {downloading ? '⏳ Gerando PDF...' : '⬇️ Baixar como PDF'}
          </button>
          <p className="tu-no-print" style={{ color: '#8b949e', fontSize: 12, marginTop: 8 }}>
            PDF profissional de 12 páginas — com capa, sumário e ilustrações
          </p>
        </div>

        <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 16px 60px' }}>

          {/* Índice */}
          <div className="tu-toc tu-no-print" style={{ background: 'var(--card, #161b22)', borderRadius: 12, padding: '20px 24px', margin: '24px 0', border: '1px solid rgba(255,255,255,0.08)' }}>
            <p style={{ margin: '0 0 12px', fontWeight: 700, color: '#e6edf3', fontSize: 14 }}>📑 Índice rápido</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {sections.map(s => (
                <button
                  key={s.id}
                  onClick={() => scrollTo(s.id)}
                  style={{ padding: '6px 14px', borderRadius: 20, border: `1px solid ${s.color}40`, background: `${s.color}10`, color: s.color, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                >
                  {s.icon} {s.title}
                </button>
              ))}
            </div>
          </div>

          {/* Seções */}
          {sections.map((sec) => (
            <div key={sec.id} id={`section-${sec.id}`} className="tu-section" style={{ marginBottom: 40 }}>
              {/* Header da seção */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: `${sec.color}20`, border: `2px solid ${sec.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>
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
                {sec.illu && (
                  <div style={{ marginBottom: 20 }}>
                    {sec.illu}
                  </div>
                )}

                {sec.content.map((block, bi) => {
                  if (block.type === 'intro' || block.type === 'text') {
                    return (
                      <p key={bi} className="tu-section-text" style={{ color: '#c9d1d9', fontSize: 15, lineHeight: 1.7, margin: '0 0 16px' }}>
                        {block.text}
                      </p>
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
                  if (block.type === 'list' && block.items) {
                    return (
                      <div key={bi} style={{ margin: '16px 0' }}>
                        {block.title && <p style={{ margin: '0 0 10px', fontWeight: 700, color: '#e6edf3', fontSize: 14 }}>{block.title}</p>}
                        {(block.items as {icon: string; text: string}[]).map((item, ii) => (
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
                        {(block.items as string[]).map((item, ii) => (
                          <div key={ii} className="tu-step">
                            <div className="tu-step-num" style={{ background: sec.color }}>{ii + 1}</div>
                            <span className="tu-step-text" style={{ color: '#c9d1d9', fontSize: 14, lineHeight: 1.6, paddingTop: 4 }}>{item.replace(/^\d️⃣\s*/, '')}</span>
                          </div>
                        ))}
                      </div>
                    );
                  }
                  if (block.type === 'grid' && block.items) {
                    return (
                      <div key={bi} className="tu-grid">
                        {(block.items as {icon: string; title: string; desc: string}[]).map((item, ii) => (
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
                        {(block.items as string[]).map((item, ii) => (
                          <div key={ii} className="tu-checklist-item">
                            <span style={{ color: '#10b981', fontSize: 16, flexShrink: 0 }}>☑</span>
                            <span style={{ color: '#c9d1d9', fontSize: 14 }}>{item}</span>
                          </div>
                        ))}
                      </div>
                    );
                  }
                  return null;
                })}
              </div>
            </div>
          ))}

          {/* Rodapé */}
          <div style={{ textAlign: 'center', padding: '32px 0', borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: 20 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🚀</div>
            <p style={{ color: '#8b949e', fontSize: 14, margin: 0 }}>
              ZapMass — Plataforma de Gestão de WhatsApp
            </p>
            <p style={{ color: '#6e7681', fontSize: 12, marginTop: 6 }}>
              Para dúvidas, use o suporte dentro da plataforma
            </p>
            <button
              onClick={handleDownload}
              className="tu-download-btn tu-no-print"
              style={{ marginTop: 20, padding: '10px 24px', background: downloading ? '#059669' : '#10b981', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: downloading ? 'wait' : 'pointer', opacity: downloading ? 0.8 : 1 }}
            >
              {downloading ? '⏳ Gerando...' : '⬇️ Baixar este guia em PDF'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
