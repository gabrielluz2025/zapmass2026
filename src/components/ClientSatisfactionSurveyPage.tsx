import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, Star, CheckCircle2 } from 'lucide-react';
import { Button, Textarea } from './ui';
import { apiUrl } from '../utils/apiBase';
import { applyMode, applyTheme, getSavedMode, getSavedTheme } from '../theme';

const TOKEN_RE = /^[a-f0-9]{40}$/i;

type MetaState = 'loading' | 'open' | 'expired' | 'already_used' | 'invalid';

async function fetchMeta(token: string): Promise<Exclude<MetaState, 'loading'>> {
  const r = await fetch(apiUrl(`/api/public/inbox-survey/meta?token=${encodeURIComponent(token)}`));
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; state?: string; error?: string };
  if (!r.ok) return 'invalid';
  if (!j.ok) return 'invalid';
  if (j.state === 'open') return 'open';
  if (j.state === 'expired') return 'expired';
  if (j.state === 'already_used') return 'already_used';
  return 'invalid';
}

async function postSubmit(token: string, rating: number, comment: string): Promise<void> {
  const r = await fetch(apiUrl('/api/public/inbox-survey/submit'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, rating, comment })
  });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!r.ok) throw new Error(j.error || `Erro ${r.status}`);
}

export function readClientSurveyTokenFromWindow(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const path = window.location.pathname.replace(/\/+$/, '') || '/';
    if (path !== '/avaliacao') return null;
    const t = (new URLSearchParams(window.location.search).get('t') || '').trim();
    return TOKEN_RE.test(t) ? t : null;
  } catch {
    return null;
  }
}

/** Página sem login — link enviado por WhatsApp após libertação do inbox. */
export const ClientSatisfactionSurveyPage: React.FC<{ token: string }> = ({ token }) => {
  const [meta, setMeta] = useState<MetaState>('loading');
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submittedOk, setSubmittedOk] = useState(false);

  useEffect(() => {
    applyTheme(getSavedTheme());
    applyMode(getSavedMode());
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const s = await fetchMeta(token);
        if (!cancelled) setMeta(s);
      } catch {
        if (!cancelled) setMeta('invalid');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const onSubmit = () => {
    if (rating == null) {
      toast.error('Escolha uma nota de 1 a 5.');
      return;
    }
    setSubmitting(true);
    void (async () => {
      try {
        await postSubmit(token, rating, comment.trim());
        setSubmittedOk(true);
        toast.success('Obrigado pela sua avaliação!');
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Não foi possível enviar.');
      } finally {
        setSubmitting(false);
      }
    })();
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ background: 'var(--bg)' }}>
      <div
        className="w-full max-w-md rounded-2xl p-6 shadow-lg border"
        style={{ background: 'var(--surface-0)', borderColor: 'var(--border)' }}
      >
        <h1 className="text-[18px] font-semibold mb-1" style={{ color: 'var(--text-1)' }}>
          Avaliação rápida
        </h1>
        <p className="text-[13px] mb-6" style={{ color: 'var(--text-2)' }}>
          Como correu o atendimento por este canal?
        </p>

        {meta === 'loading' && (
          <div className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--text-2)' }}>
            <Loader2 className="w-4 h-4 animate-spin" />
            A carregar…
          </div>
        )}

        {meta === 'invalid' && (
          <p className="text-[13px]" style={{ color: 'var(--danger)', fontWeight: 500 }}>
            Este link não é válido ou está incorreto. Peça ao contacto uma nova avaliação, se aplicável.
          </p>
        )}

        {meta === 'expired' && (
          <p className="text-[13px]" style={{ color: 'var(--text-2)' }}>
            Este link já expirou e não pode ser usado.
          </p>
        )}

        {meta === 'already_used' && (
          <p className="text-[13px]" style={{ color: 'var(--text-2)' }}>
            Esta avaliação já foi registada anteriormente.
          </p>
        )}

        {meta === 'open' && submittedOk && (
          <div className="flex items-start gap-3 text-[14px]" style={{ color: 'var(--wa-green-strong)' }}>
            <CheckCircle2 className="w-6 h-6 flex-shrink-0" />
            <span className="font-medium">Recebemos a sua resposta. Obrigado!</span>
          </div>
        )}

        {meta === 'open' && !submittedOk && (
          <>
            <p className="text-[11.5px] font-medium mb-2" style={{ color: 'var(--text-2)' }}>
              De 1 a 5 estrelas
            </p>
            <div className="flex items-center gap-1.5 mb-4">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  className="p-2 rounded-lg transition-opacity disabled:opacity-50"
                  style={{
                    background:
                      rating != null && n <= rating ? 'rgba(245,158,11,0.25)' : 'var(--surface-1)',
                    border: '1px solid var(--border-subtle)',
                    color: rating != null && n <= rating ? '#d97706' : 'var(--text-3)'
                  }}
                  title={`${n} estrelas`}
                  disabled={submitting}
                  onClick={() => setRating(n)}
                >
                  <Star className={`w-6 h-6 ${rating != null && n <= rating ? 'fill-current' : ''}`} />
                </button>
              ))}
            </div>
            <label className="text-[11.5px] font-medium block mb-1.5" style={{ color: 'var(--text-2)' }}>
              Comentário (opcional)
            </label>
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              maxLength={2000}
              disabled={submitting}
              placeholder="Critica ou elogio em poucas linhas…"
              className="w-full text-[13px] mb-4"
            />
            <Button type="button" variant="primary" className="w-full" disabled={submitting} onClick={onSubmit}>
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2 inline-block align-middle" />
                  A enviar…
                </>
              ) : (
                'Enviar avaliação'
              )}
            </Button>
          </>
        )}
      </div>
    </div>
  );
};
