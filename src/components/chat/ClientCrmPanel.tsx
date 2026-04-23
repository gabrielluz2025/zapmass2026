import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  Phone,
  Copy,
  Pin,
  PinOff,
  Bell,
  BellOff,
  Star,
  StickyNote,
  Tag as TagIcon,
  CheckCheck,
  Eye,
  CornerDownLeft,
  Send,
  Image as ImageIcon,
  FileText,
  Video,
  Clock,
  Plus,
  Trash2
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Conversation } from '../../types';
import { Button } from '../ui';
import {
  ClientCrmData,
  ClientStatus,
  STATUS_META,
  hashTagColor
} from './useClientCrm';

interface Props {
  conversation: Conversation;
  connectionName?: string;
  avatar: string;
  crmData: ClientCrmData;
  pipelineAgg: { sent: number; delivered: number; read: number; replies: number } | null;
  onClose: () => void;
  onUpdate: (patch: Partial<ClientCrmData>) => void;
  onClear: () => void;
}

export const ClientCrmPanel: React.FC<Props> = ({
  conversation,
  connectionName,
  avatar,
  crmData,
  pipelineAgg,
  onClose,
  onUpdate,
  onClear
}) => {
  const [notesDraft, setNotesDraft] = useState(crmData.notes || '');
  const [newTag, setNewTag] = useState('');
  const notesTimer = useRef<number | null>(null);

  useEffect(() => {
    setNotesDraft(crmData.notes || '');
  }, [conversation.id, crmData.notes]);

  // Autosave das notas com debounce (evita spam de writes no localStorage)
  useEffect(() => {
    if (notesTimer.current) window.clearTimeout(notesTimer.current);
    if (notesDraft === (crmData.notes || '')) return;
    notesTimer.current = window.setTimeout(() => {
      onUpdate({ notes: notesDraft });
    }, 600);
    return () => {
      if (notesTimer.current) window.clearTimeout(notesTimer.current);
    };
  }, [notesDraft, crmData.notes, onUpdate]);

  const addTag = (raw: string) => {
    const tag = raw.trim().toLowerCase();
    if (!tag) return;
    const tags = Array.from(new Set([...(crmData.tags || []), tag]));
    onUpdate({ tags });
    setNewTag('');
  };

  const removeTag = (tag: string) => {
    onUpdate({ tags: (crmData.tags || []).filter((t) => t !== tag) });
  };

  const setStatus = (status: ClientStatus | undefined) => {
    onUpdate({ status });
  };

  const setReminder = (hours: number | null) => {
    if (hours == null) {
      onUpdate({ reminderAt: undefined });
      toast.success('Lembrete removido');
      return;
    }
    const at = Date.now() + hours * 3600 * 1000;
    onUpdate({ reminderAt: at });
    toast.success(`Lembrete em ${hours}h`);
  };

  const copyPhone = async () => {
    try {
      await navigator.clipboard.writeText(conversation.contactPhone);
      toast.success('Telefone copiado');
    } catch {
      toast.error('Falha ao copiar');
    }
  };

  const mediaMessages = useMemo(
    () =>
      (conversation.messages || []).filter((m) =>
        ['image', 'video', 'document'].includes(m.type)
      ),
    [conversation.messages]
  );

  const imageMessages = mediaMessages.filter((m) => m.type === 'image' && m.mediaUrl);
  const videoMessages = mediaMessages.filter((m) => m.type === 'video');
  const docMessages = mediaMessages.filter((m) => m.type === 'document');

  const firstMsg = conversation.messages?.[0];
  const lastMsg = conversation.messages?.[conversation.messages.length - 1];
  const firstSeen = firstMsg?.timestampMs
    ? new Date(firstMsg.timestampMs).toLocaleString('pt-BR')
    : firstMsg?.timestamp || '-';
  const lastSeen = conversation.lastMessageTimestamp
    ? new Date(conversation.lastMessageTimestamp).toLocaleString('pt-BR')
    : lastMsg?.timestamp || '-';

  const reminderActive = crmData.reminderAt && crmData.reminderAt > Date.now();
  const reminderDate = reminderActive ? new Date(crmData.reminderAt!) : null;

  const statusMeta = crmData.status ? STATUS_META[crmData.status] : null;

  return (
    <div
      className="hidden lg:flex w-[340px] flex-col flex-shrink-0 overflow-hidden"
      style={{ background: 'var(--surface-0)', borderLeft: '1px solid var(--border-subtle)' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={onClose} title="Fechar">
            <X className="w-4 h-4" />
          </Button>
          <span className="text-[14px] font-bold" style={{ color: 'var(--text-1)' }}>
            Ficha do cliente
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onUpdate({ pinned: !crmData.pinned })}
            className="p-1.5 rounded-lg transition-all"
            style={{
              background: crmData.pinned ? 'rgba(245,158,11,0.15)' : 'transparent',
              color: crmData.pinned ? '#f59e0b' : 'var(--text-3)'
            }}
            title={crmData.pinned ? 'Desafixar' : 'Fixar no topo'}
          >
            {crmData.pinned ? <Pin className="w-4 h-4 fill-current" /> : <PinOff className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={() => onUpdate({ favoriteAt: crmData.favoriteAt ? undefined : Date.now() })}
            className="p-1.5 rounded-lg transition-all"
            style={{
              background: crmData.favoriteAt ? 'rgba(245,158,11,0.15)' : 'transparent',
              color: crmData.favoriteAt ? '#f59e0b' : 'var(--text-3)'
            }}
            title={crmData.favoriteAt ? 'Remover favorito' : 'Favoritar'}
          >
            <Star className={`w-4 h-4 ${crmData.favoriteAt ? 'fill-current' : ''}`} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* AVATAR gigante com anel animado se tiver status */}
        <div className="relative px-5 pt-6 pb-5 text-center overflow-hidden">
          <div
            className="absolute inset-x-0 top-0 h-40 pointer-events-none opacity-[0.55]"
            style={{
              background: statusMeta
                ? `radial-gradient(ellipse 60% 80% at 50% 0%, ${statusMeta.color}33, transparent 70%)`
                : 'radial-gradient(ellipse 60% 80% at 50% 0%, rgba(16,185,129,0.25), transparent 70%)'
            }}
            aria-hidden
          />
          <div className="relative inline-block">
            {/* Anel colorido com a cor do status */}
            <div
              className="rounded-full p-[3px]"
              style={{
                background: statusMeta
                  ? `conic-gradient(from 180deg, ${statusMeta.color} 0%, ${statusMeta.color}55 60%, ${statusMeta.color} 100%)`
                  : 'conic-gradient(from 180deg, #10b981 0%, #3b82f6 60%, #10b981 100%)'
              }}
            >
              <img
                src={avatar}
                alt={conversation.contactName}
                className="w-[128px] h-[128px] rounded-full object-cover block"
                style={{ border: '3px solid var(--surface-0)' }}
              />
            </div>
            {statusMeta && (
              <span
                className="absolute -bottom-1 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full text-[10.5px] font-bold uppercase tracking-widest flex items-center gap-1"
                style={{
                  background: statusMeta.bg,
                  color: statusMeta.color,
                  border: `1px solid ${statusMeta.color}55`
                }}
              >
                <span>{statusMeta.emoji}</span>
                {statusMeta.label}
              </span>
            )}
          </div>
          <h3 className="relative text-[19px] font-extrabold mt-4" style={{ color: 'var(--text-1)' }}>
            {conversation.contactName}
          </h3>
          <button
            type="button"
            onClick={copyPhone}
            className="relative text-[12.5px] mt-1 inline-flex items-center gap-1 group"
            style={{ color: 'var(--text-3)' }}
            title="Copiar telefone"
          >
            <Phone className="w-3 h-3" />
            {conversation.contactPhone}
            <Copy className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        </div>

        {/* PIPELINE STATS — mini grid */}
        {pipelineAgg && (
          <div className="px-4 pb-4">
            <div className="grid grid-cols-4 gap-1.5">
              {[
                { k: 'Enviadas', v: pipelineAgg.sent, icon: <Send className="w-3 h-3" />, color: '#10b981' },
                { k: 'Entregues', v: pipelineAgg.delivered, icon: <CheckCheck className="w-3 h-3" />, color: '#3b82f6' },
                { k: 'Lidas', v: pipelineAgg.read, icon: <Eye className="w-3 h-3" />, color: '#8b5cf6' },
                { k: 'Respostas', v: pipelineAgg.replies, icon: <CornerDownLeft className="w-3 h-3" />, color: '#f59e0b' }
              ].map((row) => (
                <div
                  key={row.k}
                  className="rounded-lg px-2 py-2 text-center"
                  style={{
                    background: 'var(--surface-1)',
                    border: '1px solid var(--border-subtle)'
                  }}
                >
                  <span style={{ color: row.color }} className="inline-flex mb-0.5">
                    {row.icon}
                  </span>
                  <p className="text-[15px] font-extrabold tabular-nums leading-none" style={{ color: 'var(--text-1)' }}>
                    {row.v.toLocaleString('pt-BR')}
                  </p>
                  <p className="text-[9.5px] font-semibold mt-0.5 tracking-wider uppercase" style={{ color: 'var(--text-3)' }}>
                    {row.k}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* STATUS DA CONVERSA */}
        <div className="px-4 pb-4">
          <p className="text-[10.5px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-3) ' }}>
            Status
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {(Object.keys(STATUS_META) as ClientStatus[]).map((s) => {
              const meta = STATUS_META[s];
              const active = crmData.status === s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(active ? undefined : s)}
                  className="px-2.5 py-2 rounded-lg text-[12px] font-bold text-left flex items-center gap-2 transition-all"
                  style={{
                    background: active ? meta.bg : 'var(--surface-1)',
                    color: active ? meta.color : 'var(--text-2)',
                    border: `1px solid ${active ? meta.color + '55' : 'var(--border-subtle)'}`
                  }}
                >
                  <span className="text-[14px]">{meta.emoji}</span>
                  {meta.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* TAGS */}
        <div className="px-4 pb-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10.5px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
              Tags
            </p>
            <span className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>
              {(crmData.tags || []).length}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {(crmData.tags || []).map((tag) => {
              const color = hashTagColor(tag);
              return (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold group"
                  style={{
                    background: `${color}1f`,
                    color,
                    border: `1px solid ${color}44`
                  }}
                >
                  <TagIcon className="w-2.5 h-2.5" />
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    className="opacity-60 hover:opacity-100 ml-0.5"
                    title={`Remover ${tag}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              );
            })}
            {(crmData.tags || []).length === 0 && (
              <span className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
                Adicione tags para classificar (ex: VIP, quente, recorrente)
              </span>
            )}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addTag(newTag);
            }}
            className="flex items-center gap-1.5"
          >
            <input
              type="text"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              placeholder="Nova tag…"
              className="flex-1 text-[12px] px-2.5 py-1.5 rounded-lg outline-none"
              style={{
                background: 'var(--surface-1)',
                color: 'var(--text-1)',
                border: '1px solid var(--border-subtle)'
              }}
            />
            <button
              type="submit"
              disabled={!newTag.trim()}
              className="p-1.5 rounded-lg flex-shrink-0 transition-all disabled:opacity-40"
              style={{
                background: newTag.trim() ? 'var(--brand-600)' : 'var(--surface-1)',
                color: newTag.trim() ? '#fff' : 'var(--text-3)'
              }}
            >
              <Plus className="w-4 h-4" />
            </button>
          </form>
          <div className="flex flex-wrap gap-1 mt-2">
            {['VIP', 'quente', 'lead', 'recorrente', 'inadimplente'].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => addTag(preset)}
                className="text-[10.5px] px-1.5 py-0.5 rounded-md transition-colors"
                style={{
                  background: 'var(--surface-1)',
                  color: 'var(--text-3)',
                  border: '1px solid var(--border-subtle)'
                }}
              >
                + {preset}
              </button>
            ))}
          </div>
        </div>

        {/* NOTAS com autosave */}
        <div className="px-4 pb-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10.5px] font-bold uppercase tracking-widest inline-flex items-center gap-1" style={{ color: 'var(--text-3)' }}>
              <StickyNote className="w-3 h-3" />
              Anotações privadas
            </p>
            <span
              className="text-[10px] font-medium"
              style={{
                color: notesDraft !== (crmData.notes || '') ? '#f59e0b' : 'var(--text-3)'
              }}
            >
              {notesDraft !== (crmData.notes || '') ? '● salvando…' : 'sincronizado'}
            </span>
          </div>
          <textarea
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value)}
            rows={5}
            placeholder="Histórico do relacionamento, preferências, valores combinados, próximos passos…"
            className="w-full text-[12.5px] px-3 py-2.5 rounded-lg outline-none resize-y leading-relaxed"
            style={{
              background: 'var(--surface-1)',
              color: 'var(--text-1)',
              border: '1px solid var(--border-subtle)',
              minHeight: 110,
              maxHeight: 280
            }}
          />
        </div>

        {/* LEMBRETE */}
        <div className="px-4 pb-4">
          <p className="text-[10.5px] font-bold uppercase tracking-widest mb-2 inline-flex items-center gap-1" style={{ color: 'var(--text-3)' }}>
            <Bell className="w-3 h-3" />
            Lembrete
          </p>
          {reminderActive && reminderDate ? (
            <div
              className="rounded-lg p-3 mb-2 flex items-start gap-2"
              style={{
                background: 'rgba(245,158,11,0.1)',
                border: '1px solid rgba(245,158,11,0.3)'
              }}
            >
              <Bell className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#f59e0b' }} />
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-bold" style={{ color: 'var(--text-1)' }}>
                  Retornar em
                </p>
                <p className="text-[11.5px]" style={{ color: 'var(--text-2)' }}>
                  {reminderDate.toLocaleString('pt-BR')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReminder(null)}
                className="p-1 rounded hover:bg-black/5"
                style={{ color: 'var(--text-3)' }}
                title="Cancelar lembrete"
              >
                <BellOff className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-1.5">
              {[
                { label: '1h', h: 1 },
                { label: '3h', h: 3 },
                { label: '1 dia', h: 24 },
                { label: '1 sem', h: 168 }
              ].map((o) => (
                <button
                  key={o.h}
                  type="button"
                  onClick={() => setReminder(o.h)}
                  className="px-2 py-1.5 rounded-lg text-[11.5px] font-semibold transition-all hover:-translate-y-0.5"
                  style={{
                    background: 'var(--surface-1)',
                    color: 'var(--text-2)',
                    border: '1px solid var(--border-subtle)'
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* DETALHES */}
        <div className="px-4 pb-4">
          <p className="text-[10.5px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-3)' }}>
            Detalhes
          </p>
          <div
            className="rounded-lg overflow-hidden"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
          >
            {[
              { icon: <Phone className="w-3.5 h-3.5" />, label: 'Telefone', value: conversation.contactPhone },
              ...(connectionName ? [{ icon: <Send className="w-3.5 h-3.5" />, label: 'Canal', value: connectionName }] : []),
              { icon: <Clock className="w-3.5 h-3.5" />, label: 'Primeiro contato', value: firstSeen },
              { icon: <Clock className="w-3.5 h-3.5" />, label: 'Última atividade', value: lastSeen },
              { icon: <Send className="w-3.5 h-3.5" />, label: 'Mensagens', value: `${conversation.messages.length}` }
            ].map((row, i, arr) => (
              <div
                key={row.label}
                className="flex items-center gap-2.5 px-3 py-2"
                style={{ borderBottom: i < arr.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}
              >
                <span style={{ color: 'var(--text-3)' }} className="flex-shrink-0">{row.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                    {row.value}
                  </p>
                  <p className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>
                    {row.label}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* MÍDIAS */}
        {mediaMessages.length > 0 && (
          <div className="px-4 pb-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10.5px] font-bold uppercase tracking-widest inline-flex items-center gap-1" style={{ color: 'var(--text-3)' }}>
                <ImageIcon className="w-3 h-3" />
                Mídias na conversa
              </p>
              <span
                className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded-full"
                style={{ background: 'var(--surface-1)', color: 'var(--text-3)' }}
              >
                {mediaMessages.length}
              </span>
            </div>

            {imageMessages.length > 0 && (
              <div className="grid grid-cols-3 gap-1 mb-2">
                {imageMessages.slice(-9).map((m, i) => (
                  <div key={i} className="aspect-square rounded-md overflow-hidden">
                    <img src={m.mediaUrl!} className="w-full h-full object-cover" alt="" />
                  </div>
                ))}
              </div>
            )}

            {(videoMessages.length > 0 || docMessages.length > 0) && (
              <div className="grid grid-cols-2 gap-1.5">
                {videoMessages.length > 0 && (
                  <div
                    className="rounded-lg px-2.5 py-2 flex items-center gap-2"
                    style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
                  >
                    <Video className="w-3.5 h-3.5" style={{ color: '#8b5cf6' }} />
                    <div className="min-w-0">
                      <p className="text-[12px] font-bold tabular-nums" style={{ color: 'var(--text-1)' }}>
                        {videoMessages.length}
                      </p>
                      <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>vídeos</p>
                    </div>
                  </div>
                )}
                {docMessages.length > 0 && (
                  <div
                    className="rounded-lg px-2.5 py-2 flex items-center gap-2"
                    style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
                  >
                    <FileText className="w-3.5 h-3.5" style={{ color: '#3b82f6' }} />
                    <div className="min-w-0">
                      <p className="text-[12px] font-bold tabular-nums" style={{ color: 'var(--text-1)' }}>
                        {docMessages.length}
                      </p>
                      <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>documentos</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* LIMPAR CRM */}
        {(crmData.notes || crmData.tags?.length || crmData.status || crmData.pinned || crmData.reminderAt) && (
          <div className="px-4 pb-6">
            <button
              type="button"
              onClick={() => {
                if (confirm('Apagar todos os dados CRM deste contato (notas, tags, status)?')) {
                  onClear();
                  toast.success('Dados CRM removidos');
                }
              }}
              className="w-full px-3 py-2 rounded-lg text-[12px] font-semibold transition-colors flex items-center justify-center gap-2"
              style={{
                background: 'transparent',
                color: 'var(--text-3)',
                border: '1px dashed var(--border-subtle)'
              }}
            >
              <Trash2 className="w-3.5 h-3.5" />
              Limpar dados CRM deste contato
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
