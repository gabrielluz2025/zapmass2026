import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Star, UserRound, UserPlus, ArrowRightLeft, LogOut } from 'lucide-react';
import type { Conversation } from '../../../types';
import type { Socket } from 'socket.io-client';
import { Button, Modal } from '../ui';
import {
  inboxWorkspaceApi,
  inboxWorkspaceGetJson,
  inboxWorkspacePostFinish,
  type InboxTeammateRow,
} from './lib/inboxWorkspaceApi';

type Props = {
  conversation: Conversation | null;
  isDraft: boolean;
  workspaceAuthUid: string | null;
  isTeamMember: boolean;
  isWorkspaceOwner: boolean;
  patchConversationInboxClaim: (id: string, uid: string | undefined) => void;
  socket: Socket | null;
};

export const WaInboxTeamBar: React.FC<Props> = ({
  conversation,
  isDraft,
  workspaceAuthUid,
  isTeamMember,
  isWorkspaceOwner,
  patchConversationInboxClaim,
  socket,
}) => {
  const [busy, setBusy] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [teammates, setTeammates] = useState<InboxTeammateRow[]>([]);
  const [transferTarget, setTransferTarget] = useState('');
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [sendClientSurvey, setSendClientSurvey] = useState(true);

  if (!conversation || isDraft || !workspaceAuthUid || (!isTeamMember && !isWorkspaceOwner)) {
    return null;
  }

  const claimedBy = conversation.inboxClaimedByAuthUid;
  const isMine = Boolean(claimedBy && claimedBy === workspaceAuthUid);
  const canClaim = !claimedBy;
  const ownerCanPull = Boolean(claimedBy && isWorkspaceOwner && claimedBy !== workspaceAuthUid);
  const canManage = Boolean(claimedBy && (isWorkspaceOwner || isMine));

  const openTransfer = async () => {
    try {
      const res = await inboxWorkspaceGetJson<{ ok?: boolean; items?: InboxTeammateRow[] }>(
        '/api/workspace/teammates'
      );
      setTeammates(res.items || []);
      setTransferOpen(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar equipa.');
    }
  };

  const claim = async () => {
    setBusy(true);
    try {
      await inboxWorkspaceApi('/api/workspace/inbox-claim', {
        method: 'POST',
        body: JSON.stringify({ conversationId: conversation.id }),
      });
      patchConversationInboxClaim(conversation.id, workspaceAuthUid);
      socket?.emit('request-conversations-sync');
      toast.success('Atendimento assumido.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao assumir.');
    } finally {
      setBusy(false);
    }
  };

  const transfer = async () => {
    if (!transferTarget) return;
    setBusy(true);
    try {
      await inboxWorkspaceApi('/api/workspace/inbox-transfer', {
        method: 'POST',
        body: JSON.stringify({ conversationId: conversation.id, targetAuthUid: transferTarget }),
      });
      patchConversationInboxClaim(
        conversation.id,
        isWorkspaceOwner && transferTarget !== workspaceAuthUid ? transferTarget : undefined
      );
      socket?.emit('request-conversations-sync');
      setTransferOpen(false);
      toast.success('Conversa transferida.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao transferir.');
    } finally {
      setBusy(false);
    }
  };

  const finish = async (skipSurvey: boolean) => {
    setBusy(true);
    try {
      const res = await inboxWorkspacePostFinish({
        conversationId: conversation.id,
        skipSurvey,
        rating: skipSurvey ? undefined : rating ?? undefined,
        comment: skipSurvey ? undefined : comment.trim() || undefined,
        sendClientSurvey,
      });
      setFinishOpen(false);
      patchConversationInboxClaim(conversation.id, undefined);
      socket?.emit('request-conversations-sync');
      toast.success(skipSurvey ? 'Conversa libertada.' : 'Avaliação guardada e conversa libertada.');
      if (sendClientSurvey) {
        if (res.clientSurveySent) toast.success('Link de avaliação enviado ao cliente.');
        else if (res.clientSurveyError) toast(res.clientSurveyError, { icon: '⚠️', duration: 6000 });
      }
      setRating(null);
      setComment('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao finalizar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-1.5 border-b" style={{ borderColor: 'var(--wa-border)', background: 'var(--wa-panel)' }}>
        {claimedBy ? (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium inline-flex items-center gap-1" style={{ background: 'var(--wa-search)', color: 'var(--wa-text-2)' }}>
            <UserRound className="w-3 h-3" />
            {isMine ? (isWorkspaceOwner ? 'Você (responsável)' : 'Com você') : 'Atribuída'}
          </span>
        ) : null}
        {(canClaim || ownerCanPull) && (
          <button type="button" disabled={busy} onClick={() => void claim()} className="wa-inbox-team-btn">
            <UserPlus className="w-3.5 h-3.5" /> Assumir
          </button>
        )}
        {canManage && (
          <>
            <button type="button" disabled={busy} onClick={() => void openTransfer()} className="wa-inbox-team-btn">
              <ArrowRightLeft className="w-3.5 h-3.5" /> Transferir
            </button>
            <button type="button" disabled={busy} onClick={() => setFinishOpen(true)} className="wa-inbox-team-btn">
              <LogOut className="w-3.5 h-3.5" /> Finalizar
            </button>
          </>
        )}
      </div>

      <Modal isOpen={transferOpen} onClose={() => !busy && setTransferOpen(false)} title="Transferir conversa" size="sm">
        <select className="ui-input w-full text-[13px]" value={transferTarget} onChange={(e) => setTransferTarget(e.target.value)}>
          <option value="">Selecione…</option>
          {teammates.map((t) => (
            <option key={t.uid} value={t.uid}>{t.displayName || t.email || t.uid}</option>
          ))}
        </select>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" size="sm" onClick={() => setTransferOpen(false)} disabled={busy}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={() => void transfer()} disabled={busy || !transferTarget}>Transferir</Button>
        </div>
      </Modal>

      <Modal
        isOpen={finishOpen}
        onClose={() => !busy && setFinishOpen(false)}
        title="Finalizar libertação"
        subtitle="Nota interna opcional e link de satisfação ao cliente."
        icon={<Star className="w-5 h-5" />}
        size="sm"
        footer={
          <div className="flex flex-wrap gap-2 justify-end w-full">
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setFinishOpen(false)}>Cancelar</Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void finish(true)}>Libertar sem pesquisa</Button>
            <Button variant="primary" size="sm" disabled={busy} onClick={() => void finish(false)}>Guardar e libertar</Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" onClick={() => setRating(n)} className="p-1.5 rounded-lg border text-amber-500" style={{ opacity: rating != null && n <= rating ? 1 : 0.35 }}>★</button>
            ))}
          </div>
          <textarea className="ui-input w-full text-[13px] min-h-[72px]" placeholder="Comentário interno (opcional)" value={comment} onChange={(e) => setComment(e.target.value)} />
          <label className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-2)' }}>
            <input type="checkbox" checked={sendClientSurvey} onChange={(e) => setSendClientSurvey(e.target.checked)} />
            Enviar link de avaliação ao cliente no WhatsApp
          </label>
        </div>
      </Modal>
    </>
  );
};
