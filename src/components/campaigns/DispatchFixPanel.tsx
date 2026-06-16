/**
 * Instruções copiáveis para restaurar a fila de disparo (Redis + app).
 * Reutilizado no preview de campanha e no Centro de Comando.
 */
import React, { useState } from 'react';
import { Copy, Check, Terminal, Server } from 'lucide-react';
import toast from 'react-hot-toast';

export const VPS_REDIS_FIX_COMMAND =
  "sed -i 's|^REDIS_URL=.*|REDIS_URL=redis://redis:6379|' /opt/zapmass/.env && cd /opt/zapmass && docker compose up -d zapmass";

export const VPS_FULL_REDEPLOY_COMMAND =
  'cd /opt/zapmass && git pull origin main && docker compose up -d --build';

type Props = {
  /** Mensagem curta acima dos passos */
  title?: string;
  compact?: boolean;
  /** Comando vindo da API (prioridade sobre o padrão) */
  fixCommand?: string;
  /** Detalhe técnico (ex.: host errado no REDIS_URL) */
  detail?: string | null;
};

export const DispatchFixPanel: React.FC<Props> = ({
  title = 'A fila de disparo (Redis) está offline. Sem ela, nenhuma campanha envia mensagens.',
  compact = false,
  fixCommand,
  detail,
}) => {
  const [copied, setCopied] = useState<'quick' | 'full' | null>(null);
  const quickCommand = fixCommand?.trim() || VPS_REDIS_FIX_COMMAND;
  const panelTitle = detail?.trim() || title;

  const copy = async (text: string, which: 'quick' | 'full') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      toast.success('Comando copiado — cole no terminal da VPS.');
      setTimeout(() => setCopied(null), 2500);
    } catch {
      toast.error('Não foi possível copiar. Selecione o texto manualmente.');
    }
  };

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: '#ef444410', border: '1px solid #ef444435' }}
    >
      <div className="px-3.5 py-2.5 flex items-start gap-2.5">
        <Server className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
        <p className="text-[11.5px] leading-snug" style={{ color: '#fca5a5' }}>
          {panelTitle}
        </p>
      </div>

      <div className={`px-3.5 pb-3.5 ${compact ? 'space-y-2' : 'space-y-2.5'}`}>
        <FixStep
          n={1}
          label="Conecte na VPS (SSH ou terminal do painel Hostinger)"
        />
        <FixStep
          n={2}
          label="Corrija REDIS_URL e reinicie o app"
          command={quickCommand}
          copied={copied === 'quick'}
          onCopy={() => copy(quickCommand, 'quick')}
        />
        {!compact && (
          <FixStep
            n={3}
            label="Se ainda falhar, redeploy completo"
            command={VPS_FULL_REDEPLOY_COMMAND}
            copied={copied === 'full'}
            onCopy={() => copy(VPS_FULL_REDEPLOY_COMMAND, 'full')}
            muted
          />
        )}
        <p className="text-[10px] pt-1" style={{ color: 'var(--text-3)' }}>
          Depois de executar, clique em <strong>Reverificar</strong> acima e tente o disparo de novo.
        </p>
      </div>
    </div>
  );
};

const FixStep: React.FC<{
  n: number;
  label: string;
  command?: string;
  copied?: boolean;
  onCopy?: () => void;
  muted?: boolean;
}> = ({ n, label, command, copied, onCopy, muted }) => (
  <div
    className="rounded-lg px-3 py-2"
    style={{
      background: muted ? 'var(--surface-0)' : 'rgba(0,0,0,0.25)',
      border: '1px solid var(--border-subtle)',
    }}
  >
    <div className="flex items-center gap-2 mb-1">
      <span
        className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black text-white shrink-0"
        style={{ background: muted ? '#64748b' : '#ef4444' }}
      >
        {n}
      </span>
      <span className="text-[11px] font-semibold" style={{ color: 'var(--text-1)' }}>
        {label}
      </span>
    </div>
    {command && (
      <div className="flex items-stretch gap-1.5 mt-1.5">
        <code
          className="flex-1 text-[10px] font-mono px-2 py-1.5 rounded-md overflow-x-auto whitespace-nowrap"
          style={{ background: 'var(--surface-1)', color: '#fbbf24', border: '1px solid var(--border-subtle)' }}
        >
          <Terminal className="w-3 h-3 inline mr-1 opacity-60" />
          {command}
        </code>
        {onCopy && (
          <button
            type="button"
            onClick={onCopy}
            className="shrink-0 px-2.5 rounded-md flex items-center gap-1 text-[10px] font-bold transition-colors"
            style={{ background: 'var(--surface-1)', color: copied ? '#10b981' : 'var(--text-2)', border: '1px solid var(--border-subtle)' }}
          >
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {copied ? 'Copiado' : 'Copiar'}
          </button>
        )}
      </div>
    )}
  </div>
);
