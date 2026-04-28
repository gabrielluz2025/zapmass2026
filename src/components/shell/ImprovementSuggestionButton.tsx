import React, { useState } from 'react';
import { Lightbulb } from 'lucide-react';
import toast from 'react-hot-toast';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../ui/Button';
import { Modal, Textarea } from '../ui';

interface ImprovementSuggestionButtonProps {
  /** Tela atual (para contextualizar feedback no painel administrativo). */
  currentView?: string;
}

/**
 * Botão na barra superior para o utilizador enviar sugestões de melhoria (Firestore users/{uid}/suggestions).
 */
export const ImprovementSuggestionButton: React.FC<ImprovementSuggestionButtonProps> = ({
  currentView
}) => {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  if (!user) return null;

  const submit = async () => {
    const trimmed = text.trim();
    if (trimmed.length < 1) {
      toast.error('Escreva a sua sugestão.');
      return;
    }
    setSending(true);
    try {
      await addDoc(collection(db, 'users', user.uid, 'suggestions'), {
        text: trimmed,
        createdAt: serverTimestamp(),
        screen: typeof currentView === 'string' ? currentView.slice(0, 64) : '',
        userEmail: user.email ? String(user.email).slice(0, 320) : ''
      });
      toast.success('Obrigado! A sua sugestão foi enviada.');
      setText('');
      setOpen(false);
    } catch (e) {
      console.error('[Suggestion]', e);
      const msg =
        e && typeof e === 'object' && 'message' in e && typeof (e as Error).message === 'string'
          ? (e as Error).message
          : '';
      toast.error(
        msg.length > 0
          ? `Não foi possível enviar (${msg}). Tente novamente.`
          : 'Não foi possível enviar. Verifique a ligação, regras do Firebase e tente de novo.'
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 items-center gap-1.5 px-2.5 sm:px-3 rounded-lg border shrink-0 transition-colors hover:brightness-105"
        style={{
          background: 'var(--surface-2)',
          borderColor: 'var(--border-subtle)',
          color: 'var(--text-2)'
        }}
        title="Sugerir uma melhoria no ZapMass"
        aria-label="Sugerir melhoria"
      >
        <Lightbulb className="w-3.5 h-3.5 text-amber-500 shrink-0" />
        <span className="text-[11px] font-semibold hidden sm:inline">Sugestão</span>
      </button>

      <Modal
        isOpen={open}
        onClose={() => {
          if (!sending) setOpen(false);
        }}
        title="Sugerir melhoria"
        subtitle="A sua opinião ajuda-nos a priorizar o que construir no ZapMass."
        icon={<Lightbulb className="w-5 h-5 text-amber-500" />}
        size="md"
        closeOnBackdrop={!sending}
        footer={
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 w-full">
            <Button variant="ghost" disabled={sending} onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button variant="primary" disabled={sending} onClick={() => void submit()}>
              {sending ? 'A enviar…' : 'Enviar sugestão'}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ex.: gostaria de poder filtrar campanhas por data, ou exportar o relatório em PDF…"
            style={{ minHeight: '140px' }}
            disabled={sending}
          />
          <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
            Guardamos também a área atual (<strong>{currentView || '—'}</strong>) e o seu e-mail só para poder
            retornar sobre a ideia, se fizer sentido.
          </p>
        </div>
      </Modal>
    </>
  );
};
