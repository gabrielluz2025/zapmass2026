import React, { useMemo, useState } from 'react';
import { Sparkles, Send, Filter as FilterIcon, MessageCircle, ChevronRight, Info } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Contact } from '../../types';

export interface SmartSegmentDef {
  id: string;
  label: string;
  icon: LucideIcon;
  color: 'rose' | 'amber' | 'sky' | 'emerald' | 'violet' | 'slate';
  hint: string;
  count: number;
}

interface Props {
  segments: SmartSegmentDef[];
  getMatches: (id: string) => Contact[];
  onApplyFilterOnBase: (id: string) => void;
  onCreateCampaign: (contacts: Contact[], segmentLabel: string) => void;
  onOpenChat: (contact: Contact) => void;
}

const colorMap: Record<SmartSegmentDef['color'], { bg: string; fg: string; border: string; chip: string; accent: string }> = {
  rose:    { bg: 'from-rose-500/15 to-rose-500/5',       fg: 'text-rose-600 dark:text-rose-400',       border: 'border-rose-200/60 dark:border-rose-900/40',       chip: 'bg-rose-500/10',       accent: 'bg-rose-500' },
  amber:   { bg: 'from-amber-500/15 to-amber-500/5',     fg: 'text-amber-600 dark:text-amber-400',     border: 'border-amber-200/60 dark:border-amber-900/40',     chip: 'bg-amber-500/10',      accent: 'bg-amber-500' },
  sky:     { bg: 'from-sky-500/15 to-sky-500/5',         fg: 'text-sky-600 dark:text-sky-400',         border: 'border-sky-200/60 dark:border-sky-900/40',         chip: 'bg-sky-500/10',        accent: 'bg-sky-500' },
  emerald: { bg: 'from-emerald-500/15 to-emerald-500/5', fg: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-200/60 dark:border-emerald-900/40', chip: 'bg-emerald-500/10',    accent: 'bg-emerald-500' },
  violet:  { bg: 'from-violet-500/15 to-violet-500/5',   fg: 'text-violet-600 dark:text-violet-400',   border: 'border-violet-200/60 dark:border-violet-900/40',   chip: 'bg-violet-500/10',     accent: 'bg-violet-500' },
  slate:   { bg: 'from-slate-500/15 to-slate-500/5',     fg: 'text-slate-600 dark:text-slate-300',     border: 'border-slate-200/60 dark:border-slate-700/60',     chip: 'bg-slate-500/10',      accent: 'bg-slate-500' }
};

const ContactsSegmentsPanelBase: React.FC<Props> = ({
  segments,
  getMatches,
  onApplyFilterOnBase,
  onCreateCampaign,
  onOpenChat
}) => {
  const [expanded, setExpanded] = useState<string | null>(null);

  const totalTargeted = useMemo(() => segments.reduce((a, s) => a + s.count, 0), [segments]);

  return (
    <div className="space-y-4">
      {/* Resumo + explicação */}
      <div className="ui-card p-5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/20 to-violet-500/5 text-violet-600 dark:text-violet-400 flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-900 dark:text-white">Segmentos Inteligentes</h2>
              <p className="text-[12.5px] text-slate-600 dark:text-slate-400 max-w-2xl">
                Filtros prontos baseados no comportamento e atributos dos seus contatos. Use para disparar mensagens certas para as pessoas certas.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-right">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Contatos em segmentos</p>
              <p className="text-2xl font-black tabular-nums text-slate-900 dark:text-white leading-none">{totalTargeted}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Grid de cards ricos */}
      {segments.length === 0 ? (
        <div className="ui-card p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 mx-auto flex items-center justify-center mb-2">
            <Sparkles className="w-6 h-6 text-slate-400" />
          </div>
          <p className="text-sm font-bold text-slate-700 dark:text-slate-300">Nenhum segmento disponível</p>
          <p className="text-[12px] text-slate-500 mt-1">Importe sua base e comece a interagir para ativar a segmentação automática.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {segments.map((seg) => {
            const c = colorMap[seg.color];
            const Icon = seg.icon;
            const isExpanded = expanded === seg.id;
            const matches = isExpanded ? getMatches(seg.id) : [];
            const preview = matches.slice(0, 4);

            return (
              <div
                key={seg.id}
                className={`relative overflow-hidden rounded-xl border ${c.border} bg-gradient-to-br ${c.bg} p-4 flex flex-col ${seg.count === 0 ? 'opacity-60' : ''}`}
              >
                {/* Cabeçalho */}
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div className={`w-9 h-9 rounded-lg ${c.chip} ${c.fg} flex items-center justify-center shrink-0`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-black text-slate-900 dark:text-white leading-tight">{seg.label}</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">{seg.hint}</p>
                    </div>
                  </div>
                  <div className={`text-right shrink-0`}>
                    <p className={`text-2xl font-black tabular-nums ${c.fg} leading-none`}>{seg.count}</p>
                    <p className="text-[9.5px] font-black uppercase tracking-wider text-slate-400 mt-0.5">contatos</p>
                  </div>
                </div>

                {/* Bar de proporção */}
                {totalTargeted > 0 && seg.count > 0 && (
                  <div className="h-1 rounded-full bg-slate-200/60 dark:bg-slate-700/60 overflow-hidden mb-3">
                    <div
                      className={`h-full ${c.accent}`}
                      style={{ width: `${Math.min(100, (seg.count / Math.max(...segments.map((s) => s.count || 1))) * 100)}%` }}
                    />
                  </div>
                )}

                {/* Preview quando expandido */}
                {isExpanded && preview.length > 0 && (
                  <div className="mb-3 pt-2 border-t border-slate-200/60 dark:border-slate-700/60 space-y-1">
                    {preview.map((contact) => (
                      <button
                        key={contact.id}
                        onClick={() => onOpenChat(contact)}
                        className="w-full flex items-center gap-2 p-1.5 rounded-md hover:bg-white/50 dark:hover:bg-slate-900/40 text-left transition"
                        title={`Abrir conversa com ${contact.name}`}
                      >
                        <div className={`w-6 h-6 rounded-md ${c.chip} ${c.fg} flex items-center justify-center text-[10px] font-black shrink-0`}>
                          {contact.name.charAt(0).toUpperCase() || '?'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[12px] font-bold text-slate-800 dark:text-slate-100 truncate">{contact.name}</p>
                        </div>
                        <MessageCircle className="w-3 h-3 text-slate-300 shrink-0" />
                      </button>
                    ))}
                    {matches.length > preview.length && (
                      <p className="text-[10.5px] text-slate-400 text-center pt-1">
                        + {matches.length - preview.length} outros
                      </p>
                    )}
                  </div>
                )}

                {/* Ações */}
                <div className="mt-auto flex items-center gap-1.5 pt-2">
                  <button
                    type="button"
                    disabled={seg.count === 0}
                    onClick={() => setExpanded(isExpanded ? null : seg.id)}
                    className={`flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-900/40 text-slate-700 dark:text-slate-200 text-[11px] font-bold hover:bg-white dark:hover:bg-slate-800 transition ${seg.count === 0 ? 'cursor-not-allowed opacity-50' : ''}`}
                  >
                    {isExpanded ? 'Fechar' : 'Ver quem'}{' '}
                    <ChevronRight className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                  </button>
                  <button
                    type="button"
                    disabled={seg.count === 0}
                    onClick={() => onApplyFilterOnBase(seg.id)}
                    className={`inline-flex items-center gap-1 px-2 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-900/40 text-slate-700 dark:text-slate-200 text-[11px] font-bold hover:bg-white dark:hover:bg-slate-800 transition ${seg.count === 0 ? 'cursor-not-allowed opacity-50' : ''}`}
                    title="Abrir na aba Base filtrado por este segmento"
                  >
                    <FilterIcon className="w-3 h-3" /> Filtrar
                  </button>
                  <button
                    type="button"
                    disabled={seg.count === 0}
                    onClick={() => onCreateCampaign(getMatches(seg.id), seg.label)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md ${c.accent} text-white text-[11px] font-black hover:brightness-110 transition shadow-sm ${seg.count === 0 ? 'cursor-not-allowed opacity-50' : ''}`}
                    title="Criar campanha só para este segmento"
                  >
                    <Send className="w-3 h-3" /> Campanha
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Dica */}
      <div className="ui-card p-4 border-l-4 border-violet-500 bg-gradient-to-r from-violet-50/40 to-transparent dark:from-violet-950/20">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400 flex items-center justify-center shrink-0">
            <Info className="w-4 h-4" />
          </div>
          <div>
            <p className="text-sm font-black text-slate-900 dark:text-white">Como funciona</p>
            <p className="text-[12px] text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
              Os segmentos são recalculados em tempo real a partir das suas interações (envios, leituras, respostas), dos dados cadastrais
              (cidade, aniversário, endereço) e da saúde dos números. Use "Filtrar" para inspecionar na base e "Campanha" para acionar imediatamente.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export const ContactsSegmentsPanel = React.memo(ContactsSegmentsPanelBase);
