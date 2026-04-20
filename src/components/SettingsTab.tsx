import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock,
  Database,
  Info,
  KeyRound,
  CreditCard,
  Loader2,
  Moon,
  Palette,
  Save,
  Settings as SettingsIcon,
  Shield,
  Smartphone,
  Sun,
  Webhook,
  FileWarning,
  ExternalLink
} from 'lucide-react';
import { applyMode, applyTheme, getSavedMode, getSavedTheme, ModeId, themes, ThemeId } from '../theme';
import { useZapMass } from '../context/ZapMassContext';
import { useSubscription } from '../context/SubscriptionContext';
import { useAuth } from '../context/AuthContext';
import { useMainLayoutNav } from '../context/MainLayoutNavContext';
import { isAdminUserEmail } from '../utils/adminAccess';
import {
  WHATSAPP_META_CLOUD_GET_STARTED,
  WHATSAPP_META_CLOUD_OVERVIEW,
  WHATSAPP_META_POLICY,
  WHATSAPP_OFFICIAL_API_INTRO,
  WHATSAPP_RISK_BULLETS,
  WHATSAPP_RISK_SHORT
} from '../constants/whatsappLegal';
import {
  clearWhatsAppRiskAck,
  getWhatsAppRiskAck,
  loadWaOfficialPrefs,
  saveWaOfficialPrefs,
  saveWhatsAppRiskAck,
  type WaOfficialPrefs
} from '../utils/whatsappRiskStorage';
import toast from 'react-hot-toast';
import { Badge, Button, Card, Input, SectionHeader, Tabs } from './ui';

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

type Section = 'security' | 'integrations' | 'appearance' | 'backup' | 'system' | 'legal';

const SECTION_META: Record<
  Section,
  { headline: string; hint: string }
> = {
  security: {
    headline: 'Disparo e proteção do chip',
    hint: 'Intervalos e limites usados na fila de envio. Clique em Salvar para aplicar no servidor.'
  },
  integrations: {
    headline: 'Webhooks, alertas e cobrança',
    hint: 'Conecte sistemas externos e acompanhe a assinatura.'
  },
  appearance: {
    headline: 'Tema e modo',
    hint: 'A cor e o claro/escuro são guardados neste navegador ao escolher.'
  },
  backup: {
    headline: 'Cópia de segurança',
    hint: 'Snapshot dos dados com chave configurada no servidor.'
  },
  system: {
    headline: 'Ambiente e painel do criador',
    hint: 'Versão, conexão em tempo real e atalhos administrativos.'
  },
  legal: {
    headline: 'WhatsApp, LGPD e API oficial',
    hint: 'Riscos da automação, aceite local e preferências da Cloud API.'
  }
};

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
  const { socket } = useZapMass();
  const { user } = useAuth();
  const goToView = useMainLayoutNav();
  const isCreatorAdmin = isAdminUserEmail(user?.email ?? null);
  const { subscription, loading: subLoading, enforce: subEnforce } = useSubscription();
  const saved: SystemSettings = (() => {
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
    } catch {
      return DEFAULT_SETTINGS;
    }
  })();

  const [section, setSection] = useState<Section>('security');
  const [minDelay, setMinDelay] = useState(saved.minDelay);
  const [maxDelay, setMaxDelay] = useState(saved.maxDelay);
  const [dailyLimit, setDailyLimit] = useState(saved.dailyLimit);
  const [sleepMode, setSleepMode] = useState(saved.sleepMode);
  const [webhookUrl, setWebhookUrl] = useState(saved.webhookUrl);
  const [emailNotif, setEmailNotif] = useState(saved.emailNotif);
  const [appVersion, setAppVersion] = useState('carregando...');
  const [backupKey, setBackupKey] = useState('');
  const [backupStatus, setBackupStatus] = useState('');
  const [themeId, setThemeId] = useState<ThemeId>('emerald');
  const [mode, setMode] = useState<ModeId>('dark');
  const [savedOk, setSavedOk] = useState(false);
  const settingsBaselineRef = useRef(serializeServerSettings(saved));
  const [mpCheckoutLoading, setMpCheckoutLoading] = useState<'monthly' | 'annual' | null>(null);
  const [ipCheckoutLoading, setIpCheckoutLoading] = useState<'monthly' | 'annual' | null>(null);
  const billingBusy = !!mpCheckoutLoading || !!ipCheckoutLoading || subLoading;

  const [waOfficial, setWaOfficial] = useState<WaOfficialPrefs>(() => loadWaOfficialPrefs());
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

  const startMercadoPagoCheckout = async (plan: 'monthly' | 'annual') => {
    if (!user) {
      toast.error('Faca login para assinar.');
      return;
    }
    setMpCheckoutLoading(plan);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/billing/mercadopago/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({ plan })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        toast.error(typeof data?.error === 'string' ? data.error : 'Nao foi possivel iniciar o checkout.');
        return;
      }
      if (data.init_point) {
        window.open(String(data.init_point), '_blank', 'noopener,noreferrer');
        toast.success('Abra a aba do Mercado Pago para concluir a assinatura.');
      } else {
        toast.error('Resposta sem link de checkout.');
      }
    } catch (e) {
      console.error(e);
      toast.error('Erro de rede ao falar com o servidor.');
    } finally {
      setMpCheckoutLoading(null);
    }
  };

  const startInfinitePayCheckout = async (plan: 'monthly' | 'annual') => {
    if (!user) {
      toast.error('Faca login para assinar.');
      return;
    }
    setIpCheckoutLoading(plan);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/billing/infinitepay/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({ plan })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        toast.error(typeof data?.error === 'string' ? data.error : 'Nao foi possivel iniciar o checkout Infinite Pay.');
        return;
      }
      if (data.checkout_url) {
        window.open(String(data.checkout_url), '_blank', 'noopener,noreferrer');
        toast.success('Abra a aba da Infinite Pay para concluir o pagamento.');
      } else {
        toast.error('Resposta sem link de checkout.');
      }
    } catch (e) {
      console.error(e);
      toast.error('Erro de rede ao falar com o servidor.');
    } finally {
      setIpCheckoutLoading(null);
    }
  };

  useEffect(() => {
    const savedTheme = getSavedTheme();
    const savedMode = getSavedMode();
    setThemeId(savedTheme);
    setMode(savedMode);
    applyTheme(savedTheme);
    applyMode(savedMode);
    fetch('/api/version')
      .then((res) => res.json())
      .then((data) => setAppVersion(data.version || 'desconhecida'))
      .catch(() => setAppVersion('offline'));
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
    toast.success('Configurações salvas no servidor.');
    setTimeout(() => setSavedOk(false), 3000);
  };

  const handleBackupNow = async () => {
    setBackupStatus('Processando...');
    try {
      const response = await fetch('/api/backup', {
        method: 'POST',
        headers: { 'x-backup-key': backupKey }
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setBackupStatus(data.error || 'Falha ao executar backup.');
        return;
      }
      const result = await response.json();
      setBackupStatus(`Backup salvo em ${result.backupDir}`);
    } catch {
      setBackupStatus('Falha ao conectar com o servidor.');
    }
  };

  const handleModeChange = (next: ModeId) => {
    setMode(next);
    applyMode(next);
  };

  const meta = SECTION_META[section];

  return (
    <div className="max-w-5xl mx-auto space-y-5 pb-10">
      <SectionHeader
        eyebrow={
          <>
            <SettingsIcon className="w-3 h-3" />
            Configurações
          </>
        }
        title="Configurações"
        description={
          <span>
            <span className="font-semibold" style={{ color: 'var(--text-1)' }}>
              {meta.headline}.{' '}
            </span>
            <span style={{ color: 'var(--text-3)' }}>{meta.hint}</span>
          </span>
        }
        icon={<SettingsIcon className="w-5 h-5" style={{ color: 'var(--brand-600)' }} />}
        actions={
          <div className="flex flex-col items-end gap-1.5 sm:flex-row sm:items-center sm:gap-3">
            {serverSettingsDirty && (
              <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 whitespace-nowrap">
                Alterações não salvas (disparo / integrações)
              </span>
            )}
            <Button
              variant="primary"
              size="lg"
              leftIcon={savedOk ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
              onClick={handleSaveSettings}
            >
              {savedOk ? 'Salvo' : 'Salvar no servidor'}
            </Button>
          </div>
        }
      />

      <div
        className="sticky top-0 z-20 -mx-1 px-1 py-2 -mt-1 mb-1 rounded-xl sm:static sm:z-0 sm:rounded-none sm:bg-transparent sm:p-0 sm:mb-0"
        style={{ background: 'color-mix(in srgb, var(--surface-0) 92%, transparent)', boxShadow: '0 1px 0 var(--border-subtle)' }}
      >
        <div className="overflow-x-auto overflow-y-hidden pb-0.5 sm:pb-0">
          <Tabs
            className="min-w-max w-full sm:min-w-0"
            value={section}
            onChange={(v) => setSection(v as Section)}
            items={[
              { id: 'security', label: 'Segurança', icon: <Shield className="w-3.5 h-3.5" /> },
              { id: 'integrations', label: 'Integrações', icon: <Webhook className="w-3.5 h-3.5" /> },
              { id: 'appearance', label: 'Aparência', icon: <Palette className="w-3.5 h-3.5" /> },
              { id: 'backup', label: 'Backup', icon: <Database className="w-3.5 h-3.5" /> },
              { id: 'system', label: 'Sistema', icon: <Info className="w-3.5 h-3.5" /> },
              { id: 'legal', label: 'WhatsApp / LGPD', icon: <FileWarning className="w-3.5 h-3.5" /> }
            ]}
          />
        </div>
      </div>

      {/* SECURITY */}
      {section === 'security' && (
        <Card className="p-0 overflow-hidden">
          <div className="px-6 py-5" style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface-1)' }}>
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: 'var(--brand-50)' }}
              >
                <Shield className="w-5 h-5" style={{ color: 'var(--brand-600)' }} />
              </div>
              <div>
                <h2 className="ui-title text-[15px]">Proteção anti-bloqueio</h2>
                <p className="ui-subtitle text-[12.5px]">Parâmetros da fila de disparo para reduzir risco de restrição no WhatsApp.</p>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-6">
            <div>
              <label className="flex items-center gap-2 text-[13px] font-semibold mb-3" style={{ color: 'var(--text-1)' }}>
                <Clock className="w-4 h-4" style={{ color: 'var(--text-3)' }} />
                Intervalo entre mensagens (segundos)
              </label>
              <p className="text-[11.5px] mb-2 font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>
                Faixa atual: <span style={{ color: 'var(--brand-600)' }}>{minDelay}s</span> a{' '}
                <span style={{ color: 'var(--brand-600)' }}>{maxDelay}s</span> (aleatório por envio)
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-xl p-4" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
                      Minimo
                    </span>
                    <span className="text-[14px] font-bold tabular-nums" style={{ color: 'var(--brand-600)' }}>
                      {minDelay}s
                    </span>
                  </div>
                  <input
                    type="range"
                    min="5"
                    max="60"
                    value={minDelay}
                    onChange={(e) => setMinDelay(Number(e.target.value))}
                    className="w-full accent-brand-600"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
                      Maximo
                    </span>
                    <span className="text-[14px] font-bold tabular-nums" style={{ color: 'var(--brand-600)' }}>
                      {maxDelay}s
                    </span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="120"
                    value={maxDelay}
                    onChange={(e) => setMaxDelay(Number(e.target.value))}
                    className="w-full accent-brand-600"
                  />
                </div>
              </div>
              <p className="text-[11.5px] mt-2 flex items-center gap-1" style={{ color: 'var(--text-3)' }}>
                <AlertTriangle className="w-3 h-3" style={{ color: '#f59e0b' }} />
                Recomendamos um intervalo variavel entre 15s e 45s para simular comportamento humano.
              </p>
            </div>

            <div className="h-px" style={{ background: 'var(--border-subtle)' }} />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-[13px] font-semibold mb-2" style={{ color: 'var(--text-1)' }}>
                  Limite diário por chip
                </label>
                <Input
                  type="number"
                  value={dailyLimit}
                  onChange={(e) => setDailyLimit(Number(e.target.value))}
                  leftIcon={<Smartphone className="w-4 h-4" />}
                />
                <p className="text-[11.5px] mt-1.5" style={{ color: 'var(--text-3)' }}>
                  Protege cada número de enviar em excesso.
                </p>
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
                    Modo silêncio (fora do expediente)
                  </label>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={sleepMode}
                    className="w-11 h-6 rounded-full p-1 cursor-pointer transition-colors shrink-0"
                    style={{
                      background: sleepMode ? 'var(--brand-500)' : 'var(--surface-2)'
                    }}
                    onClick={() => setSleepMode(!sleepMode)}
                  >
                    <span
                      className="block w-4 h-4 bg-white rounded-full shadow-sm transition-transform"
                      style={{ transform: sleepMode ? 'translateX(18px)' : 'translateX(0)' }}
                    />
                  </button>
                </div>
                <p className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
                  Pausa disparos automaticamente fora do horário comercial (20:00–08:00).
                </p>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* INTEGRATIONS */}
      {section === 'integrations' && (
        <Card className="p-0 overflow-hidden">
          <div className="px-6 py-5" style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface-1)' }}>
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: 'rgba(59,130,246,0.12)' }}
              >
                <Webhook className="w-5 h-5" style={{ color: '#3b82f6' }} />
              </div>
              <div>
                <h2 className="ui-title text-[15px]">Integrações e notificações</h2>
                <p className="ui-subtitle text-[12.5px]">Webhook, e-mail de alerta e atalhos de assinatura.</p>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-5">
            <div>
              <label className="block text-[13px] font-semibold mb-1.5" style={{ color: 'var(--text-1)' }}>
                Webhook URL
              </label>
              <Input
                type="url"
                placeholder="https://seu-sistema.com/api/webhook"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                leftIcon={<Webhook className="w-4 h-4" />}
              />
              <p className="text-[11.5px] mt-1.5" style={{ color: 'var(--text-3)' }}>
                Enviaremos um POST quando uma mensagem for recebida ou um status mudar.
              </p>
              <p className="text-[11.5px] mt-1" style={{ color: 'var(--brand-600)' }}>
                Ao salvar, este webhook passa a valer tambem no backend atual.
              </p>
            </div>

            <div className="h-px" style={{ background: 'var(--border-subtle)' }} />

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="w-4 h-4 accent-brand-600 rounded"
                checked={emailNotif}
                onChange={(e) => setEmailNotif(e.target.checked)}
              />
              <div>
                <p className="text-[13px] font-semibold flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
                  <Bell className="w-4 h-4" style={{ color: 'var(--text-3)' }} />
                  Alertas por e-mail
                </p>
                <p className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
                  Receber notificacao quando um chip desconectar.
                </p>
              </div>
            </label>

            <div className="h-px" style={{ background: 'var(--border-subtle)' }} />

            <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}>
              <div className="flex items-center gap-2">
                <CreditCard className="w-4 h-4" style={{ color: 'var(--brand-600)' }} />
                <h3 className="text-[13px] font-bold" style={{ color: 'var(--text-1)' }}>
                  Assinatura (Mercado Pago / Infinite Pay)
                </h3>
              </div>
              {subLoading ? (
                <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                  Carregando status...
                </p>
              ) : subscription ? (
                <ul className="text-[12px] space-y-1.5" style={{ color: 'var(--text-2)' }}>
                  <li>
                    <span className="font-semibold">Status:</span> {subscription.status}
                  </li>
                  <li>
                    <span className="font-semibold">Provedor:</span> {subscription.provider}
                  </li>
                  <li>
                    <span className="font-semibold">Plano:</span> {subscription.plan || '—'}
                  </li>
                </ul>
              ) : (
                <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                  Nenhum registro de assinatura no Firestore para esta conta. Com webhooks configurados, o status aparece aqui apos o
                  pagamento.
                </p>
              )}
              <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>
                Cobrança ativa no app:{' '}
                <span className="font-semibold">{subEnforce ? 'sim (VITE_ENFORCE_SUBSCRIPTION)' : 'não'}</span>.
              </p>

              <details
                className="rounded-lg px-3 py-2 text-[11px] cursor-pointer"
                style={{ background: 'var(--surface-0)', border: '1px solid var(--border-subtle)', color: 'var(--text-3)' }}
              >
                <summary className="font-semibold text-[12px] cursor-pointer" style={{ color: 'var(--text-2)' }}>
                  Referência técnica (endpoints e variáveis de ambiente)
                </summary>
                <p className="mt-2 leading-relaxed">
                  Endpoints: <span className="font-mono break-all">POST /api/webhooks/mercadopago</span>,{' '}
                  <span className="font-mono break-all">POST /api/webhooks/infinitepay</span>. Checkout:{' '}
                  <span className="font-mono break-all">POST /api/billing/mercadopago/start</span>,{' '}
                  <span className="font-mono break-all">POST /api/billing/infinitepay/start</span>. Use URL pública (ngrok ou domínio) para
                  webhooks e para <span className="font-mono">INFINITEPAY_WEBHOOK_URL</span>.
                </p>
                <p className="mt-2 leading-relaxed">
                  MP: <span className="font-mono">MERCADOPAGO_PRICE_*</span> (BRL), <span className="font-mono">MERCADOPAGO_BACK_URL</span>.
                  Infinite Pay: <span className="font-mono">INFINITEPAY_HANDLE</span>,{' '}
                  <span className="font-mono">INFINITEPAY_WEBHOOK_URL</span>, preços em centavos opcionais{' '}
                  <span className="font-mono">INFINITEPAY_PRICE_*_CENTS</span> ou os mesmos <span className="font-mono">MERCADOPAGO_PRICE_*</span>{' '}
                  convertidos.
                </p>
              </details>

              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  variant="primary"
                  size="sm"
                  type="button"
                  disabled={billingBusy}
                  leftIcon={
                    mpCheckoutLoading === 'monthly' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />
                  }
                  onClick={() => startMercadoPagoCheckout('monthly')}
                >
                  Assinar mensal (MP)
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  disabled={billingBusy}
                  leftIcon={
                    mpCheckoutLoading === 'annual' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />
                  }
                  onClick={() => startMercadoPagoCheckout('annual')}
                >
                  Assinar anual (MP)
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  disabled={billingBusy}
                  leftIcon={
                    ipCheckoutLoading === 'monthly' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />
                  }
                  onClick={() => startInfinitePayCheckout('monthly')}
                >
                  Pagar mensal (Infinite Pay)
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  disabled={billingBusy}
                  leftIcon={
                    ipCheckoutLoading === 'annual' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />
                  }
                  onClick={() => startInfinitePayCheckout('annual')}
                >
                  Pagar anual (Infinite Pay)
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* APPEARANCE */}
      {section === 'appearance' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <p className="text-[11.5px] lg:col-span-2 -mt-1" style={{ color: 'var(--text-3)' }}>
            Tema e modo claro/escuro são gravados neste navegador ao selecionar (não dependem do botão Salvar no topo).
          </p>
          <Card>
            <div className="flex items-center gap-3 mb-4">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: 'var(--brand-50)' }}
              >
                <Palette className="w-5 h-5" style={{ color: 'var(--brand-600)' }} />
              </div>
              <div>
                <h2 className="ui-title text-[15px]">Cor de destaque</h2>
                <p className="ui-subtitle text-[12.5px]">Escolha a cor principal do sistema.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {themes.map((theme) => {
                const isSel = themeId === theme.id;
                return (
                  <button
                    key={theme.id}
                    onClick={() => {
                      setThemeId(theme.id);
                      applyTheme(theme.id);
                    }}
                    className="flex items-center gap-2 px-3.5 py-2 rounded-xl transition-all"
                    style={{
                      background: isSel ? 'var(--brand-50)' : 'var(--surface-1)',
                      border: isSel ? '1.5px solid rgba(16,185,129,0.3)' : '1.5px solid var(--border-subtle)',
                      color: isSel ? 'var(--brand-700)' : 'var(--text-2)'
                    }}
                  >
                    <span
                      className="w-4 h-4 rounded-full"
                      style={{ backgroundColor: theme.preview, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.08)' }}
                    />
                    <span className="text-[12.5px] font-semibold">{theme.name}</span>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card>
            <div className="flex items-center gap-3 mb-4">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: 'var(--surface-2)' }}
              >
                {mode === 'dark' ? (
                  <Moon className="w-5 h-5" style={{ color: 'var(--text-2)' }} />
                ) : (
                  <Sun className="w-5 h-5" style={{ color: '#f59e0b' }} />
                )}
              </div>
              <div>
                <h2 className="ui-title text-[15px]">Modo de exibição</h2>
                <p className="ui-subtitle text-[12.5px]">Claro ou escuro com pré-visualização imediata.</p>
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
                      border: isSel ? '1.5px solid rgba(16,185,129,0.3)' : '1.5px solid var(--border-subtle)'
                    }}
                  >
                    <span style={{ color: isSel ? 'var(--brand-600)' : 'var(--text-3)' }}>{m.icon}</span>
                    <span
                      className="text-[13px] font-semibold"
                      style={{ color: isSel ? 'var(--brand-700)' : 'var(--text-1)' }}
                    >
                      {m.label}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 rounded-xl p-3" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}>
              <p className="text-[11.5px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--text-3)' }}>
                Preview
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="success" dot>Success</Badge>
                <Badge variant="warning">Warning</Badge>
                <Badge variant="danger">Danger</Badge>
                <Badge variant="info">Info</Badge>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* BACKUP */}
      {section === 'backup' && (
        <Card className="p-0 overflow-hidden">
          <div className="px-6 py-5" style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface-1)' }}>
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: 'rgba(59,130,246,0.12)' }}
              >
                <Database className="w-5 h-5" style={{ color: '#3b82f6' }} />
              </div>
              <div>
                <h2 className="ui-title text-[15px]">Backup manual</h2>
                <p className="ui-subtitle text-[12.5px]">Execute um snapshot completo dos dados.</p>
              </div>
            </div>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-[13px] font-semibold mb-1.5" style={{ color: 'var(--text-1)' }}>
                Chave de backup (API)
              </label>
              <Input
                type="password"
                value={backupKey}
                onChange={(e) => setBackupKey(e.target.value)}
                placeholder="BACKUP_API_KEY"
                leftIcon={<KeyRound className="w-4 h-4" />}
              />
            </div>
            <Button variant="primary" onClick={handleBackupNow} fullWidth>
              Executar backup agora
            </Button>
            {backupStatus && (
              <div
                className="rounded-lg px-3 py-2 text-[12px]"
                style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)', color: 'var(--text-2)' }}
              >
                {backupStatus}
              </div>
            )}
          </div>
        </Card>
      )}

      {/* SYSTEM */}
      {section === 'system' && (
        <div className="space-y-4">
          <Card className="p-0 overflow-hidden">
            <div className="px-6 py-4" style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface-1)' }}>
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ background: 'var(--brand-50)' }}
                >
                  <Info className="w-5 h-5" style={{ color: 'var(--brand-600)' }} />
                </div>
                <div>
                  <h2 className="ui-title text-[15px]">Versão e conexão</h2>
                  <p className="ui-subtitle text-[12.5px]">Build instalada e socket em tempo real com o servidor.</p>
                </div>
              </div>
            </div>
            <div className="p-6 space-y-3">
              <div
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 py-3 px-4 rounded-xl"
                style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
              >
                <span className="text-[13px] font-medium" style={{ color: 'var(--text-3)' }}>
                  Versão instalada
                </span>
                <span className="font-mono font-semibold text-[13px] tabular-nums" style={{ color: 'var(--text-1)' }}>
                  {appVersion}
                </span>
              </div>
              <div
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 py-3 px-4 rounded-xl"
                style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
              >
                <div>
                  <span className="text-[13px] font-medium block" style={{ color: 'var(--text-3)' }}>
                    Painel ↔ servidor
                  </span>
                  <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                    Necessário para campanhas e chips em tempo real
                  </span>
                </div>
                <Badge variant={socket?.connected ? 'success' : 'danger'} dot>
                  {socket?.connected ? 'Online' : 'Offline'}
                </Badge>
              </div>
            </div>
          </Card>

          <Card>
            <div className="flex items-center gap-3 mb-4">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: 'rgba(16,185,129,0.12)' }}
              >
                <Shield className="w-5 h-5" style={{ color: 'var(--brand-600)' }} />
              </div>
              <div>
                <h2 className="ui-title text-[15px]">Painel do criador</h2>
                <p className="ui-subtitle text-[12.5px]">
                  Preços de marketing, duração do teste e textos da landing (<span className="font-mono text-[11px]">appConfig/global</span> no
                  Firestore).
                </p>
              </div>
            </div>
            {isCreatorAdmin ? (
              <div className="space-y-3">
                <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
                  No menu lateral, em <strong>Sistema</strong>, use <strong>Painel do criador</strong> (ícone de escudo). No celular, abra o menu
                  pelo ícone no topo.
                </p>
                <Button variant="primary" leftIcon={<Shield className="w-4 h-4" />} onClick={() => goToView('admin')}>
                  Abrir painel do criador
                </Button>
              </div>
            ) : (
              <div className="space-y-3 text-[12.5px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
                <p>
                  O item <strong>Painel do criador</strong> no menu e este botão ficam ocultos até o seu e-mail de login constar em{' '}
                  <span className="font-mono text-[11px]">VITE_ADMIN_EMAILS</span> no ambiente do Vite (arquivo <span className="font-mono text-[11px]">.env</span>),
                  com a mesma lista em <span className="font-mono text-[11px]">ADMIN_EMAILS</span> no servidor para poder salvar.
                </p>
                <p style={{ color: 'var(--text-3)' }}>
                  Conta atual: <span className="font-mono text-[11px]">{user?.email || '—'}</span>
                </p>
              </div>
            )}
          </Card>
        </div>
      )}

      {section === 'legal' && (
        <div className="space-y-5">
          <Card className="p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: 'rgba(245,158,11,0.15)' }}
              >
                <FileWarning className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h2 className="ui-title text-[15px]">Riscos, banimento e responsabilidade</h2>
                <p className="ui-subtitle text-[12.5px] mt-1">
                  Informacao para sua operacao. Quem define listas, consentimento e o uso dos numeros e o{' '}
                  <strong>cliente</strong> (voce ou sua empresa).
                </p>
              </div>
            </div>
            <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
              {WHATSAPP_RISK_SHORT}
            </p>
            <ul className="text-[12px] space-y-2 list-disc pl-4" style={{ color: 'var(--text-2)' }}>
              {WHATSAPP_RISK_BULLETS.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-[12px] font-semibold">
              <a
                href={WHATSAPP_META_POLICY}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-emerald-600 hover:underline"
              >
                Politica comercial WhatsApp <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <a
                href={WHATSAPP_META_CLOUD_OVERVIEW}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-emerald-600 hover:underline"
              >
                API oficial — visao geral <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <a
                href={WHATSAPP_META_CLOUD_GET_STARTED}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-emerald-600 hover:underline"
              >
                Cloud API — inicio <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
            <div
              className="rounded-lg px-3 py-2.5 text-[12px] space-y-1"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)', color: 'var(--text-2)' }}
            >
              <p>
                <strong>Aceite para campanhas:</strong>{' '}
                {riskAck
                  ? `Registrado neste navegador em ${new Date(riskAck.acceptedAt).toLocaleString('pt-BR')}.`
                  : 'Ainda nao registrado — ao criar a primeira campanha o app pedira a confirmacao.'}
              </p>
              {user?.uid && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    onClick={() => {
                      saveWhatsAppRiskAck(user.uid);
                      setAckTick((t) => t + 1);
                      toast.success('Aceite registrado novamente neste aparelho.');
                    }}
                  >
                    Registrar aceite agora
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    onClick={() => {
                      clearWhatsAppRiskAck();
                      setAckTick((t) => t + 1);
                      toast.success('Aceite removido. Sera pedido de novo ao criar campanha.');
                    }}
                  >
                    Revogar aceite neste navegador
                  </Button>
                </div>
              )}
            </div>
          </Card>

          <Card className="p-6 space-y-4">
            <div className="flex items-start gap-3">
              <Smartphone className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <h2 className="ui-title text-[15px]">Vincular API oficial (Meta / Cloud API)</h2>
                <p className="ui-subtitle text-[12.5px] mt-1 leading-relaxed">{WHATSAPP_OFFICIAL_API_INTRO}</p>
              </div>
            </div>
            <p className="text-[11.5px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
              Hoje o disparo pelo ZapMass usa conexao no estilo WhatsApp Web no servidor. Os campos abaixo servem para
              guardar os dados da Cloud API quando voce (ou um integrador) ligar o envio oficial no backend — nada disso
              e enviado automaticamente a Meta por este formulario.
            </p>
            <label className="flex items-center gap-2 cursor-pointer text-[13px]" style={{ color: 'var(--text-1)' }}>
              <input
                type="checkbox"
                checked={waOfficial.preferOfficialOnly}
                onChange={(e) => setWaOfficial((p) => ({ ...p, preferOfficialOnly: e.target.checked }))}
              />
              Pretendo usar apenas a API oficial (Cloud API) quando estiver disponivel no meu ambiente
            </label>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--text-3)' }}>
                Phone Number ID (Graph API)
              </label>
              <Input
                value={waOfficial.phoneNumberId}
                onChange={(e) => setWaOfficial((p) => ({ ...p, phoneNumberId: e.target.value }))}
                placeholder="Ex.: 123456789012345"
                leftIcon={<Smartphone className="w-4 h-4" />}
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--text-3)' }}>
                WhatsApp Business Account ID (opcional)
              </label>
              <Input
                value={waOfficial.wabaId}
                onChange={(e) => setWaOfficial((p) => ({ ...p, wabaId: e.target.value }))}
                placeholder="WABA ID"
                leftIcon={<KeyRound className="w-4 h-4" />}
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--text-3)' }}>
                Access token (temporario / sistema — segredo)
              </label>
              <Input
                type="password"
                autoComplete="off"
                value={waOfficial.accessToken}
                onChange={(e) => setWaOfficial((p) => ({ ...p, accessToken: e.target.value }))}
                placeholder="Nao compartilhe em video ou Git"
                leftIcon={<KeyRound className="w-4 h-4" />}
              />
            </div>
            <Button
              variant="primary"
              type="button"
              onClick={() => {
                saveWaOfficialPrefs(waOfficial);
                toast.success('Preferencias da Cloud API salvas neste navegador.');
              }}
            >
              Salvar vinculo (local)
            </Button>
          </Card>
        </div>
      )}
    </div>
  );
};
