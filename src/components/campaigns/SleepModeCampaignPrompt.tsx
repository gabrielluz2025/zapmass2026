import React from 'react';
import { Moon, Play, Pause } from 'lucide-react';
import { Modal, Button } from '../ui';
import { useZapMassCore } from '../../context/ZapMassContext';

export const SleepModeCampaignPrompt: React.FC = () => {
  const {
    sleepModePrompts,
    campaigns,
    continueCampaignInSleepMode,
    dismissCampaignSleepMode,
  } = useZapMassCore();

  const current = sleepModePrompts[0];
  if (!current) return null;

  const campaign = campaigns.find((c) => c.id === current.campaignId);
  const label = campaign?.name || `Campanha ${current.campaignId.slice(0, 8)}…`;

  return (
    <Modal
      isOpen
      onClose={() => dismissCampaignSleepMode(current.campaignId)}
      title="Modo silêncio noturno"
      icon={<Moon className="w-5 h-5" style={{ color: '#818cf8' }} />}
      size="md"
    >
      <div className="space-y-4">
        <div
          className="p-4 rounded-xl"
          style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.22)' }}
        >
          <p className="text-[13px] font-bold mb-1" style={{ color: 'var(--text-1)' }}>
            {label}
          </p>
          <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
            {current.message ||
              'O modo silêncio noturno está ativo (20h às 8h, horário de Brasília). Esta campanha foi pausada automaticamente.'}
          </p>
          <p className="text-[11.5px] mt-2" style={{ color: 'var(--text-3)' }}>
            Deseja <strong>continuar enviando agora</strong> mesmo durante a noite, ou manter pausada até 8h?
          </p>
        </div>

        {sleepModePrompts.length > 1 && (
          <p className="text-[11px] text-center" style={{ color: 'var(--text-3)' }}>
            +{sleepModePrompts.length - 1} campanha(s) aguardando confirmação após esta
          </p>
        )}

        <div className="flex flex-col sm:flex-row gap-2 justify-end pt-1">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Pause className="w-4 h-4" />}
            onClick={() => dismissCampaignSleepMode(current.campaignId)}
          >
            Manter pausada até 8h
          </Button>
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Play className="w-4 h-4" />}
            onClick={() => continueCampaignInSleepMode(current.campaignId)}
          >
            Continuar enviando agora
          </Button>
        </div>
      </div>
    </Modal>
  );
};
