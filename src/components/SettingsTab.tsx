import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileWarning,
  Moon,
  Palette,
  Save,
  ShieldCheck,
  Sliders,
  Smartphone,
  Sparkles,
  Sun,
  User as UserIcon,
  Webhook,
  Zap
} from 'lucide-react';
import { applyMode, applyTheme, getSavedMode, getSavedTheme, ModeId, themes, ThemeId } from '../theme';
import { useZapMass } from '../context/ZapMassContext';
import { useSubscription } from '../context/SubscriptionContext';
import { useAuth } from '../context/AuthContext';
import { useMainLayoutNav } from '../context/MainLayoutNavContext';
import {
  WHATSAPP_META_CLOUD_OVERVIEW,
  WHATSAPP_META_POLICY,
  WHATSAPP_RISK_BULLETS,
  WHATSAPP_RISK_SHORT
} from '../constants/whatsappLegal';
import {
  clearWhatsAppRiskAck,
  getWhatsAppRiskAck,
  saveWhatsAppRiskAck
} from '../utils/whatsappRiskStorage';
import toast from 'react-hot-toast';
import { Badge, Button, Card, Input, SectionHeader } from './ui';

const SETTINGS_KEY = 'zapmass_settings';

interface SystemSettings {
  minDelay: number;
  maxDelay: number;
  dailyLimit: number;
  sleepMode: boolean;
  webhookUrl: string;
  emailNotif: boolean;
}

const DEFAULT_SETTINGS: SystemSettings = {
  minDelay: 15,
  maxDelay: 45,
  dailyLimit: 1000,
  sleepMode: true,
  webhookUrl: '',
  emailNotif: true
};

type Section = 'disparo' | 'aparencia' | 'notificacoes' | 'conta' | 'legal';

const SECTIONS: Array<{ id: Section; label: string; icon: React.ReactNode; description: string }> = [
  {
    id: 'disparo',
    label: 'Disparo',
    icon: <Sliders className="w-4 h-4" />,
    description: 'Velocidade, limite diário e modo silêncio.'
  },
  {
    id: 'aparencia',
    label: 'Aparência',
    icon: <Palette className="w-4 h-4" />,
    description: 'Cor de destaque e tema claro ou escuro.'
  },
  {
    id: 'notificacoes',
    label: 'Notificações',
    icon: <Bell className="w-4 h-4" />,
    description: 'E-mail de alerta e integrações via webhook.'
  },
  {
    id: 'conta',
    label: 'Minha conta',
    icon: <UserIcon className="w-4 h-4" />,
    description: 'Dados do seu login e plano atual.'
  },
  {
    id: 'legal',
    label: 'Termo e responsabilidade',
    icon: <FileWarning className="w-4 h-4" />,
    description: 'LGPD, política do WhatsApp e aceite de uso.'
  }
];

function serializeServerSettings(s: SystemSettings): string {
  return JSON.stringify({
    minDelay: s.minDelay,
    maxDelay: s.maxDelay,
    dailyLimit: s.dailyLimit,
    sleepMode: s.sleepMode,
    webhookUrl: s.webhookUrl,
    emailNotif: s.emailNotif
  });
}

export const SettingsTab: React.FC = () => {
  const { socket, clearAllUserData } = useZapMass();
  const { user, signOut } = useAuth();
  const goToView = useMainLayoutNav();
  const { subscription, loading: subLoading } = useSubscription();

  const saved: SystemSettings = (() => {
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
    } catch {
      return DEFAULT_SETTINGS;
    }
  })();

  const [section, setSection] = useState<Section>('disparo');
  const [minDelay, setMinDelay] = useState(saved.minDelay);
  const [maxDelay, setMaxDelay] = useState(saved.maxDelay);
  const [dailyLimit, setDailyLimit] = useState(saved.dailyLimit);
  const [sleepMode, setSleepMode] = useState(saved.sleepMode);
  const [webhookUrl, setWebhookUrl] = useState(saved.webhookUrl);
  const [emailNotif, setEmailNotif] = useState(saved.emailNotif);
  const [themeId, setThemeId] = useState<ThemeId>('emerald');
  const [mode, setMode] = useState<ModeId>('dark');
  const [savedOk, setSavedOk] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);
  const settingsBaselineRef = useRef(serializeServerSettings(saved));

  const [ackTick, setAckTick] = useState(0);
  const riskAck = useMemo(() => (user?.uid ? getWhatsAppRiskAck(user.uid) : null), [user?.uid, ackTick]);

  const serverSettingsPayload = useMemo(
    () =>
      serializeServerSettings({
        minDelay,
        maxDelay,
        dailyLimit,
        sleepMode,
        webhookUrl,
        emailNotif
      }),
    [minDelay, maxDelay, dailyLimit, sleepMode, webhookUrl, emailNotif]
  );
  const serverSettingsDirty = serverSettingsPayload !== settingsBaselineRef.current;

  useEffect(() => {
    const savedTheme = getSavedTheme();
    const savedMode = getSavedMode();
    setThemeId(savedTheme);
    setMode(savedMode);
    applyTheme(savedTheme);
    applyMode(savedMode);
  }, []);

  const handleSaveSettings = () => {
    if (minDelay > maxDelay) {
      toast.error('O atraso mínimo não pode ser maior que o máximo.');
      return;
    }
    const settings: SystemSettings = { minDelay, maxDelay, dailyLimit, sleepMode, webhookUrl, emailNotif };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    settingsBaselineRef.current = serializeServerSettings(settings);
    socket?.emit('update-settings', settings);
    setSavedOk(true);
    toast.success('Configurações salvas.');
    setTimeout(() => setSavedOk(false), 3000);
  };

  const handleModeChange = (next: ModeId) => {
    setMode(next);
    applyMode(next);
  };

  const handleClearAllData = async () => {
    if (clearingAll) return;
    const typed = window.prompt(
      'Atenção: esta ação apaga contatos, listas, campanhas, conexões e dados locais.\n\nPara continuar, digite EXATAMENTE: APAGAR TUDO'
    );
    if (typed !== 'APAGAR TUDO') {
      toast('Ação cancelada. Confirmação inválida.', { icon: 'ℹ️' });
      return;
    }
    const ok = window.confirm(
      'Confirma apagar TODOS os dados do sistema agora?\n\nEsta ação é irreversível.'
    );
    if (!ok) return;

    try {
      setClearingAll(true);
      const loadingId = toast.loading('Apagando todos os dados...');
      await clearAllUserData();
      toast.success('Todos os dados foram apagados com sucesso.', { id: loadingId, duration: 2600 });
    } catch (err: any) {
      toast.error(err?.message || 'Não foi possível apagar todos os dados.');
    } finally {
      setClearingAll(false);
    }
  };

  const currentSection = SECTIONS.find(s => s.id === section)!;
  const planLabel = subscription?.plan
    ? (subscription.plan === 'annual' ? 'Anual' : subscription.plan === 'monthly' ? 'Mensal' : subscription.plan)
    : (subscription?.status === 'trialing' ? 'Teste grátis' : '—');

  return (
    <div className="max-w-5xl mx-auto space-y-5 pb-10">
      <SectionHeader
        eyebrow={
          <>
            <Sparkles className="w-3 h-3" />
            Configurações
          </>
        }
        title="Configurações"
        description={
          <span>
            <span className="font-semibold" style={{ color: 'var(--text-1)' }}>
              {currentSection.label}.{' '}
            </span>
            <span style={{ color: 'var(--text-3)' }}>{currentSection.description}</span>
          </span>
        }
        icon={<Sliders className="w-5 h-5" style={{ color: 'var(--brand-600)' }} />}
        actions={
          section === 'disparo' || section === 'notificacoes' ? (
            <div className="flex items-center gap-3">
              {serverSettingsDirty && (
                <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 whitespace-nowrap">
                  Alterações não salvas
                </span>
              )}
              <Button
                variant="primary"
                size="lg"
                leftIcon={savedOk ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                onClick={handleSaveSettings}
                disabled={!serverSettingsDirty && !savedOk}
              >
                {savedOk ? 'Salvo' : 'Salvar'}
              </Button>
            </div>
          ) : null
        }
      />

      {/* Nav de seções em chips horizontais — mais clean que Tabs */}
      <div className="flex flex-wrap gap-2">
        {SECTIONS.map((s) => {
          const active = section === s.id;
          return (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl transition-all"
              style={{
                background: active ? 'var(--brand-50)' : 'var(--surface-1)',
                border: active ? '1.5px solid color-mix(in srgb, var(--brand-500) 35%, transparent)' : '1.5px solid var(--border-subtle)',
                color: active ? 'var(--brand-700)' : 'var(--text-2)',
                boxShadow: active ? '0 2px 10px color-mix(in srgb, var(--brand-500) 14%, transparent)' : 'none'
              }}
            >
              <span style={{ color: active ? 'var(--brand-600)' : 'var(--text-3)' }}>{s.icon}</span>
              <span className="text-[13px] font-semibold">{s.label}</span>
            </button>
          );
        })}
      </div>

      {/* DISPARO */}
      {section === 'disparo' && (
        <div className="space-y-4">
          <Card className="p-0 overflow-hidden">
            <div className="px-6 py-5 flex items-center gap-3" style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface-1)' }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--brand-50)' }}>
                <Zap className="w-5 h-5" style={{ color: 'var(--brand-600)' }} />
              </div>
              <div>
                <h2 className="ui-title text-[15px]">Intervalo entre mensagens</h2>
                <p className="ui-subtitle text-[12.5px]">Quanto maior a variação, mais humano o padrão fica.</p>
              </div>
            </div>

            <div className="p-6 space-y-6">
              <div className="rounded-xl p-4" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}>
                <div className="flex items-center justify-between mb-4">
                  <span className="flex items-center gap-2 text-[12px] font-semibold" style={{ color: 'var(--text-2)' }}>
                    <Clock className="w-3.5 h-3.5" style={{ color: 'var(--text-3)' }} />
                    Faixa atual
                  </span>
                  <span className="text-[13px] font-bold tabular-nums" style={{ color: 'var(--brand-600)' }}>
                    {minDelay}s – {maxDelay}s
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11.5px] uppercase tracking-wide font-semibold" style={{ color: 'var(--text-3)' }}>Mínimo</span>
                      <span className="text-[13px] font-bold tabular-nums" style={{ color: 'var(--text-1)' }}>{minDelay}s</span>
                    </div>
                    <input type="range" min="5" max="60" value={minDelay}
                      onChange={(e) => setMinDelay(Number(e.target.value))}
                      className="w-full accent-brand-600" />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11.5px] uppercase tracking-wide font-semibold" style={{ color: 'var(--text-3)' }}>Máximo</span>
                      <span className="text-[13px] font-bold tabular-nums" style={{ color: 'var(--text-1)' }}>{maxDelay}s</span>
                    </div>
                    <input type="range" min="10" max="120" value={maxDelay}
                      onChange={(e) => setMaxDelay(Number(e.target.value))}
                      className="w-full accent-brand-600" />
                  </div>
                </div>
                <p className="text-[11.5px] mt-3 flex items-start gap-1.5" style={{ color: 'var(--text-3)' }}>
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: '#f59e0b' }} />
                  Recomendamos <strong>15s a 45s</strong> para simular comportamento humano e reduzir risco de bloqueio.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label className="flex items-center gap-2 text-[13px] font-semibold mb-2" style={{ color: 'var(--text-1)' }}>
                    <Smartphone className="w-3.5 h-3.5" style={{ color: 'var(--text-3)' }} />
                    Limite diário por chip
                  </label>
                  <Input
                    type="number"
                    value={dailyLimit}
                    onChange={(e) => setDailyLimit(Number(e.target.value))}
                  />
                  <p className="text-[11.5px] mt-1.5" style={{ color: 'var(--text-3)' }}>
                    Cada número para quando atinge esse total no dia.
                  </p>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
                      Modo silêncio noturno
                    </label>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={sleepMode}
                      className="w-11 h-6 rounded-full p-1 cursor-pointer transition-colors shrink-0"
                      style={{ background: sleepMode ? 'var(--brand-500)' : 'var(--surface-2)' }}
                      onClick={() => setSleepMode(!sleepMode)}
                    >
                      <span
                        className="block w-4 h-4 bg-white rounded-full shadow-sm transition-transform"
                        style={{ transform: sleepMode ? 'translateX(18px)' : 'translateX(0)' }}
                      />
                    </button>
                  </div>
                  <p className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
                    Pausa a fila automaticamente das <strong>20h às 8h</strong>.
                  </p>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* APARÊNCIA */}
      {section === 'aparencia' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--brand-50)' }}>
                <Palette className="w-5 h-5" style={{ color: 'var(--brand-600)' }} />
              </div>
              <div>
                <h2 className="ui-title text-[15px]">Cor de destaque</h2>
                <p className="ui-subtitle text-[12.5px]">Muda a cor dos botões e indicadores.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {themes.map((theme) => {
                const isSel = themeId === theme.id;
                return (
                  <button
                    key={theme.id}
                    onClick={() => { setThemeId(theme.id); applyTheme(theme.id); }}
                    className="flex items-center gap-2 px-3.5 py-2 rounded-xl transition-all"
                    style={{
                      background: isSel ? 'var(--brand-50)' : 'var(--surface-1)',
                      border: isSel ? '1.5px solid color-mix(in srgb, var(--brand-500) 35%, transparent)' : '1.5px solid var(--border-subtle)',
                      color: isSel ? 'var(--brand-700)' : 'var(--text-2)'
                    }}
                  >
                    <span className="w-4 h-4 rounded-full"
                      style={{ backgroundColor: theme.preview, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.08)' }} />
                    <span className="text-[12.5px] font-semibold">{theme.name}</span>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--surface-2)' }}>
                {mode === 'dark'
                  ? <Moon className="w-5 h-5" style={{ color: 'var(--text-2)' }} />
                  : <Sun className="w-5 h-5" style={{ color: '#f59e0b' }} />}
              </div>
              <div>
                <h2 className="ui-title text-[15px]">Claro ou escuro</h2>
                <p className="ui-subtitle text-[12.5px]">Aplica na hora, salvo neste navegador.</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'light' as const, label: 'Claro', icon: <Sun className="w-4 h-4" /> },
                { id: 'dark' as const, label: 'Escuro', icon: <Moon className="w-4 h-4" /> }
              ].map((m) => {
                const isSel = mode === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => handleModeChange(m.id)}
                    className="flex items-center gap-2.5 px-4 py-3 rounded-xl transition-all"
                    style={{
                      background: isSel ? 'var(--brand-50)' : 'var(--surface-1)',
                      border: isSel ? '1.5px solid color-mix(in srgb, var(--brand-500) 35%, transparent)' : '1.5px solid var(--border-subtle)'
                    }}
                  >
                    <span style={{ color: isSel ? 'var(--brand-600)' : 'var(--text-3)' }}>{m.icon}</span>
                    <span className="text-[13px] font-semibold"
                      style={{ color: isSel ? 'var(--brand-700)' : 'var(--text-1)' }}>
                      {m.label}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 rounded-xl p-3"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}>
              <p className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-3)' }}>
                Prévia
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="success" dot>Online</Badge>
                <Badge variant="warning">Atenção</Badge>
                <Badge variant="danger">Falha</Badge>
                <Badge variant="info">Info</Badge>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* NOTIFICAÇÕES */}
      {section === 'notificacoes' && (
        <div className="space-y-4">
          <Card className="p-0 overflow-hidden">
            <div className="px-6 py-5 flex items-center gap-3" style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface-1)' }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(59,130,246,0.12)' }}>
                <Webhook className="w-5 h-5" style={{ color: '#3b82f6' }} />
              </div>
              <div>
                <h2 className="ui-title text-[15px]">Webhook</h2>
                <p className="ui-subtitle text-[12.5px]">Receba eventos no seu sistema (mensagens e mudanças de status).</p>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-3)' }}>
                  URL do endpoint
                </label>
                <Input
                  type="url"
                  placeholder="https://seu-sistema.com/webhook"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  leftIcon={<Webhook className="w-4 h-4" />}
                />
                <p className="text-[11.5px] mt-1.5" style={{ color: 'var(--text-3)' }}>
                  Vamos fazer <span className="font-mono text-[11px]">POST</span> em JSON com o payload do evento. Deixe em branco para desativar.
                </p>
              </div>
            </div>
          </Card>

          <Card>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="w-4 h-4 mt-1 accent-brand-600 rounded"
                checked={emailNotif}
                onChange={(e) => setEmailNotif(e.target.checked)}
              />
              <div className="flex-1">
                <p className="text-[13px] font-semibold flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
                  <Bell className="w-4 h-4" style={{ color: 'var(--text-3)' }} />
                  Alertas por e-mail
                </p>
                <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                  Avisamos no e-mail do login quando um chip cair ou uma campanha terminar.
                </p>
              </div>
            </label>
          </Card>
        </div>
      )}

      {/* MINHA CONTA */}
      {section === 'conta' && (
        <div className="space-y-4">
          <Card className="p-6">
            <div className="flex items-start gap-4">
              {user?.photoURL ? (
                <img src={user.photoURL} alt={user.displayName || ''} className="w-14 h-14 rounded-2xl object-cover" />
              ) : (
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-white font-bold text-[18px]"
                  style={{ background: 'linear-gradient(135deg, var(--brand-500), var(--brand-700))' }}>
                  {(user?.displayName || user?.email || 'U').charAt(0).toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="font-bold text-[15px] truncate" style={{ color: 'var(--text-1)' }}>
                  {user?.displayName || 'Conta ZapMass'}
                </p>
                <p className="text-[12.5px] truncate" style={{ color: 'var(--text-3)' }}>{user?.email || '—'}</p>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <Badge variant={subscription?.status === 'active' ? 'success' : subscription?.status === 'trialing' ? 'info' : 'neutral'} dot>
                    {subLoading
                      ? 'Carregando…'
                      : subscription?.status === 'active'
                        ? 'Plano ativo'
                        : subscription?.status === 'trialing'
                          ? 'Teste grátis'
                          : subscription?.status === 'past_due'
                            ? 'Pagamento atrasado'
                            : subscription?.status === 'canceled'
                              ? 'Cancelado'
                              : 'Sem plano'}
                  </Badge>
                  <span className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>Plano: <strong>{planLabel}</strong></span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-5">
              <Button variant="primary" leftIcon={<Sparkles className="w-4 h-4" />} onClick={() => goToView('subscription')}>
                Minha assinatura
              </Button>
              <Button variant="secondary" onClick={() => { signOut?.(); }}>
                Sair da conta
              </Button>
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: socket?.connected ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)' }}>
                  <span className={`w-2.5 h-2.5 rounded-full ${socket?.connected ? 'bg-emerald-500' : 'bg-red-500'} ${socket?.connected ? 'animate-pulse' : ''}`} />
                </div>
                <div>
                  <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>Conexão com o servidor</p>
                  <p className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
                    {socket?.connected ? 'Em tempo real (socket ativo)' : 'Tentando reconectar…'}
                  </p>
                </div>
              </div>
              <Badge variant={socket?.connected ? 'success' : 'danger'} dot>
                {socket?.connected ? 'Online' : 'Offline'}
              </Badge>
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-start gap-3">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: 'rgba(239,68,68,0.14)' }}
              >
                <AlertTriangle className="w-4 h-4 text-red-500" />
              </div>
              <div className="flex-1">
                <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
                  Zona de perigo
                </p>
                <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                  Remove todos os dados do seu ambiente: contatos, listas, campanhas, conexões e histórico local.
                  Sempre exigimos confirmação em duas etapas.
                </p>
                <div className="mt-3">
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => void handleClearAllData()}
                    disabled={clearingAll}
                    leftIcon={<AlertTriangle className="w-4 h-4" />}
                  >
                    {clearingAll ? 'Apagando tudo...' : 'Apagar tudo'}
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* LEGAL */}
      {section === 'legal' && (
        <div className="space-y-4">
          <Card className="p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: 'rgba(245,158,11,0.15)' }}>
                <FileWarning className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h2 className="ui-title text-[15px]">Responsabilidade no uso do WhatsApp</h2>
                <p className="ui-subtitle text-[12.5px] mt-1">
                  Quem define as listas, o conteúdo e o consentimento dos contatos é <strong>você</strong>. O ZapMass é a ferramenta.
                </p>
              </div>
            </div>
            <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
              {WHATSAPP_RISK_SHORT}
            </p>
            <ul className="text-[12px] space-y-1.5 list-disc pl-4" style={{ color: 'var(--text-2)' }}>
              {WHATSAPP_RISK_BULLETS.map((t) => <li key={t}>{t}</li>)}
            </ul>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] font-semibold">
              <a href={WHATSAPP_META_POLICY} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 hover:underline" style={{ color: 'var(--brand-600)' }}>
                Política comercial do WhatsApp <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <a href={WHATSAPP_META_CLOUD_OVERVIEW} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 hover:underline" style={{ color: 'var(--brand-600)' }}>
                API oficial da Meta <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: riskAck ? 'rgba(16,185,129,0.12)' : 'var(--surface-2)' }}>
                <ShieldCheck className="w-4 h-4" style={{ color: riskAck ? 'var(--brand-600)' : 'var(--text-3)' }} />
              </div>
              <div className="flex-1">
                <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
                  Aceite de uso para campanhas
                </p>
                <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                  {riskAck
                    ? `Registrado em ${new Date(riskAck.acceptedAt).toLocaleString('pt-BR')} neste aparelho.`
                    : 'Ainda não registrado. Será pedido ao criar a primeira campanha.'}
                </p>
                {user?.uid && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {!riskAck ? (
                      <Button variant="primary" size="sm" type="button"
                        onClick={() => {
                          saveWhatsAppRiskAck(user.uid);
                          setAckTick((t) => t + 1);
                          toast.success('Aceite registrado.');
                        }}>
                        Registrar aceite agora
                      </Button>
                    ) : (
                      <Button variant="secondary" size="sm" type="button"
                        onClick={() => {
                          clearWhatsAppRiskAck();
                          setAckTick((t) => t + 1);
                          toast.success('Aceite revogado neste aparelho.');
                        }}>
                        Revogar aceite
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};
