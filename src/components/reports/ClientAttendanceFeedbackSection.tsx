import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, MessageCircleHeart, RefreshCw, Star, ExternalLink, Download } from 'lucide-react';
import { getAuth } from 'firebase/auth';
import { Badge, Button, Card, EmptyState } from '../ui';
import { apiUrl } from '../../utils/apiBase';
import { useMainLayoutNav } from '../../context/MainLayoutNavContext';
import { openChatByConversationIdNavigate } from '../../utils/openChatByConversationIdNav';

export type InboxClientFeedbackRow = {
  id: string;
  conversationId: string;
  rating: number | null;
  comment: string | null;
  source: string;
  createdAt: string | null;
};

async function fetchInboxClientFeedback(limit: number): Promise<InboxClientFeedbackRow[]> {
  const u = getAuth().currentUser;
  if (!u) throw new Error('Sessão expirada.');
  const token = await u.getIdToken();
  const r = await fetch(apiUrl(`/api/workspace/inbox-client-feedback?limit=${encodeURIComponent(String(limit))}`), {
    headers: { Authorization: `Bearer ${token}` }
  });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; items?: InboxClientFeedbackRow[]; error?: string };
  if (!r.ok) throw new Error(j.error || `Erro HTTP ${r.status}`);
  return Array.isArray(j.items) ? j.items : [];
}

function shortConvId(id: string): string {
  if (id.length <= 22) return id;
  return `${id.slice(0, 10)}…${id.slice(-8)}`;
}

function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return '—';
  }
}

export const ClientAttendanceFeedbackSection: React.FC = () => {
  const navigateTo = useMainLayoutNav();
  const [rows, setRows] = useState<InboxClientFeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await fetchInboxClientFeedback(100);
      setRows(items);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao carregar.';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const exportCsv = () => {
    if (rows.length === 0) return;
    const header = ['Data', 'Nota', 'Comentário', 'Conversa', 'Origem'];
    const lines = rows.map((r) =>
      [
        r.createdAt || '',
        r.rating != null ? String(r.rating) : '',
        (r.comment || '').replace(/"/g, '""'),
        r.conversationId,
        r.source
      ]
        .map((cell) => `"${String(cell)}"`)
        .join(';')
    );
    const csv = ['\ufeff', header.join(';'), ...lines].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `avaliacoes_clientes_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success('CSV exportado.');
  };

  return (
    <Card className="p-0 overflow-hidden">
      <div
        className="px-5 py-4 flex flex-wrap items-center justify-between gap-3"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <div className="flex items-center gap-2">
          <MessageCircleHeart className="w-4 h-4" style={{ color: '#a855f7' }} />
          <h3 className="ui-title text-[14px]">Satisfação do cliente</h3>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="neutral">{rows.length} registos</Badge>
          <Button
            variant="ghost"
            size="sm"
            disabled={loading}
            leftIcon={loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            onClick={() => void load()}
          >
            Actualizar
          </Button>
          <Button variant="secondary" size="sm" disabled={rows.length === 0} leftIcon={<Download className="w-3.5 h-3.5" />} onClick={exportCsv}>
            CSV
          </Button>
        </div>
      </div>
      <p className="px-5 py-3 text-[12px]" style={{ color: 'var(--text-2)', borderBottom: '1px solid var(--border-subtle)' }}>
        Respostas do formulário público enviado por WhatsApp após «Finalizar libertação» na conversa.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left min-w-[560px]">
          <thead style={{ background: 'var(--surface-1)', borderBottom: '1px solid var(--border-subtle)' }}>
            <tr>
              {['Data', 'Nota', 'Comentário', 'Conversa', ''].map((h) => (
                <th
                  key={h || '_'}
                  className="px-5 py-3 font-bold text-[10.5px] uppercase tracking-widest whitespace-nowrap"
                  style={{ color: 'var(--text-3)' }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center">
                  <Loader2 className="w-6 h-6 animate-spin inline-block align-middle mr-2" style={{ color: 'var(--text-3)' }} />
                  <span className="text-[13px]" style={{ color: 'var(--text-2)' }}>
                    A carregar…
                  </span>
                </td>
              </tr>
            )}
            {!loading && error && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-8">
                  <EmptyState
                    icon={<MessageCircleHeart className="w-5 h-5" style={{ color: 'var(--text-3)' }} />}
                    title="Não foi possível carregar"
                    description={error}
                  />
                </td>
              </tr>
            )}
            {!loading && !error && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-8">
                  <EmptyState
                    icon={<MessageCircleHeart className="w-5 h-5" style={{ color: 'var(--text-3)' }} />}
                    title="Ainda sem avaliações de clientes"
                    description='Assim que finalizar libertações com a opção "link no WhatsApp" e o cliente responder, os dados aparecem aqui.'
                  />
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr
                key={r.id}
                className="transition-colors hover:bg-[var(--surface-1)]"
                style={{ borderBottom: '1px solid var(--border-subtle)' }}
              >
                <td className="px-5 py-3.5 text-[13px] whitespace-nowrap" style={{ color: 'var(--text-2)' }}>
                  {formatWhen(r.createdAt)}
                </td>
                <td className="px-5 py-3.5">
                  {r.rating != null ? (
                    <span className="inline-flex items-center gap-0.5" title={`${r.rating} de 5`}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star
                          key={n}
                          className={`w-3.5 h-3.5 ${n <= r.rating! ? 'fill-amber-500 text-amber-500' : ''}`}
                          style={n <= r.rating! ? undefined : { color: 'var(--text-3)' }}
                        />
                      ))}
                    </span>
                  ) : (
                    <span className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                      —
                    </span>
                  )}
                </td>
                <td className="px-5 py-3.5 max-w-[280px]">
                  <p className="text-[13px] line-clamp-3" style={{ color: 'var(--text-1)' }}>
                    {r.comment?.trim() ? r.comment : <span style={{ color: 'var(--text-3)' }}>—</span>}
                  </p>
                </td>
                <td className="px-5 py-3.5">
                  <span className="font-mono text-[11px] break-all" style={{ color: 'var(--text-2)' }} title={r.conversationId}>
                    {r.conversationId ? shortConvId(r.conversationId) : '—'}
                  </span>
                </td>
                <td className="px-5 py-3.5 text-right whitespace-nowrap">
                  {r.conversationId ? (
                    <button
                      type="button"
                      className="text-[11px] font-semibold inline-flex items-center gap-1 px-2 py-1 rounded-lg transition-opacity hover:opacity-80"
                      style={{ color: 'var(--brand-600)', background: 'rgba(16,185,129,0.1)' }}
                      onClick={() => openChatByConversationIdNavigate(navigateTo, r.conversationId)}
                    >
                      <ExternalLink className="w-3 h-3" />
                      Conversa
                    </button>
                  ) : (
                    <span />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
};
