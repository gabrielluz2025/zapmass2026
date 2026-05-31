import React, { useState } from 'react';
import { CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '../ui';
import { useAppProfile } from '../../context/AppProfileContext';
import {
  USE_SEGMENT_CHANGE_DATA_SAFE_SHORT,
  USE_SEGMENT_OPTIONS,
  USE_SEGMENT_TOAST_DATA_SAFE,
  type UseSegmentId
} from '../../constants/useSegments';

/**
 * Primeiro acesso do dono da conta: escolhe o segmento de uso antes do restante do onboarding.
 * Membros de equipa e admins não veem esta tela.
 */
export const SegmentOnboardingScreen: React.FC = () => {
  const { saveSegment } = useAppProfile();
  const [selected, setSelected] = useState<UseSegmentId | null>(null);
  const [saving, setSaving] = useState(false);

  const onContinue = async () => {
    if (!selected) {
      toast.error('Escolha um segmento para continuar.');
      return;
    }
    setSaving(true);
    try {
      await saveSegment(selected);
      toast.success(`Preferência guardada. ${USE_SEGMENT_TOAST_DATA_SAFE}`);
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(
        msg.includes('permission') || msg.includes('PERMISSION_DENIED')
          ? 'Sem permissão para guardar preferência. Recarregue a página ou contacte o suporte.'
          : 'Não foi possível guardar. Tente de novo ou verifique a ligação.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 py-12 relative overflow-hidden"
      style={{ background: 'var(--bg)' }}
    >
      <div
        aria-hidden
        className="absolute top-[-18%] left-[-8%] w-[520px] h-[520px] rounded-full pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(16,185,129,0.16), transparent 62%)',
          filter: 'blur(42px)'
        }}
      />
      <div
        aria-hidden
        className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(59,130,246,0.12), transparent 58%)',
          filter: 'blur(48px)'
        }}
      />

      <div className="relative z-10 w-full max-w-2xl">
        <div className="text-center mb-8">
          <div
            className="mx-auto w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
            style={{
              background: 'linear-gradient(135deg, #10b981, #059669)',
              boxShadow: '0 16px 44px rgba(16,185,129,0.28)'
            }}
          >
            <Sparkles className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight" style={{ color: 'var(--text-1)' }}>
            Em que contexto vai usar o ZapMass?
          </h1>
          <p className="text-[13px] sm:text-[14px] mt-2 max-w-lg mx-auto" style={{ color: 'var(--text-3)' }}>
            Isto ajuda-nos a priorizar funcionalidades e mensagens adequadas ao seu caso. Depois pode mudar quando
            quiser em <strong>Configurações → Minha conta</strong>.
          </p>
          <p
            className="text-[12px] sm:text-[13px] mt-3 max-w-lg mx-auto rounded-xl px-3 py-2.5"
            style={{
              color: 'var(--text-2)',
              background: 'var(--surface-1)',
              border: '1px solid var(--border-subtle)'
            }}
          >
            {USE_SEGMENT_CHANGE_DATA_SAFE_SHORT}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {USE_SEGMENT_OPTIONS.map((opt) => {
            const active = selected === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSelected(opt.id)}
                className="text-left rounded-2xl border p-4 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                style={{
                  borderColor: active ? 'rgba(16,185,129,0.55)' : 'var(--border)',
                  background: active ? 'rgba(16,185,129,0.08)' : 'var(--surface-0)',
                  boxShadow: active ? '0 8px 28px rgba(16,185,129,0.12)' : undefined
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[14px] font-semibold" style={{ color: 'var(--text-1)' }}>
                      {opt.title}
                    </p>
                    <p className="text-[12px] mt-1 leading-snug" style={{ color: 'var(--text-3)' }}>
                      {opt.description}
                    </p>
                  </div>
                  {active ? (
                    <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-500" aria-hidden />
                  ) : (
                    <span className="w-5 h-5 shrink-0 rounded-full border border-dashed" style={{ borderColor: 'var(--border)' }} />
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-8 flex justify-center">
          <Button
            variant="primary"
            className="min-w-[200px]"
            disabled={!selected || saving}
            onClick={() => void onContinue()}
            leftIcon={saving ? <Loader2 className="w-4 h-4 animate-spin" /> : undefined}
          >
            {saving ? 'A guardar…' : 'Continuar'}
          </Button>
        </div>
      </div>
    </div>
  );
};
