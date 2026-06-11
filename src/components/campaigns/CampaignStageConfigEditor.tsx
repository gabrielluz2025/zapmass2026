import React from 'react';
import { Clock, MessageSquare, GitBranch, Zap } from 'lucide-react';
import type { CampaignStageConfig, CampaignStageTriggerType } from '../../types';

interface Props {
  stageIndex: number;
  config: CampaignStageConfig;
  totalStages: number;
  onChange: (updated: CampaignStageConfig) => void;
}

type TriggerOption = {
  value: CampaignStageTriggerType;
  label: string;
  description: string;
  icon: React.ReactNode;
};

const TRIGGER_OPTIONS: TriggerOption[] = [
  {
    value: 'delay',
    label: 'Após delay configurado',
    description: 'Envia com o intervalo padrão entre contatos.',
    icon: <Clock className="h-4 w-4" />,
  },
  {
    value: 'immediate',
    label: 'Imediatamente',
    description: 'Envia logo após a etapa anterior, sem delay.',
    icon: <Zap className="h-4 w-4" />,
  },
  {
    value: 'any_reply',
    label: 'Quando contato responder',
    description: 'Aguarda qualquer resposta antes de avançar.',
    icon: <MessageSquare className="h-4 w-4" />,
  },
  {
    value: 'conditional',
    label: 'Baseado na resposta (condicional)',
    description: 'Avança para etapa diferente conforme o conteúdo da resposta.',
    icon: <GitBranch className="h-4 w-4" />,
  },
];

export function CampaignStageConfigEditor({ stageIndex, config, totalStages, onChange }: Props) {
  const update = (patch: Partial<CampaignStageConfig>) => onChange({ ...config, ...patch });

  const stepOptions = Array.from({ length: totalStages }, (_, i) => i).filter(
    (i) => i !== stageIndex
  );

  return (
    <div className="mt-2 rounded-lg border border-white/10 bg-white/5 p-3 space-y-3">
      <div>
        <label className="mb-1.5 block text-xs font-medium text-white/60">
          Como esta etapa dispara a próxima
        </label>
        <div className="grid grid-cols-2 gap-2">
          {TRIGGER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => update({ trigger_type: opt.value })}
              className={`flex flex-col gap-1 rounded-lg border p-2.5 text-left text-xs transition-all ${
                config.trigger_type === opt.value
                  ? 'border-violet-500 bg-violet-500/20 text-white'
                  : 'border-white/10 bg-white/5 text-white/60 hover:border-white/20 hover:text-white/80'
              }`}
            >
              <div className="flex items-center gap-1.5">
                {opt.icon}
                <span className="font-medium">{opt.label}</span>
              </div>
              <span className="text-[11px] opacity-70">{opt.description}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Timeout para any_reply e conditional */}
      {(config.trigger_type === 'any_reply' || config.trigger_type === 'conditional') && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-white/60">
              Timeout (horas, opcional)
            </label>
            <input
              type="number"
              min={1}
              max={720}
              placeholder="Ex: 24"
              value={config.timeout_hours ?? ''}
              onChange={(e) =>
                update({ timeout_hours: e.target.value ? parseInt(e.target.value, 10) : undefined })
              }
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder-white/30 focus:border-violet-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-white/60">Ação no timeout</label>
            <select
              value={config.timeout_action ?? 'skip'}
              onChange={(e) => update({ timeout_action: e.target.value })}
              className="w-full rounded-lg border border-white/10 bg-[#1a1a2e] px-3 py-2 text-xs text-white focus:border-violet-500 focus:outline-none"
            >
              <option value="skip">Pular contato</option>
              <option value="complete">Marcar como concluído</option>
              {stepOptions.map((i) => (
                <option key={i} value={String(i)}>
                  Ir para etapa {i + 1}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Condição para trigger_type=conditional */}
      {config.trigger_type === 'conditional' && (
        <div className="space-y-3 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
          <p className="text-xs text-amber-300">
            Define a condição da resposta e para onde o contato vai em cada caso.
          </p>
          <div>
            <label className="mb-1 block text-xs text-white/60">
              Palavra-chave que a resposta deve conter (case-insensitive)
            </label>
            <input
              type="text"
              placeholder="Ex: sim, yes, 1"
              value={config.trigger_condition?.contains ?? ''}
              onChange={(e) =>
                update({
                  trigger_condition: e.target.value
                    ? { contains: e.target.value }
                    : undefined,
                })
              }
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder-white/30 focus:border-violet-500 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-white/60">
                Se BATE → próxima etapa
              </label>
              <select
                value={config.next_step_on_match ?? ''}
                onChange={(e) =>
                  update({
                    next_step_on_match: e.target.value !== '' ? parseInt(e.target.value, 10) : undefined,
                  })
                }
                className="w-full rounded-lg border border-white/10 bg-[#1a1a2e] px-3 py-2 text-xs text-white focus:border-violet-500 focus:outline-none"
              >
                <option value="">Próxima sequencial</option>
                {stepOptions.map((i) => (
                  <option key={i} value={String(i)}>
                    Etapa {i + 1}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-white/60">
                Se NÃO BATE → próxima etapa
              </label>
              <select
                value={config.next_step_on_no_match ?? ''}
                onChange={(e) =>
                  update({
                    next_step_on_no_match: e.target.value !== '' ? parseInt(e.target.value, 10) : undefined,
                  })
                }
                className="w-full rounded-lg border border-white/10 bg-[#1a1a2e] px-3 py-2 text-xs text-white focus:border-violet-500 focus:outline-none"
              >
                <option value="">Próxima sequencial</option>
                {stepOptions.map((i) => (
                  <option key={i} value={String(i)}>
                    Etapa {i + 1}
                  </option>
                ))}
                <option value="skip">Pular</option>
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
