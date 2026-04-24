import React, { Suspense, lazy, useEffect, useState } from 'react';
import { X, BarChart3, LayoutGrid, Sparkles, Cake, Loader2 } from 'lucide-react';
import type { Contact } from '../../../types';

type Temperature = 'hot' | 'warm' | 'cold' | 'new';
interface TempStats {
  sent: number; delivered: number; read: number; replied: number;
  lastSentTs: number; lastReplyTs: number; lastReadTs: number;
  temp: Temperature; score: number;
}

// Lazy load dos componentes pesados — só baixam quando modal abre.
const ContactsOverview = lazy(() => import('../ContactsOverview').then(m => ({ default: m.ContactsOverview })));
const ContactsSegmentsPanel = lazy(() => import('../ContactsSegmentsPanel').then(m => ({ default: m.ContactsSegmentsPanel })));
const ContactsBirthdays = lazy(() => import('../ContactsBirthdays').then(m => ({ default: m.ContactsBirthdays })));

type Tab = 'overview' | 'segments' | 'birthdays';

interface Segment {
  id: string;
  label: string;
  icon: import('lucide-react').LucideIcon;
  color: 'rose' | 'amber' | 'sky' | 'emerald' | 'violet' | 'slate';
  hint: string;
  count: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  contacts: Contact[];
  contactTemps: Record<string, TempStats>;
  segments: Segment[];
  getSegmentMatches: (segId: string) => Contact[];
  onOpenChat: (contact: Contact) => void;
  onCreateCampaignFiltered: () => void;
  onApplyFilterOnBase: (segId: string) => void;
  onSegmentCampaign: (matches: Contact[], segmentLabel: string) => void;
  onBirthdayCampaign: (people: Contact[]) => void;
}

export const ContactsInsightsModal: React.FC<Props> = ({
  open, onClose,
  contacts, contactTemps, segments,
  getSegmentMatches, onOpenChat, onCreateCampaignFiltered,
  onApplyFilterOnBase, onSegmentCampaign, onBirthdayCampaign
}) => {
  const [tab, setTab] = useState<Tab>('overview');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
    { id: 'overview', label: 'Visão geral', icon: <LayoutGrid className="w-3.5 h-3.5" /> },
    { id: 'segments', label: 'Segmentos', icon: <Sparkles className="w-3.5 h-3.5" /> },
    { id: 'birthdays', label: 'Aniversariantes', icon: <Cake className="w-3.5 h-3.5" /> }
  ];

  const handleGoToSegments = () => setTab('segments');
  const handleGoToBirthdays = () => setTab('birthdays');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-8 animate-in fade-in duration-200">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} aria-hidden />

      <div className="relative w-full max-w-6xl max-h-[92vh] rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div
          className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between"
          style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--brand-600) 8%, transparent) 0%, transparent 60%)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-white shadow"
              style={{ background: 'linear-gradient(135deg, var(--brand-500), var(--brand-700))' }}
            >
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Insights da base</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">Análise visual completa — {contacts.length.toLocaleString('pt-BR')} contatos</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-5 pt-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-xs font-semibold transition border-b-2 -mb-px ${
                  tab === t.id
                    ? 'border-[var(--brand-600)] text-[var(--brand-700)] dark:text-[var(--brand-300)]'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Conteúdo rolável */}
        <div className="flex-1 overflow-y-auto p-5">
          <Suspense fallback={
            <div className="flex items-center justify-center py-20 text-slate-500 dark:text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              <span className="text-sm">Carregando visão…</span>
            </div>
          }>
            {tab === 'overview' && (
              <ContactsOverview
                contacts={contacts}
                contactTemps={contactTemps}
                onOpenChat={(c) => { onOpenChat(c); onClose(); }}
                onNewCampaign={() => { onCreateCampaignFiltered(); onClose(); }}
                onGoToSegments={handleGoToSegments}
                onGoToBirthdays={handleGoToBirthdays}
              />
            )}
            {tab === 'segments' && (
              <ContactsSegmentsPanel
                segments={segments}
                getMatches={getSegmentMatches}
                onApplyFilterOnBase={(segId) => { onApplyFilterOnBase(segId); onClose(); }}
                onCreateCampaign={(matches, label) => { onSegmentCampaign(matches, label); onClose(); }}
                onOpenChat={(c) => { onOpenChat(c); onClose(); }}
              />
            )}
            {tab === 'birthdays' && (
              <ContactsBirthdays
                contacts={contacts}
                onOpenChat={(c) => { onOpenChat(c); onClose(); }}
                onBirthdayCampaign={(people) => { onBirthdayCampaign(people); onClose(); }}
              />
            )}
          </Suspense>
        </div>
      </div>
    </div>
  );
};
