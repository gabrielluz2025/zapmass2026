import React, { useCallback, useMemo, useState } from 'react';
import { Check, FolderPlus, Plus, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  createCampaignGreetingKit,
  loadCampaignGreetingKits,
  saveCampaignGreetingKits,
  type CampaignGreetingKit
} from '../../utils/campaignGreetings';

type Props = {
  onInsert: (text: string) => void;
};

export const CampaignGreetingPicker: React.FC<Props> = ({ onInsert }) => {
  const [kits, setKits] = useState<CampaignGreetingKit[]>(() => loadCampaignGreetingKits());
  const [activeKitId, setActiveKitId] = useState<string | null>(() => loadCampaignGreetingKits()[0]?.id ?? null);
  const [building, setBuilding] = useState(false);
  const [kitNameDraft, setKitNameDraft] = useState('');
  const [phraseDraft, setPhraseDraft] = useState('');
  const [builderItems, setBuilderItems] = useState<string[]>([]);

  const persistKits = useCallback((next: CampaignGreetingKit[]) => {
    saveCampaignGreetingKits(next);
    setKits(next);
    if (next.length === 0) {
      setActiveKitId(null);
      return;
    }
    if (!activeKitId || !next.some((k) => k.id === activeKitId)) {
      setActiveKitId(next[0]!.id);
    }
  }, [activeKitId]);

  const activeKit = useMemo(
    () => kits.find((k) => k.id === activeKitId) ?? kits[0] ?? null,
    [kits, activeKitId]
  );

  const resetBuilder = () => {
    setBuilding(false);
    setKitNameDraft('');
    setPhraseDraft('');
    setBuilderItems([]);
  };

  const addPhraseToBuilder = () => {
    const t = phraseDraft.trim();
    if (!t) return;
    if (builderItems.some((g) => g.toLowerCase() === t.toLowerCase())) {
      setPhraseDraft('');
      return;
    }
    setBuilderItems((prev) => [...prev, t]);
    setPhraseDraft('');
  };

  const confirmNewKit = () => {
    const kit = createCampaignGreetingKit(kitNameDraft, builderItems);
    if (!kit) {
      toast.error('Informe um nome e pelo menos uma saudação.');
      return;
    }
    const next = [...kits, kit];
    persistKits(next);
    setActiveKitId(kit.id);
    toast.success(`Conjunto "${kit.name}" salvo — use em qualquer disparo.`);
    resetBuilder();
  };

  const deleteKit = (id: string) => {
    if (kits.length <= 1) {
      toast.error('Mantenha pelo menos um conjunto de saudações.');
      return;
    }
    const next = kits.filter((k) => k.id !== id);
    persistKits(next);
    toast.success('Conjunto removido.');
  };

  const insertPhrase = (phrase: string) => {
    onInsert(phrase.endsWith(' ') ? phrase : `${phrase} `);
  };

  return (
    <div className="cw-greeting-picker">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="cw-vars-group-label mb-0">Conjuntos de saudações</p>
        {!building && (
          <button
            type="button"
            className="cw-greeting-kit-create-btn"
            onClick={() => setBuilding(true)}
          >
            <FolderPlus className="w-3.5 h-3.5" />
            Criar conjunto
          </button>
        )}
      </div>

      {building ? (
        <div className="cw-greeting-builder">
          <p className="text-[11px] font-semibold mb-2" style={{ color: 'var(--text-1)' }}>
            Novo conjunto
          </p>
          <label className="text-[10px] font-semibold block mb-1" style={{ color: 'var(--text-3)' }}>
            Nome do conjunto (ex: Igreja, Vendas, Informal)
          </label>
          <input
            type="text"
            className="w-full rounded-lg border px-2.5 py-1.5 text-[12px] mb-2"
            style={{
              borderColor: 'var(--border-subtle)',
              background: 'var(--surface-0)',
              color: 'var(--text-1)'
            }}
            placeholder="Ex: Atendimento amigável"
            value={kitNameDraft}
            maxLength={48}
            onChange={(e) => setKitNameDraft(e.target.value)}
          />

          <label className="text-[10px] font-semibold block mb-1" style={{ color: 'var(--text-3)' }}>
            Saudações deste conjunto
          </label>
          {builderItems.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {builderItems.map((g) => (
                <span key={g} className="inline-flex items-center gap-0.5">
                  <span className="cw-vars-chip cw-vars-chip--greeting">{g}</span>
                  <button
                    type="button"
                    className="cw-greeting-remove"
                    aria-label={`Remover ${g} do rascunho`}
                    onClick={() => setBuilderItems((prev) => prev.filter((x) => x !== g))}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="flex gap-1.5 mb-3">
            <input
              type="text"
              className="flex-1 rounded-lg border px-2.5 py-1.5 text-[12px]"
              style={{
                borderColor: 'var(--border-subtle)',
                background: 'var(--surface-0)',
                color: 'var(--text-1)'
              }}
              placeholder="Ex: Olá, Oi, Paz…"
              value={phraseDraft}
              maxLength={48}
              onChange={(e) => setPhraseDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addPhraseToBuilder();
                }
              }}
            />
            <button type="button" className="cw-greeting-add-phrase-btn" onClick={addPhraseToBuilder}>
              <Plus className="w-3.5 h-3.5" />
              Adicionar
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" className="cw-greeting-builder-cancel" onClick={resetBuilder}>
              Cancelar
            </button>
            <button
              type="button"
              className="cw-greeting-builder-confirm"
              onClick={confirmNewKit}
            >
              <Check className="w-3.5 h-3.5" />
              Confirmar e salvar
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="cw-greeting-kit-list">
            {kits.map((kit) => {
              const active = kit.id === (activeKit?.id ?? '');
              return (
                <div
                  key={kit.id}
                  className="cw-greeting-kit-card"
                  data-active={active ? 'true' : 'false'}
                >
                  <button
                    type="button"
                    className="cw-greeting-kit-card-main"
                    onClick={() => setActiveKitId(kit.id)}
                  >
                    <span className="cw-greeting-kit-name">{kit.name}</span>
                    <span className="cw-greeting-kit-meta">
                      {kit.items.length} saudação{kit.items.length !== 1 ? 'ões' : ''}
                    </span>
                  </button>
                  {kits.length > 1 && (
                    <button
                      type="button"
                      className="cw-greeting-kit-delete"
                      aria-label={`Excluir conjunto ${kit.name}`}
                      onClick={() => deleteKit(kit.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {activeKit && (
            <div className="cw-greeting-kit-phrases mt-2">
              <p className="text-[10px] mb-1.5" style={{ color: 'var(--text-3)' }}>
                Clique para inserir no texto — conjunto &quot;{activeKit.name}&quot;
              </p>
              <div className="flex flex-wrap gap-1">
                {activeKit.items.map((g) => (
                  <button
                    key={`${activeKit.id}-${g}`}
                    type="button"
                    className="cw-vars-chip cw-vars-chip--greeting"
                    onClick={() => insertPhrase(g)}
                    title={`Inserir "${g}"`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
