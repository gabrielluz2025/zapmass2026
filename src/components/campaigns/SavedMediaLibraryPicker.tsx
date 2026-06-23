import React, { useCallback, useEffect, useState } from 'react';
import { Bookmark, ImageIcon, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '../ui';
import {
  listSavedCampaignMedia,
  removeSavedCampaignMedia,
  saveCampaignMediaToLibrary,
  savedMediaToDataUrl,
  savedMediaToFile,
  type SavedCampaignMedia
} from '../../utils/campaignMediaLibrary';

type Props = {
  onPick: (file: File) => void;
  /** Se informado, oferece salvar o anexo atual na biblioteca. */
  currentFile?: File | null;
  compact?: boolean;
};

export const SavedMediaLibraryPicker: React.FC<Props> = ({ onPick, currentFile, compact }) => {
  const [items, setItems] = useState<SavedCampaignMedia[]>([]);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(() => {
    setItems(listSavedCampaignMedia());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleSaveCurrent = async () => {
    if (!currentFile) return;
    setSaving(true);
    try {
      const res = await saveCampaignMediaToLibrary(currentFile);
      if (res.ok === false) {
        toast.error(res.error);
        return;
      }
      toast.success('Imagem salva na biblioteca.');
      refresh();
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = (id: string) => {
    removeSavedCampaignMedia(id);
    refresh();
    toast.success('Imagem removida da biblioteca.');
  };

  if (items.length === 0 && !currentFile) return null;

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
          Imagens salvas
        </p>
        {currentFile?.type.startsWith('image/') && (
          <Button type="button" size="xs" variant="secondary" disabled={saving} onClick={() => void handleSaveCurrent()}>
            <Bookmark className="w-3.5 h-3.5 mr-1" />
            {saving ? 'Salvando…' : 'Salvar anexo atual'}
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
          Nenhuma imagem salva ainda. Anexe uma foto e use &quot;Salvar anexo atual&quot; para reutilizar depois.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="group relative rounded-lg overflow-hidden border"
              style={{ borderColor: 'var(--border-subtle)', width: compact ? 72 : 84, height: compact ? 72 : 84 }}
            >
              <button
                type="button"
                className="w-full h-full block"
                title={item.name}
                onClick={() => {
                  onPick(savedMediaToFile(item));
                  toast.success('Imagem da biblioteca selecionada.');
                }}
              >
                <img src={savedMediaToDataUrl(item)} alt="" className="w-full h-full object-cover" />
              </button>
              <button
                type="button"
                className="absolute top-1 right-1 p-1 rounded-md bg-black/55 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label="Remover da biblioteca"
                onClick={() => handleRemove(item.id)}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
          <div
            className="rounded-lg border border-dashed flex items-center justify-center"
            style={{ borderColor: 'var(--border-subtle)', width: compact ? 72 : 84, height: compact ? 72 : 84, color: 'var(--text-3)' }}
          >
            <ImageIcon className="w-5 h-5 opacity-50" />
          </div>
        </div>
      )}
    </div>
  );
};
