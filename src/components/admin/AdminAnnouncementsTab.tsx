import React, { useEffect, useState } from 'react';
import { Loader2, Megaphone, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useAppConfig } from '../../context/AppConfigContext';
import type { SystemAnnouncement, SystemAnnouncementKind } from '../../types/appConfig';
import { Button, Card, CardHeader, SectionHeader, Textarea } from '../ui';
import { apiUrl } from '../../utils/apiBase';

export const AdminAnnouncementsTab: React.FC = () => {
  const { user } = useAuth();
  const { config, reload } = useAppConfig();
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [kind, setKind] = useState<SystemAnnouncementKind>('warning');
  const [showBanner, setShowBanner] = useState(true);
  const [pushToBell, setPushToBell] = useState(true);
  const [expiresAt, setExpiresAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [current, setCurrent] = useState<SystemAnnouncement | null>(null);

  useEffect(() => {
    setCurrent(config.systemAnnouncement ?? null);
  }, [config.systemAnnouncement]);

  const authHeaders = async () => {
    if (!user) throw new Error('Faça login.');
    const idToken = await user.getIdToken();
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`
    };
  };

  const publish = async () => {
    if (!user) return;
    if (!title.trim() || !message.trim()) {
      toast.error('Informe título e mensagem.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(apiUrl('/api/admin/system-announcement'), {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({
          title: title.trim(),
          message: message.trim(),
          kind,
          showBanner,
          pushToBell,
          expiresAt: expiresAt.trim() || null
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        toast.error(typeof data?.error === 'string' ? data.error : 'Falha ao publicar.');
        return;
      }
      const bell = Number(data.bellCount) || 0;
      toast.success(
        pushToBell
          ? `Comunicado publicado. ${bell} notificação(ões) no sino.`
          : 'Comunicado publicado (faixa superior).'
      );
      await reload();
    } catch {
      toast.error('Erro de rede.');
    } finally {
      setSaving(false);
    }
  };

  const clearAnnouncement = async () => {
    if (!user) return;
    setClearing(true);
    try {
      const res = await fetch(apiUrl('/api/admin/system-announcement'), {
        method: 'DELETE',
        headers: await authHeaders()
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        toast.error(typeof data?.error === 'string' ? data.error : 'Falha ao remover.');
        return;
      }
      toast.success('Comunicado removido.');
      await reload();
    } catch {
      toast.error('Erro de rede.');
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Comunicados globais"
        description="Avisos de manutenção ou informações importantes para todos os utilizadores. Podem aparecer na faixa superior e no sino de notificações."
      />

      {current?.active && (
        <Card className="border-amber-500/30">
          <CardHeader
            title="Comunicado ativo"
            subtitle={`Publicado em ${new Date(current.updatedAt).toLocaleString('pt-BR')}${
              current.expiresAt ? ` · expira ${new Date(current.expiresAt).toLocaleString('pt-BR')}` : ''
            }`}
            icon={<Megaphone className="w-4 h-4 text-amber-500" />}
          />
          <div className="mt-3 space-y-2">
            <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>
              {current.title}
            </p>
            <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--text-2)' }}>
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
      )}

      <Card>
        <CardHeader
          title="Novo comunicado"
          subtitle="Exemplo: manutenção programada, instabilidade temporária, novidade importante."
          icon={<Megaphone className="w-4 h-4 text-emerald-600" />}
        />
        <div className="mt-4 space-y-4">
          <div>
            <label className="ui-eyebrow text-[10px]">Título</label>
            <input
              className="ui-input mt-1"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: Manutenção programada"
              maxLength={200}
            />
          </div>
          <div>
            <label className="ui-eyebrow text-[10px]">Mensagem</label>
            <Textarea
              className="mt-1 min-h-[120px]"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Ex.: Domingo, das 22h às 23h, o sistema ficará indisponível para atualização."
              maxLength={4000}
            />
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
          <Button
            type="button"
            disabled={saving}
            leftIcon={saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Megaphone className="w-4 h-4" />}
            onClick={() => void publish()}
          >
            Publicar comunicado
          </Button>
        </div>
      </Card>
    </div>
  );
};
