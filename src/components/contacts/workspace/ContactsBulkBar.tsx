import React from 'react';
import { X, Rocket, ListPlus, Trash2, Tag, Download } from 'lucide-react';

interface Props {
  count: number;
  onClear: () => void;
  onCreateCampaign: () => void;
  onAddToList: () => void;
  onAddTag: () => void;
  onExport: () => void;
  onDelete: () => void;
}

/**
 * Barra de ações em lote — só aparece quando há seleção.
 * Fica na parte inferior da tabela, não atrapalha o fluxo.
 */
export const ContactsBulkBar: React.FC<Props> = React.memo(({
  count, onClear, onCreateCampaign, onAddToList, onAddTag, onExport, onDelete
}) => {
  if (count === 0) return null;

  return (
    <div className="sticky bottom-4 z-20 flex justify-center pointer-events-none px-4 pt-2">
      <div
        className="pointer-events-auto flex items-center gap-1 px-3 py-2 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md animate-in slide-in-from-bottom-4 duration-200"
      >
        <div className="flex items-center gap-2 pr-3 pl-1 border-r border-slate-200 dark:border-slate-700">
          <span
            className="w-6 h-6 rounded-lg flex items-center justify-center text-white text-xs font-bold"
            style={{ background: 'var(--brand-600)' }}
          >
            {count > 99 ? '99+' : count}
          </span>
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap">
            {count === 1 ? 'selecionado' : 'selecionados'}
          </span>
        </div>

        <BulkBtn icon={<Rocket className="w-3.5 h-3.5" />} label="Campanha" onClick={onCreateCampaign} primary />
        <BulkBtn icon={<ListPlus className="w-3.5 h-3.5" />} label="Lista" onClick={onAddToList} />
        <BulkBtn icon={<Tag className="w-3.5 h-3.5" />} label="Tag" onClick={onAddTag} />
        <BulkBtn icon={<Download className="w-3.5 h-3.5" />} label="Exportar" onClick={onExport} />
        <BulkBtn icon={<Trash2 className="w-3.5 h-3.5" />} label="Remover" onClick={onDelete} danger />

        <div className="border-l border-slate-200 dark:border-slate-700 pl-1 ml-1">
          <button
            onClick={onClear}
            className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            title="Limpar seleção"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
});
ContactsBulkBar.displayName = 'ContactsBulkBar';

const BulkBtn: React.FC<{
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  primary?: boolean;
  danger?: boolean;
}> = ({ icon, label, onClick, primary, danger }) => {
  const base = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition whitespace-nowrap';
  const style = primary
    ? 'text-white shadow hover:brightness-110'
    : danger
      ? 'text-rose-600 dark:text-rose-400 hover:bg-rose-500/10'
      : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800';
  return (
    <button
      onClick={onClick}
      className={`${base} ${style}`}
      style={primary ? { background: 'linear-gradient(135deg, var(--brand-500), var(--brand-700))' } : undefined}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
};
