import React, { useEffect } from 'react';
import {
  X, Phone, Mail, MapPin, Church, Briefcase, Cake, Tag, Edit3, Trash2,
  MessageCircle, Rocket, Copy, Flame, Snowflake, Clock, User as UserIcon,
  Sparkles, ListPlus, CalendarClock
} from 'lucide-react';
import { formatFollowUpLabel, parseFollowUpMs, localStartOfTodayMs } from '../../../utils/followUp';
import type { Contact } from '../../../types';

type Temperature = 'hot' | 'warm' | 'cold' | 'new';
interface TempStats {
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  lastSentTs: number;
  lastReplyTs: number;
  lastReadTs: number;
  temp: Temperature;
  score: number;
}

interface Props {
  contact: Contact | null;
  tempStats?: TempStats;
  onClose: () => void;
  onEdit: (contact: Contact) => void;
  onDelete: (contact: Contact) => void;
  onOpenChat: (contact: Contact) => void;
  onCreateCampaign: (contact: Contact) => void;
  onCopyPhone: (contact: Contact) => void;
  onAddToList: (contact: Contact) => void;
}

const tempLabel: Record<Temperature, { label: string; icon: React.ReactNode; color: string }> = {
  hot: { label: 'Quente', icon: <Flame className="w-3.5 h-3.5" />, color: 'bg-red-500/10 text-red-600 border-red-500/20 dark:text-red-300' },
  warm: { label: 'Morno', icon: <Sparkles className="w-3.5 h-3.5" />, color: 'bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-300' },
  cold: { label: 'Frio', icon: <Snowflake className="w-3.5 h-3.5" />, color: 'bg-sky-500/10 text-sky-600 border-sky-500/20 dark:text-sky-300' },
  new: { label: 'Sem histórico', icon: <Clock className="w-3.5 h-3.5" />, color: 'bg-slate-500/10 text-slate-600 border-slate-500/20 dark:text-slate-300' }
};

const formatDate = (ts: number): string => {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: '2-digit' });
};

const formatPhone = (raw: string): string => {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('55')) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 12 && digits.startsWith('55')) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return raw || '—';
};

export const ContactDetailDrawer: React.FC<Props> = ({
  contact,
  tempStats,
  onClose,
  onEdit,
  onDelete,
  onOpenChat,
  onCreateCampaign,
  onCopyPhone,
  onAddToList
}) => {
  useEffect(() => {
    if (!contact) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [contact, onClose]);

  if (!contact) return null;

  const temp = tempStats?.temp || 'new';
  const tempInfo = tempLabel[temp];
  const initials = (contact.name || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() || '').join('') || '?';

  const addressLine = [contact.street, contact.number].filter(Boolean).join(', ');
  const cityLine = [contact.city, contact.state].filter(Boolean).join(' · ');
  const hasAddress = !!(addressLine || contact.neighborhood || cityLine || contact.zipCode);

  return (
    <>
      {/* backdrop — clique fecha */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={onClose}
        aria-hidden
      />
      {/* drawer */}
      <aside
        className="fixed top-0 right-0 z-50 h-screen w-full sm:w-[440px] bg-white dark:bg-slate-900 shadow-2xl border-l border-slate-200 dark:border-slate-800 flex flex-col animate-in slide-in-from-right duration-200"
        role="dialog"
        aria-label="Detalhes do contato"
      >
        {/* header */}
        <div
          className="relative px-5 pt-5 pb-4 border-b border-slate-200 dark:border-slate-800"
          style={{
            background:
              'linear-gradient(135deg, color-mix(in srgb, var(--brand-600) 10%, transparent) 0%, transparent 60%)'
          }}
        >
          <button
            onClick={onClose}
            className="absolute top-3 right-3 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="flex items-start gap-3">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center text-white font-bold text-lg shrink-0 shadow-lg"
              style={{ background: 'linear-gradient(135deg, var(--brand-500), var(--brand-700))' }}
            >
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white truncate">
                {contact.name || 'Sem nome'}
              </h2>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-semibold ${tempInfo.color}`}
                >
                  {tempInfo.icon}
                  {tempInfo.label}
                </span>
                {contact.status === 'INVALID' && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-semibold bg-rose-500/10 text-rose-600 border-rose-500/20 dark:text-rose-300">
                    Telefone inválido
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* ações rápidas */}
          <div className="grid grid-cols-4 gap-2 mt-4">
            <QuickActionBtn icon={<MessageCircle className="w-4 h-4" />} label="Chat" onClick={() => onOpenChat(contact)} accent="emerald" />
            <QuickActionBtn icon={<Rocket className="w-4 h-4" />} label="Campanha" onClick={() => onCreateCampaign(contact)} accent="brand" />
            <QuickActionBtn icon={<Edit3 className="w-4 h-4" />} label="Editar" onClick={() => onEdit(contact)} accent="sky" />
            <QuickActionBtn icon={<ListPlus className="w-4 h-4" />} label="Lista" onClick={() => onAddToList(contact)} accent="violet" />
          </div>
        </div>

        {/* corpo rolável */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Contato */}
          <Section title="Contato">
            <InfoRow
              icon={<Phone className="w-4 h-4" />}
              label="Telefone"
              value={formatPhone(contact.phone || '')}
              action={
                <button
                  onClick={() => onCopyPhone(contact)}
                  className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
                  title="Copiar telefone"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              }
            />
            {contact.email && (
              <InfoRow icon={<Mail className="w-4 h-4" />} label="E-mail" value={contact.email} />
            )}
            {contact.birthday && (
              <InfoRow icon={<Cake className="w-4 h-4" />} label="Aniversário" value={contact.birthday} />
            )}
          </Section>

          {/* Endereço */}
          {hasAddress && (
            <Section title="Endereço">
              {addressLine && <InfoRow icon={<MapPin className="w-4 h-4" />} label="Rua" value={addressLine} />}
              {contact.neighborhood && <InfoRow icon={<MapPin className="w-4 h-4" />} label="Bairro" value={contact.neighborhood} />}
              {cityLine && <InfoRow icon={<MapPin className="w-4 h-4" />} label="Cidade" value={cityLine} />}
              {contact.zipCode && <InfoRow icon={<MapPin className="w-4 h-4" />} label="CEP" value={contact.zipCode} />}
            </Section>
          )}

          {/* Igreja / Trabalho */}
          {(contact.church || contact.role || contact.profession) && (
            <Section title="Vínculos">
              {contact.church && <InfoRow icon={<Church className="w-4 h-4" />} label="Igreja" value={contact.church} />}
              {contact.role && <InfoRow icon={<UserIcon className="w-4 h-4" />} label="Cargo (igreja)" value={contact.role} />}
              {contact.profession && <InfoRow icon={<Briefcase className="w-4 h-4" />} label="Profissão" value={contact.profession} />}
            </Section>
          )}

          {/* Tags */}
          {Array.isArray(contact.tags) && contact.tags.length > 0 && (
            <Section title="Tags">
              <div className="flex flex-wrap gap-1.5">
                {contact.tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                  >
                    <Tag className="w-3 h-3" />
                    {t}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {(parseFollowUpMs(contact.followUpAt) != null || (contact.followUpNote || '').trim()) && (
            <Section title="Retorno">
              {parseFollowUpMs(contact.followUpAt) != null && (
                <div
                  className={`flex items-start gap-2 px-2.5 py-2 rounded-lg border ${
                    (parseFollowUpMs(contact.followUpAt) ?? 0) < localStartOfTodayMs()
                      ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900/50'
                      : 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/40'
                  }`}
                >
                  <CalendarClock className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
                  <div>
                    <div className="text-xs font-bold text-slate-700 dark:text-slate-200">
                      {(parseFollowUpMs(contact.followUpAt) ?? 0) < localStartOfTodayMs() ? 'Atrasado para' : 'Agendado para'}{' '}
                      {formatFollowUpLabel(contact.followUpAt)}
                    </div>
                  </div>
                </div>
              )}
              {(contact.followUpNote || '').trim() && (
                <p className="text-sm text-slate-600 dark:text-slate-400 whitespace-pre-wrap px-1">{contact.followUpNote}</p>
              )}
            </Section>
          )}

          {/* Engajamento */}
          {tempStats && tempStats.sent > 0 && (
            <Section title="Engajamento">
              <div className="grid grid-cols-2 gap-2">
                <Metric label="Enviadas" value={tempStats.sent} />
                <Metric label="Entregues" value={tempStats.delivered} />
                <Metric label="Lidas" value={tempStats.read} />
                <Metric label="Respondidas" value={tempStats.replied} />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                <div>Últ. envio: {formatDate(tempStats.lastSentTs)}</div>
                <div>Últ. resposta: {formatDate(tempStats.lastReplyTs)}</div>
              </div>
            </Section>
          )}

          {/* Notas */}
          {contact.notes && (
            <Section title="Notas">
              <p className="text-sm text-slate-600 dark:text-slate-400 whitespace-pre-wrap">
                {contact.notes}
              </p>
            </Section>
          )}
        </div>

        {/* footer — destruir */}
        <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800">
          <button
            onClick={() => onDelete(contact)}
            className="w-full py-2 rounded-lg text-sm font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 transition flex items-center justify-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Remover contato
          </button>
        </div>
      </aside>
    </>
  );
};

const QuickActionBtn: React.FC<{
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  accent: 'emerald' | 'brand' | 'sky' | 'violet';
}> = ({ icon, label, onClick, accent }) => {
  const map: Record<typeof accent, string> = {
    emerald: 'text-emerald-600 dark:text-emerald-300 hover:bg-emerald-500/10 border-emerald-500/30',
    brand: 'text-[var(--brand-600)] hover:bg-[color-mix(in_srgb,var(--brand-500)_12%,transparent)] border-[color-mix(in_srgb,var(--brand-500)_30%,transparent)]',
    sky: 'text-sky-600 dark:text-sky-300 hover:bg-sky-500/10 border-sky-500/30',
    violet: 'text-violet-600 dark:text-violet-300 hover:bg-violet-500/10 border-violet-500/30'
  } as const;
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-1 px-2 py-2 rounded-lg border transition bg-white dark:bg-slate-900 ${map[accent]}`}
    >
      {icon}
      <span className="text-[11px] font-semibold">{label}</span>
    </button>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
      {title}
    </div>
    <div className="space-y-1.5">{children}</div>
  </div>
);

const InfoRow: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  action?: React.ReactNode;
}> = ({ icon, label, value, action }) => (
  <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 transition group">
    <div className="text-slate-400 dark:text-slate-500 shrink-0">{icon}</div>
    <div className="min-w-0 flex-1">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">{label}</div>
      <div className="text-sm text-slate-900 dark:text-white truncate">{value}</div>
    </div>
    {action && <div className="opacity-0 group-hover:opacity-100 transition">{action}</div>}
  </div>
);

const Metric: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
    <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">{label}</div>
    <div className="text-lg font-bold text-slate-900 dark:text-white">{value}</div>
  </div>
);
