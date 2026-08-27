import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Cake,
  Calendar,
  Clock,
  Send,
  Sparkles,
  Smartphone,
  User,
  Zap,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Button, Modal, Select, Textarea, Badge } from '../ui';
import { ConnectionStatus, type CampaignScheduleSlot, type WhatsAppConnection } from '../../types';
import { DEFAULT_BIRTHDAY_TEMPLATE } from '../../constants/birthdayTemplates';
import { CampaignAttachmentBlock, type CampaignAttachmentState } from '../campaigns/CampaignAttachmentBlock';
import { SavedMediaLibraryPicker } from '../campaigns/SavedMediaLibraryPicker';
import { prepareCampaignAttachmentPayload } from '../../utils/campaignMediaLibrary';
import { campaignRecipientNameVars } from '../../utils/contactNameNormalize';
import { campaignClockVars } from '../../utils/campaignClockVars';
import { ensureDispatchReady, formatDispatchUnavailableMessage } from '../../services/campaignsApi';
import { markBirthdayGreetedMany } from '../../utils/birthdayGreeted';
import {
  BIRTHDAY_SCHEDULE_TZ,
  type BirthdayDispatchMode,
  type BirthdayPerson,
  formatBirthdayWhen,
  formatSendDateLabel,
  groupBirthdaysBySendDate,
  shouldSendBirthdayImmediately,
  buildBirthdayRecipients,
} from '../../utils/birthdayDispatch';

type Props = {
  open: boolean;
  onClose: () => void;
  connections: WhatsAppConnection[];
  todaysBirthdays: BirthdayPerson[];
  weekBirthdays: BirthdayPerson[];
  startCampaign: (
    sessionId: string,
    numbers: string[],
    message: string,
    connectionIds?: string[],
    contactListMeta?: { id?: string; name?: string },
    campaignName?: string,
    options?: {
      delaySeconds?: number;
      recipients?: Array<{ phone: string; vars: Record<string, string> }>;
      skipFrequencyCap?: boolean;
      mediaAttachment?: {
        dataBase64: string;
        mimeType: string;
        fileName: string;
        sendMediaAsDocument?: boolean;
      };
    }
  ) => Promise<string>;
  scheduleCampaign: (
    sessionId: string,
    numbers: string[],
    message: string,
    connectionIds: string[] | undefined,
    contactListMeta: { id?: string; name?: string } | undefined,
    campaignName: string | undefined,
    schedule: {
      timeZone: string;
      slots: CampaignScheduleSlot[];
      repeatWeekly: boolean;
      onceLocalDate?: string;
      onceLocalTime?: string;
    },
    options?: {
      delaySeconds?: number;
      recipients?: Array<{ phone: string; vars: Record<string, string> }>;
      skipFrequencyCap?: boolean;
    }
  ) => Promise<string>;
  onDispatched: () => void;
};

function renderTemplate(tpl: string, b: BirthdayPerson): string {
  const nv = campaignRecipientNameVars(b.name || '');
  const clock = campaignClockVars();
  const vars: Record<string, string> = {
    ...clock,
    nome: nv.nome,
    nome_completo: nv.nome_completo,
    telefone: b.phone,
    aniversario: b.birthdayLabel,
    idade: b.age != null ? String(b.age) : '',
  };
  return tpl.replace(/\{\{?\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}?\}/g, (match, key) => {
    const v = vars[String(key).toLowerCase()];
    return v !== undefined ? v : match;
  });
}

export const BirthdayBulkModal: React.FC<Props> = ({
  open,
  onClose,
  connections,
  todaysBirthdays,
  weekBirthdays,
  startCampaign,
  scheduleCampaign,
  onDispatched,
}) => {
  const [step, setStep] = useState<'compose' | 'preview'>('compose');
  const [mode, setMode] = useState<BirthdayDispatchMode>('today_now');
  const [template, setTemplate] = useState(DEFAULT_BIRTHDAY_TEMPLATE);
  const [connectionId, setConnectionId] = useState('');
  const [scheduleTime, setScheduleTime] = useState('09:00');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [attachment, setAttachment] = useState<CampaignAttachmentState | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  const candidates = useMemo(
    () => (mode === 'today_now' ? todaysBirthdays : weekBirthdays),
    [mode, todaysBirthdays, weekBirthdays]
  );

  const selectedList = useMemo(
    () => candidates.filter((b) => selectedIds.has(b.id)),
    [candidates, selectedIds]
  );

  const scheduleGroups = useMemo(
    () => groupBirthdaysBySendDate(selectedList),
    [selectedList]
  );

  const allSelected = candidates.length > 0 && candidates.every((b) => selectedIds.has(b.id));

  useEffect(() => {
    if (!open) return;
    const firstOnline = connections.find((c) => c.status === ConnectionStatus.CONNECTED);
    if (firstOnline && !connectionId) setConnectionId(firstOnline.id);
  }, [open, connections, connectionId]);

  useEffect(() => {
    if (!open) return;
    setStep('compose');
    setMode('today_now');
    setTemplate(DEFAULT_BIRTHDAY_TEMPLATE);
    setScheduleTime('09:00');
    setPreviewIndex(0);
    setSelectedIds(new Set(todaysBirthdays.map((b) => b.id)));
    setAttachment(null);
  }, [open, todaysBirthdays]);

  const pickAttachment = useCallback((file: File | null) => {
    setAttachment((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      if (!file) return null;
      const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
      const next: CampaignAttachmentState = { file, previewUrl, preparing: true };
      void (async () => {
        try {
          const mediaPayload = await prepareCampaignAttachmentPayload(file);
          setAttachment((p) =>
            p?.file === file
              ? { ...p, mediaPayload, preparing: false, sendAsDocument: mediaPayload.sendMediaAsDocument }
              : p
          );
        } catch (err) {
          setAttachment(null);
          toast.error(err instanceof Error ? err.message : 'Não foi possível preparar o anexo.');
        }
      })();
      return next;
    });
  }, []);

  const switchMode = (next: BirthdayDispatchMode) => {
    setMode(next);
    const list = next === 'today_now' ? todaysBirthdays : weekBirthdays;
    setSelectedIds(new Set(list.map((b) => b.id)));
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      if (candidates.every((b) => prev.has(b.id))) {
        return new Set(Array.from(prev).filter((id) => !candidates.some((b) => b.id === id)));
      }
      const next = new Set(prev);
      candidates.forEach((b) => next.add(b.id));
      return next;
    });
  };

  const goToPreview = async () => {
    if (!connectionId) {
      toast.error('Selecione um canal online para disparar.');
      return;
    }
    if (selectedList.length === 0) {
      toast.error('Selecione pelo menos um aniversariante.');
      return;
    }
    if (!template.trim()) {
      toast.error('Escreva a mensagem que será enviada.');
      return;
    }
    if (mode === 'week_schedule' && attachment?.file) {
      toast('Anexo só no envio imediato de hoje. Programação da semana usa texto.', { icon: 'ℹ️', duration: 5000 });
    }
    if (attachment?.preparing) {
      toast.error('Aguarde o anexo terminar de carregar.');
      return;
    }
    if (attachment?.file && !attachment.mediaPayload) {
      try {
        const mediaPayload = await prepareCampaignAttachmentPayload(attachment.file);
        setAttachment((prev) => (prev ? { ...prev, mediaPayload, preparing: false } : prev));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Não foi possível ler o anexo.');
        return;
      }
    }
    setPreviewIndex(0);
    setStep('preview');
  };

  const handleSubmit = async () => {
    if (!template.trim() || selectedList.length === 0) return;

    let channelId = connectionId;
    if (!channelId) {
      const firstOnline = connections.find((c) => c.status === ConnectionStatus.CONNECTED);
      if (firstOnline) {
        channelId = firstOnline.id;
        setConnectionId(firstOnline.id);
      }
    }
    const conn = connections.find((c) => c.id === channelId);
    if (!conn || conn.status !== ConnectionStatus.CONNECTED) {
      toast.error('Canal offline ou suspenso. Reconecte o chip antes de disparar.');
      return;
    }

    const dispatchHealth = await ensureDispatchReady({ maxAttempts: 2, tryReconnect: true });
    if (!dispatchHealth.ok) {
      toast.error(formatDispatchUnavailableMessage(dispatchHealth), { duration: 12_000 });
      return;
    }

    let mediaAttachment = attachment?.mediaPayload;
    if (!mediaAttachment && attachment?.file) {
      mediaAttachment = await prepareCampaignAttachmentPayload(attachment.file);
    }

    setSubmitting(true);
    try {
      if (mode === 'today_now') {
        const recipients = buildBirthdayRecipients(selectedList);
        const numbers = recipients.map((r) => r.phone);
        await startCampaign(
          channelId,
          numbers,
          template.trim(),
          [channelId],
          { name: `Aniversariantes hoje (${selectedList.length})` },
          `Parabéns — ${new Date().toLocaleDateString('pt-BR')}`,
          {
            delaySeconds: 10,
            recipients,
            skipFrequencyCap: true,
            ...(mediaAttachment ? { mediaAttachment } : {}),
          }
        );
        markBirthdayGreetedMany(selectedList.map((b) => b.id));
        toast.success(`Disparo iniciado para ${selectedList.length} aniversariante(s) de hoje.`);
      } else {
        const groups = scheduleGroups;
        let immediate = 0;
        let scheduled = 0;

        for (const { date, people } of groups) {
          const recipients = buildBirthdayRecipients(people);
          const numbers = recipients.map((r) => r.phone);
          const label = formatSendDateLabel(date);
          const sendNow = shouldSendBirthdayImmediately(date, scheduleTime, BIRTHDAY_SCHEDULE_TZ);

          if (sendNow) {
            await startCampaign(
              channelId,
              numbers,
              template.trim(),
              [channelId],
              { name: `Aniversário ${label} (${people.length})` },
              `Parabéns ${label} — imediato`,
              {
                delaySeconds: 10,
                recipients,
                skipFrequencyCap: true,
                ...(date === people[0]?.sendLocalDate &&
                people.every((p) => p.daysRemaining === 0) &&
                mediaAttachment
                  ? { mediaAttachment }
                  : {}),
              }
            );
            markBirthdayGreetedMany(people.map((b) => b.id));
            immediate += people.length;
          } else {
            await scheduleCampaign(
              channelId,
              numbers,
              template.trim(),
              [channelId],
              { name: `Aniversário ${label} (${people.length})` },
              `Parabéns ${label} às ${scheduleTime}`,
              {
                timeZone: BIRTHDAY_SCHEDULE_TZ,
                slots: [],
                repeatWeekly: false,
                onceLocalDate: date,
                onceLocalTime: scheduleTime,
              },
              { delaySeconds: 10, recipients, skipFrequencyCap: true }
            );
            scheduled += people.length;
          }
        }

        const parts: string[] = [];
        if (immediate > 0) parts.push(`${immediate} enviado(s) agora`);
        if (scheduled > 0) parts.push(`${scheduled} programado(s) no dia do aniversário`);
        toast.success(
          `${groups.length} lote(s) criado(s). ${parts.join(' · ')}. Acompanhe em Campanhas.`,
          { duration: 6000 }
        );
      }

      onDispatched();
      onClose();
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : 'Falha ao iniciar disparo.';
      toast.error(raw, { duration: 12_000 });
    } finally {
      setSubmitting(false);
    }
  };

  const bulkChannel = connections.find((c) => c.id === connectionId);

  const listByDate = useMemo(() => {
    if (mode !== 'week_schedule') return null;
    return groupBirthdaysBySendDate(candidates);
  }, [mode, candidates]);

  return (
    <Modal
      isOpen={open}
      onClose={() => {
        if (submitting) return;
        onClose();
        setStep('compose');
      }}
      title={step === 'compose' ? 'Parabéns automáticos' : 'Revisar antes de confirmar'}
      subtitle={
        step === 'compose'
          ? 'Envie hoje ou programe a semana — cada pessoa recebe no dia do aniversário'
          : mode === 'week_schedule'
            ? `${scheduleGroups.length} dia(s) · ${selectedList.length} mensagem(ns) personalizadas`
            : `${selectedList.length} mensagem(ns) para enviar agora`
      }
      icon={<Cake className="w-5 h-5 text-pink-500" />}
      size="lg"
      footer={
        step === 'compose' ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              leftIcon={<Sparkles className="w-4 h-4" />}
              disabled={
                selectedList.length === 0 ||
                !connectionId ||
                !template.trim() ||
                attachment?.preparing
              }
              onClick={() => void goToPreview()}
            >
              Revisar ({selectedList.length})
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setStep('compose')} disabled={submitting}>
              Voltar
            </Button>
            <Button
              variant="primary"
              leftIcon={mode === 'today_now' ? <Zap className="w-4 h-4" /> : <Calendar className="w-4 h-4" />}
              disabled={submitting || attachment?.preparing}
              onClick={() => void handleSubmit()}
            >
              {submitting
                ? 'Processando…'
                : mode === 'today_now'
                  ? `Enviar agora (${selectedList.length})`
                  : `Programar ${selectedList.length} parabéns`}
            </Button>
          </>
        )
      }
    >
      {step === 'compose' ? (
        <div className="space-y-5">
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => switchMode('today_now')}
              className="rounded-xl p-4 text-left transition-all border-2"
              style={{
                borderColor: mode === 'today_now' ? '#ec4899' : 'var(--border-subtle)',
                background:
                  mode === 'today_now'
                    ? 'linear-gradient(135deg, rgba(236,72,153,0.12), rgba(236,72,153,0.04))'
                    : 'var(--surface-1)',
              }}
            >
              <div className="flex items-center gap-2 mb-1">
                <Zap className="w-4 h-4 text-pink-500" />
                <span className="text-[11px] font-bold uppercase tracking-wide text-pink-500">Hoje</span>
              </div>
              <p className="text-2xl font-black tabular-nums" style={{ color: 'var(--text-1)' }}>
                {todaysBirthdays.length}
              </p>
              <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                Enviar agora
              </p>
            </button>
            <button
              type="button"
              onClick={() => switchMode('week_schedule')}
              className="rounded-xl p-4 text-left transition-all border-2"
              style={{
                borderColor: mode === 'week_schedule' ? '#8b5cf6' : 'var(--border-subtle)',
                background:
                  mode === 'week_schedule'
                    ? 'linear-gradient(135deg, rgba(139,92,246,0.12), rgba(139,92,246,0.04))'
                    : 'var(--surface-1)',
              }}
            >
              <div className="flex items-center gap-2 mb-1">
                <Calendar className="w-4 h-4 text-violet-500" />
                <span className="text-[11px] font-bold uppercase tracking-wide text-violet-500">Semana</span>
              </div>
              <p className="text-2xl font-black tabular-nums" style={{ color: 'var(--text-1)' }}>
                {weekBirthdays.length}
              </p>
              <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                1 msg no dia de cada um
              </p>
            </button>
          </div>

          <div
            className="rounded-xl px-3 py-2.5 text-[12px] flex items-start gap-2"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
          >
            {mode === 'today_now' ? (
              <>
                <Zap className="w-4 h-4 shrink-0 text-pink-500 mt-0.5" />
                <span style={{ color: 'var(--text-2)' }}>
                  Dispara <strong>agora</strong> para quem faz aniversário <strong>hoje</strong>. Ideal para felicitar no mesmo dia.
                </span>
              </>
            ) : (
              <>
                <Clock className="w-4 h-4 shrink-0 text-violet-500 mt-0.5" />
                <span style={{ color: 'var(--text-2)' }}>
                  Cria campanhas agendadas: cada contato recebe a mensagem <strong>no dia do aniversário</strong>, no horário escolhido abaixo.
                </span>
              </>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="ui-eyebrow mb-1.5 block">Canal de envio</label>
              <Select value={connectionId} onChange={(e) => setConnectionId(e.target.value)}>
                <option value="">Selecione…</option>
                {connections.map((c) => (
                  <option key={c.id} value={c.id} disabled={c.status !== ConnectionStatus.CONNECTED}>
                    {c.name} {c.status !== ConnectionStatus.CONNECTED ? '(offline)' : ''}
                  </option>
                ))}
              </Select>
            </div>
            {mode === 'week_schedule' && (
              <div>
                <label className="ui-eyebrow mb-1.5 block">Horário do parabéns</label>
                <input
                  type="time"
                  className="ui-input w-full"
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                />
                <p className="text-[10.5px] mt-1" style={{ color: 'var(--text-3)' }}>
                  Fuso: Brasília · Se já passou hoje, envia na hora
                </p>
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="ui-eyebrow">Mensagem</label>
              <Badge variant="info">{'{nome} {idade} {aniversario}'}</Badge>
            </div>
            <Textarea
              rows={5}
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              placeholder={DEFAULT_BIRTHDAY_TEMPLATE}
            />
          </div>

          <CampaignAttachmentBlock
            compact
            attachment={attachment}
            inputRef={attachmentInputRef}
            onPick={pickAttachment}
            onRemove={() => pickAttachment(null)}
          />
          {mode === 'week_schedule' && attachment?.file && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              Anexo aplicado só aos envios imediatos de hoje (se o horário já passou).
            </p>
          )}
          <SavedMediaLibraryPicker
            compact
            currentFile={attachment?.file ?? null}
            onPick={pickAttachment}
          />

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="ui-eyebrow">
                Selecionados ({selectedList.length} de {candidates.length})
              </label>
              <button
                type="button"
                onClick={toggleSelectAll}
                className="text-[11.5px] font-semibold hover:underline"
                style={{ color: 'var(--brand-600)' }}
              >
                {allSelected ? 'Desmarcar todos' : 'Selecionar todos'}
              </button>
            </div>

            <div
              className="rounded-xl max-h-[280px] overflow-y-auto"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
            >
              {candidates.length === 0 ? (
                <div className="py-10 text-center text-[13px]" style={{ color: 'var(--text-3)' }}>
                  {mode === 'today_now'
                    ? 'Nenhum aniversariante hoje com telefone válido.'
                    : 'Nenhum aniversariante nos próximos 7 dias.'}
                </div>
              ) : mode === 'week_schedule' && listByDate ? (
                listByDate.map(({ date, people }) => (
                  <div key={date}>
                    <div
                      className="sticky top-0 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider backdrop-blur-sm"
                      style={{ background: 'color-mix(in srgb, var(--surface-1) 92%, transparent)', color: 'var(--text-3)' }}
                    >
                      {formatSendDateLabel(date)} · {people.length} contato(s)
                    </div>
                    {people.map((b) => (
                      <BirthdayRow
                        key={b.id}
                        b={b}
                        checked={selectedIds.has(b.id)}
                        onToggle={() => toggleSelect(b.id)}
                      />
                    ))}
                  </div>
                ))
              ) : (
                candidates.map((b) => (
                  <BirthdayRow
                    key={b.id}
                    b={b}
                    checked={selectedIds.has(b.id)}
                    onToggle={() => toggleSelect(b.id)}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div
            className="flex flex-wrap items-center gap-3 p-3 rounded-xl"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
          >
            <Smartphone className="w-4 h-4 shrink-0" style={{ color: 'var(--text-3)' }} />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                Canal · {mode === 'today_now' ? 'Envio imediato' : `Programado às ${scheduleTime}`}
              </p>
              <p className="text-[13px] font-semibold truncate">{bulkChannel?.name || '—'}</p>
            </div>
            {bulkChannel?.status === ConnectionStatus.CONNECTED ? (
              <Badge variant="success" dot>
                Online
              </Badge>
            ) : (
              <Badge variant="warning">Offline</Badge>
            )}
          </div>

          {mode === 'week_schedule' && (
            <div
              className="rounded-xl p-3 space-y-2"
              style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)' }}
            >
              <p className="text-[12px] font-bold text-violet-600 dark:text-violet-400">Cronograma da semana</p>
              {scheduleGroups.map(({ date, people }) => {
                const immediate = shouldSendBirthdayImmediately(date, scheduleTime, BIRTHDAY_SCHEDULE_TZ);
                return (
                  <div key={date} className="flex justify-between text-[12px]" style={{ color: 'var(--text-2)' }}>
                    <span>
                      {formatSendDateLabel(date)} — {people.length} contato(s)
                    </span>
                    <span className="font-semibold">{immediate ? '⚡ Agora' : `🕐 ${scheduleTime}`}</span>
                  </div>
                );
              })}
            </div>
          )}

          {selectedList.length === 0 ? (
            <p className="py-8 text-center text-[13px]" style={{ color: 'var(--text-3)' }}>
              Nenhum contato selecionado.
            </p>
          ) : (
            <>
              <div
                className="flex items-center justify-between p-2 rounded-lg"
                style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={previewIndex === 0}
                  onClick={() => setPreviewIndex((i) => Math.max(0, i - 1))}
                >
                  ← Anterior
                </Button>
                <p className="text-[12px] font-semibold">
                  {previewIndex + 1} / {selectedList.length} — {selectedList[previewIndex]?.name}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={previewIndex >= selectedList.length - 1}
                  onClick={() => setPreviewIndex((i) => Math.min(selectedList.length - 1, i + 1))}
                >
                  Próxima →
                </Button>
              </div>

              {selectedList[previewIndex] && (() => {
                const b = selectedList[previewIndex];
                const rendered = renderTemplate(template, b);
                return (
                  <div
                    className="rounded-xl p-4"
                    style={{
                      background: 'linear-gradient(135deg, rgba(236,72,153,0.06), rgba(139,92,246,0.06))',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    <div className="flex items-center gap-3 pb-3 mb-3 border-b border-[var(--border-subtle)]">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center bg-pink-500/15 text-pink-500">
                        <User className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold truncate">{b.name}</p>
                        <p className="text-[11px] font-mono opacity-70">+{b.phone}</p>
                      </div>
                      <div className="text-right text-[11px]">
                        <p>{b.birthdayLabel}</p>
                        <p className="font-bold text-pink-500">{formatBirthdayWhen(b.daysRemaining)}</p>
                      </div>
                    </div>
                    <div
                      className="rounded-lg px-3 py-2 text-[13px] whitespace-pre-wrap max-w-[92%] ml-auto"
                      style={{ background: '#d9fdd3', color: '#111' }}
                    >
                      {rendered}
                    </div>
                  </div>
                );
              })()}
            </>
          )}
        </div>
      )}
    </Modal>
  );
};

function BirthdayRow({
  b,
  checked,
  onToggle,
}: {
  b: BirthdayPerson;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-[var(--surface-2)] border-b border-[var(--border-subtle)] last:border-0">
      <input type="checkbox" checked={checked} onChange={onToggle} className="w-4 h-4 accent-pink-500" />
      <div
        className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
          b.daysRemaining === 0 ? 'bg-pink-500/15 text-pink-500' : 'bg-violet-500/10 text-violet-500'
        }`}
      >
        {b.daysRemaining === 0 ? <Cake className="w-4 h-4" /> : <User className="w-4 h-4" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold truncate">
          {b.name}
          {b.age != null && (
            <span className="ml-1.5 text-[11px] font-normal opacity-60">{b.age} anos</span>
          )}
        </p>
        <p className="text-[11px] font-mono opacity-60">+{b.phone}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-[12px] font-semibold">{b.birthdayLabel}</p>
        <p
          className="text-[10.5px] font-bold"
          style={{ color: b.daysRemaining === 0 ? '#ec4899' : 'var(--text-3)' }}
        >
          {formatBirthdayWhen(b.daysRemaining)}
        </p>
      </div>
    </label>
  );
}
