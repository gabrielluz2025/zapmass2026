import React from 'react';
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
} from '@react-pdf/renderer';

/* ─── Paleta ─────────────────────────────────────────────────── */
const C = {
  green:      '#10b981',
  greenDark:  '#059669',
  greenLight: '#d1fae5',
  blue:       '#3b82f6',
  purple:     '#8b5cf6',
  amber:      '#f59e0b',
  red:        '#ef4444',
  bg:         '#09090b',
  card:       '#111827',
  border:     '#1f2937',
  text:       '#f9fafb',
  muted:      '#9ca3af',
  white:      '#ffffff',
  coverGrad1: '#052e16',
  coverGrad2: '#0a0a0f',
  sectionBg:  '#f8fafc',
  bodyText:   '#1e293b',
  bodyMuted:  '#64748b',
  bodyHead:   '#0f172a',
};

/* ─── Estilos globais ─────────────────────────────────────────── */
const s = StyleSheet.create({
  /* ── Layout ── */
  page: {
    backgroundColor: C.white,
    paddingTop: 54,
    paddingBottom: 54,
    paddingHorizontal: 52,
    fontFamily: 'Helvetica',
  },
  coverPage: {
    backgroundColor: C.coverGrad1,
    padding: 0,
    position: 'relative',
  },

  /* ── Capa ── */
  coverBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 60,
  },
  coverBadge: {
    backgroundColor: C.green,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 6,
    marginBottom: 28,
  },
  coverBadgeText: {
    color: C.white,
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 2,
  },
  coverTitle: {
    color: C.white,
    fontSize: 36,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'center',
    lineHeight: 1.2,
    marginBottom: 12,
  },
  coverSubtitle: {
    color: C.green,
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 40,
  },
  coverDivider: {
    width: 60,
    height: 3,
    backgroundColor: C.green,
    marginBottom: 40,
    borderRadius: 2,
  },
  coverDesc: {
    color: '#a7f3d0',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 1.7,
    maxWidth: 360,
  },
  coverFooter: {
    backgroundColor: C.coverGrad2,
    padding: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
  },
  coverFooterText: {
    color: C.muted,
    fontSize: 10,
  },
  coverYear: {
    color: C.green,
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
  },

  /* ── Cabeçalho de página ── */
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 28,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  headerLogo: {
    color: C.green,
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 1,
  },
  headerSection: {
    color: C.bodyMuted,
    fontSize: 9,
    letterSpacing: 0.5,
  },

  /* ── Rodapé de página ── */
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 52,
    right: 52,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  footerText: {
    color: C.bodyMuted,
    fontSize: 8,
  },
  footerPage: {
    color: C.bodyMuted,
    fontSize: 8,
  },

  /* ── Índice ── */
  tocTitle: {
    fontSize: 26,
    fontFamily: 'Helvetica-Bold',
    color: C.bodyHead,
    marginBottom: 6,
  },
  tocSubtitle: {
    fontSize: 13,
    color: C.bodyMuted,
    marginBottom: 32,
  },
  tocItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  tocLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  tocIcon: {
    width: 28,
    height: 28,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  tocIconText: {
    fontSize: 14,
  },
  tocLabel: {
    fontSize: 12,
    color: C.bodyHead,
    fontFamily: 'Helvetica-Bold',
  },
  tocDots: {
    flex: 1,
    borderBottomWidth: 1,
    borderBottomStyle: 'dotted',
    borderBottomColor: '#cbd5e1',
    marginHorizontal: 8,
    marginBottom: 3,
  },
  tocPage: {
    fontSize: 11,
    color: C.bodyMuted,
    fontFamily: 'Helvetica-Bold',
  },

  /* ── Seção: hero pill ── */
  sectionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    gap: 10,
  },
  pillBox: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pillIcon: { fontSize: 16 },
  pillText: {
    color: C.white,
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 1,
  },
  sectionNum: {
    color: C.bodyMuted,
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 1,
  },

  /* ── Seção: títulos ── */
  h1: {
    fontSize: 28,
    fontFamily: 'Helvetica-Bold',
    color: C.bodyHead,
    marginBottom: 6,
    lineHeight: 1.2,
  },
  h2: {
    fontSize: 15,
    fontFamily: 'Helvetica-Bold',
    color: C.bodyHead,
    marginTop: 18,
    marginBottom: 8,
  },
  h3: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    color: C.bodyHead,
    marginBottom: 6,
    marginTop: 12,
  },
  accent: {
    width: 40,
    height: 3,
    borderRadius: 2,
    marginBottom: 20,
  },
  lead: {
    fontSize: 13,
    color: C.bodyMuted,
    lineHeight: 1.65,
    marginBottom: 20,
  },
  body: {
    fontSize: 11,
    color: C.bodyText,
    lineHeight: 1.7,
    marginBottom: 10,
  },

  /* ── Cards ── */
  cardRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
    flexWrap: 'wrap',
  },
  card: {
    flex: 1,
    minWidth: 100,
    backgroundColor: C.sectionBg,
    borderRadius: 10,
    padding: 14,
    borderLeftWidth: 3,
  },
  cardIcon: { fontSize: 18, marginBottom: 6 },
  cardTitle: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: C.bodyHead,
    marginBottom: 4,
  },
  cardDesc: {
    fontSize: 9,
    color: C.bodyMuted,
    lineHeight: 1.5,
  },

  /* ── Lista ── */
  listItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
    gap: 8,
  },
  listIcon: { fontSize: 13, marginTop: 1, minWidth: 18 },
  listText: {
    fontSize: 11,
    color: C.bodyText,
    flex: 1,
    lineHeight: 1.6,
  },
  listBold: {
    fontFamily: 'Helvetica-Bold',
    color: C.bodyHead,
  },

  /* ── Checklist ── */
  checkItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    gap: 10,
  },
  checkBox: {
    width: 16,
    height: 16,
    borderRadius: 4,
    backgroundColor: C.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: { color: C.white, fontSize: 9, fontFamily: 'Helvetica-Bold' },
  checkText: { fontSize: 11, color: C.bodyText, flex: 1, lineHeight: 1.5 },

  /* ── Steps ── */
  stepItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
    gap: 10,
  },
  stepCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  stepNum: { color: C.white, fontSize: 10, fontFamily: 'Helvetica-Bold' },
  stepText: { fontSize: 11, color: C.bodyText, flex: 1, lineHeight: 1.6, paddingTop: 4 },

  /* ── Tip ── */
  tip: {
    backgroundColor: '#f0fdf4',
    borderLeftWidth: 4,
    borderLeftColor: C.green,
    borderRadius: 8,
    padding: 14,
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  tipIcon: { fontSize: 13, marginTop: 1 },
  tipLabel: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: C.greenDark,
    marginBottom: 2,
  },
  tipText: { fontSize: 10, color: '#166534', lineHeight: 1.6 },

  /* ── Warning ── */
  warn: {
    backgroundColor: '#fffbeb',
    borderLeftWidth: 4,
    borderLeftColor: C.amber,
    borderRadius: 8,
    padding: 14,
    marginTop: 12,
  },
  warnText: { fontSize: 10, color: '#92400e', lineHeight: 1.6 },

  /* ── Tabela ── */
  table: { marginBottom: 12, borderRadius: 8, overflow: 'hidden' },
  tableHead: {
    flexDirection: 'row',
    backgroundColor: C.bodyHead,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  tableHeadCell: {
    flex: 1,
    color: C.white,
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 0.5,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  tableRowAlt: { backgroundColor: C.sectionBg },
  tableCell: { flex: 1, fontSize: 10, color: C.bodyText, lineHeight: 1.5 },

  /* ── Hero bloco ── */
  heroBlock: {
    backgroundColor: C.sectionBg,
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
});

/* ─── Helpers ─────────────────────────────────────────────────── */
const Header = ({ section }: { section: string }) => (
  <View style={s.header} fixed>
    <Text style={s.headerLogo}>⚡ ZapMass</Text>
    <Text style={s.headerSection}>{section.toUpperCase()}</Text>
  </View>
);

const Footer = ({ pageNum }: { pageNum: string }) => (
  <View style={s.footer} fixed>
    <Text style={s.footerText}>ZapMass — Guia Completo do Usuário</Text>
    <Text style={s.footerPage}>{pageNum}</Text>
  </View>
);

const Accent = ({ color }: { color: string }) => (
  <View style={[s.accent, { backgroundColor: color }]} />
);

const Tip = ({ text }: { text: string }) => (
  <View style={s.tip}>
    <Text style={s.tipIcon}>💡</Text>
    <View style={{ flex: 1 }}>
      <Text style={s.tipLabel}>DICA</Text>
      <Text style={s.tipText}>{text}</Text>
    </View>
  </View>
);

const Warn = ({ text }: { text: string }) => (
  <View style={s.warn}>
    <Text style={s.warnText}>⚠️  {text}</Text>
  </View>
);

const Li = ({ icon, bold, text }: { icon: string; bold?: string; text: string }) => (
  <View style={s.listItem}>
    <Text style={s.listIcon}>{icon}</Text>
    <Text style={s.listText}>
      {bold ? <Text style={s.listBold}>{bold} </Text> : null}
      {text}
    </Text>
  </View>
);

const Step = ({ num, text, color }: { num: number; text: string; color: string }) => (
  <View style={s.stepItem}>
    <View style={[s.stepCircle, { backgroundColor: color }]}>
      <Text style={s.stepNum}>{num}</Text>
    </View>
    <Text style={s.stepText}>{text}</Text>
  </View>
);

const Check = ({ text }: { text: string }) => (
  <View style={s.checkItem}>
    <View style={s.checkBox}><Text style={s.checkMark}>✓</Text></View>
    <Text style={s.checkText}>{text}</Text>
  </View>
);

const SectionPill = ({ icon, label, num, color }: { icon: string; label: string; num: string; color: string }) => (
  <View style={s.sectionPill}>
    <View style={[s.pillBox, { backgroundColor: color }]}>
      <Text style={s.pillIcon}>{icon}</Text>
      <Text style={s.pillText}>{label.toUpperCase()}</Text>
    </View>
    <Text style={s.sectionNum}>SEÇÃO {num}</Text>
  </View>
);

/* ─── CAPA ───────────────────────────────────────────────────── */
const CoverPage = () => (
  <Page size="A4" style={s.coverPage}>
    {/* Faixa verde topo */}
    <View style={{ backgroundColor: C.green, height: 6 }} />

    {/* Corpo central */}
    <View style={s.coverBody}>
      <View style={s.coverBadge}>
        <Text style={s.coverBadgeText}>GUIA OFICIAL DO USUÁRIO</Text>
      </View>

      <Text style={s.coverTitle}>ZapMass</Text>
      <Text style={s.coverSubtitle}>Plataforma de Gestão de WhatsApp</Text>

      <View style={s.coverDivider} />

      <Text style={s.coverDesc}>
        Tutorial completo cobrindo todas as funcionalidades da plataforma:{'\n'}
        Conexões, Campanhas, Bate-papo, Contatos, Relatórios, Aquecimento e muito mais.
      </Text>

      {/* Grade de features */}
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 40, flexWrap: 'wrap', justifyContent: 'center' }}>
        {[
          { icon: '📱', t: 'Conexões' },
          { icon: '📣', t: 'Campanhas' },
          { icon: '💬', t: 'Bate-papo' },
          { icon: '👥', t: 'Contatos' },
          { icon: '📈', t: 'Relatórios' },
          { icon: '🔥', t: 'Aquecimento' },
        ].map((f) => (
          <View key={f.t} style={{ alignItems: 'center', width: 70 }}>
            <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: 'rgba(16,185,129,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: 6, borderWidth: 1, borderColor: 'rgba(16,185,129,0.3)' }}>
              <Text style={{ fontSize: 20 }}>{f.icon}</Text>
            </View>
            <Text style={{ color: '#a7f3d0', fontSize: 9 }}>{f.t}</Text>
          </View>
        ))}
      </View>
    </View>

    {/* Rodapé da capa */}
    <View style={s.coverFooter}>
      <Text style={s.coverFooterText}>zap-mass.com</Text>
      <Text style={s.coverFooterText}>Versão 2026</Text>
      <Text style={s.coverYear}>© 2026 ZapMass</Text>
    </View>
  </Page>
);

/* ─── SUMÁRIO ────────────────────────────────────────────────── */
const TOCPage = () => {
  const items = [
    { icon: '📊', label: 'Painel (Dashboard)',       page: '3',  color: C.blue },
    { icon: '📱', label: 'Conexões (Chips)',          page: '4',  color: C.green },
    { icon: '💬', label: 'Bate-papo (Chat)',          page: '5',  color: C.purple },
    { icon: '📣', label: 'Campanhas',                 page: '6',  color: C.amber },
    { icon: '🔀', label: 'Fluxo por Resposta',        page: '7',  color: C.blue },
    { icon: '👥', label: 'Contatos',                  page: '8',  color: C.green },
    { icon: '📈', label: 'Relatórios',                page: '9',  color: C.purple },
    { icon: '🔥', label: 'Aquecimento (Warmup)',       page: '10', color: C.amber },
    { icon: '⚙️', label: 'Configurações',             page: '11', color: C.bodyMuted },
    { icon: '✅', label: 'Boas Práticas',             page: '12', color: C.green },
  ];

  return (
    <Page size="A4" style={s.page}>
      <Header section="Sumário" />

      <View style={{ marginBottom: 8 }}>
        <Text style={s.tocTitle}>Sumário</Text>
        <Text style={s.tocSubtitle}>Conteúdo deste guia</Text>
      </View>

      {items.map((item) => (
        <View key={item.label} style={s.tocItem}>
          <View style={[s.tocIcon, { backgroundColor: `${item.color}20` }]}>
            <Text style={s.tocIconText}>{item.icon}</Text>
          </View>
          <Text style={s.tocLabel}>{item.label}</Text>
          <View style={s.tocDots} />
          <Text style={s.tocPage}>{item.page}</Text>
        </View>
      ))}

      <View style={[s.tip, { marginTop: 28 }]}>
        <Text style={s.tipIcon}>📖</Text>
        <View style={{ flex: 1 }}>
          <Text style={s.tipText}>Este guia cobre todas as funcionalidades do ZapMass em detalhes. Recomendamos ler na sequência para iniciantes ou consultar seções específicas conforme a necessidade.</Text>
        </View>
      </View>

      <Footer pageNum="2" />
    </Page>
  );
};

/* ─── PÁGINA 1: PAINEL ───────────────────────────────────────── */
const PainelPage = () => (
  <Page size="A4" style={s.page}>
    <Header section="Painel" />
    <SectionPill icon="📊" label="Painel" num="01" color={C.blue} />
    <Text style={s.h1}>Painel (Dashboard)</Text>
    <Accent color={C.blue} />
    <Text style={s.lead}>
      O Painel é a primeira tela após o login. Ele mostra um resumo em tempo real de tudo que está acontecendo na sua conta — envios, chips ativos, taxa de sucesso e alertas importantes.
    </Text>

    <Text style={s.h2}>O que você encontra no Painel</Text>

    <View style={s.cardRow}>
      {[
        { icon: '📈', t: 'Envios do dia', d: 'Total de mensagens enviadas hoje com destaque em relação ao dia anterior', c: C.blue },
        { icon: '📱', t: 'Chips online',  d: 'Quantidade de números WhatsApp conectados e disponíveis agora',            c: C.green },
        { icon: '✅', t: 'Taxa de sucesso', d: 'Percentual de mensagens entregues com êxito na sessão atual',           c: C.purple },
      ].map((card) => (
        <View key={card.t} style={[s.card, { borderLeftColor: card.c }]}>
          <Text style={s.cardIcon}>{card.icon}</Text>
          <Text style={s.cardTitle}>{card.t}</Text>
          <Text style={s.cardDesc}>{card.d}</Text>
        </View>
      ))}
    </View>

    <Li icon="📅" bold="Gráfico de envios:" text="Histórico dos últimos dias em barras — veja picos e quedas de atividade." />
    <Li icon="🎂" bold="Aniversariantes:" text="Contatos que fazem aniversário hoje ou em breve, com botão para enviar mensagem diretamente." />
    <Li icon="⚡" bold="Atalhos rápidos:" text="Botões de acesso direto para Conexões, Campanhas e Contatos — ganhe tempo." />
    <Li icon="🔔" bold="Alertas do sistema:" text="Notificações sobre chips offline, campanhas concluídas ou erros que precisam de atenção." />

    <Tip text="Comece sempre pelo Painel para verificar se seus chips estão Online antes de disparar qualquer campanha. Um chip offline não entrega mensagens." />

    <Footer pageNum="3" />
  </Page>
);

/* ─── PÁGINA 2: CONEXÕES ─────────────────────────────────────── */
const ConexoesPage = () => (
  <Page size="A4" style={s.page}>
    <Header section="Conexões" />
    <SectionPill icon="📱" label="Conexões" num="02" color={C.green} />
    <Text style={s.h1}>Conexões (Chips WhatsApp)</Text>
    <Accent color={C.green} />
    <Text style={s.lead}>
      Conexões são os números de WhatsApp vinculados ao ZapMass. Cada "chip" é um número que pode enviar mensagens. Gerenciar bem sua frota de chips é essencial para campanhas eficientes.
    </Text>

    <Text style={s.h2}>Como adicionar um chip (passo a passo)</Text>
    <Step num={1} text='Clique em "Nova conexão" no canto superior direito da tela de Conexões.' color={C.green} />
    <Step num={2} text='Dê um nome descritivo ao chip (ex.: "Chip Marketing 1", "Suporte Principal").' color={C.green} />
    <Step num={3} text='Abra o WhatsApp no celular → toque em Configurações → Aparelhos conectados → Conectar aparelho.' color={C.green} />
    <Step num={4} text='Escaneie o QR Code exibido na tela do ZapMass com o celular.' color={C.green} />
    <Step num={5} text='Aguarde o status ficar "Online" (indicador verde). O chip está pronto.' color={C.green} />

    <Text style={s.h2}>Status dos chips</Text>
    <View style={s.table}>
      <View style={s.tableHead}>
        <Text style={[s.tableHeadCell, { flex: 0.5 }]}>Status</Text>
        <Text style={s.tableHeadCell}>Significado</Text>
        <Text style={s.tableHeadCell}>O que fazer</Text>
      </View>
      {[
        ['🟢 Online',     'Chip conectado e ativo',           'Pronto para enviar'],
        ['🟡 Conectando', 'Sincronizando com o WhatsApp',     'Aguardar alguns segundos'],
        ['🔴 Offline',    'Chip desconectado',                'Reconectar com QR Code'],
        ['⚠️ Banido',     'Número bloqueado pelo WhatsApp',   'Ver seção de Aquecimento'],
      ].map(([status, sig, acao], i) => (
        <View key={status} style={[s.tableRow, i % 2 === 1 ? s.tableRowAlt : {}]}>
          <Text style={[s.tableCell, { flex: 0.5, fontFamily: 'Helvetica-Bold', fontSize: 9 }]}>{status}</Text>
          <Text style={s.tableCell}>{sig}</Text>
          <Text style={s.tableCell}>{acao}</Text>
        </View>
      ))}
    </View>

    <Warn text="Nunca use um chip novo para disparos em massa imediatamente. Realize o aquecimento por pelo menos 2 semanas antes. Veja a seção Aquecimento." />

    <Footer pageNum="4" />
  </Page>
);

/* ─── PÁGINA 3: BATE-PAPO ────────────────────────────────────── */
const BatePapoPage = () => (
  <Page size="A4" style={s.page}>
    <Header section="Bate-papo" />
    <SectionPill icon="💬" label="Bate-papo" num="03" color={C.purple} />
    <Text style={s.h1}>Bate-papo (Chat)</Text>
    <Accent color={C.purple} />
    <Text style={s.lead}>
      A aba de Bate-papo funciona como um WhatsApp Web integrado ao ZapMass. Todas as conversas de todos os seus chips aparecem em um único lugar, organizadas e fáceis de acessar.
    </Text>

    <Text style={s.h2}>Layout da tela</Text>
    <View style={s.heroBlock}>
      <View style={{ flexDirection: 'row', gap: 14 }}>
        <View style={{ flex: 1, backgroundColor: '#f8fafc', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: '#e2e8f0' }}>
          <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.bodyHead, marginBottom: 6 }}>⬅ LISTA DE CONVERSAS</Text>
          <Text style={{ fontSize: 9, color: C.bodyMuted, lineHeight: 1.6 }}>Busca{'\n'}Filtros (não lidas, canal){'\n'}Cada conversa exibe: nome, prévia da última mensagem, horário e badge de não lidas</Text>
        </View>
        <View style={{ flex: 2, backgroundColor: '#f8fafc', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: '#e2e8f0' }}>
          <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.bodyHead, marginBottom: 6 }}>PAINEL DE MENSAGENS ➡</Text>
          <Text style={{ fontSize: 9, color: C.bodyMuted, lineHeight: 1.6 }}>Histórico completo da conversa com scroll automático{'\n'}Campo de texto para responder{'\n'}Botões de anexo: imagem, áudio, documento{'\n'}Sugestões de IA, atribuição para a equipe</Text>
        </View>
      </View>
    </View>

    <Text style={s.h2}>Recursos principais</Text>
    <Li icon="🔍" bold="Busca:" text="Encontre rapidamente qualquer conversa pelo nome do contato ou conteúdo." />
    <Li icon="🏷️" bold="Filtros:" text="Veja apenas conversas não lidas, de um canal específico ou atribuídas a você." />
    <Li icon="🤖" bold="Atendimento automático:" text="Configure um robô para responder enquanto você não está online." />
    <Li icon="📎" bold="Envio de mídia:" text="Imagens, áudios, vídeos e documentos diretamente pela interface." />
    <Li icon="✨" bold="Sugestões de IA:" text="A inteligência artificial sugere respostas baseadas no contexto da conversa." />
    <Li icon="👥" bold="Atribuição de equipe:" text="Transfira o atendimento para um funcionário específico." />

    <Tip text="Use o Bate-papo para acompanhar respostas de campanhas e fazer atendimento manual quando o contato precisar de atenção humana." />

    <Footer pageNum="5" />
  </Page>
);

/* ─── PÁGINA 4: CAMPANHAS ────────────────────────────────────── */
const CampanhasPage = () => (
  <Page size="A4" style={s.page}>
    <Header section="Campanhas" />
    <SectionPill icon="📣" label="Campanhas" num="04" color={C.amber} />
    <Text style={s.h1}>Campanhas</Text>
    <Accent color={C.amber} />
    <Text style={s.lead}>
      Campanhas é o coração do ZapMass. Aqui você cria, gerencia e monitora todos os seus disparos em massa, programados ou por fluxo de respostas.
    </Text>

    <Text style={s.h2}>As abas de Campanhas</Text>
    <Li icon="📊" bold="Dashboard:" text="Visão rápida das métricas de campanha antes de mergulhar na lista." />
    <Li icon="🏛️" bold="Centro de Missões:" text="Calendário de envios, saúde dos chips, modelos de mensagem e auditoria." />
    <Li icon="📋" bold="Lista de campanhas:" text="Todas as campanhas com ações: detalhes, pausar/retomar, clonar e apagar." />
    <Li icon="➕" bold="Nova campanha:" text="Assistente passo a passo para criar um novo disparo." />

    <Text style={s.h2}>Criando uma campanha — 4 passos</Text>
    <Step num={1} text="Público: escolha quem recebe — lista salva, filtro por cidade/tag/temperatura, ou números avulsos." color={C.amber} />
    <Step num={2} text="Mensagem: escreva o texto, use variáveis {nome} {cidade} e spintax {Olá|Oi|Bom dia} para personalizar." color={C.amber} />
    <Step num={3} text="Canais: selecione os chips participantes e configure o intervalo anti-ban entre envios." color={C.amber} />
    <Step num={4} text='Revisão: confira tudo e clique em "Disparar agora" ou escolha uma data/hora para agendamento.' color={C.amber} />

    <Text style={s.h2}>Tipos de disparo</Text>
    <View style={s.cardRow}>
      {[
        { icon: '📢', t: 'Disparo único',     d: 'Uma mensagem para cada contato — ideal para avisos e promoções',         c: C.amber },
        { icon: '🔀', t: 'Fluxo por resposta', d: 'Sistema aguarda o contato responder antes de enviar a próxima mensagem', c: C.blue },
        { icon: '📅', t: 'Agendado',           d: 'Programe o disparo para qualquer data/hora futura',                     c: C.green },
      ].map((card) => (
        <View key={card.t} style={[s.card, { borderLeftColor: card.c }]}>
          <Text style={s.cardIcon}>{card.icon}</Text>
          <Text style={s.cardTitle}>{card.t}</Text>
          <Text style={s.cardDesc}>{card.d}</Text>
        </View>
      ))}
    </View>

    <Tip text="Use o Spintax para variar o início das mensagens: {Olá|Oi|Bom dia} — isso reduz o risco de bloqueio porque cada mensagem fica levemente diferente." />

    <Footer pageNum="6" />
  </Page>
);

/* ─── PÁGINA 5: FLUXO POR RESPOSTA ──────────────────────────── */
const FluxoPage = () => (
  <Page size="A4" style={s.page}>
    <Header section="Fluxo por Resposta" />
    <SectionPill icon="🔀" label="Fluxo por Resposta" num="05" color={C.blue} />
    <Text style={s.h1}>Fluxo por Resposta</Text>
    <Accent color={C.blue} />
    <Text style={s.lead}>
      Recurso avançado que cria um diálogo automatizado. O sistema aguarda o contato responder antes de enviar a próxima mensagem — criando uma conversa guiada e natural.
    </Text>

    <Text style={s.h2}>Como funciona</Text>
    <Step num={1} text="Você configura etapas de mensagem no editor de fluxo, cada uma com opções de resposta esperada." color={C.blue} />
    <Step num={2} text="A campanha envia a mensagem inicial para todos os contatos da lista." color={C.blue} />
    <Step num={3} text="Cada contato responde com uma palavra ou frase (ex.: SIM, NÃO, QUERO SABER MAIS)." color={C.blue} />
    <Step num={4} text="O sistema reconhece a resposta e envia automaticamente a mensagem seguinte configurada para aquela opção." color={C.blue} />
    <Step num={5} text="Com múltiplas opções, cada resposta pode levar a um caminho diferente (árvore de decisão)." color={C.blue} />

    <Text style={s.h2}>Configurando as opções de resposta</Text>
    <Li icon="🎯" bold="Palavra-chave:" text='Define qual texto o contato deve enviar para acionar aquela opção (ex.: "sim", "quero", "1").' />
    <Li icon="🔤" bold="Sem acento:" text="O sistema reconhece variações: SIM, Sim, sim, sím são todos aceitos." />
    <Li icon="🔀" bold="Modo de match:" text='Escolha "palavra exata" ou "contém" — "contém" é mais flexível para respostas naturais.' />
    <Li icon="⏱️" bold="Tempo limite:" text="Configure quanto tempo aguardar pela resposta antes de encerrar o fluxo automaticamente." />

    <Text style={s.h2}>Encerramento automático</Text>
    <Li icon="🛑" bold="Opt-out global:" text='Palavras como "sair", "parar", "cancelar" encerram qualquer fluxo ativo do contato.' />
    <Li icon="✅" bold="Prioridade de opções:" text="Se o contato digitar uma palavra que é tanto uma opção configurada quanto opt-out (ex.: 'sair'), a opção configurada tem prioridade." />

    <Tip text="Crie fluxos curtos (2-3 etapas) para melhor engajamento. Fluxos longos cansam o contato e aumentam o abandono." />

    <Footer pageNum="7" />
  </Page>
);

/* ─── PÁGINA 6: CONTATOS ─────────────────────────────────────── */
const ContatosPage = () => (
  <Page size="A4" style={s.page}>
    <Header section="Contatos" />
    <SectionPill icon="👥" label="Contatos" num="06" color={C.green} />
    <Text style={s.h1}>Contatos</Text>
    <Accent color={C.green} />
    <Text style={s.lead}>
      A aba Contatos é sua base de dados completa de clientes e leads. Importe, organize, filtre e segmente seus contatos para campanhas cada vez mais precisas.
    </Text>

    <Text style={s.h2}>Importando contatos</Text>
    <Step num={1} text='Clique em "Importar" no canto superior da tela.' color={C.green} />
    <Step num={2} text="Escolha o formato: CSV, Excel (.xlsx), vCard (.vcf) ou cole texto diretamente." color={C.green} />
    <Step num={3} text="Baixe o modelo de planilha para ver o formato correto das colunas." color={C.green} />
    <Step num={4} text="Preencha com nome, telefone (com DDD) e dados opcionais como cidade, e-mail, tag." color={C.green} />
    <Step num={5} text="Faça o upload, confirme o mapeamento de colunas e aguarde a importação." color={C.green} />

    <Text style={s.h2}>Temperatura dos contatos</Text>
    <View style={s.cardRow}>
      {[
        { icon: '🔥', t: 'Quente',  d: 'Engajado — respondeu recentemente ou abriu mensagens',   c: C.red },
        { icon: '🌡️', t: 'Morno',   d: 'Moderado — alguma interação nos últimos 30 dias',         c: C.amber },
        { icon: '❄️', t: 'Frio',    d: 'Inativo — sem interação há mais de 30 dias',              c: C.blue },
      ].map((card) => (
        <View key={card.t} style={[s.card, { borderLeftColor: card.c }]}>
          <Text style={s.cardIcon}>{card.icon}</Text>
          <Text style={s.cardTitle}>{card.t}</Text>
          <Text style={s.cardDesc}>{card.d}</Text>
        </View>
      ))}
    </View>

    <Text style={s.h2}>Listas e organização</Text>
    <Li icon="📋" bold="Listas:" text="Agrupe contatos em segmentos (ex.: Clientes VIP, Leads Novos, Igreja Sul)." />
    <Li icon="🏷️" bold="Tags:" text="Adicione etiquetas livres para classificação personalizada." />
    <Li icon="🔍" bold="Filtros avançados:" text="Filtre por cidade, DDD, tag, temperatura, aniversário, opt-out e muito mais." />
    <Li icon="🗺️" bold="Mapa:" text="Visualize a distribuição geográfica dos seus contatos no mapa do Brasil." />

    <Tip text="Use a temperatura como filtro de campanha. Envie ofertas mais agressivas para contatos Quentes e abordagens mais suaves para contatos Frios." />

    <Footer pageNum="8" />
  </Page>
);

/* ─── PÁGINA 7: RELATÓRIOS ───────────────────────────────────── */
const RelatoriosPage = () => (
  <Page size="A4" style={s.page}>
    <Header section="Relatórios" />
    <SectionPill icon="📈" label="Relatórios" num="07" color={C.purple} />
    <Text style={s.h1}>Relatórios</Text>
    <Accent color={C.purple} />
    <Text style={s.lead}>
      A área de Relatórios transforma seus dados de envio em insights acionáveis. Veja o desempenho das campanhas, identifique os melhores horários e exporte dados para análise externa.
    </Text>

    <Text style={s.h2}>Métricas disponíveis</Text>
    <View style={s.cardRow}>
      {[
        { icon: '📤', t: 'Envios totais',    d: 'Total de mensagens disparadas no período filtrado',         c: C.blue },
        { icon: '✅', t: 'Taxa de sucesso',  d: 'Percentual de mensagens entregues com êxito',               c: C.green },
        { icon: '💬', t: 'Respostas',        d: 'Contatos que responderam a alguma mensagem do período',      c: C.purple },
      ].map((card) => (
        <View key={card.t} style={[s.card, { borderLeftColor: card.c }]}>
          <Text style={s.cardIcon}>{card.icon}</Text>
          <Text style={s.cardTitle}>{card.t}</Text>
          <Text style={s.cardDesc}>{card.d}</Text>
        </View>
      ))}
    </View>

    <Text style={s.h2}>Filtros de período</Text>
    <Li icon="📅" bold="7 dias:" text="Visão da última semana — ideal para monitoramento diário." />
    <Li icon="📅" bold="30 dias:" text="Visão mensal — mais comum para análise de desempenho." />
    <Li icon="📅" bold="3 meses:" text="Visão trimestral — identifica tendências e sazonalidades." />

    <Text style={s.h2}>Mapa de Calor</Text>
    <Text style={s.body}>
      O mapa de calor exibe em quais horários e dias da semana você mais envia mensagens. Quanto mais escura a célula, maior o volume de envios naquele horário. Use esta informação para agendar campanhas nos momentos de maior engajamento do seu público.
    </Text>

    <Text style={s.h2}>Exportação de dados</Text>
    <Li icon="⬇️" bold="Exportar CSV:" text='Clique no botão "Exportar CSV" para baixar uma planilha com todas as campanhas do período filtrado.' />
    <Li icon="📊" bold="Compatível com:" text="Microsoft Excel, Google Sheets, LibreOffice Calc e qualquer software de análise." />
    <Li icon="📋" bold="Dados exportados:" text="Nome da campanha, data, total de contatos, enviados, falhas, taxa de sucesso." />

    <Tip text="Use o mapa de calor para descobrir os melhores horários de engajamento e agende suas próximas campanhas nesses momentos." />

    <Footer pageNum="9" />
  </Page>
);

/* ─── PÁGINA 8: AQUECIMENTO ──────────────────────────────────── */
const AquecimentoPage = () => (
  <Page size="A4" style={s.page}>
    <Header section="Aquecimento" />
    <SectionPill icon="🔥" label="Aquecimento" num="08" color={C.amber} />
    <Text style={s.h1}>Aquecimento (Warmup)</Text>
    <Accent color={C.amber} />
    <Text style={s.lead}>
      O Aquecimento é essencial para chips novos. Ele "educa" gradualmente o número, enviando mensagens em volume crescente, reduzindo significativamente o risco de bloqueio pelo WhatsApp.
    </Text>

    <Text style={s.h2}>Plano de aquecimento recomendado</Text>
    <View style={s.table}>
      <View style={s.tableHead}>
        <Text style={s.tableHeadCell}>Período</Text>
        <Text style={s.tableHeadCell}>Volume diário</Text>
        <Text style={s.tableHeadCell}>Observação</Text>
      </View>
      {[
        ['Dias 1–3',   'até 20 msgs/dia',  'Conversas naturais, amigos e conhecidos'],
        ['Dias 4–7',   'até 50 msgs/dia',  'Pode começar listas pequenas (opt-in)'],
        ['Semana 2',   'até 100 msgs/dia', 'Aumente gradualmente ao longo da semana'],
        ['Semana 3',   'até 200 msgs/dia', 'Monitore status do chip diariamente'],
        ['Semana 4+',  'até 300 msgs/dia', 'Máximo recomendado — mantenha intervalos'],
      ].map(([per, vol, obs], i) => (
        <View key={per} style={[s.tableRow, i % 2 === 1 ? s.tableRowAlt : {}]}>
          <Text style={[s.tableCell, { fontFamily: 'Helvetica-Bold' }]}>{per}</Text>
          <Text style={[s.tableCell, { color: C.greenDark }]}>{vol}</Text>
          <Text style={s.tableCell}>{obs}</Text>
        </View>
      ))}
    </View>

    <Text style={s.h2}>Regras de ouro</Text>
    <Li icon="✅" bold="Sempre" text="aqueça chips novos por pelo menos 2 semanas antes de qualquer disparo em massa." />
    <Li icon="✅" bold="Sempre" text="use intervalos de no mínimo 8–15 segundos entre cada mensagem." />
    <Li icon="✅" bold="Sempre" text="envie primeiros com contatos que conhecem o número (família, amigos, equipe)." />
    <Li icon="❌" bold="Nunca" text="dispare para listas frias ou compradas com chip novo." />
    <Li icon="❌" bold="Nunca" text="ultrapassar 300 mensagens/dia mesmo com chip já aquecido." />
    <Li icon="❌" bold="Nunca" text="ignore avisos de bloqueio — pause e aguarde 24h antes de retomar." />

    <Warn text="Chip banido não pode ser recuperado. Invista no aquecimento correto — leva 4 semanas mas protege seu número indefinidamente." />

    <Footer pageNum="10" />
  </Page>
);

/* ─── PÁGINA 9: CONFIGURAÇÕES ────────────────────────────────── */
const ConfiguracoesPage = () => (
  <Page size="A4" style={s.page}>
    <Header section="Configurações" />
    <SectionPill icon="⚙️" label="Configurações" num="09" color={C.bodyMuted} />
    <Text style={s.h1}>Configurações</Text>
    <Accent color="#6b7280" />
    <Text style={s.lead}>
      As Configurações permitem personalizar o comportamento do sistema: limites de envio, aparência, notificações e dados da conta.
    </Text>

    <Text style={s.h2}>Aba Disparo</Text>
    <Li icon="⏱️" bold="Intervalo mínimo:" text="Tempo mínimo entre duas mensagens (recomendado: 8–15 segundos)." />
    <Li icon="⏱️" bold="Intervalo máximo:" text="Tempo máximo para variar a cadência e tornar os envios mais naturais." />
    <Li icon="🔢" bold="Limite diário por chip:" text="Máximo de mensagens que cada chip pode enviar em um dia (recomendado: 300)." />
    <Li icon="🌙" bold="Modo silêncio noturno:" text="Pausa automática dos envios durante a madrugada (ex.: 22h até 7h)." />

    <Text style={s.h2}>Aba Aparência</Text>
    <Li icon="🌙" bold="Tema escuro:" text="Interface com fundo escuro — ideal para uso prolongado e reduz cansaço visual." />
    <Li icon="☀️" bold="Tema claro:" text="Interface com fundo branco — melhor em ambientes iluminados." />
    <Li icon="🎨" bold="Cor de destaque:" text="Personalize a cor principal dos botões e elementos de destaque." />

    <Text style={s.h2}>Aba Notificações</Text>
    <Li icon="📧" bold="E-mail de alertas:" text="Receba notificações por e-mail quando campanhas terminarem ou ocorrer algum erro." />
    <Li icon="🔗" bold="Webhook URL:" text="Envie eventos do sistema para sistemas externos (CRM, automações, etc.)." />

    <Text style={s.h2}>Aba Minha conta</Text>
    <Li icon="👤" bold="Dados do perfil:" text="Nome, e-mail de login e foto de perfil." />
    <Li icon="🔑" bold="Alterar senha:" text="Redefina sua senha de acesso quando necessário." />

    <Tip text="Configure o intervalo entre 8 e 15 segundos. Intervalos muito curtos aumentam o risco de bloqueio. Intervalos muito longos tornam grandes disparos muito lentos." />

    <Footer pageNum="11" />
  </Page>
);

/* ─── PÁGINA 10: BOAS PRÁTICAS ───────────────────────────────── */
const BoasPraticasPage = () => (
  <Page size="A4" style={s.page}>
    <Header section="Boas Práticas" />
    <SectionPill icon="✅" label="Boas Práticas" num="10" color={C.green} />
    <Text style={s.h1}>Boas Práticas</Text>
    <Accent color={C.green} />
    <Text style={s.lead}>
      Seguir estas práticas garante maior entregabilidade, protege seus chips e mantém a saúde da sua conta no longo prazo.
    </Text>

    <Text style={s.h2}>Antes de cada campanha</Text>
    <Check text="Verificar se os chips estão Online na tela de Conexões" />
    <Check text="Confirmar que a lista tem opt-in (contatos que autorizaram receber mensagens)" />
    <Check text="Personalizar a mensagem com {nome} e spintax para evitar cópias idênticas" />
    <Check text="Definir intervalo mínimo de 8s ou mais nas Configurações de Disparo" />
    <Check text="Enviar uma mensagem de teste para 2–3 contatos antes do disparo em massa" />
    <Check text="Revisar todas as informações na tela de Revisão antes de confirmar" />

    <Text style={s.h2}>Para manter chips saudáveis</Text>
    <Check text="Nunca ultrapassar 300 mensagens/dia por chip, mesmo aquecido" />
    <Check text="Sempre aquecer chips novos por no mínimo 2 semanas" />
    <Check text="Não enviar para listas desatualizadas, compradas ou sem opt-in" />
    <Check text="Monitorar a saúde dos chips na aba Centro de Missões → Saúde dos chips" />
    <Check text="Pausar imediatamente campanhas com alta taxa de erro e investigar o motivo" />

    <Text style={s.h2}>Organização dos contatos</Text>
    <Check text="Manter a base de contatos atualizada — remova números inválidos regularmente" />
    <Check text="Usar listas segmentadas em vez de disparar para toda a base sempre" />
    <Check text="Aproveitar filtros de temperatura para personalizar a abordagem" />
    <Check text="Respeitar solicitações de opt-out — não reenviar para quem pediu para sair" />

    <Tip text="A consistência é mais importante que o volume. Envios menores e bem segmentados convertem mais que grandes disparos para listas frias." />

    <Footer pageNum="12" />
  </Page>
);

/* ─── DOCUMENTO PRINCIPAL ────────────────────────────────────── */
export const ZapMassPDF: React.FC = () => (
  <Document
    title="ZapMass — Guia Completo do Usuário"
    author="ZapMass"
    subject="Tutorial e manual de uso da plataforma ZapMass"
    keywords="zapmass, whatsapp, campanhas, disparos, tutorial"
    creator="ZapMass"
    producer="@react-pdf/renderer"
  >
    <CoverPage />
    <TOCPage />
    <PainelPage />
    <ConexoesPage />
    <BatePapoPage />
    <CampanhasPage />
    <FluxoPage />
    <ContatosPage />
    <RelatoriosPage />
    <AquecimentoPage />
    <ConfiguracoesPage />
    <BoasPraticasPage />
  </Document>
);
