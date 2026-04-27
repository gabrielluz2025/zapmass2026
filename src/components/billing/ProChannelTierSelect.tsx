import React from 'react';
import type { ChannelTier } from '../../constants/channelTierPricing';

const TIERS: ChannelTier[] = [1, 2, 3, 4, 5];

interface ProChannelTierSelectProps {
  value: ChannelTier;
  onChange: (v: ChannelTier) => void;
  disabled?: boolean;
  id?: string;
}

/**
 * Seletor de quantidade de canais WhatsApp (1–5), alinhado ao checkout `channel-plan`.
 */
export const ProChannelTierSelect: React.FC<ProChannelTierSelectProps> = ({
  value,
  onChange,
  disabled,
  id = 'pro-channel-tier'
}) => (
  <div
    className="rounded-xl px-3 py-2.5 mb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
    style={{ background: 'var(--surface-0)', border: '1px solid var(--border-subtle)' }}
  >
    <div className="min-w-0">
      <label htmlFor={id} className="text-[11px] font-bold block" style={{ color: 'var(--text-1)' }}>
        Escolha com quantos canais deseja começar
      </label>
      <p className="text-[10px] leading-snug mt-0.5" style={{ color: 'var(--text-3)' }}>
        O valor do Pro é calculado pela quantidade de canais selecionada. Você pode ajustar antes de concluir a compra.
      </p>
    </div>
    <select
      id={id}
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(Number(e.target.value) as ChannelTier)}
      className="text-[12px] font-semibold rounded-lg px-2.5 py-1.5 min-w-[120px] shrink-0"
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        color: 'var(--text-1)'
      }}
    >
      {TIERS.map((n) => (
        <option key={n} value={n}>
          {n} canal{n > 1 ? 'is' : ''}
        </option>
      ))}
    </select>
  </div>
);
