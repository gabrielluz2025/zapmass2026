import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Lightbulb,
  Loader2,
  Mail,
  MessageCircle,
  RefreshCw,
  Send,
  XCircle
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { apiFetchJson } from '../../utils/apiFetchAuth';
import { Badge, Button, Card, EmptyState, Modal, SectionHeader, StatCard, TabBar, Textarea } from '../ui';

const SESSION_TOAST_ID = 'admin-suggestions-session';

type ProductSuggestion = {
  id: string;
  uid: string;
  text: string;
  userEmail: string;
  screen: string;
  category?: string;
  status?: string;
  replyCount?: number;
  lastRepliedAt?: string | null;
  lastRepliedBy?: string;
  createdAt: string | null;
};

type SuggestionReply = {
  id: string;
  text: string;
  adminEmail: string;
  adminUid: string;
  emailSent: boolean;
  emailError?: string;
  createdAt: string | null;
};

type TriageFilter = 'all' | 'new' | 'reviewing' | 'answered';

function suggestionCategoryPt(code: string | undefined): string {
  const m: Record<string, string> = {
    usability: 'Telas / usabilidade',
    campaigns: 'Campanhas',
    reports: 'Relatórios',
    integrations: 'Integrações',
    support: 'Suporte',
    other: 'Outro'
  };
  if (!code) return '';
  return m[code] || code;
}

const toPtDateTime = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR');
  } catch {
    return '—';
  }
};

const copyToClipboard = async (text: string, okMessage = 'Copiado.') => {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(okMessage);
  } catch {
    toast.error('Não foi possível copiar.');
  }
};

const toastSuggestionError = (e: unknown, fallback: string) => {
  const msg = e instanceof Error ? e.message : fallback;
  const isSession = /sessão expirada/i.test(msg);
  toast.error(msg, { id: isSession ? SESSION_TOAST_ID : undefined });
};

function triageOf(row: ProductSuggestion): Exclude<TriageFilter, 'all'> {
  const replies = Number(row.replyCount) || 0;
  if (replies > 0 || row.lastRepliedAt) return 'answered';
  if (row.status === 'reviewing') return 'reviewing';
  return 'new';
}

const TRIAGE_TABS: Array<{
  id: TriageFilter;
  label: string;
  activeClass: string;
}> = [
  { id: 'all', label: 'Todas', activeClass: 'text-[var(--text-1)]' },
  { id: 'new', label: 'Novas', activeClass: 'text-sky-600 dark:text-sky-400' },
  { id: 'reviewing', label: 'Em análise', activeClass: 'text-amber-600 dark:text-amber-400' },
  { id: 'answered', label: 'Respondidas', activeClass: 'text-emerald-600 dark:text-emerald-400' }
];

export const AdminSuggestionsTab: React.FC = () => {
  const { user, loading: authLoading } = useAuth();
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [productSuggestions, setProductSuggestions] = useState<ProductSuggestion[]>([]);
  const [triageFilter, setTriageFilter] = useState<TriageFilter>('all');
  const [replyTarget, setReplyTarget] = useState<ProductSuggestion | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replySending, setReplySending] = useState(false);
  const [statusBusyKey, setStatusBusyKey] = useState<string | null>(null);
  const [repliesByKey, setRepliesByKey] = useState<Record<string, SuggestionReply[]>>({});
  const [repliesLoadingKey, setRepliesLoadingKey] = useState<string | null>(null);
  const [repliesOpenKey, setRepliesOpenKey] = useState<string | null>(null);

  const replyKey = (s: { uid: string; id: string }) => `${s.uid}__${s.id}`;

  const loadProductSuggestions = useCallback(async () => {
    if (!user) return;
    setSuggestionsLoading(true);
    setLoadError(null);
    try {
      const data = await apiFetchJson<{ ok: boolean; items?: ProductSuggestion[]; error?: string }>(
        '/api/admin/product-suggestions?limit=120'
      );
      if (!data?.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Falha ao carregar sugestões.');
      }
      setProductSuggestions(Array.isArray(data.items) ? data.items : []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao carregar sugestões.';
      setLoadError(msg);
      toastSuggestionError(e, msg);
    } finally {
      setSuggestionsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading || !user) return;
    void loadProductSuggestions();
  }, [authLoading, user, loadProductSuggestions]);

  const loadRepliesFor = useCallback(
    async (s: ProductSuggestion) => {
      if (!user) return;
      const k = replyKey(s);
      setRepliesLoadingKey(k);
      try {
        const data = await apiFetchJson<{ ok: boolean; items?: SuggestionReply[]; error?: string }>(
          `/api/admin/product-suggestions/${encodeURIComponent(s.uid)}/${encodeURIComponent(s.id)}/replies`
        );
        if (!data?.ok) {
          throw new Error(typeof data?.error === 'string' ? data.error : 'Falha ao carregar histórico.');
        }
        setRepliesByKey((prev) => ({ ...prev, [k]: Array.isArray(data.items) ? data.items : [] }));
      } catch (e: unknown) {
        toastSuggestionError(e, e instanceof Error ? e.message : 'Erro ao carregar histórico.');
      } finally {
        setRepliesLoadingKey(null);
      }
    },
    [user]
  );

  const toggleRepliesPanel = (s: ProductSuggestion) => {
    const k = replyKey(s);
    if (repliesOpenKey === k) {
      setRepliesOpenKey(null);
      return;
    }
    setRepliesOpenKey(k);
    if (!repliesByKey[k]) void loadRepliesFor(s);
  };

  const openReplyModal = (s: ProductSuggestion) => {
    setReplyTarget(s);
    setReplyText('');
  };

  const closeReplyModal = () => {
    if (replySending) return;
    setReplyTarget(null);
    setReplyText('');
  };

  const markReviewing = async (s: ProductSuggestion) => {
    if (!user) return;
    const k = replyKey(s);
    setStatusBusyKey(k);
    try {
      const data = await apiFetchJson<{ ok: boolean; error?: string }>(
        `/api/admin/product-suggestions/${encodeURIComponent(s.uid)}/${encodeURIComponent(s.id)}`,
        { method: 'PATCH', body: JSON.stringify({ status: 'reviewing' }) }
      );
      if (!data?.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Falha ao atualizar status.');
      }
      setProductSuggestions((prev) =>
        prev.map((row) => (replyKey(row) === k ? { ...row, status: 'reviewing' } : row))
      );
      toast.success('Marcada como em análise.');
    } catch (e: unknown) {
      toastSuggestionError(e, 'Não foi possível atualizar o status.');
    } finally {
      setStatusBusyKey(null);
    }
  };

  const submitReply = async () => {
    if (!user || !replyTarget) return;
    const trimmed = replyText.trim();
    if (trimmed.length < 1) {
      toast.error('Escreva a resposta antes de enviar.');
      return;
    }
    setReplySending(true);
    try {
      const data = await apiFetchJson<{
        ok: boolean;
        emailSent?: boolean;
        recipient?: string;
        emailError?: string;
        error?: string;
      }>(
        `/api/admin/product-suggestions/${encodeURIComponent(replyTarget.uid)}/${encodeURIComponent(replyTarget.id)}/reply`,
        { method: 'POST', body: JSON.stringify({ text: trimmed }) }
      );
      if (!data?.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Falha ao enviar resposta.');
      }
      const emailSent = data.emailSent === true;
      const recipient = typeof data.recipient === 'string' ? data.recipient : '';
      const emailErr = typeof data.emailError === 'string' ? data.emailError.trim() : '';
      if (emailSent && recipient) {
        toast.success(`Resposta enviada por email para ${recipient}.`);
      } else if (recipient) {
        const detail =
          emailErr.length > 0
            ? emailErr
            : 'Verifique RESEND_API_KEY e EMAIL_FROM no servidor.';
        toast(`Resposta registrada. ${detail}`, { icon: '⚠️', duration: 12000, style: { maxWidth: 560 } });
      } else {
        toast('Resposta registrada — cliente sem email vinculado.', { icon: 'ℹ️', duration: 6000 });
      }
      const k = replyKey(replyTarget);
      setProductSuggestions((prev) =>
        prev.map((row) =>
          replyKey(row) === k
            ? {
                ...row,
                replyCount: (Number(row.replyCount) || 0) + 1,
                lastRepliedAt: new Date().toISOString(),
                lastRepliedBy: user.email || ''
              }
            : row
        )
      );
      await loadRepliesFor(replyTarget);
      setRepliesOpenKey(k);
      setReplyTarget(null);
      setReplyText('');
    } catch (e: unknown) {
      toastSuggestionError(e, 'Erro ao enviar resposta.');
    } finally {
      setReplySending(false);
    }
  };

  const triageCounts = useMemo(() => {
    const counts = { all: productSuggestions.length, new: 0, reviewing: 0, answered: 0 };
    for (const row of productSuggestions) {
      const t = triageOf(row);
      counts[t] += 1;
    }
    return counts;
  }, [productSuggestions]);

  const filteredSuggestions = useMemo(() => {
    if (triageFilter === 'all') return productSuggestions;
    return productSuggestions.filter((row) => triageOf(row) === triageFilter);
  }, [productSuggestions, triageFilter]);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Sugestões dos usuários"
        description="Ideias enviadas pelo botão «Sugestões» na barra superior. Armazenadas no servidor (Postgres na VPS); triagem, status e respostas por email."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total listadas" value={String(triageCounts.all)} icon={<Lightbulb className="w-4 h-4 text-amber-500" />} />
        <StatCard label="Novas" value={String(triageCounts.new)} icon={<Lightbulb className="w-4 h-4 text-sky-500" />} />
        <StatCard label="Em análise" value={String(triageCounts.reviewing)} icon={<Loader2 className="w-4 h-4 text-amber-500" />} />
        <StatCard label="Respondidas" value={String(triageCounts.answered)} icon={<CheckCircle2 className="w-4 h-4 text-emerald-500" />} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <TabBar
          items={TRIAGE_TABS.map((t) => ({
            id: t.id,
            label:
              t.id === 'all'
                ? `${t.label} (${triageCounts.all})`
                : `${t.label} (${triageCounts[t.id as keyof typeof triageCounts]})`,
            activeClass: t.activeClass
          }))}
          activeId={triageFilter}
          onChange={(id) => setTriageFilter(id as TriageFilter)}
          ariaLabel="Filtrar sugestões por status"
        />
        <Button
          variant="secondary"
          size="sm"
          type="button"
          disabled={suggestionsLoading}
          leftIcon={suggestionsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          onClick={() => void loadProductSuggestions()}
        >
          Atualizar
        </Button>
      </div>

      {suggestionsLoading && productSuggestions.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center gap-3 py-14 rounded-xl border"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-0)' }}
        >
          <Loader2 className="w-7 h-7 animate-spin text-amber-500" />
          <p className="text-sm" style={{ color: 'var(--text-3)' }}>
            Carregando sugestões…
          </p>
        </div>
      ) : loadError && productSuggestions.length === 0 ? (
        <EmptyState
          title="Falha ao carregar"
          description={loadError}
          action={
            <Button variant="secondary" type="button" onClick={() => void loadProductSuggestions()}>
              Tentar de novo
            </Button>
          }
        />
      ) : productSuggestions.length === 0 ? (
        <EmptyState
          icon={<Lightbulb className="w-7 h-7 text-amber-500" />}
          title="Ainda sem sugestões"
          description="Quando usuários enviarem ideias pelo botão «Sugestões» na barra superior, elas aparecem aqui para triagem e resposta."
          className="!py-14"
        />
      ) : filteredSuggestions.length === 0 ? (
        <EmptyState
          title="Nenhuma neste filtro"
          description="Altere o filtro acima ou aguarde novos envios."
        />
      ) : (
        <div className="space-y-3">
          {filteredSuggestions.map((row) => {
            const k = replyKey(row);
            const open = repliesOpenKey === k;
            const replies = repliesByKey[k] || [];
            const repliesLoading = repliesLoadingKey === k;
            const hasEmail = !!row.userEmail && /@/.test(row.userEmail);
            const triage = triageOf(row);
            const statusBusy = statusBusyKey === k;
            return (
              <Card key={`${row.uid}-${row.id}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <Badge variant="neutral">{toPtDateTime(row.createdAt)}</Badge>
                      {triage === 'new' ? (
                        <Badge variant="info">Nova</Badge>
                      ) : triage === 'reviewing' ? (
                        <Badge variant="warning">Em análise</Badge>
                      ) : (
                        <Badge variant="success">Respondida</Badge>
                      )}
                      {row.category ? (
                        <Badge variant="info">{suggestionCategoryPt(row.category)}</Badge>
                      ) : null}
                      {row.screen ? <Badge variant="neutral">{row.screen}</Badge> : null}
                    </div>
                    <p className="text-sm whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-1)' }}>
                      {row.text || '—'}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {triage === 'new' ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      disabled={statusBusy}
                      loading={statusBusy}
                      onClick={() => void markReviewing(row)}
                    >
                      Marcar em análise
                    </Button>
                  ) : null}
                  <Button
                    variant="primary"
                    size="sm"
                    type="button"
                    leftIcon={<Send className="w-3.5 h-3.5" />}
                    disabled={!hasEmail}
                    title={
                      hasEmail
                        ? 'Enviar resposta por email ao cliente'
                        : 'Cliente sem email vinculado'
                    }
                    onClick={() => openReplyModal(row)}
                  >
                    Responder
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    leftIcon={<MessageCircle className="w-3.5 h-3.5" />}
                    onClick={() => toggleRepliesPanel(row)}
                  >
                    {open ? 'Ocultar histórico' : 'Ver histórico'}
                  </Button>
                  {hasEmail ? (
                    <a
                      href={`mailto:${row.userEmail}?subject=${encodeURIComponent('Sobre a sua sugestão no ZapMass')}`}
                      className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300 hover:underline"
                    >
                      <Mail className="w-3.5 h-3.5" />
                      mailto
                    </a>
                  ) : null}
                </div>

                {open ? (
                  <div
                    className="mt-3 rounded-lg border p-3"
                    style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
                  >
                    {repliesLoading ? (
                      <div className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-3)' }}>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Carregando histórico…
                      </div>
                    ) : replies.length === 0 ? (
                      <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                        Nenhuma resposta enviada ainda.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {replies.map((rep) => (
                          <li
                            key={rep.id}
                            className="rounded-md p-2.5 text-[12.5px]"
                            style={{
                              background: 'var(--surface-0)',
                              border: '1px solid var(--border-subtle)'
                            }}
                          >
                            <div className="flex flex-wrap items-center gap-2 mb-1 text-[10.5px]" style={{ color: 'var(--text-3)' }}>
                              <span className="font-semibold" style={{ color: 'var(--text-2)' }}>
                                {rep.adminEmail || rep.adminUid || 'admin'}
                              </span>
                              <span>·</span>
                              <span>{toPtDateTime(rep.createdAt)}</span>
                              <span>·</span>
                              {rep.emailSent ? (
                                <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                                  <CheckCircle2 className="w-3 h-3" /> email enviado
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                                  <XCircle className="w-3 h-3" /> só registrado
                                </span>
                              )}
                            </div>
                            <p className="whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-1)' }}>
                              {rep.text}
                            </p>
                            {!rep.emailSent && rep.emailError ? (
                              <p className="mt-2 text-[10px]" style={{ color: 'var(--text-3)' }}>
                                {rep.emailError}
                              </p>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}

                <div
                  className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] pt-3 border-t"
                  style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-3)' }}
                >
                  <span>
                    <strong style={{ color: 'var(--text-2)' }}>E-mail:</strong> {row.userEmail || '—'}
                  </span>
                  {row.lastRepliedBy ? (
                    <span>
                      <strong style={{ color: 'var(--text-2)' }}>Última resposta:</strong> {row.lastRepliedBy}
                    </span>
                  ) : null}
                  <span className="inline-flex items-center gap-1 font-mono">
                    <strong style={{ color: 'var(--text-2)' }}>Conta:</strong> {row.uid.slice(0, 8)}…
                    <button
                      type="button"
                      className="p-0.5 rounded hover:bg-slate-200/50 dark:hover:bg-slate-700/50"
                      title="Copiar ID da conta"
                      onClick={() => void copyToClipboard(row.uid, 'ID copiado.')}
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </span>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        isOpen={replyTarget !== null}
        onClose={closeReplyModal}
        title="Responder ao cliente"
        subtitle={
          replyTarget?.userEmail
            ? `Envio por email para ${replyTarget.userEmail}. Respostas do cliente chegam no seu Reply-To.`
            : 'O cliente desta sugestão não tem email vinculado.'
        }
        icon={<Send className="w-5 h-5 text-emerald-500" />}
        size="lg"
        closeOnBackdrop={!replySending}
        footer={
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 w-full">
            <Button variant="ghost" disabled={replySending} onClick={closeReplyModal}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              disabled={replySending || replyText.trim().length < 1 || !replyTarget?.userEmail}
              leftIcon={<Send className="w-4 h-4" />}
              onClick={() => void submitReply()}
            >
              {replySending ? 'Enviando…' : 'Enviar resposta por email'}
            </Button>
          </div>
        }
      >
        {replyTarget ? (
          <div className="space-y-4">
            <div
              className="rounded-lg border p-3"
              style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
            >
              <p className="text-[10.5px] uppercase font-bold tracking-wide mb-1" style={{ color: 'var(--text-3)' }}>
                Sugestão original
              </p>
              <p className="text-[13px] whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-1)' }}>
                {replyTarget.text || '—'}
              </p>
            </div>
            <div>
              <label className="text-[12.5px] font-semibold flex items-center gap-2 mb-1.5" style={{ color: 'var(--text-1)' }}>
                Sua resposta
                <span className="text-[10.5px] font-normal font-mono px-1.5 py-0.5 rounded" style={{ color: 'var(--text-3)', background: 'var(--surface-2)' }}>
                  {replyText.length}/8000
                </span>
              </label>
              <Textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value.slice(0, 8000))}
                placeholder="Status (em estudo, planejado, feito), perguntas ou agradecimento…"
                style={{ minHeight: '160px', fontSize: '13.5px', lineHeight: 1.55 }}
                disabled={replySending}
                autoFocus
              />
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
};
