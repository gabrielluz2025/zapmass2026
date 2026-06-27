import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Clock, History, MessageCircle, Plus, RefreshCw, Save, Trash2, UserRound } from 'lucide-react';
import toast from 'react-hot-toast';
import { useZapMassConnectionsSlice } from '../../context/ZapMassContext';
import { Button, Card, Input, SectionHeader } from '../ui';
import {
  fetchSupportBotConfig,
  fetchSupportBotHandoffs,
  resetSupportBotSession,
  saveSupportBotConfig,
  type SupportBotConfig,
  type SupportBotFaqItem,
  type SupportBotHandoffRow,
  type SupportBotMenuOption,
  type SupportBotMetrics
} from '../../services/supportBotApi';

const DEFAULT_CONFIG: SupportBotConfig = {
  enabled: false,
  connectionIds: [],
  welcomeMessage: 'Olá! 👋 Sou o assistente automático. Como posso ajudar?',
  menuPrompt: 'Digite o número da opção:',
  options: [
    {
      id: '1',
      label: 'Horário de atendimento',
      reply: 'Atendemos de segunda a sexta, das 9h às 18h (horário de Brasília).'
    },
    {
      id: '3',
      label: 'Falar com atendente',
      reply: '',
      handoff: true
    }
  ],
  offHoursMessage:
    'No momento estamos fora do horário. Deixe sua mensagem — retornamos em breve.',
  handoffMessage: 'Certo! Vou chamar um atendente humano. Aguarde um instante. 🙏',
  invalidOptionMessage: 'Não entendi essa opção. Escolha um número do menu:',
  humanKeywords: ['atendente', 'humano', 'pessoa'],
  faqItems: [
    {
      id: '1',
      keywords: ['horario', 'horário', 'funciona'],
      reply: 'Atendemos de segunda a sexta, das 9h às 18h (horário de Brasília).'
    }
  ],
  resetKeywords: ['menu', 'voltar', 'inicio', 'início', 'reiniciar', '0'],
  resetMessage: 'Certo! Aqui está o menu novamente:',
  businessHours: {
    enabled: true,
    timezone: 'America/Sao_Paulo',
    weekdays: [1, 2, 3, 4, 5],
    start: '09:00',
    end: '18:00'
  },
  botOnlyOutsideHours: false,
  menuCooldownMinutes: 20
};

function menuPreview(config: SupportBotConfig): string {
  const lines = config.options.map((o, i) => `${i + 1} — ${o.label}`);
  return `${config.welcomeMessage}\n\n${config.menuPrompt}\n\n${lines.join('\n')}`;
}

function keywordsToString(keywords: string[]): string {
  return keywords.join(', ');
}

function stringToKeywords(raw: string): string[] {
  return raw
    .split(/[,;]+/)
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
}

function formatPhoneDigits(digits: string): string {
  const d = digits.replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('55')) {
    return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  }
  if (d.length === 11) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }
  return d || '—';
}

function formatHandoffDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return iso;
  }
}

export const SupportBotSettingsPanel: React.FC = () => {
  const connections = useZapMassConnectionsSlice();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<SupportBotConfig>(DEFAULT_CONFIG);
  const [metrics, setMetrics] = useState<SupportBotMetrics>({
    botReplies: 0,
    handoffs: 0,
    menuShown: 0
  });
  const [handoffs, setHandoffs] = useState<SupportBotHandoffRow[]>([]);
  const [resettingId, setResettingId] = useState<string | null>(null);

  const loadHandoffs = useCallback(async () => {
    try {
      const rows = await fetchSupportBotHandoffs(30);
      setHandoffs(rows);
    } catch {
      /* opcional no painel */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await fetchSupportBotConfig();
        if (!cancelled) {
          setConfig(data.config);
          setMetrics(data.metrics);
        }
        if (!cancelled) await loadHandoffs();
      } catch (e) {
        if (!cancelled) {
          console.error(e);
          toast.error('Não foi possível carregar o atendimento automático.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadHandoffs]);

  const connectedIds = useMemo(
    () => connections.filter((c) => c.status === 'CONNECTED').map((c) => c.id),
    [connections]
  );

  const toggleConnection = (id: string) => {
    setConfig((prev) => {
      const set = new Set(prev.connectionIds);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return { ...prev, connectionIds: [...set] };
    });
  };

  const updateOption = (index: number, patch: Partial<SupportBotMenuOption>) => {
    setConfig((prev) => {
      const options = prev.options.map((o, i) => (i === index ? { ...o, ...patch } : o));
      return { ...prev, options };
    });
  };

  const addOption = () => {
    setConfig((prev) => {
      if (prev.options.length >= 20) return prev;
      const n = prev.options.length + 1;
      return {
        ...prev,
        options: [...prev.options, { id: String(n), label: `Nova opção ${n}`, reply: '', marketingEffect: 'none' }]
      };
    });
  };

  const removeOption = (index: number) => {
    setConfig((prev) => ({
      ...prev,
      options: prev.options.filter((_, i) => i !== index)
    }));
  };

  const updateFaq = (index: number, patch: Partial<SupportBotFaqItem>) => {
    setConfig((prev) => ({
      ...prev,
      faqItems: prev.faqItems.map((item, i) => (i === index ? { ...item, ...patch } : item))
    }));
  };

  const addFaq = () => {
    setConfig((prev) => {
      if (prev.faqItems.length >= 30) return prev;
      const n = prev.faqItems.length + 1;
      return {
        ...prev,
        faqItems: [...prev.faqItems, { id: String(n), keywords: ['palavra'], reply: '', marketingEffect: 'none' }]
      };
    });
  };

  const removeFaq = (index: number) => {
    setConfig((prev) => ({
      ...prev,
      faqItems: prev.faqItems.filter((_, i) => i !== index)
    }));
  };

  const handleResetSession = async (row: SupportBotHandoffRow) => {
    setResettingId(row.id);
    try {
      await resetSupportBotSession(row.connectionId, row.phoneDigits);
      toast.success('Bot reativado nesta conversa.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao reativar o bot.');
    } finally {
      setResettingId(null);
    }
  };

  const handleSave = useCallback(async () => {
    if (config.options.length === 0) {
      toast.error('Adicione pelo menos uma opção no menu.');
      return;
    }
    setSaving(true);
    try {
      const data = await saveSupportBotConfig(config);
      setConfig(data.config);
      setMetrics(data.metrics);
      await loadHandoffs();
      toast.success('Atendimento automático salvo.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar.');
    } finally {
      setSaving(false);
    }
  }, [config, loadHandoffs]);

  const connectionNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of connections) map.set(c.id, c.name || c.id);
    return map;
  }, [connections]);

  if (loading) {
    return (
      <Card className="p-6 text-[13px]" style={{ color: 'var(--text-3)' }}>
        A carregar atendimento automático…
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Atendimento automático"
        description="Bot com menu no WhatsApp. Quando o cliente pede atendente, você recebe alerta no Bate-papo."
      />

      <Card className="p-5 space-y-4">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => setConfig((p) => ({ ...p, enabled: e.target.checked }))}
            className="rounded border-[var(--border)]"
          />
          <span className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
            Ativar bot de atendimento
          </span>
        </label>

        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            { label: 'Menus enviados', value: metrics.menuShown },
            { label: 'Respostas auto', value: metrics.botReplies },
            { label: 'Passou p/ humano', value: metrics.handoffs }
          ].map((m) => (
            <div
              key={m.label}
              className="rounded-xl px-2 py-3"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}
            >
              <p className="text-[18px] font-black tabular-nums" style={{ color: 'var(--text-1)' }}>
                {m.value.toLocaleString('pt-BR')}
              </p>
              <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                {m.label}
              </p>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <p className="text-[13px] font-semibold flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
          <MessageCircle className="w-4 h-4" />
          Chips com bot ativo
        </p>
        <p className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
          Nenhum selecionado = todos os chips conectados. Se alguém da equipe assumir a conversa no
          Bate-papo, o bot para de responder.
        </p>
        <div className="flex flex-wrap gap-2">
          {connectedIds.length === 0 && (
            <span className="text-[12px]" style={{ color: 'var(--text-3)' }}>
              Nenhum chip conectado no momento.
            </span>
          )}
          {connectedIds.map((id) => {
            const name = connections.find((c) => c.id === id)?.name || id;
            const on =
              config.connectionIds.length === 0 || config.connectionIds.includes(id);
            const explicit = config.connectionIds.includes(id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => toggleConnection(id)}
                className="px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors"
                style={{
                  borderColor: explicit || (config.connectionIds.length === 0 && on) ? 'var(--brand-500)' : 'var(--border)',
                  background: explicit ? 'rgba(16,185,129,0.12)' : 'var(--surface-2)',
                  color: 'var(--text-2)'
                }}
              >
                {name}
              </button>
            );
          })}
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] font-semibold flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
            <Bot className="w-4 h-4" />
            Mensagens
          </p>
          <div className="px-2 py-1 rounded bg-[rgba(16,185,129,0.1)] border border-[rgba(16,185,129,0.2)] text-[10px] text-[var(--brand-500)] font-semibold flex items-center gap-1.5">
            <span>✨</span>
            <span>Suporta Spintax e Variáveis</span>
          </div>
        </div>
        <p className="text-[11.5px] leading-relaxed mb-4" style={{ color: 'var(--text-3)' }}>
          Você pode usar variáveis dinâmicas como <strong>{`{saudacao}`}</strong> (Bom dia/Boa tarde/Boa noite) e Spintax <strong>{`{Oi|Olá}`}</strong> em todas as mensagens do bot para torná-lo mais humano e reduzir riscos de bloqueio.
        </p>
        <div>
          <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>
            Boas-vindas
          </label>
          <Input
            value={config.welcomeMessage}
            onChange={(e) => setConfig((p) => ({ ...p, welcomeMessage: e.target.value }))}
          />
        </div>
        <div>
          <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>
            Texto antes das opções
          </label>
          <Input
            value={config.menuPrompt}
            onChange={(e) => setConfig((p) => ({ ...p, menuPrompt: e.target.value }))}
          />
        </div>
        <div>
          <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>
            Fora do horário
          </label>
          <Input
            value={config.offHoursMessage}
            onChange={(e) => setConfig((p) => ({ ...p, offHoursMessage: e.target.value }))}
          />
        </div>
        <div>
          <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>
            Ao chamar humano
          </label>
          <Input
            value={config.handoffMessage}
            onChange={(e) => setConfig((p) => ({ ...p, handoffMessage: e.target.value }))}
          />
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
            Opções do menu (máx. 20)
          </p>
          <Button type="button" size="sm" variant="secondary" leftIcon={<Plus className="w-3.5 h-3.5" />} onClick={addOption} disabled={config.options.length >= 20}>
            Opção
          </Button>
        </div>
        {config.options.map((opt, i) => (
          <div
            key={`${opt.id}-${i}`}
            className="rounded-xl p-3 space-y-2"
            style={{ border: '1px solid var(--border-subtle)', background: 'var(--surface-1)' }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold" style={{ color: 'var(--text-3)' }}>
                Opção {i + 1}
              </span>
              <button
                type="button"
                onClick={() => removeOption(i)}
                className="p-1 rounded hover:bg-[var(--surface-2)]"
                title="Remover"
              >
                <Trash2 className="w-3.5 h-3.5" style={{ color: 'var(--text-3)' }} />
              </button>
            </div>
            <div>
              <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>
                Rótulo (menu)
              </label>
              <Input
                value={opt.label}
                onChange={(e) => updateOption(i, { label: e.target.value })}
              />
            </div>
            <label className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-2)' }}>
              <input
                type="checkbox"
                checked={!!opt.handoff}
                onChange={(e) =>
                  updateOption(i, { handoff: e.target.checked, reply: e.target.checked ? '' : opt.reply })
                }
              />
              <UserRound className="w-3.5 h-3.5" />
              Encaminhar para atendente humano
            </label>
            {!opt.handoff && (
              <textarea
                className="w-full min-h-[72px] rounded-xl border px-3 py-2 text-[13px] resize-y mb-2"
                style={{ borderColor: 'var(--border)', background: 'var(--surface-0)', color: 'var(--text-1)' }}
                placeholder="Resposta automática desta opção"
                value={opt.reply}
                onChange={(e) => updateOption(i, { reply: e.target.value })}
              />
            )}
            
            <div className="pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
              <label className="block text-[11px] font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>
                Ação CRM (Opcional)
              </label>
              <select
                className="w-full px-3 py-1.5 rounded-lg text-[12px] border transition-colors outline-none"
                style={{ 
                  background: 'var(--surface-2)', 
                  borderColor: 'var(--border)',
                  color: 'var(--text-1)' 
                }}
                value={opt.marketingEffect || 'none'}
                onChange={(e) => updateOption(i, { marketingEffect: e.target.value as any })}
              >
                <option value="none">Nenhuma ação</option>
                <option value="opt_in">🔥 Adicionar à Lista Quente (Lead)</option>
                <option value="opt_out">🚫 Adicionar à Lista Negra (Bloquear campanhas)</option>
              </select>
              <p className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>
                Se o contato escolher esta opção, ele será automaticamente marcado no seu CRM.
              </p>
            </div>
          </div>
        ))}
      </Card>

      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
            FAQ por palavra-chave (máx. 30)
          </p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            leftIcon={<Plus className="w-3.5 h-3.5" />}
            onClick={addFaq}
            disabled={config.faqItems.length >= 30}
          >
            FAQ
          </Button>
        </div>
        <p className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
          Se a mensagem do cliente contiver uma palavra-chave, o bot responde automaticamente e mostra o menu de novo.
        </p>
        {config.faqItems.map((item, i) => (
          <div
            key={`faq-${item.id}-${i}`}
            className="rounded-xl p-3 space-y-2"
            style={{ border: '1px solid var(--border-subtle)', background: 'var(--surface-1)' }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold" style={{ color: 'var(--text-3)' }}>
                FAQ {i + 1}
              </span>
              <button
                type="button"
                onClick={() => removeFaq(i)}
                className="p-1 rounded hover:bg-[var(--surface-2)]"
                title="Remover"
              >
                <Trash2 className="w-3.5 h-3.5" style={{ color: 'var(--text-3)' }} />
              </button>
            </div>
            <div>
              <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>
                Palavras-chave (separadas por vírgula)
              </label>
              <Input
                value={keywordsToString(item.keywords)}
                onChange={(e) => updateFaq(i, { keywords: stringToKeywords(e.target.value) })}
                placeholder="horário, funciona, abre"
              />
            </div>
            <textarea
              className="w-full min-h-[72px] rounded-xl border px-3 py-2 text-[13px] resize-y mb-2"
              style={{ borderColor: 'var(--border)', background: 'var(--surface-0)', color: 'var(--text-1)' }}
              placeholder="Resposta automática"
              value={item.reply}
              onChange={(e) => updateFaq(i, { reply: e.target.value })}
            />
            
            <div className="pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
              <label className="block text-[11px] font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>
                Ação CRM (Opcional)
              </label>
              <select
                className="w-full px-3 py-1.5 rounded-lg text-[12px] border transition-colors outline-none"
                style={{ 
                  background: 'var(--surface-2)', 
                  borderColor: 'var(--border)',
                  color: 'var(--text-1)' 
                }}
                value={item.marketingEffect || 'none'}
                onChange={(e) => updateFaq(i, { marketingEffect: e.target.value as any })}
              >
                <option value="none">Nenhuma ação</option>
                <option value="opt_in">🔥 Adicionar à Lista Quente (Lead)</option>
                <option value="opt_out">🚫 Adicionar à Lista Negra (Bloquear campanhas)</option>
              </select>
            </div>
          </div>
        ))}
      </Card>

      <Card className="p-5 space-y-3">
        <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
          Voltar ao menu
        </p>
        <div>
          <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>
            Palavras para reiniciar (vírgula)
          </label>
          <Input
            value={keywordsToString(config.resetKeywords)}
            onChange={(e) =>
              setConfig((p) => ({ ...p, resetKeywords: stringToKeywords(e.target.value) }))
            }
            placeholder="menu, voltar, 0"
          />
        </div>
        <div>
          <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>
            Mensagem ao reiniciar
          </label>
          <Input
            value={config.resetMessage}
            onChange={(e) => setConfig((p) => ({ ...p, resetMessage: e.target.value }))}
          />
        </div>
        <p className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
          Quando a equipe finaliza ou liberta a conversa no Bate-papo, o bot também volta a responder automaticamente.
        </p>
      </Card>

      <Card className="p-5 space-y-3">
        <p className="text-[13px] font-semibold flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
          <Clock className="w-4 h-4" />
          Horário comercial (Brasília)
        </p>
        <label className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-2)' }}>
          <input
            type="checkbox"
            checked={config.businessHours.enabled}
            onChange={(e) =>
              setConfig((p) => ({
                ...p,
                businessHours: { ...p.businessHours, enabled: e.target.checked }
              }))
            }
          />
          Respeitar horário comercial
        </label>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>
              Início
            </label>
            <Input
              type="time"
              value={config.businessHours.start}
              onChange={(e) =>
                setConfig((p) => ({
                  ...p,
                  businessHours: { ...p.businessHours, start: e.target.value }
                }))
              }
            />
          </div>
          <div>
            <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>
              Fim
            </label>
            <Input
              type="time"
              value={config.businessHours.end}
              onChange={(e) =>
                setConfig((p) => ({
                  ...p,
                  businessHours: { ...p.businessHours, end: e.target.value }
                }))
              }
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-2)' }}>
          <input
            type="checkbox"
            checked={config.botOnlyOutsideHours}
            onChange={(e) => setConfig((p) => ({ ...p, botOnlyOutsideHours: e.target.checked }))}
          />
          Bot só fora do horário (humano de dia, bot à noite)
        </label>
      </Card>

      <Card className="p-5 space-y-2">
        <p className="text-[12px] font-semibold" style={{ color: 'var(--text-2)' }}>
          Pré-visualização
        </p>
        <pre
          className="text-[12px] whitespace-pre-wrap rounded-xl p-3 max-h-48 overflow-auto"
          style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
        >
          {menuPreview(config)}
        </pre>
      </Card>

      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] font-semibold flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
            <History className="w-4 h-4" />
            Histórico de handoffs
          </p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
            onClick={() => void loadHandoffs()}
          >
            Atualizar
          </Button>
        </div>
        {handoffs.length === 0 ? (
          <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>
            Nenhum cliente passou para atendente humano ainda.
          </p>
        ) : (
          <div className="space-y-2 max-h-72 overflow-auto">
            {handoffs.map((row) => (
              <div
                key={row.id}
                className="rounded-xl p-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3"
                style={{ border: '1px solid var(--border-subtle)', background: 'var(--surface-1)' }}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                    {formatPhoneDigits(row.phoneDigits)}
                  </p>
                  <p className="text-[11px] truncate" style={{ color: 'var(--text-3)' }}>
                    {connectionNameById.get(row.connectionId) || row.connectionId} · {formatHandoffDate(row.createdAt)}
                  </p>
                  {row.previewMessage && (
                    <p className="text-[11.5px] mt-1 line-clamp-2" style={{ color: 'var(--text-2)' }}>
                      “{row.previewMessage}”
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  loading={resettingId === row.id}
                  onClick={() => void handleResetSession(row)}
                >
                  Reativar bot
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Button
        type="button"
        variant="primary"
        leftIcon={<Save className="w-4 h-4" />}
        loading={saving}
        onClick={() => void handleSave()}
      >
        Salvar atendimento automático
      </Button>
    </div>
  );
};
