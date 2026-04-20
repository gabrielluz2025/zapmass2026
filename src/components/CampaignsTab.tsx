import React, { useState } from 'react';
import { BarChart3, CheckCircle2, LayoutDashboard, Plus, Rocket, Send, Smartphone, Target } from 'lucide-react';
import toast from 'react-hot-toast';
import { CampaignReplyFlow, CampaignStatus, ConnectionStatus, WhatsAppConnection } from '../types';
import type { CampaignWizardDraft } from '../types/campaignMission';
import { useZapMass } from '../context/ZapMassContext';
import { useAuth } from '../context/AuthContext';
import { isWhatsAppRiskAcknowledged, saveWhatsAppRiskAck } from '../utils/whatsappRiskStorage';
import { appendAudit } from '../utils/campaignMissionStorage';
import { buildDraftFromCampaign } from '../utils/campaignDraft';
import { Badge, Button, Card, Input, SectionHeader, Select, StatCard, Tabs as UITabs } from './ui';
import {
  CampaignDetails,
  CampaignMissionControl,
  CampaignMissionStickyBar,
  CampaignsList,
  CampaignsOverview,
  NewCampaignWizard
} from './campaigns';
import { WhatsAppRiskAcceptModal } from './legal/WhatsAppRiskAcceptModal';

interface CampaignsTabProps {
  connections: WhatsAppConnection[];
}

type SubTab = 'overview' | 'mission' | 'campaigns' | 'create';

export const CampaignsTab: React.FC<CampaignsTabProps> = ({ connections }) => {
  const { user } = useAuth();
  const {
    campaigns,
    contactLists,
    contacts,
    socket,
    startCampaign,
    pauseCampaign,
    resumeCampaign,
    deleteCampaign,
    deleteCampaigns,
    systemLogs
  } = useZapMass();

  const [subTab, setSubTab] = useState<SubTab>('overview');
  const [viewState, setViewState] = useState<'list' | 'create' | 'details'>('list');
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [riskModalOpen, setRiskModalOpen] = useState(false);
  const [testFromConn, setTestFromConn] = useState<string>('');
  const [testToPhone, setTestToPhone] = useState<string>('');
  const [testMessage, setTestMessage] = useState<string>('Teste de disparo - ZapMass');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [wizardDraft, setWizardDraft] = useState<CampaignWizardDraft | null>(null);
  const [wizardSessionId, setWizardSessionId] = useState(0);
  const [pendingDraft, setPendingDraft] = useState<CampaignWizardDraft | null>(null);

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
      toast.error('Faca login para criar campanhas.');
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
  const runningCampaigns = campaigns.filter((c) => c.status === CampaignStatus.RUNNING).length;
  const completedCampaigns = campaigns.filter((c) => c.status === CampaignStatus.COMPLETED).length;
  const onlineCount = connections.filter((c) => c.status === ConnectionStatus.CONNECTED).length;

  const openDetails = (id: string) => {
    setSelectedCampaignId(id);
    setViewState('details');
  };

  const toggleCampaignStatus = (id: string) => {
    const campaign = campaigns.find((c) => c.id === id);
    if (!campaign) return;
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
  }) => {
    if (payload.connectedIds.length === 0) {
      toast.error('Selecione pelo menos um chip conectado para disparar.');
      throw new Error('Sem chips conectados');
    }
    if (payload.numbers.length === 0) {
      toast.error('Nenhum numero valido foi encontrado.');
      throw new Error('Sem numeros');
    }

    const id = await startCampaign(
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
        replyFlow: payload.replyFlow
      }
    );
    appendAudit({
      action: 'campaign_create',
      label: payload.name,
      campaignId: id
    });

    const isAbA = payload.name.includes(' — Var A');
    const isAbB = payload.name.includes(' — Var B');
    if (isAbA) {
      return;
    }
    if (isAbB) {
      toast.success('Laboratório A/B: as duas campanhas foram iniciadas. Compare os resultados na lista.');
    } else {
      toast.success('Campanha iniciada com sucesso.');
    }
    setViewState('list');
    setSubTab('overview');
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
          <SectionHeader
            eyebrow={
              <>
                <Rocket className="w-3 h-3" />
                Campanhas
              </>
            }
            title="Campanhas WhatsApp"
            description="Dashboard, centro de missões (linha do tempo, chips, modelos), lista e criação com laboratório A/B."
            icon={<Rocket className="w-5 h-5" style={{ color: 'var(--brand-600)' }} />}
            actions={
              <Button variant="primary" size="lg" leftIcon={<Plus className="w-4 h-4" />} onClick={requestCreateFlow}>
                Nova Campanha
              </Button>
            }
          />

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Total" value={campaigns.length} icon={<Target className="w-4 h-4" />} />
            <StatCard label="Ativas" value={runningCampaigns} icon={<Send className="w-4 h-4" />} accent="success" />
            <StatCard
              label="Concluidas"
              value={completedCampaigns}
              icon={<CheckCircle2 className="w-4 h-4" />}
              accent="info"
            />
            <StatCard
              label="Chips Online"
              value={onlineCount}
              icon={<Smartphone className="w-4 h-4" />}
              accent="warning"
            />
          </div>

          <Card>
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(59,130,246,0.12)' }}>
                <Smartphone className="w-4 h-4 text-blue-500" />
              </div>
              <div className="flex-1">
                <h3 className="ui-title text-[15px]">Teste de disparo</h3>
                <p className="ui-subtitle text-[12px]">Valide o envio antes de rodar campanha grande</p>
              </div>
              <Badge variant="info">Depuracao</Badge>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="ui-eyebrow mb-1.5 block">Conexao origem</label>
                <Select value={testFromConn} onChange={(e) => setTestFromConn(e.target.value)}>
                  <option value="">Selecione...</option>
                  {connections.filter((c) => c.status === ConnectionStatus.CONNECTED).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="ui-eyebrow mb-1.5 block">Numero destino</label>
                <Input
                  placeholder="Ex: 5511999999999"
                  value={testToPhone}
                  onChange={(e) => setTestToPhone(e.target.value.replace(/\D/g, ''))}
                />
              </div>
              <div>
                <label className="ui-eyebrow mb-1.5 block">Mensagem</label>
                <Input value={testMessage} onChange={(e) => setTestMessage(e.target.value)} />
              </div>
            </div>
            <div className="flex items-center justify-between mt-4 gap-3">
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
          </Card>

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
            <CampaignsList
              campaigns={campaigns}
              onOpenDetails={openDetails}
              onTogglePause={toggleCampaignStatus}
              onDelete={handleDeleteCampaign}
              onDeleteMany={handleDeleteManyCampaigns}
              onClone={(c) => openWizardWithDraft(buildDraftFromCampaign(c))}
            />
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
    </>
  );
};
