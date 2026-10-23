import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Info, Loader2, Megaphone, Trash2, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useAppConfig } from '../../context/AppConfigContext';
import type { SystemAnnouncement, SystemAnnouncementKind } from '../../types/appConfig';
import { apiFetchJson } from '../../utils/apiFetchAuth';
import { Badge, Button, Card, CardHeader, SectionHeader, Textarea } from '../ui';

const TITLE_MAX = 200;
const MESSAGE_MAX = 4000;
const SESSION_TOAST_ID = 'admin-announcements-session';
const PUBLISH_TOAST_ID = 'admin-announcements-publish';

const PREVIEW_STYLE = {
  info: {
    bg: 'rgba(59, 130, 246, 0.12)',
    border: 'rgba(59, 130, 246, 0.35)',
    icon: 'text-blue-500'
  },
  warning: {
    bg: 'rgba(245, 158, 11, 0.12)',
    border: 'rgba(245, 158, 11, 0.35)',
    icon: 'text-amber-500'
  },
  error: {
    bg: 'rgba(239, 68, 68, 0.12)',
    border: 'rgba(239, 68, 68, 0.35)',
    icon: 'text-red-500'
  }
} as const;

const PREVIEW_ICON = {
  info: Info,
  warning: AlertTriangle,
  error: XCircle
} as const;

const toPtDateTime = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR');
  } catch {
    return '—';
  }
};

const toastAnnounceError = (e: unknown, fallback: string) => {
  const msg = e instanceof Error ? e.message : fallback;
  const isSession = /sessão expirada/i.test(msg);
  toast.error(msg, { id: isSession ? SESSION_TOAST_ID : undefined });
};

export const AdminAnnouncementsTab: React.FC = () => {
  const { user, loading: authLoading } = useAuth();
  const { config, reload } = useAppConfig();
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [kind, setKind] = useState<SystemAnnouncementKind>('warning');
  const [showBanner, setShowBanner] = useState(true);
  const [pushToBell, setPushToBell] = useState(true);
  const [expiresAt, setExpiresAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [loadingCurrent, setLoadingCurrent] = useState(false);
  const [current, setCurrent] = useState<SystemAnnouncement | null>(null);
  const [touched, setTouched] = useState({ title: false, message: false });

  const syncCurrent = useCallback((announcement: SystemAnnouncement | null) => {
    setCurrent(announcement?.active ? announcement : null);
  }, []);

  useEffect(() => {
    syncCurrent(config.systemAnnouncement ?? null);
  }, [config.systemAnnouncement, syncCurrent]);

  const loadCurrent = useCallback(async () => {
    if (!user) return;
    setLoadingCurrent(true);
    try {
      const data = await apiFetchJson<{ ok: boolean; announcement?: SystemAnnouncement | null; error?: string }>(
        '/api/admin/system-announcement'
      );
      if (!data?.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Falha ao carregar comunicado.');
      }
      const ann = data.announcement ?? null;
      syncCurrent(ann?.active ? ann : null);
    } catch (e: unknown) {
      toastAnnounceError(e, e instanceof Error ? e.message : 'Comunicado indisponível.');
    } finally {
      setLoadingCurrent(false);
    }
  }, [user, syncCurrent]);

  useEffect(() => {
    if (authLoading || !user) return;
    void loadCurrent();
  }, [authLoading, user, loadCurrent]);

  const titleError = useMemo(() => {
    if (!touched.title && !title.trim()) return '';
    if (!title.trim()) return 'Informe um título.';
    if (title.length > TITLE_MAX) return `Máximo ${TITLE_MAX} caracteres.`;
    return '';
  }, [title, touched.title]);

  const messageError = useMemo(() => {
    if (!touched.message && !message.trim()) return '';
    if (!message.trim()) return 'Informe a mensagem.';
    if (message.length > MESSAGE_MAX) return `Máximo ${MESSAGE_MAX} caracteres.`;
    return '';
  }, [message, touched.message]);

  const canPublish = title.trim().length > 0 && message.trim().length > 0 && !titleError && !messageError;

  const previewKind = kind in PREVIEW_STYLE ? kind : 'info';
  const PreviewIcon = PREVIEW_ICON[previewKind];
  const previewPalette = PREVIEW_STYLE[previewKind];

  const publish = async () => {
    if (!user) return;
    setTouched({ title: true, message: true });
    if (!canPublish) {
      toast.error('Corrija título e mensagem antes de publicar.', { id: PUBLISH_TOAST_ID });
      return;
    }
    setSaving(true);
    try {
      const data = await apiFetchJson<{
        ok: boolean;
        bellCount?: number;
        error?: string;
      }>('/api/admin/system-announcement', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          message: message.trim(),
          kind,
          showBanner,
          pushToBell,
          expiresAt: expiresAt.trim() || null
        })
      });
      if (!data?.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Falha ao publicar.');
      }
      const bell = Number(data.bellCount) || 0;
      toast.success(
        pushToBell
          ? `Comunicado publicado. ${bell} notificação(ões) no sino.`
          : 'Comunicado publicado (faixa superior).',
        { id: PUBLISH_TOAST_ID }
      );
      setTitle('');
      setMessage('');
      setTouched({ title: false, message: false });
      await reload();
      await loadCurrent();
    } catch (e: unknown) {
      toastAnnounceError(e, 'Erro ao publicar comunicado.');
    } finally {
      setSaving(false);
    }
  };

  const clearAnnouncement = async () => {
    if (!user) return;
    setClearing(true);
    try {
      const data = await apiFetchJson<{ ok: boolean; error?: string }>('/api/admin/system-announcement', {
        method: 'DELETE'
      });
      if (!data?.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Falha ao remover.');
      }
      toast.success('Comunicado removido.');
      syncCurrent(null);
      await reload();
    } catch (e: unknown) {
      toastAnnounceError(e, 'Erro ao remover comunicado.');
    } finally {
      setClearing(false);
    }
  };

  const expired =
    current?.expiresAt && Number.isFinite(Date.parse(current.expiresAt))
      ? Date.parse(current.expiresAt) < Date.now()
      : false;

  return (
    <div className="space-y-6 pb-24">
      <SectionHeader
        title="Comunicados globais"
        description="Avisos de manutenção ou informações importantes para todos os usuários. Aparecem na faixa superior e, opcionalmente, no sino de notificações."
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={current ? 'warning' : 'neutral'}>{current ? '1 ativo' : 'Nenhum ativo'}</Badge>
        {loadingCurrent ? (
          <span className="text-xs inline-flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Atualizando…
          </span>
        ) : null}
      </div>

      {current ? (
        <Card className={expired ? 'border-slate-500/40 opacity-90' : 'border-amber-500/30'}>
          <CardHeader
            title={expired ? 'Comunicado expirado' : 'Comunicado ativo'}
            subtitle={`Publicado em ${toPtDateTime(current.updatedAt)}${
              current.expiresAt ? ` · expira ${toPtDateTime(current.expiresAt)}` : ''
            }${current.publishedBy ? ` · por ${current.publishedBy}` : ''}`}
            icon={<Megaphone className="w-4 h-4 text-amber-500" />}
          />
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge variant={current.kind === 'error' ? 'danger' : current.kind === 'warning' ? 'warning' : 'info'}>
                {current.kind === 'error' ? 'Urgente' : current.kind === 'warning' ? 'Aviso' : 'Informação'}
              </Badge>
              {current.showBanner ? <Badge variant="neutral">Faixa no topo</Badge> : null}
            </div>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>
              {current.title}
            </p>
            <p className="text-sm whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-2)' }}>
              {current.body}
            </p>
            <Button
              variant="secondary"
              type="button"
              leftIcon={clearing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              disabled={clearing}
              onClick={() => void clearAnnouncement()}
            >
              Remover comunicado
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="border-dashed">
          <p className="text-sm" style={{ color: 'var(--text-3)' }}>
            Nenhum comunicado ativo no momento. Publique abaixo para substituir o anterior automaticamente.
          </p>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Pré-visualização da faixa"
          subtitle="Como os usuários verão o aviso no topo do painel (se «Mostrar faixa» estiver marcado)."
          icon={<PreviewIcon className={`w-4 h-4 ${previewPalette.icon}`} />}
        />
        <div
          className="mt-3 rounded-lg border px-4 py-3"
          style={{ background: previewPalette.bg, borderColor: previewPalette.border }}
        >
          <div className="flex items-start gap-3">
            <PreviewIcon className={`w-5 h-5 shrink-0 mt-0.5 ${previewPalette.icon}`} />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
                {title.trim() || 'Título do comunicado'}
              </p>
              <p className="text-[12px] mt-1 whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-2)' }}>
                {message.trim() || 'Mensagem que aparecerá para todos os usuários logados.'}
              </p>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Novo comunicado"
          subtitle="Exemplo: manutenção programada, instabilidade temporária ou novidade importante."
          icon={<Megaphone className="w-4 h-4 text-emerald-600" />}
        />
        <div className="mt-4 space-y-4">
          <div>
            <div className="flex items-center justify-between gap-2">
              <label className="ui-eyebrow text-[10px]">Título</label>
              <span className="text-[10px] font-mono" style={{ color: 'var(--text-3)' }}>
                {title.length}/{TITLE_MAX}
              </span>
            </div>
            <input
              className="ui-input mt-1"
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX))}
              onBlur={() => setTouched((t) => ({ ...t, title: true }))}
              placeholder="Ex.: Manutenção programada"
              maxLength={TITLE_MAX}
              aria-invalid={Boolean(titleError)}
            />
            {titleError ? (
              <p className="text-[11px] mt-1 text-red-500">{titleError}</p>
            ) : null}
          </div>
          <div>
            <div className="flex items-center justify-between gap-2">
              <label className="ui-eyebrow text-[10px]">Mensagem</label>
              <span className="text-[10px] font-mono" style={{ color: 'var(--text-3)' }}>
                {message.length}/{MESSAGE_MAX}
              </span>
            </div>
            <Textarea
              className="mt-1 min-h-[120px]"
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, MESSAGE_MAX))}
              onBlur={() => setTouched((t) => ({ ...t, message: true }))}
              placeholder="Ex.: Domingo, das 22h às 23h, o sistema ficará indisponível para atualização."
              maxLength={MESSAGE_MAX}
              aria-invalid={Boolean(messageError)}
            />
            {messageError ? (
              <p className="text-[11px] mt-1 text-red-500">{messageError}</p>
            ) : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="ui-eyebrow text-[10px]">Tipo</label>
              <select
                className="ui-input mt-1"
                value={kind}
                onChange={(e) => setKind(e.target.value as SystemAnnouncementKind)}
              >
                <option value="info">Informação</option>
                <option value="warning">Aviso / manutenção</option>
                <option value="error">Urgente</option>
              </select>
            </div>
            <div>
              <label className="ui-eyebrow text-[10px]">Expira em (opcional)</label>
              <input
                type="datetime-local"
                className="ui-input mt-1"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-2)' }}>
            <input type="checkbox" checked={showBanner} onChange={(e) => setShowBanner(e.target.checked)} />
            Mostrar faixa no topo do painel
          </label>
          <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-2)' }}>
            <input type="checkbox" checked={pushToBell} onChange={(e) => setPushToBell(e.target.checked)} />
            Enviar também ao sino de notificações de cada utilizador
          </label>
        </div>
      </Card>

      <div
        className="sticky bottom-0 z-10 -mx-2 sm:mx-0 px-3 py-3 rounded-xl border flex flex-wrap items-center justify-between gap-3 backdrop-blur-md"
        style={{ borderColor: 'var(--border-subtle)', background: 'color-mix(in srgb, var(--surface-0) 88%, transparent)' }}
      >
        <p className="text-xs max-w-xl" style={{ color: 'var(--text-3)' }}>
          Publicar substitui qualquer comunicado ativo. Com expiração, a faixa some automaticamente após a data.
        </p>
        <Button
          type="button"
          disabled={saving || !canPublish}
          loading={saving}
          leftIcon={saving ? undefined : <Megaphone className="w-4 h-4" />}
          onClick={() => void publish()}
        >
          Publicar comunicado
        </Button>
      </div>
    </div>
  );
};
