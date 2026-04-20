import React, { useEffect, useState } from 'react';
import { Loader2, Save, Shield } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAppConfig } from '../../context/AppConfigContext';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../ui';

export const AdminPanel: React.FC = () => {
  const { user } = useAuth();
  const { config, reload } = useAppConfig();
  const [saving, setSaving] = useState(false);
  const [marketingPriceMonthly, setMarketingPriceMonthly] = useState('');
  const [marketingPriceAnnual, setMarketingPriceAnnual] = useState('');
  const [trialHours, setTrialHours] = useState('1');
  const [landingTrialTitle, setLandingTrialTitle] = useState('');
  const [landingTrialBody, setLandingTrialBody] = useState('');

  useEffect(() => {
    setMarketingPriceMonthly(config.marketingPriceMonthly);
    setMarketingPriceAnnual(config.marketingPriceAnnual);
    setTrialHours(String(config.trialHours));
    setLandingTrialTitle(config.landingTrialTitle);
    setLandingTrialBody(config.landingTrialBody);
  }, [config]);

  const save = async () => {
    if (!user) return;
    const th = Math.max(1, Math.min(168, Math.round(Number(trialHours)) || 1));
    setSaving(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin/app-config', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({
          marketingPriceMonthly,
          marketingPriceAnnual,
          trialHours: th,
          landingTrialTitle,
          landingTrialBody
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        toast.error(typeof data?.error === 'string' ? data.error : 'Falha ao salvar.');
        return;
      }
      toast.success('Configuracao publicada. Clientes passam a ver na proxima leitura (ate ~15s no servidor).');
      await reload();
    } catch (e) {
      console.error(e);
      toast.error('Erro de rede.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 p-1">
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{
            background: 'linear-gradient(135deg, rgba(16,185,129,0.2), rgba(5,150,105,0.15))',
            border: '1px solid rgba(16,185,129,0.35)'
          }}
        >
          <Shield className="w-5 h-5 text-emerald-500" />
        </div>
        <div>
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-1)' }}>
            Painel do criador
          </h2>
          <p className="text-[13px] leading-relaxed mt-1" style={{ color: 'var(--text-3)' }}>
            Estes valores ficam em <code className="text-[12px]">appConfig/global</code> no Firestore. Precos abaixo
            alimentam o modal Pro quando preenchidos; vazio usa o fallback do front (Vite). A duracao do teste gratuito
            (horas) e aplicada pelo servidor em <code className="text-[12px]">POST /api/billing/trial/start</code>.
          </p>
        </div>
      </div>

      <div
        className="rounded-xl border p-5 space-y-4"
        style={{ borderColor: 'var(--border)', background: 'var(--surface-0)' }}
      >
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--text-3)' }}>
            Preco mensal (texto exibido)
          </label>
          <input
            className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-emerald-500/30"
            style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text-1)' }}
            value={marketingPriceMonthly}
            onChange={(e) => setMarketingPriceMonthly(e.target.value)}
            placeholder="Ex.: R$ 49,90 / mes"
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--text-3)' }}>
            Preco anual (texto exibido)
          </label>
          <input
            className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-emerald-500/30"
            style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text-1)' }}
            value={marketingPriceAnnual}
            onChange={(e) => setMarketingPriceAnnual(e.target.value)}
            placeholder="Ex.: R$ 479,90 / ano"
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--text-3)' }}>
            Duracao do teste (horas, 1 a 168)
          </label>
          <input
            type="number"
            min={1}
            max={168}
            className="w-full max-w-[200px] rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-emerald-500/30"
            style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text-1)' }}
            value={trialHours}
            onChange={(e) => setTrialHours(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--text-3)' }}>
            Titulo do bloco de teste na landing (opcional)
          </label>
          <input
            className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-emerald-500/30"
            style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text-1)' }}
            value={landingTrialTitle}
            onChange={(e) => setLandingTrialTitle(e.target.value)}
            placeholder="Vazio = montar automaticamente a partir das horas"
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--text-3)' }}>
            Texto do bloco de teste na landing (opcional)
          </label>
          <textarea
            rows={4}
            className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-emerald-500/30 resize-y min-h-[100px]"
            style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text-1)' }}
            value={landingTrialBody}
            onChange={(e) => setLandingTrialBody(e.target.value)}
            placeholder="Vazio = texto padrao da landing (menciona a duracao configurada)"
          />
        </div>

        <Button variant="primary" type="button" disabled={saving} leftIcon={saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} onClick={() => void save()}>
          Salvar e publicar
        </Button>
      </div>
    </div>
  );
};
