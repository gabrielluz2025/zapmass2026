import React, { useCallback, useEffect, useState } from 'react';
import { Flame, RefreshCw, ShieldBan, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  fetchContactIdentityProfile,
  reconcileContactIdentity,
  type ContactProfileSnapshot,
} from '../../services/contactIdentityApi';

const BAND_LABEL: Record<string, string> = {
  cold: 'Frio',
  warm: 'Morno',
  hot: 'Quente',
  blocked: 'Lista negra',
};

type Props = {
  phoneDigits: string;
};

export const ContactIdentityPanel: React.FC<Props> = ({ phoneDigits }) => {
  const [profile, setProfile] = useState<ContactProfileSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [reconciling, setReconciling] = useState(false);

  const load = useCallback(async () => {
    if (!phoneDigits || phoneDigits.replace(/\D/g, '').length < 8) return;
    setLoading(true);
    try {
      const res = await fetchContactIdentityProfile(phoneDigits);
      if (res.ok && res.profile) setProfile(res.profile);
      else if (!res.ok) setProfile(null);
    } catch {
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, [phoneDigits]);

  useEffect(() => {
    void load();
  }, [load]);

  const onReconcile = async () => {
    setReconciling(true);
    try {
      const res = await reconcileContactIdentity(phoneDigits);
      if (res.ok && res.profile) {
        setProfile(res.profile);
        toast.success('Identidade atualizada.');
      } else toast.error(res.error || 'Não foi possível reconciliar.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao reconciliar.');
    } finally {
      setReconciling(false);
    }
  };

  if (phoneDigits.replace(/\D/g, '').length < 8) return null;

  const band = profile?.leadBand || 'cold';
  const bandLabel = BAND_LABEL[band] || band;

  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-violet-400" />
          Identidade do contato
        </span>
        <button
          type="button"
          className="text-xs text-violet-300 hover:text-violet-200 flex items-center gap-1"
          disabled={loading || reconciling}
          onClick={() => void onReconcile()}
        >
          <RefreshCw className={`w-3 h-3 ${reconciling ? 'animate-spin' : ''}`} />
          Sincronizar chip
        </button>
      </div>

      {loading && !profile ? (
        <p className="text-xs text-white/50">Carregando histórico…</p>
      ) : profile ? (
        <>
          <div className="flex flex-wrap gap-2 text-xs">
            <span
              className="px-2 py-0.5 rounded-full bg-white/10"
              data-band={band}
              title={`Score ${profile.leadScore}`}
            >
              {band === 'hot' ? <Flame className="w-3 h-3 inline mr-1 text-orange-400" /> : null}
              {band === 'blocked' ? (
                <ShieldBan className="w-3 h-3 inline mr-1 text-red-400" />
              ) : null}
              {bandLabel} · {profile.leadScore} pts
            </span>
            {profile.optedOut && (
              <span className="px-2 py-0.5 rounded-full bg-red-500/20 text-red-200">Opt-out</span>
            )}
            {profile.nurturePending && (
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-200">
                Jornada ativa
              </span>
            )}
            {profile.mergedMessageCount > 0 && (
              <span className="text-white/50">{profile.mergedMessageCount} msgs arquivadas</span>
            )}
          </div>

          {profile.timeline.length > 0 && (
            <ul className="max-h-36 overflow-y-auto space-y-1 text-xs text-white/70 border-t border-white/10 pt-2">
              {profile.timeline.slice(0, 8).map((ev) => (
                <li key={ev.id} className="flex justify-between gap-2">
                  <span className="truncate">{ev.summary}</span>
                  <time className="shrink-0 text-white/40">
                    {new Date(ev.at).toLocaleDateString('pt-BR', {
                      day: '2-digit',
                      month: '2-digit',
                    })}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="text-xs text-white/50">Sem dados ainda — interações geram timeline automaticamente.</p>
      )}
    </div>
  );
};
