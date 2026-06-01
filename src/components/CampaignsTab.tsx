import React, { useEffect, useState } from 'react';
import {
  BarChart3,
  ChevronDown,
  ChevronUp,
  Command,
  LayoutDashboard,
  Plus,
  Send,
  Smartphone,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { CampaignReplyFlow, CampaignScheduleSlot, CampaignStatus, ConnectionStatus, WhatsAppConnection } from '../types';
import type { CampaignWizardDraft } from '../types/campaignMission';
import { useZapMassCore } from '../context/ZapMassContext';
import { useAuth } from '../context/AuthContext';
import { isWhatsAppRiskAcknowledged, saveWhatsAppRiskAck } from '../utils/whatsappRiskStorage';
import { appendAudit } from '../utils/campaignMissionStorage';
import { buildDraftFromCampaign } from '../utils/campaignDraft';
import { Badge, Button, Card, Input, Select, Tabs as UITabs, Modal } from './ui';
import {
  CampaignDetails,
  CampaignMissionControl,
  CampaignMissionStickyBar,
  CampaignsList,
  CampaignsOverview,
  NewCampaignWizard,
  CampaignWeekScheduleView
} from './campaigns';
import { CampaignCockpitHero } from './campaigns/CampaignCockpitHero';
import { CampaignTemplatesGallery } from './campaigns/CampaignTemplatesGallery';
import { CampaignInsightsBanner } from './campaigns/CampaignInsightsBanner';
import { WhatsAppRiskAcceptModal } from './legal/WhatsAppRiskAcceptModal';

interface CampaignsTabProps {
  connections: WhatsAppConnection[];
}

type SubTab = 'overview' | 'mission' | 'campaigns' | 'create';

const LS_TEST_OPEN = 'zapmass.campaigns.testOpen';
const LS_DISMISSED = 'zapmass.campaigns.dismissedInsights';

const loadDismissed = (): string[] => {
  try {
    const raw = localStorage.getItem(LS_DISMISSED);
    if (!raw) return [];
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
};

export const CampaignsTab: React.FC<CampaignsTabProps> = ({ connections }) => {
  const { user } = useAuth();
  const {
    campaigns,
    contactLists,
    contacts,
    socket,
    startCampaign,
    scheduleCampaign,
    pauseCampaign,
    resumeCampaign,
    deleteCampaign,
    deleteCampaigns,
    systemLogs
  } = useZapMassCore();

  const [subTab, setSubTab] = useState<SubTab>('overview');
  const [viewState, setViewState] = useState<'list' | 'create' | 'details'>('list');
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [riskModalOpen, setRiskModalOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(() => localStorage.getItem(LS_TEST_OPEN) === '1');
  const [testFromConn, setTestFromConn] = useState<string>('');
  const [testToPhone, setTestToPhone] = useState<string>('');
  const [testMessage, setTestMessage] = useState<string>('Teste de disparo - ZapMass');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [wizardDraft, setWizardDraft] = useState<CampaignWizardDraft | null>(null);
  const [wizardSessionId, setWizardSessionId] = useState(0);
  const [pendingDraft, setPendingDraft] = useState<CampaignWizardDraft | null>(null);
  const [dismissedInsights, setDismissedInsights] = useState<string[]>(loadDismissed);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem(LS_TEST_OPEN, testOpen ? '1' : '0');
  }, [testOpen]);

  useEffect(() => {
    localStorage.setItem(LS_DISMISSED, JSON.stringify(dismissedInsights));
  }, [dismissedInsights]);

  // Draft chegando da aba Contatos ("Criar campanha com selecionados"/"lista") via sessionStorage.
  // O handshake usa storage para sobreviver a navegação entre abas sem prop drilling.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('zapmass.pendingCampaignDraft');
      if (!raw) return;
      sessionStorage.removeItem('zapmass.pendingCampaignDraft');
      const draft = JSON.parse(raw) as CampaignWizardDraft;
      if (!draft || typeof draft !== 'object') return;
      const uid = user?.uid;
      if (!uid) return;
      if (!isWhatsAppRiskAcknowledged(uid)) {
        setPendingDraft(draft);
        setRiskModalOpen(true);
      } else {
        setWizardDraft(draft);
        setWizardSessionId((s) => s + 1);
        setSubTab('create');
        setViewState('create');
      }
    } catch {
      /* ignore */
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  const goToCreateWizard = () => {
    setWizardDraft(null);
    setPendingDraft(null);
    setWizardSessionId((s) => s + 1);
    setSubTab('create');
    setViewState('create');
  };

  const openWizardWithDraft = (draft: CampaignWizardDraft) => {
    const uid = user?.uid;
    if (!uid) {
      toast.error('Faça login para criar campanhas.');
      return;
    }
    if (!isWhatsAppRiskAcknowledged(uid)) {
      setPendingDraft(draft);
      setRiskModalOpen(true);
      return;
    }
    setWizardDraft(draft);
    setWizardSessionId((s) => s + 1);
    setSubTab('create');
    setViewState('create');
  };

  const requestCreateFlow = () => {
    const uid = user?.uid;
    if (!uid) {
      toast.error('Faça login para criar campanhas.');
      return;
    }
    if (!isWhatsAppRiskAcknowledged(uid)) {
      setPendingDraft(null);
      setRiskModalOpen(true);
      return;
    }
    goToCreateWizard();
  };

  const activeCampaign = campaigns.find((c) => c.id === selectedCampaignId);

  const openDetails = (id: string) => {
    setSelectedCampaignId(id);
    setViewState('details');
  };

  const toggleCampaignStatus = (id: string) => {
    const campaign = campaigns.find((c) => c.id === id);
    if (!campaign) return;
    if (campaign.status === CampaignStatus.SCHEDULED) {
      return;
    }
    if (campaign.status === CampaignStatus.RUNNING) {
      pauseCampaign(id);
      appendAudit({
        action: 'campaign_pause',
        label: `Pausar: ${campaign.name}`,
        campaignId: id
      });
    } else if (campaign.status === CampaignStatus.PAUSED) {
      resumeCampaign(id);
      appendAudit({
        action: 'campaign_resume',
        label: `Retomar: ${campaign.name}`,
        campaignId: id
      });
    }
  };

  const handleDeleteCampaign = async (id: string) => {
    const c = campaigns.find((x) => x.id === id);
    await deleteCampaign(id);
    appendAudit({
      action: 'campaign_delete',
      label: c ? `Excluir: ${c.name}` : `Excluir campanha ${id}`,
      campaignId: id
    });
  };

  const handleDeleteManyCampaigns = async (ids: string[]) => {
    await deleteCampaigns(ids);
    appendAudit({
      action: 'campaign_delete',
      label: `Exclusão em lote (${ids.length})`
    });
  };

  const handleSubmitCampaign = async (payload: {
    name: string;
    message: string;
    messageStages: string[];
    replyFlow?: CampaignReplyFlow;
    connectedIds: string[];
    numbers: string[];
    recipients: Array<{ phone: string; vars: Record<string, string> }>;
    contactListMeta: { id?: string; name?: string };
    delaySeconds: number;
    launchMode?: 'now' | 'schedule';
    schedule?: {
      timeZone: string;
      slots: CampaignScheduleSlot[];
      repeatWeekly: boolean;
      onceLocalDate?: string;
      onceLocalTime?: string;
    };
    channelWeights?: Record<string, number>;
    mediaAttachment?: {
      dataBase64: string;
      mimeType: string;
      fileName: string;
      sendMediaAsDocument?: boolean;
    };
  }) => {
    if (payload.connectedIds.length === 0) {
      toast.error('Selecione pelo menos um chip conectado para disparar.');
      throw new Error('Sem chips conectados');
    }
    if (payload.numbers.length === 0) {
      toast.error('Nenhum número válido foi encontrado.');
      throw new Error('Sem números');
    }

    try {
      const id =
        payload.launchMode === 'schedule' && payload.schedule
          ? await scheduleCampaign(
              payload.connectedIds[0],
              payload.numbers,
              payload.message,
              payload.connectedIds,
              payload.contactListMeta,
              payload.name,
              payload.schedule,
              {
                delaySeconds: payload.delaySeconds,
                recipients: payload.recipients,
                messageStages: payload.messageStages,
                replyFlow: payload.replyFlow,
                channelWeights: payload.channelWeights
              }
            )
          : await startCampaign(
              payload.connectedIds[0],
              payload.numbers,
              payload.message,
              payload.connectedIds,
              payload.contactListMeta,
              payload.name,
              {
                delaySeconds: payload.delaySeconds,
                recipients: payload.recipients,
                messageStages: payload.messageStages,
                replyFlow: payload.replyFlow,
                channelWeights: payload.channelWeights,
                mediaAttachment: payload.mediaAttachment
              }
            );
      appendAudit({
        action: 'campaign_create',
        label: payload.name,
        campaignId: id
      });

      const isAbA = payload.name.includes(' — Var A');
      const isAbB = payload.name.includes(' — Var B');
      if (isAbA) return;
      if (isAbB) {
        toast.success('Laboratório A/B: as duas campanhas foram iniciadas. Compare os resultados na lista.');
      } else {
        if (payload.launchMode !== 'schedule') {
          toast.success('Campanha iniciada com sucesso.');
        }
      }
      setViewState('list');
      setSubTab('overview');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao iniciar campanha.';
      if (msg.includes('Demoramos a confirmar no servidor')) {
        toast.error(msg, { duration: 10000 });
        setViewState('list');
        setSubTab('overview');
        return;
      }
      throw err;
    }
  };

  const onRiskAccepted = () => {
    if (user?.uid) saveWhatsAppRiskAck(user.uid);
    setRiskModalOpen(false);
    if (pendingDraft) {
      setWizardDraft(pendingDraft);
      setPendingDraft(null);
      setWizardSessionId((s) => s + 1);
      setSubTab('create');
      setViewState('create');
    } else {
      goToCreateWizard();
    }
  };

  const handleSubTabChange = (v: SubTab) => {
    if (v === 'create') {
      requestCreateFlow();
      return;
    }
    setSubTab(v);
    setViewState('list');
  };

  const handleTestDispatch = () => {
    if (!testFromConn || !testToPhone || !testMessage.trim()) {
      toast.error('Preencha todos os campos do teste.');
      return;
    }
    setTestResult(null);
    socket?.emit('test-dispatch', {
      fromConnectionId: testFromConn,
      toPhone: testToPhone,
      message: testMessage.trim()
    });
    socket?.once('test-dispatch-result', (result: { success: boolean; message?: string; error?: string }) => {
      if (result.success) {
        setTestResult(`Enviado: ${result.message}`);
        toast.success(result.message || 'Teste enviado.');
      } else {
        setTestResult(`Erro: ${result.error}`);
        toast.error(result.error || 'Falha no teste.');
      }
    });
  };

  // --- Atalhos de teclado ---
  useEffect(() => {
    if (viewState !== 'list') return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isTyping =
        tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable;
      if (isTyping && e.key !== 'Escape') return;

      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        requestCreateFlow();
      } else if (e.key === '1') {
        setSubTab('overview');
      } else if (e.key === '2') {
        setSubTab('mission');
      } else if (e.key === '3') {
        setSubTab('campaigns');
      } else if (e.key === 't' || e.key === 'T') {
        setTestOpen((v) => !v);
      } else if (e.key === '?') {
        setShortcutsOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewState]);

  const dismissInsight = (id: string) => setDismissedInsights((prev) => [...prev, id]);

  // Notificações / deep-link: abrir detalhe da campanha (sino ou sessionStorage).
  useEffect(() => {
    const tryOpen = (campaignId: string): boolean => {
      if (!campaigns.some((c) => c.id === campaignId)) {
        if (campaigns.length === 0) return false;
        toast.error('Campanha não encontrada.');
        return false;
      }
      setSelectedCampaignId(campaignId);
      setViewState('details');
      return true;
    };
    const onOpenCampaign = (e: Event) => {
      const id = (e as CustomEvent<{ campaignId?: string }>).detail?.campaignId;
      if (!id) return;
      if (tryOpen(id)) {
        try {
          sessionStorage.removeItem('zapmass.openCampaignById');
        } catch {
          /* ignore */
        }
      } else if (campaigns.length > 0) {
        try {
          sessionStorage.removeItem('zapmass.openCampaignById');
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener('zapmass-open-campaign', onOpenCampaign);
    return () => window.removeEventListener('zapmass-open-campaign', onOpenCampaign);
  }, [campaigns]);

  useEffect(() => {
    let id: string | null = null;
    try {
      id = sessionStorage.getItem('zapmass.openCampaignById');
    } catch {
      return;
    }
    if (!id) return;
    if (campaigns.length === 0) return;
    if (!campaigns.some((c) => c.id === id)) {
      try {
        sessionStorage.removeItem('zapmass.openCampaignById');
      } catch {
        /* ignore */
      }
      toast.error('Campanha desta notificação já não existe.');
      return;
    }
    try {
      sessionStorage.removeItem('zapmass.openCampaignById');
    } catch {
      /* ignore */
    }
    setSelectedCampaignId(id);
    setViewState('details');
  }, [campaigns]);

  return (
    <>
      <WhatsAppRiskAcceptModal
        isOpen={riskModalOpen}
        onClose={() => {
          setRiskModalOpen(false);
          setPendingDraft(null);
        }}
        onAccepted={onRiskAccepted}
      />

      {viewState === 'create' ? (
        <NewCampaignWizard
          key={wizardSessionId}
          connections={connections}
          contactLists={contactLists}
          contacts={contacts}
          initialDraft={wizardDraft}
          onDraftConsumed={() => setWizardDraft(null)}
          onCancel={() => {
            setViewState('list');
            setSubTab('overview');
            setWizardDraft(null);
          }}
          onSubmit={handleSubmitCampaign}
        />
      ) : viewState === 'details' && activeCampaign ? (
        <CampaignDetails
          campaign={activeCampaign}
          connections={connections}
          systemLogs={systemLogs}
          onBack={() => {
            setViewState('list');
            setSubTab('campaigns');
          }}
          onTogglePause={toggleCampaignStatus}
        />
      ) : (
        <div className="space-y-5 pb-24 lg:pb-10">

          {/* ── Launch Pad hero ── */}
          {(() => {
            const running = campaigns.filter(c => c.status === CampaignStatus.RUNNING);
            const scheduled = campaigns.filter(c => c.status === CampaignStatus.SCHEDULED);
            const paused = campaigns.filter(c => c.status === CampaignStatus.PAUSED);
            const connOnline = connections.filter(c => c.status === ConnectionStatus.CONNECTED);
            return (
              <div
                className="relative overflow-hidden rounded-[26px] animate-fade-in-up"
                style={{
                  background: 'linear-gradient(145deg,#0c0d1a 0%,#111328 55%,#080910 100%)',
                  border: '1px solid rgba(139,92,246,0.22)',
                  boxShadow: '0 28px 80px -28px rgba(139,92,246,0.22)'
                }}
              >
                {/* Stars bg */}
                <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden>
                  {[...Array(24)].map((_,i) => (
                    <div key={i} className="absolute rounded-full bg-white"
                      style={{
                        width: i%5===0?2:1, height: i%5===0?2:1,
                        top:`${(i*37+11)%95}%`, left:`${(i*53+7)%95}%`,
                        opacity: 0.12 + (i%4)*0.06,
                        animation:`ping ${2+i%3}s cubic-bezier(0,0,0.2,1) infinite ${i*0.3}s`
                      }} />
                  ))}
                </div>
                {/* Acento topo */}
                <div className="absolute inset-x-0 top-0 h-[2px] pointer-events-none"
                  style={{ background:'linear-gradient(90deg,transparent,#8b5cf6 35%,#ec4899 65%,transparent)' }} aria-hidden />
                {/* Glow */}
                <div className="absolute -top-20 right-1/3 w-72 h-72 rounded-full pointer-events-none opacity-15"
                  style={{ background:'radial-gradient(circle,#8b5cf6,transparent 70%)', filter:'blur(48px)' }} aria-hidden />

                <div className="relative z-10 px-5 py-5 sm:px-8 sm:py-7">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
                    {/* Ícone + título */}
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 text-[22px]"
                        style={{ background:'linear-gradient(135deg,#8b5cf6,#6d28d9)', boxShadow:'0 12px 32px -8px rgba(139,92,246,0.6)' }}>
                        🚀
                      </div>
                      <div>
                        <h2 className="text-[18px] sm:text-[22px] font-black leading-tight" style={{ color:'#fff' }}>
                          Launch Pad
                        </h2>
                        <p className="text-[11.5px] mt-0.5" style={{ color:'rgba(255,255,255,0.4)' }}>
                          Central de disparos — {campaigns.length} campanha{campaigns.length !== 1 ? 's' : ''} no total
                        </p>
                      </div>
                    </div>
                    {/* Botão principal */}
                    <button type="button" onClick={requestCreateFlow}
                      className="group inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-bold text-white shrink-0 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
                      style={{ background:'linear-gradient(135deg,#8b5cf6,#6d28d9)', boxShadow:'0 8px 24px -8px rgba(139,92,246,0.7)' }}>
                      <Plus className="w-4 h-4 transition-transform group-hover:rotate-90" />
                      Nova campanha
                    </button>
                  </div>

                  {/* Status tiles */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-5">
                    {[
                      { label:'Em execução', val:running.length, color:'#10b981', emoji:'▶️', onClick:() => setSubTab('campaigns') },
                      { label:'Agendadas', val:scheduled.length, color:'#3b82f6', emoji:'🕐', onClick:() => setSubTab('campaigns') },
                      { label:'Pausadas', val:paused.length, color:'#f59e0b', emoji:'⏸️', onClick:() => setSubTab('campaigns') },
                      { label:'Canais online', val:connOnline.length, color:'#8b5cf6', emoji:'📶', onClick:undefined },
                    ].map(t => (
                      <button key={t.label} type="button" onClick={t.onClick}
                        className="flex flex-col gap-1.5 rounded-xl px-3 py-3 text-left transition-all duration-200 hover:scale-[1.03] disabled:cursor-default"
                        disabled={!t.onClick}
                        style={{ background:`${t.color}10`, border:`1px solid ${t.color}28` }}>
                        <span className="text-[13px]">{t.emoji}</span>
                        <span className="text-[22px] font-black tabular-nums leading-none" style={{ color:'#fff' }}>{t.val}</span>
                        <span className="text-[9.5px] font-bold uppercase tracking-widest" style={{ color:'rgba(255,255,255,0.35)' }}>{t.label}</span>
                      </button>
                    ))}
                  </div>

                  {/* Missões ativas inline */}
                  {running.length > 0 && (
                    <div className="mt-4 flex flex-col gap-2">
                      <span className="text-[9.5px] font-bold uppercase tracking-widest" style={{ color:'rgba(255,255,255,0.3)' }}>
                        Missões em voo
                      </span>
                      {running.slice(0,3).map(c => {
                        const pct = c.totalContacts > 0 ? Math.round((c.successCount/c.totalContacts)*100) : 0;
                        return (
                          <button key={c.id} type="button" onClick={() => openDetails(c.id)}
                            className="flex items-center gap-3 rounded-xl px-4 py-2.5 text-left hover:opacity-90 transition-opacity"
                            style={{ background:'rgba(16,185,129,0.08)', border:'1px solid rgba(16,185,129,0.2)' }}>
                            <span className="text-[16px] shrink-0">🚀</span>
                            <div className="flex-1 min-w-0">
                              <span className="text-[12.5px] font-bold truncate block" style={{ color:'#fff' }}>{c.name}</span>
                              <div className="mt-1 h-1.5 rounded-full overflow-hidden" style={{ background:'rgba(255,255,255,0.06)' }}>
                                <div className="h-full rounded-full transition-all duration-700"
                                  style={{ width:`${pct}%`, background:'linear-gradient(90deg,#10b981,#34d399)' }} />
                              </div>
                            </div>
                            <span className="text-[12px] font-bold shrink-0 tabular-nums" style={{ color:'#10b981' }}>{pct}%</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          <CampaignCockpitHero
            campaigns={campaigns}
            connections={connections}
            onCreate={requestCreateFlow}
            onOpenDetails={openDetails}
            onTogglePause={toggleCampaignStatus}
          />

          <CampaignInsightsBanner
            campaigns={campaigns}
            connections={connections}
            onOpenDetails={openDetails}
            dismissedIds={dismissedInsights}
            onDismiss={dismissInsight}
            onTogglePause={toggleCampaignStatus}
          />

          <CampaignTemplatesGallery onUseTemplate={openWizardWithDraft} />

          {/* Teste de disparo — colapsável */}
          <Card>
            <button
              type="button"
              onClick={() => setTestOpen((v) => !v)}
              className="w-full flex items-center gap-2.5 text-left"
              aria-expanded={testOpen}
            >
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: 'rgba(59,130,246,0.12)' }}
              >
                <Smartphone className="w-4 h-4 text-blue-500" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="ui-title text-[14.5px]">Teste de disparo</h3>
                <p className="ui-subtitle text-[11.5px] truncate">
                  Valide o envio em 1 número antes de rodar uma campanha cheia
                </p>
              </div>
              <Badge variant="info">Depuração</Badge>
              <span
                className="p-1 rounded-md transition-colors shrink-0"
                style={{ color: 'var(--text-3)' }}
                aria-hidden
              >
                {testOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </span>
            </button>

            {testOpen && (
              <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="ui-eyebrow mb-1.5 block">Conexão origem</label>
                    <Select value={testFromConn} onChange={(e) => setTestFromConn(e.target.value)}>
                      <option value="">Selecione...</option>
                      {connections
                        .filter((c) => c.status === ConnectionStatus.CONNECTED)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </Select>
                  </div>
                  <div>
                    <label className="ui-eyebrow mb-1.5 block">Número destino</label>
                    <Input
                      placeholder="Ex: 5511999999999"
                      value={testToPhone}
                      onChange={(e) => setTestToPhone(e.target.value.replace(/\D/g, ''))}
                    />
                  </div>
                  <div>
                    <label className="ui-eyebrow mb-1.5 block">Mensagem</label>
                    <Input
                      value={testMessage}
                      onChange={(e) => setTestMessage(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between mt-4 gap-3 flex-wrap">
                  <div
                    className="text-[12.5px] min-h-[20px]"
                    style={{
                      color: testResult?.startsWith('Enviado')
                        ? 'var(--brand-600)'
                        : testResult?.startsWith('Erro')
                        ? '#ef4444'
                        : 'var(--text-3)'
                    }}
                  >
                    {testResult || 'Aguardando teste...'}
                  </div>
                  <Button
                    variant="primary"
                    leftIcon={<Send className="w-4 h-4" />}
                    disabled={!testFromConn || !testToPhone || !testMessage.trim()}
                    onClick={handleTestDispatch}
                  >
                    Testar disparo
                  </Button>
                </div>
              </div>
            )}
          </Card>

          <div className="flex items-center gap-2 flex-wrap">
            <UITabs
              value={subTab}
              onChange={(v) => handleSubTabChange(v as SubTab)}
              items={[
                { id: 'overview', label: 'Dashboard', icon: <BarChart3 className="w-3.5 h-3.5" /> },
                { id: 'mission', label: 'Centro', icon: <LayoutDashboard className="w-3.5 h-3.5" /> },
                { id: 'campaigns', label: `Campanhas (${campaigns.length})`, icon: <Send className="w-3.5 h-3.5" /> },
                { id: 'create', label: 'Nova', icon: <Plus className="w-3.5 h-3.5" /> }
              ]}
            />
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => setShortcutsOpen(true)}
              className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors"
              style={{
                background: 'var(--surface-1)',
                color: 'var(--text-3)',
                border: '1px solid var(--border-subtle)'
              }}
              title="Atalhos de teclado"
            >
              <Command className="w-3.5 h-3.5" />
              Atalhos
            </button>
          </div>

          {subTab === 'mission' && (
            <CampaignMissionControl
              campaigns={campaigns}
              connections={connections}
              onOpenDetails={openDetails}
              onApplyDraft={(draft) => openWizardWithDraft(draft)}
              onCreate={requestCreateFlow}
            />
          )}

          {subTab === 'overview' && (
            <CampaignsOverview
              campaigns={campaigns}
              connections={connections}
              onOpenDetails={openDetails}
              onViewAll={() => {
                setSubTab('campaigns');
                setViewState('list');
              }}
              onCreate={requestCreateFlow}
            />
          )}

          {subTab === 'campaigns' && (
            <div className="space-y-4">
              <CampaignWeekScheduleView campaigns={campaigns} onOpenDetails={openDetails} />
              <CampaignsList
                campaigns={campaigns}
                onOpenDetails={openDetails}
                onTogglePause={toggleCampaignStatus}
                onDelete={handleDeleteCampaign}
                onDeleteMany={handleDeleteManyCampaigns}
                onClone={(c) => openWizardWithDraft(buildDraftFromCampaign(c))}
              />
            </div>
          )}
        </div>
      )}

      {viewState === 'list' && (
        <CampaignMissionStickyBar
          campaigns={campaigns}
          onOpenDetails={openDetails}
          onTogglePause={toggleCampaignStatus}
        />
      )}

      <Modal
        isOpen={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        title="Atalhos de teclado"
      >
        <div className="space-y-1">
          {[
            { k: 'N', d: 'Nova campanha' },
            { k: '1', d: 'Ir para Dashboard' },
            { k: '2', d: 'Ir para Centro de missões' },
            { k: '3', d: 'Ir para lista de campanhas' },
            { k: 'T', d: 'Abrir/fechar Teste de disparo' },
            { k: '?', d: 'Mostrar esta tela de atalhos' }
          ].map((row) => (
            <div
              key={row.k}
              className="flex items-center justify-between py-1.5"
              style={{ borderBottom: '1px solid var(--border-subtle)' }}
            >
              <span className="text-[13px]" style={{ color: 'var(--text-2)' }}>
                {row.d}
              </span>
              <kbd
                className="text-[11px] font-bold px-2 py-0.5 rounded-md tabular-nums"
                style={{
                  background: 'var(--surface-1)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-1)'
                }}
              >
                {row.k}
              </kbd>
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
};
