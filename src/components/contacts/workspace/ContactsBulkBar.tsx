import React from 'react';
import { X, Rocket, ListPlus, Trash2, Tag, Download, ShieldOff, ShieldCheck } from 'lucide-react';

interface Props {
  count: number;
  onClear: () => void;
  onCreateCampaign: () => void;
  onAddToList: () => void;
  onAddTag: () => void;
  onExport: () => void;
  onDelete: () => void;
  onAddToBlacklist?: () => void;
  onRemoveFromBlacklist?: () => void;
  activeFilter?: string;
}

/**
 * Barra de ações em lote — só aparece quando há seleção.
 * Fica na parte inferior da tabela, não atrapalha o fluxo.
 */
export const ContactsBulkBar: React.FC<Props> = React.memo(({
  count, onClear, onCreateCampaign, onAddToList, onAddTag, onExport, onDelete,
  onAddToBlacklist, onRemoveFromBlacklist, activeFilter
}) => {
  if (count === 0) return null;

  const isBlacklistView = activeFilter === 'blacklist';

  return (
    <div className="sticky bottom-4 z-20 flex justify-center pointer-events-none px-4 pt-2">
      <div className="crm-bulk-bar">
        <div className="flex items-center gap-2 pr-3 pl-1 border-r border-white/20">
          <span className="w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold" style={{ background: 'rgba(255,255,255,0.2)' }}>
            {count > 99 ? '99+' : count}
          </span>
          <span className="text-xs font-semibold whitespace-nowrap">
            {count === 1 ? 'selecionado' : 'selecionados'}
          </span>
        </div>

        {isBlacklistView && onRemoveFromBlacklist ? (
          <BulkBtn icon={<ShieldCheck className="w-3.5 h-3.5" />} label="Remover lista negra" onClick={onRemoveFromBlacklist} primary />
        ) : (
          <BulkBtn icon={<Rocket className="w-3.5 h-3.5" />} label="Campanha" onClick={onCreateCampaign} primary />
        )}
        {!isBlacklistView && onAddToBlacklist && (
          <BulkBtn icon={<ShieldOff className="w-3.5 h-3.5" />} label="Lista negra" onClick={onAddToBlacklist} danger />
        )}
        <BulkBtn icon={<ListPlus className="w-3.5 h-3.5" />} label="Lista" onClick={onAddToList} />
        <BulkBtn icon={<Tag className="w-3.5 h-3.5" />} label="Tag" onClick={onAddTag} />
        <BulkBtn icon={<Download className="w-3.5 h-3.5" />} label="Exportar" onClick={onExport} />
        <BulkBtn icon={<Trash2 className="w-3.5 h-3.5" />} label="Remover" onClick={onDelete} danger />

        <div className="border-l border-white/20 pl-1 ml-1">
          <button
            onClick={onClear}
            className="p-1.5 rounded-md transition hover:bg-white/5"
            style={{ color: 'var(--zm-c-muted)' }}
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
  if (primary) {
    return (
      <button onClick={onClick} className="zm-contacts-btn zm-contacts-btn-primary text-xs py-1.5 px-2.5 whitespace-nowrap">
        {icon}
        <span>{label}</span>
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition whitespace-nowrap hover:bg-white/5"
      style={{ color: danger ? '#fb7185' : 'var(--zm-c-text)' }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
};
