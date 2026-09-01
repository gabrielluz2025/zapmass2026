import React from 'react';
import { Calendar, MessageSquare, Plus, Trash2 } from 'lucide-react';
import type { CampaignProspectingResponderStep } from '../../types';
import { Button, Input, Textarea } from '../ui';

const WEEKDAYS = [
  { value: 0, label: 'Domingo' },
  { value: 1, label: 'Segunda' },
  { value: 2, label: 'Terça' },
  { value: 3, label: 'Quarta' },
  { value: 4, label: 'Quinta' },
  { value: 5, label: 'Sexta' },
  { value: 6, label: 'Sábado' }
];

type Props = {
  silentWeeks: number;
  onSilentWeeksChange: (n: number) => void;
  silentBody: string;
  onSilentBodyChange: (v: string) => void;
  bumpWeekday: number;
  onBumpWeekdayChange: (n: number) => void;
  bumpTime: string;
  onBumpTimeChange: (v: string) => void;
  responderSteps: CampaignProspectingResponderStep[];
  onResponderStepsChange: (steps: CampaignProspectingResponderStep[]) => void;
};

export const CampaignProspectingSetup: React.FC<Props> = ({
  silentWeeks,
  onSilentWeeksChange,
  silentBody,
  onSilentBodyChange,
  bumpWeekday,
  onBumpWeekdayChange,
  bumpTime,
  onBumpTimeChange,
  responderSteps,
  onResponderStepsChange
}) => {
  const updateStep = (index: number, patch: Partial<CampaignProspectingResponderStep>) => {
    onResponderStepsChange(
      responderSteps.map((s, i) => (i === index ? { ...s, ...patch } : s))
    );
  };

  return (
    <div className="cw-msg-section space-y-4 mt-4">
      <div className="rounded-xl p-4" style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)' }}>
        <p className="text-[13px] font-bold mb-1" style={{ color: 'var(--text-1)' }}>
          Plano semanal — quem responder
        </p>
        <p className="text-[11.5px] mb-3" style={{ color: 'var(--text-3)' }}>
          Após a abertura, quem responder entra nesta sequência (semana 1, 2, 3…). Mínimo 2 passos.
        </p>
        <div className="space-y-3">
          {responderSteps.map((step, i) => (
            <div
              key={`prosp-step-${i}`}
              className="rounded-lg p-3 space-y-2"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-semibold" style={{ color: 'var(--text-2)' }}>
                  Semana {i + 1}
                </span>
                {responderSteps.length > 2 && (
                  <button
                    type="button"
                    className="p-1 rounded-md hover:bg-black/5"
                    onClick={() =>
                      onResponderStepsChange(responderSteps.filter((_, j) => j !== i))
                    }
                    aria-label="Remover passo"
                  >
                    <Trash2 className="w-3.5 h-3.5" style={{ color: 'var(--text-3)' }} />
                  </button>
                )}
              </div>
              <Textarea
                rows={3}
                placeholder="Texto enviado nesta semana (material, CTA, convite…)"
                value={step.body}
                onChange={(e) => updateStep(i, { body: e.target.value })}
              />
            </div>
          ))}
          {responderSteps.length < 8 && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => onResponderStepsChange([...responderSteps, { body: '' }])}
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              Adicionar semana
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-xl p-4" style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.22)' }}>
        <div className="flex items-center gap-2 mb-2">
          <MessageSquare className="w-4 h-4" style={{ color: '#d97706' }} />
          <p className="text-[13px] font-bold mb-0" style={{ color: 'var(--text-1)' }}>
            Lembretes para quem não responde
          </p>
        </div>
        <p className="text-[11.5px] mb-3" style={{ color: 'var(--text-3)' }}>
          Só os silenciosos recebem este texto, uma vez por semana, até o limite abaixo.
        </p>
        <Textarea
          rows={3}
          value={silentBody}
          onChange={(e) => onSilentBodyChange(e.target.value)}
          placeholder="Ex.: Oi! Ainda posso te enviar mais detalhes?"
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
          <div>
            <label className="text-[11px] font-medium block mb-1" style={{ color: 'var(--text-3)' }}>
              Semanas de insistência
            </label>
            <Input
              type="number"
              min={1}
              max={12}
              value={silentWeeks}
              onChange={(e) => onSilentWeeksChange(Math.min(12, Math.max(1, Number(e.target.value) || 4)))}
            />
          </div>
          <div>
            <label className="text-[11px] font-medium block mb-1" style={{ color: 'var(--text-3)' }}>
              Dia do lembrete
            </label>
            <select
              className="w-full rounded-lg px-3 py-2 text-[13px]"
              style={{ border: '1px solid var(--border-subtle)', background: 'var(--surface-1)' }}
              value={bumpWeekday}
              onChange={(e) => onBumpWeekdayChange(Number(e.target.value))}
            >
              {WEEKDAYS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-medium block mb-1" style={{ color: 'var(--text-3)' }}>
              Horário (BRT)
            </label>
            <Input type="time" value={bumpTime} onChange={(e) => onBumpTimeChange(e.target.value)} />
          </div>
        </div>
        <p className="text-[10.5px] mt-2 flex items-center gap-1" style={{ color: 'var(--text-3)' }}>
          <Calendar className="w-3 h-3" />
          Primeiro lembrete ~7 dias após o disparo inicial, no dia e horário escolhidos.
        </p>
      </div>
    </div>
  );
};
