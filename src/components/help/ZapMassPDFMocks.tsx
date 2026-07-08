import React from 'react';
import { View, Text, StyleSheet } from '@react-pdf/renderer';

const M = StyleSheet.create({
  frame: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    overflow: 'hidden',
    marginTop: 10,
    marginBottom: 14,
    backgroundColor: '#0b1220',
  },
  topBar: {
    backgroundColor: '#111827',
    paddingHorizontal: 12,
    paddingVertical: 7,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  topTitle: { color: '#10b981', fontSize: 8, fontFamily: 'Helvetica-Bold' },
  topMeta: { color: '#64748b', fontSize: 7 },
  body: { padding: 10, backgroundColor: '#0f172a' },
  caption: {
    fontSize: 8,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 2,
    fontStyle: 'italic',
  },
  kpiRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  kpi: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 6,
    padding: 7,
    borderLeftWidth: 2,
  },
  kpiVal: { color: '#f8fafc', fontSize: 11, fontFamily: 'Helvetica-Bold' },
  kpiLbl: { color: '#94a3b8', fontSize: 6, marginTop: 2 },
  barRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 36, marginTop: 4 },
  bar: { flex: 1, backgroundColor: '#10b981', borderRadius: 2, opacity: 0.85 },
  chipRow: { flexDirection: 'row', gap: 8 },
  chip: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#10b981', marginBottom: 4 },
  chatWrap: { flexDirection: 'row', minHeight: 72 },
  chatSide: {
    width: '34%',
    backgroundColor: '#111827',
    padding: 6,
    borderRightWidth: 1,
    borderRightColor: '#1f2937',
  },
  chatMain: { flex: 1, padding: 8, justifyContent: 'flex-end', gap: 5 },
  chatLine: {
    backgroundColor: '#1e293b',
    borderRadius: 4,
    height: 8,
    marginBottom: 4,
    width: '88%',
  },
  bubbleOut: {
    alignSelf: 'flex-end',
    backgroundColor: '#065f46',
    borderRadius: 6,
    padding: 6,
    maxWidth: '72%',
  },
  bubbleIn: {
    alignSelf: 'flex-start',
    backgroundColor: '#1e293b',
    borderRadius: 6,
    padding: 6,
    maxWidth: '68%',
  },
  bubbleText: { color: '#ecfdf5', fontSize: 6, lineHeight: 1.35 },
  bubbleTextIn: { color: '#e2e8f0', fontSize: 6, lineHeight: 1.35 },
  steps: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  step: {
    flex: 1,
    borderRadius: 6,
    padding: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#1e293b',
  },
  stepActive: { borderColor: '#10b981', backgroundColor: '#064e3b' },
  stepNum: { color: '#10b981', fontSize: 8, fontFamily: 'Helvetica-Bold' },
  stepLbl: { color: '#94a3b8', fontSize: 6, marginTop: 2, textAlign: 'center' },
  preview: {
    backgroundColor: '#1e293b',
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
});

const MockCaption = ({ text }: { text: string }) => <Text style={M.caption}>{text}</Text>;

export const DashboardMock = () => (
  <View>
    <View style={M.frame}>
      <View style={M.topBar}>
        <Text style={M.topTitle}>ZapMass</Text>
        <Text style={M.topMeta}>Painel</Text>
      </View>
      <View style={M.body}>
        <View style={M.kpiRow}>
          <View style={[M.kpi, { borderLeftColor: '#3b82f6' }]}>
            <Text style={M.kpiVal}>1.284</Text>
            <Text style={M.kpiLbl}>Envios hoje</Text>
          </View>
          <View style={[M.kpi, { borderLeftColor: '#10b981' }]}>
            <Text style={M.kpiVal}>4</Text>
            <Text style={M.kpiLbl}>Chips online</Text>
          </View>
          <View style={[M.kpi, { borderLeftColor: '#8b5cf6' }]}>
            <Text style={M.kpiVal}>97%</Text>
            <Text style={M.kpiLbl}>Sucesso</Text>
          </View>
        </View>
        <View style={M.barRow}>
          {[18, 28, 22, 34, 26, 40, 32].map((h, i) => (
            <View key={i} style={[M.bar, { height: h }]} />
          ))}
        </View>
      </View>
    </View>
    <MockCaption text="Ilustracao: Painel com KPIs e grafico de envios" />
  </View>
);

export const ConnectionsMock = () => (
  <View>
    <View style={M.frame}>
      <View style={M.topBar}>
        <Text style={M.topTitle}>Conexoes</Text>
        <Text style={M.topMeta}>Chips WhatsApp</Text>
      </View>
      <View style={M.body}>
        <View style={M.chipRow}>
          <View style={M.chip}>
            <View style={M.dot} />
            <Text style={{ color: '#f8fafc', fontSize: 7, fontFamily: 'Helvetica-Bold' }}>Marketing 01</Text>
            <Text style={{ color: '#64748b', fontSize: 6, marginTop: 2 }}>Online · 47 99999-0001</Text>
          </View>
          <View style={M.chip}>
            <View style={[M.dot, { backgroundColor: '#f59e0b' }]} />
            <Text style={{ color: '#f8fafc', fontSize: 7, fontFamily: 'Helvetica-Bold' }}>Suporte</Text>
            <Text style={{ color: '#64748b', fontSize: 6, marginTop: 2 }}>Conectando...</Text>
          </View>
        </View>
      </View>
    </View>
    <MockCaption text="Ilustracao: chips com status Online / Conectando" />
  </View>
);

export const ChatMock = () => (
  <View>
    <View style={M.frame}>
      <View style={M.topBar}>
        <Text style={M.topTitle}>Bate-papo</Text>
        <Text style={M.topMeta}>Atendimento</Text>
      </View>
      <View style={M.chatWrap}>
        <View style={M.chatSide}>
          <View style={[M.chatLine, { width: '95%' }]} />
          <View style={[M.chatLine, { width: '80%', opacity: 0.7 }]} />
          <View style={[M.chatLine, { width: '88%', opacity: 0.5 }]} />
        </View>
        <View style={M.chatMain}>
          <View style={M.bubbleIn}>
            <Text style={M.bubbleTextIn}>Ola! Quero saber mais sobre a campanha.</Text>
          </View>
          <View style={M.bubbleOut}>
            <Text style={M.bubbleText}>Claro! Posso te ajudar agora mesmo.</Text>
          </View>
        </View>
      </View>
    </View>
    <MockCaption text="Ilustracao: conversas e respostas no chat" />
  </View>
);

export const CampaignMock = () => (
  <View>
    <View style={M.frame}>
      <View style={M.topBar}>
        <Text style={M.topTitle}>Campanhas</Text>
        <Text style={M.topMeta}>Nova campanha</Text>
      </View>
      <View style={M.body}>
        <View style={M.steps}>
          {[
            { n: '1', l: 'Contatos', active: false },
            { n: '2', l: 'Mensagem', active: true },
            { n: '3', l: 'Revisao', active: false },
          ].map((st) => (
            <View key={st.n} style={[M.step, st.active ? M.stepActive : {}]}>
              <Text style={M.stepNum}>{st.n}</Text>
              <Text style={M.stepLbl}>{st.l}</Text>
            </View>
          ))}
        </View>
        <View style={M.preview}>
          <Text style={{ color: '#94a3b8', fontSize: 6, marginBottom: 4 }}>Mensagem</Text>
          <Text style={{ color: '#f1f5f9', fontSize: 7, lineHeight: 1.4 }}>
            Ola {'{nome}'}! Temos uma novidade especial para voce hoje.
          </Text>
        </View>
      </View>
    </View>
    <MockCaption text="Ilustracao: assistente de criacao de campanha" />
  </View>
);
