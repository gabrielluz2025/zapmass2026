import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, Clock, MessageSquare, Save, Smartphone, Wifi, WifiOff } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Campaign } from '../../types';
import { CampaignStatus, ConnectionStatus, WhatsAppConnection } from '../../types';
import { getCampaignProgressMetrics } from '../../utils/campaignMetrics';
import {
  buildCampaignEditSavePayload,
  campaignToEditForm,
  type CampaignEditFormState,
  type CampaignEditTab
} from '../../utils/campaignEditForm';
import { saveCampaignEdit } from '../../services/campaignsApi';
import { Badge, Button, Input, Modal, Tabs } from '../ui';

type Props = {
  isOpen: boolean;
  campaign: Campaign | null;
  connections: WhatsAppConnection[];
  onClose: () => void;
  onSaved?: () => void;
};

const TAB_ITEMS: Array<{ id: CampaignEditTab; label: string }> = [
  { id: 'message', label: 'Mensagem' },
  { id: 'chips', label: 'Chips' },
  { id: 'pace', label: 'Ritmo e dias' }
];

export const CampaignEditDialog: React.FC<Props> = ({
  isOpen,
  campaign,
  connections,
  onClose,
  onSaved
}) => {
  const [tab, setTab] = useState<CampaignEditTab>('message');
  const [form, setForm] = useState<CampaignEditFormState | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen || !campaign) return;
    setForm(campaignToEditForm(campaign));
    setTab('message');
  }, [isOpen, campaign?.id]);

  const metrics = useMemo(
    () => (campaign ? getCampaignProgressMetrics(campaign) : null),
    [campaign]
  );

  if (!campaign || !form) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="Ajustar campanha" size="lg">
        <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>
          Carregando…
        </p>
      </Modal>
    );
  }

  const isCompleted = campaign.status === CampaignStatus.COMPLETED;
  const onlinePicked = form.selectedConnectionIds.filter(
    (id) => connections.find((c) => c.id === id)?.status === ConnectionStatus.CONNECTED
  ).length;

  const patchForm = (partial: Partial<CampaignEditFormState>) => {
    setForm((prev) => (prev ? { ...prev, ...partial } : prev));
  };

  const toggleChip = (id: string) => {
    setForm((prev) => {
      if (!prev) return prev;
      const has = prev.selectedConnectionIds.includes(id);
      if (has && prev.selectedConnectionIds.length <= 1) return prev;
      return {
        ...prev,
        selectedConnectionIds: has
          ? prev.selectedConnectionIds.filter((x) => x !== id)
          : [...prev.selectedConnectionIds, id]
      };
    });
  };

  const updateDayLimit = (idx: number, limit: number) => {
    setForm((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        dailyScheduleDays: prev.dailyScheduleDays.map((d, i) =>
          i === idx ? { ...d, limitPerChannel: Math.max(1, limit) } : d
        )
      };
    });
  };

  const addScheduleDay = () => {
    setForm((prev) => {
      if (!prev) return prev;
      const nextIndex = prev.dailyScheduleDays.length;
      return {
        ...prev,
        dailyScheduleEnabled: true,
        dailyScheduleDays: [
          ...prev.dailyScheduleDays,
          { dayIndex: nextIndex, limitPerChannel: 100 }
        ]
      };
    });
  };

  const removeScheduleDay = (idx: number) => {
    setForm((prev) => {
      if (!prev || prev.dailyScheduleDays.length <= 1) return prev;
      return {
        ...prev,
        dailyScheduleDays: prev.dailyScheduleDays
          .filter((_, i) => i !== idx)
          .map((d, i) => ({ ...d, dayIndex: i }))
      };
    });
  };

  const handleSave = async () => {
    if (isCompleted) {
      toast.error('Campanha concluída — clone para criar uma nova versão.');
      return;
    }
    if (!form.name.trim()) {
      toast.error('Informe o nome da campanha.');
      setTab('message');
      return;
    }
    if (form.selectedConnectionIds.length === 0) {
      toast.error('Selecione ao menos um chip.');
      setTab('chips');
      return;
    }
    if (!form.hasReplyFlow && !form.message.trim()) {
      toast.error('Escreva a mensagem principal.');
      setTab('message');
      return;
    }

    setSaving(true);
    try {
      const { patch, channelIds } = buildCampaignEditSavePayload(campaign, form);
      await saveCampaignEdit(campaign.id, patch, channelIds, {
        poolId: campaign.poolId ?? null,
        channelWeights: campaign.channelWeights,
        poolStrategy: campaign.poolStrategy
      });
      toast.success('Campanha atualizada. Quem já recebeu não será reenviado.');
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao salvar alterações.', { duration: 9000 });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Ajustar campanha"
      size="lg"
      icon={<Save className="w-5 h-5" style={{ color: 'var(--brand-600)' }} />}
    >
      <div className="space-y-4">
        <div
          className="rounded-xl px-4 py-3 space-y-2"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-bold truncate" style={{ color: 'var(--text-1)' }}>
              {campaign.name}
            </span>
            <Badge variant="neutral">{campaign.status}</Badge>
          </div>
          {metrics && (
            <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>
              Progresso:{' '}
              <strong>
                {metrics.effectiveProcessed} / {campaign.totalContacts || metrics.effectiveProcessed}
              </strong>{' '}
              processados · {metrics.successRatePct}% entregues
            </p>
          )}
          <p className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
            Alterações valem só para envios <strong>pendentes</strong>. Contatos já enviados não voltam ao início.
          </p>
        </div>

        <Tabs items={TAB_ITEMS} value={tab} onChange={(id) => setTab(id as CampaignEditTab)} />

        {tab === 'message' && (
          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                Nome interno
              </label>
              <Input
                value={form.name}
                onChange={(e) => patchForm({ name: e.target.value })}
                className="mt-1"
              />
            </div>
            {form.hasReplyFlow ? (
              <div className="space-y-3">
                <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>
                  Fluxo por respostas — edite o texto de cada etapa:
                </p>
                {form.replyFlowSteps.map((body, idx) => (
                  <div key={idx}>
                    <label className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                      Etapa {idx + 1}
                    </label>
                    <textarea
                      value={body}
                      onChange={(e) => {
                        const next = [...form.replyFlowSteps];
                        next[idx] = e.target.value;
                        patchForm({ replyFlowSteps: next });
                      }}
                      rows={4}
                      className="mt-1 w-full rounded-xl px-3 py-2 text-[13px] resize-y"
                      style={{
                        background: 'var(--surface-0)',
                        border: '1px solid var(--border-subtle)',
                        color: 'var(--text-1)'
                      }}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                  Mensagem principal
                </label>
                <textarea
                  value={form.message}
                  onChange={(e) => patchForm({ message: e.target.value })}
                  rows={6}
                  className="mt-1 w-full rounded-xl px-3 py-2 text-[13px] resize-y"
                  style={{
                    background: 'var(--surface-0)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-1)'
                  }}
                />
              </div>
            )}
          </div>
        )}

        {tab === 'chips' && (
          <div className="space-y-3">
            <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>
              Escolha os chips para os envios pendentes. Offline pode ficar selecionado — o sistema usa os
              online na hora do disparo.
            </p>
            {onlinePicked === 0 && form.selectedConnectionIds.length > 0 && (
              <div
                className="rounded-lg px-3 py-2 flex items-start gap-2 text-[12px]"
                style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)' }}
              >
                <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <span style={{ color: 'var(--text-2)' }}>
                  Nenhum chip selecionado está online agora. Reconecte ou escolha outro chip.
                </span>
              </div>
            )}
            <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
              {connections.map((conn) => {
                const checked = form.selectedConnectionIds.includes(conn.id);
                const online = conn.status === ConnectionStatus.CONNECTED;
                return (
                  <button
                    key={conn.id}
                    type="button"
                    onClick={() => toggleChip(conn.id)}
                    className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left"
                    style={{
                      background: checked ? 'rgba(16,185,129,0.08)' : 'var(--surface-1)',
                      border: checked
                        ? '1px solid rgba(16,185,129,0.35)'
                        : '1px solid var(--border-subtle)'
                    }}
                  >
                    <div
                      className="w-5 h-5 rounded-md flex items-center justify-center shrink-0"
                      style={{
                        background: checked ? 'var(--brand-600)' : 'transparent',
                        border: checked ? 'none' : '1.5px solid var(--border-strong)'
                      }}
                    >
                      {checked && <Check className="w-3 h-3 text-white" />}
                    </div>
                    <Smartphone className="w-4 h-4 shrink-0" style={{ color: 'var(--text-3)' }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-bold truncate" style={{ color: 'var(--text-1)' }}>
                        {conn.name}
                      </p>
                      <p className="text-[11px] font-mono truncate" style={{ color: 'var(--text-3)' }}>
                        {conn.phoneNumber || 'Sem número'}
                      </p>
                    </div>
                    <span
                      className="flex items-center gap-1 text-[10px] font-bold shrink-0"
                      style={{ color: online ? '#10b981' : '#ef4444' }}
                    >
                      {online ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                      {online ? 'Online' : 'Offline'}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
              {form.selectedConnectionIds.length} chip(s) selecionado(s) · {onlinePicked} online agora
            </p>
          </div>
        )}

        {tab === 'pace' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                  Intervalo mínimo (s)
                </label>
                <Input
                  type="number"
                  min={5}
                  value={String(form.delaySeconds)}
                  onChange={(e) => patchForm({ delaySeconds: Math.max(5, Number(e.target.value) || 45) })}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                  Intervalo máximo (s)
                </label>
                <Input
                  type="number"
                  min={form.delaySeconds}
                  value={String(form.delaySecondsMax)}
                  onChange={(e) =>
                    patchForm({
                      delaySecondsMax: Math.max(form.delaySeconds, Number(e.target.value) || form.delaySeconds)
                    })
                  }
                  className="mt-1"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => patchForm({ humanizedPauses: !form.humanizedPauses })}
              className="w-full flex items-center justify-between rounded-xl px-3 py-2.5 text-left"
              style={{
                background: form.humanizedPauses ? 'rgba(16,185,129,0.08)' : 'var(--surface-1)',
                border: `1px solid ${form.humanizedPauses ? 'rgba(16,185,129,0.3)' : 'var(--border-subtle)'}`
              }}
            >
              <div>
                <p className="text-[12px] font-semibold" style={{ color: 'var(--text-1)' }}>
                  Pausas humanizadas
                </p>
                <p className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>
                  Pausas extras ocasionais entre blocos de mensagens
                </p>
              </div>
              <Clock className="w-4 h-4" style={{ color: form.humanizedPauses ? '#10b981' : 'var(--text-3)' }} />
            </button>

            <div
              className="rounded-xl p-3 space-y-3"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
            >
              <button
                type="button"
                onClick={() => {
                  const next = !form.dailyScheduleEnabled;
                  patchForm({
                    dailyScheduleEnabled: next,
                    dailyScheduleDays:
                      next && form.dailyScheduleDays.length === 0
                        ? [{ dayIndex: 0, limitPerChannel: 100 }]
                        : form.dailyScheduleDays
                  });
                }}
                className="w-full flex items-center justify-between"
              >
                <div className="text-left">
                  <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
                    Cronograma diário
                  </p>
                  <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                    Limite de mensagens por chip em cada dia
                  </p>
                </div>
                <Badge variant={form.dailyScheduleEnabled ? 'success' : 'neutral'}>
                  {form.dailyScheduleEnabled ? 'Ativo' : 'Off'}
                </Badge>
              </button>

              {form.dailyScheduleEnabled && (
                <div className="space-y-2">
                  {form.dailyScheduleDays.map((day, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-2 rounded-lg px-2 py-2"
                      style={{ background: 'var(--surface-0)', border: '1px solid var(--border-subtle)' }}
                    >
                      <span className="text-[12px] font-semibold w-14 shrink-0" style={{ color: 'var(--text-2)' }}>
                        Dia {idx + 1}
                      </span>
                      <Input
                        type="number"
                        min={1}
                        value={String(day.limitPerChannel)}
                        onChange={(e) => updateDayLimit(idx, Number(e.target.value) || 1)}
                        containerClassName="flex-1"
                      />
                      <span className="text-[11px] shrink-0" style={{ color: 'var(--text-3)' }}>
                        msg/chip
                      </span>
                      {form.dailyScheduleDays.length > 1 && (
                        <Button variant="ghost" size="sm" onClick={() => removeScheduleDay(idx)}>
                          Remover
                        </Button>
                      )}
                    </div>
                  ))}
                  <Button variant="secondary" size="sm" onClick={addScheduleDay}>
                    + Adicionar dia
                  </Button>
                  <p className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>
                    Total programado:{' '}
                    {form.dailyScheduleDays.reduce(
                      (acc, d) => acc + d.limitPerChannel * Math.max(1, form.selectedConnectionIds.length),
                      0
                    )}{' '}
                    mensagens (todos os chips)
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            leftIcon={<MessageSquare className="w-4 h-4" />}
            loading={saving}
            disabled={isCompleted}
            onClick={() => void handleSave()}
          >
            Salvar alterações
          </Button>
        </div>
      </div>
    </Modal>
  );
};
