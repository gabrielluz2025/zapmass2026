import React, { useCallback, useMemo, useState } from 'react';
import { Check, FolderPlus, Plus, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { buildCampaignSpintax } from '../../../shared/campaignSpintax';
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

  const deleteKit = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (kits.length <= 1) {
      toast.error('Mantenha pelo menos um conjunto de saudações.');
      return;
    }
    const next = kits.filter((k) => k.id !== id);
    persistKits(next);
    toast.success('Conjunto removido.');
  };

  const insertPhrase = () => {
    if (!activeKit) return;
    const token = buildCampaignSpintax(activeKit.items);
    if (!token) return;
    onInsert(token.endsWith(' ') ? token : `${token} `);
  };

  return (
    <div className="cw-greeting-picker campaign-message-variable-chips">
      <div className="cw-greeting-picker-head">
        <p className="cw-vars-group-label mb-0">Saudações</p>
        {!building && (
          <button
            type="button"
            className="cw-greeting-kit-create-link"
            onClick={() => setBuilding(true)}
          >
            <FolderPlus className="w-3 h-3" />
            Criar conjunto
          </button>
        )}
      </div>

      {building ? (
        <div className="cw-greeting-builder">
          <p className="cw-vars-group-label">Novo conjunto</p>
          <input
            type="text"
            className="cw-greeting-input"
            placeholder="Nome (ex: Igreja, Vendas)"
            value={kitNameDraft}
            maxLength={48}
            onChange={(e) => setKitNameDraft(e.target.value)}
          />
          {builderItems.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-1.5">
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
          <div className="flex gap-1 mb-2">
            <input
              type="text"
              className="cw-greeting-input flex-1"
              placeholder="Frase (ex: Olá) — Enter adiciona"
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
            <button type="button" className="cw-greeting-mini-btn" onClick={addPhraseToBuilder}>
              <Plus className="w-3 h-3" />
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            <button type="button" className="cw-greeting-mini-btn" onClick={resetBuilder}>
              Cancelar
            </button>
            <button type="button" className="cw-greeting-mini-btn cw-greeting-mini-btn--primary" onClick={confirmNewKit}>
              <Check className="w-3 h-3" />
              Salvar
            </button>
          </div>
        </div>
      ) : (
        <>
          {kits.length > 1 && (
            <>
              <p className="cw-vars-group-label">Conjunto</p>
              <div className="flex flex-wrap gap-1 mb-1">
                {kits.map((kit) => {
                  const active = kit.id === (activeKit?.id ?? '');
                  return (
                    <span key={kit.id} className="inline-flex items-center gap-0.5">
                      <button
                        type="button"
                        className={`cw-vars-chip ${active ? 'cw-vars-chip--greeting' : 'cw-vars-chip--ficha'}`}
                        onClick={() => setActiveKitId(kit.id)}
                        title={`Conjunto ${kit.name}`}
                      >
                        {kit.name}
                      </button>
                      <button
                        type="button"
                        className="cw-greeting-remove"
                        aria-label={`Excluir conjunto ${kit.name}`}
                        onClick={(e) => deleteKit(kit.id, e)}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </span>
                  );
                })}
              </div>
            </>
          )}

          {activeKit && activeKit.items.length > 0 && (
            <>
              <p className="cw-vars-group-label">
                {activeKit.items.length > 1
                  ? 'Rodízio — cada contato recebe uma saudação'
                  : 'Clique para inserir'}
              </p>
              <div className="flex flex-wrap gap-1">
                {activeKit.items.length > 1 ? (
                  <button
                    type="button"
                    className="cw-vars-chip cw-vars-chip--greeting"
                    onClick={insertPhrase}
                    title={`Inserir rodízio: ${activeKit.items.join(' / ')}`}
                  >
                    {activeKit.items.join(' · ')}
                  </button>
                ) : (
                  activeKit.items.map((g) => (
                    <button
                      key={`${activeKit.id}-${g}`}
                      type="button"
                      className="cw-vars-chip cw-vars-chip--greeting"
                      onClick={insertPhrase}
                      title={`Inserir "${g}" no texto`}
                    >
                      {g}
                    </button>
                  ))
                )}
              </div>
              {activeKit.items.length > 1 && (
                <p className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>
                  No envio: uma opção por pessoa ({'{'}Olá|Oi|…{'}'}).
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
};
