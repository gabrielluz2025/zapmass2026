/**
 * Mapa dos Contatos — reconstruído do zero.
 * Sem Leaflet, sem chamadas API externas no carregamento,
 * sem notificações de timeout. Painel de distribuição pura
 * baseado nos contatos já carregados no contexto.
 */
import React, { useMemo, useState } from 'react';
import {
  BarChart3,
  Users,
  MapPin,
  TrendingUp,
  Search,
  Send,
  Flame,
  Thermometer,
  Snowflake,
  Sparkles,
  Phone,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useZapMassCore, useZapMassConversations } from '../../context/ZapMassContext';
import { useAppView } from '../../context/AppViewContext';
import { PageShell, Badge } from '../ui';
import { DDD_COORDINATES } from '../../utils/dddCoordinates';
import {
  computeContactTemperatures,
  CONTACT_TEMP_LABEL,
  type ContactTemperature,
} from '../../utils/contactTemperature';

// ────────────────────────────────────────────
// Tipos auxiliares
// ────────────────────────────────────────────

interface StateRow {
  state: string;
  count: number;
  pct: number;
}

interface DddRow {
  ddd: string;
  city: string;
  state: string;
  count: number;
  pct: number;
}

// ────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────

function extractDdd(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) return digits.slice(2, 4);
  if (digits.length >= 10) return digits.slice(0, 2);
  return null;
}

const TEMP_COLORS: Record<ContactTemperature, { bg: string; fg: string; border: string; icon: React.ReactNode }> = {
  hot: {
    bg: 'rgba(239,68,68,0.12)',
    fg: '#ef4444',
    border: 'rgba(239,68,68,0.3)',
    icon: <Flame className="w-4 h-4" />,
  },
  warm: {
    bg: 'rgba(245,158,11,0.12)',
    fg: '#f59e0b',
    border: 'rgba(245,158,11,0.3)',
    icon: <Thermometer className="w-4 h-4" />,
  },
  cold: {
    bg: 'rgba(59,130,246,0.12)',
    fg: '#3b82f6',
    border: 'rgba(59,130,246,0.3)',
    icon: <Snowflake className="w-4 h-4" />,
  },
  new: {
    bg: 'rgba(16,185,129,0.1)',
    fg: '#10b981',
    border: 'rgba(16,185,129,0.25)',
    icon: <Sparkles className="w-4 h-4" />,
  },
};

const STATE_COLORS = [
  '#10b981','#34d399','#6ee7b7','#a7f3d0',
  '#3b82f6','#60a5fa','#93c5fd','#bfdbfe',
  '#f59e0b','#fbbf24','#fcd34d','#fde68a',
  '#ef4444','#f87171','#fca5a5',
];

// ────────────────────────────────────────────
// Componente principal
// ────────────────────────────────────────────

export const ContactsMapTab: React.FC = () => {
  const { setCurrentView } = useAppView();
  const { contacts, contactsSavedTotal, contactsHasMore, contactsLoadingMore } = useZapMassCore();
  const conversations = useZapMassConversations();

  const [searchState, setSearchState] = useState('');
  const [expandStates, setExpandStates] = useState(false);

  const total = contactsSavedTotal ?? contacts.length;

  // ── Distribuição por DDD ──────────────────
  const { dddRows, stateRows, withDdd, withoutDdd } = useMemo(() => {
    const dddCount: Record<string, number> = {};
    let noDdd = 0;

    for (const c of contacts) {
      const phone = c.phoneNumber || c.phone || '';
      const ddd = extractDdd(phone);
      if (ddd && DDD_COORDINATES[ddd]) {
        dddCount[ddd] = (dddCount[ddd] || 0) + 1;
      } else {
        noDdd++;
      }
    }

    const totalWithDdd = Object.values(dddCount).reduce((a, b) => a + b, 0);

    const ddds: DddRow[] = Object.entries(dddCount)
      .map(([ddd, count]) => ({
        ddd,
        city: DDD_COORDINATES[ddd]?.city ?? ddd,
        state: DDD_COORDINATES[ddd]?.state ?? '?',
        count,
        pct: totalWithDdd > 0 ? Math.round((count / totalWithDdd) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);

    // Agrupamento por estado
    const stateCount: Record<string, number> = {};
    for (const d of ddds) {
      stateCount[d.state] = (stateCount[d.state] || 0) + d.count;
    }
    const states: StateRow[] = Object.entries(stateCount)
      .map(([state, count]) => ({
        state,
        count,
        pct: totalWithDdd > 0 ? Math.round((count / totalWithDdd) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);

    return { dddRows: ddds, stateRows: states, withDdd: totalWithDdd, withoutDdd: noDdd };
  }, [contacts]);

  // ── Temperaturas ─────────────────────────
  const tempCounts = useMemo(() => {
    const temps = computeContactTemperatures(contacts, conversations);
    const count: Record<ContactTemperature, number> = { hot: 0, warm: 0, cold: 0, new: 0 };
    for (const t of Object.values(temps)) count[t.temp]++;
    return count;
  }, [contacts, conversations]);

  // ── Filtro de estado ──────────────────────
  const filteredDdds = useMemo(() => {
    if (!searchState) return dddRows;
    const q = searchState.toLowerCase();
    return dddRows.filter(
      (d) =>
        d.city.toLowerCase().includes(q) ||
        d.state.toLowerCase().includes(q) ||
        d.ddd.includes(q)
    );
  }, [dddRows, searchState]);

  const visibleStates = expandStates ? stateRows : stateRows.slice(0, 8);

  const topDdds = filteredDdds.slice(0, 20);

  return (
    <PageShell
      statusStrip={
        <>
          <Badge variant="neutral">Distribuição</Badge>
          <span className="ui-caption tabular-nums">{total.toLocaleString('pt-BR')} contatos</span>
          {(contactsHasMore || contactsLoadingMore) && (
            <span className="ui-caption" style={{ color: 'var(--text-3)' }}>
              Carregando base…
            </span>
          )}
        </>
      }
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">

        {/* ── KPIs Rápidos ────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            {
              label: 'Total',
              value: total.toLocaleString('pt-BR'),
              icon: <Users className="w-5 h-5" />,
              color: '#10b981',
            },
            {
              label: 'Com DDD',
              value: withDdd.toLocaleString('pt-BR'),
              icon: <Phone className="w-5 h-5" />,
              color: '#3b82f6',
            },
            {
              label: 'Estados',
              value: stateRows.length,
              icon: <MapPin className="w-5 h-5" />,
              color: '#f59e0b',
            },
            {
              label: 'DDDs ativos',
              value: dddRows.length,
              icon: <BarChart3 className="w-5 h-5" />,
              color: '#a855f7',
            },
          ].map((kpi) => (
            <div
              key={kpi.label}
              className="rounded-xl p-4 flex items-center gap-3"
              style={{ background: 'var(--surface)', border: '1px solid var(--border-subtle)' }}
            >
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: `${kpi.color}18`, color: kpi.color }}
              >
                {kpi.icon}
              </div>
              <div>
                <p className="text-[22px] font-extrabold leading-none tabular-nums" style={{ color: 'var(--text)' }}>
                  {kpi.value}
                </p>
                <p className="text-[11px] mt-0.5 font-medium" style={{ color: 'var(--text-3)' }}>
                  {kpi.label}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* ── Temperatura dos contatos ─── */}
          <div
            className="rounded-xl p-4"
            style={{ background: 'var(--surface)', border: '1px solid var(--border-subtle)' }}
          >
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-4 h-4" style={{ color: '#10b981' }} />
              <h3 className="text-[14px] font-bold" style={{ color: 'var(--text)' }}>
                Temperatura dos contatos
              </h3>
            </div>
            <div className="space-y-3">
              {(Object.keys(tempCounts) as ContactTemperature[]).map((t) => {
                const c = tempCounts[t];
                const pct = total > 0 ? Math.round((c / total) * 100) : 0;
                const col = TEMP_COLORS[t];
                return (
                  <div key={t}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5" style={{ color: col.fg }}>
                        {col.icon}
                        <span className="text-[12px] font-semibold">{CONTACT_TEMP_LABEL[t]}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-bold tabular-nums" style={{ color: 'var(--text)' }}>
                          {c.toLocaleString('pt-BR')}
                        </span>
                        <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-3)' }}>
                          {pct}%
                        </span>
                      </div>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--surface-1)' }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, background: col.fg }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 pt-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
              <button
                type="button"
                onClick={() => setCurrentView('campaigns')}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] font-semibold transition"
                style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.2)' }}
              >
                <Send className="w-3.5 h-3.5" /> Criar campanha segmentada
              </button>
            </div>
          </div>

          {/* ── Distribuição por estado ─── */}
          <div
            className="rounded-xl p-4"
            style={{ background: 'var(--surface)', border: '1px solid var(--border-subtle)' }}
          >
            <div className="flex items-center gap-2 mb-4">
              <MapPin className="w-4 h-4" style={{ color: '#f59e0b' }} />
              <h3 className="text-[14px] font-bold" style={{ color: 'var(--text)' }}>
                Por estado (UF)
              </h3>
              {stateRows.length > 8 && (
                <span className="ml-auto text-[11px]" style={{ color: 'var(--text-3)' }}>
                  {stateRows.length} estados
                </span>
              )}
            </div>

            {stateRows.length === 0 ? (
              <p className="text-[12px] text-center py-6" style={{ color: 'var(--text-3)' }}>
                Nenhum contato com DDD reconhecido ainda.
              </p>
            ) : (
              <>
                <div className="space-y-2">
                  {visibleStates.map((s, idx) => (
                    <div key={s.state} className="flex items-center gap-2">
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-extrabold flex-shrink-0"
                        style={{
                          background: `${STATE_COLORS[idx % STATE_COLORS.length]}20`,
                          color: STATE_COLORS[idx % STATE_COLORS.length],
                        }}
                      >
                        {s.state}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[12px] font-semibold truncate" style={{ color: 'var(--text)' }}>
                            {s.state}
                          </span>
                          <span className="text-[11px] tabular-nums flex-shrink-0 ml-2" style={{ color: 'var(--text-3)' }}>
                            {s.count.toLocaleString('pt-BR')} · {s.pct}%
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-1)' }}>
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${s.pct}%`,
                              background: STATE_COLORS[idx % STATE_COLORS.length],
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {stateRows.length > 8 && (
                  <button
                    type="button"
                    onClick={() => setExpandStates((v) => !v)}
                    className="mt-3 w-full flex items-center justify-center gap-1 text-[11px] font-semibold py-1.5 rounded-lg transition"
                    style={{
                      background: 'var(--surface-1)',
                      color: 'var(--text-3)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    {expandStates ? (
                      <><ChevronUp className="w-3.5 h-3.5" /> Recolher</>
                    ) : (
                      <><ChevronDown className="w-3.5 h-3.5" /> Ver todos ({stateRows.length - 8} restantes)</>
                    )}
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Top DDDs / Cidades ────────────── */}
        <div
          className="rounded-xl p-4"
          style={{ background: 'var(--surface)', border: '1px solid var(--border-subtle)' }}
        >
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4" style={{ color: '#3b82f6' }} />
              <h3 className="text-[14px] font-bold" style={{ color: 'var(--text)' }}>
                Top cidades por DDD
              </h3>
            </div>
            <div
              className="flex-1 min-w-[160px] flex items-center gap-2 rounded-lg px-3 py-1.5"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
            >
              <Search className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-3)' }} />
              <input
                type="text"
                className="flex-1 bg-transparent text-[12px] outline-none"
                style={{ color: 'var(--text)' }}
                placeholder="Buscar cidade, estado ou DDD…"
                value={searchState}
                onChange={(e) => setSearchState(e.target.value)}
              />
            </div>
            {withoutDdd > 0 && (
              <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                {withoutDdd.toLocaleString('pt-BR')} sem DDD reconhecido
              </span>
            )}
          </div>

          {dddRows.length === 0 ? (
            <div className="py-10 text-center">
              <MapPin className="w-8 h-8 mx-auto mb-3" style={{ color: 'var(--text-3)' }} />
              <p className="text-[13px] font-semibold" style={{ color: 'var(--text-2)' }}>
                Nenhum DDD identificado
              </p>
              <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
                Contatos precisam ter número com DDD brasileiro para aparecer aqui.
              </p>
            </div>
          ) : topDdds.length === 0 ? (
            <p className="text-[12px] text-center py-6" style={{ color: 'var(--text-3)' }}>
              Nenhum resultado para "{searchState}".
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {topDdds.map((d, idx) => {
                const color = STATE_COLORS[idx % STATE_COLORS.length];
                return (
                  <div
                    key={d.ddd}
                    className="rounded-xl p-3 flex flex-col gap-1.5"
                    style={{
                      background: `${color}08`,
                      border: `1px solid ${color}25`,
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="text-[10px] font-extrabold px-1.5 py-0.5 rounded"
                        style={{ background: `${color}20`, color }}
                      >
                        ({d.ddd})
                      </span>
                      <span className="text-[11px] font-bold truncate" style={{ color: 'var(--text-2)' }}>
                        {d.state}
                      </span>
                    </div>
                    <p className="text-[12px] font-semibold truncate" style={{ color: 'var(--text)' }}>
                      {d.city}
                    </p>
                    <div className="flex items-center justify-between">
                      <span className="text-[15px] font-extrabold tabular-nums" style={{ color }}>
                        {d.count.toLocaleString('pt-BR')}
                      </span>
                      <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-3)' }}>
                        {d.pct}%
                      </span>
                    </div>
                    <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--surface-1)' }}>
                      <div className="h-full rounded-full" style={{ width: `${d.pct}%`, background: color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {filteredDdds.length > 20 && (
            <p className="mt-3 text-[11px] text-center" style={{ color: 'var(--text-3)' }}>
              Mostrando os 20 maiores DDDs. Use a busca para filtrar.
            </p>
          )}
        </div>

        {/* ── Rodapé informativo ────────────── */}
        {withoutDdd > 0 && (
          <div
            className="rounded-xl px-4 py-3 flex items-start gap-2.5"
            style={{
              background: 'rgba(245,158,11,0.07)',
              border: '1px solid rgba(245,158,11,0.2)',
            }}
          >
            <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: '#f59e0b' }} />
            <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>
              <strong>{withoutDdd.toLocaleString('pt-BR')}</strong> contato{withoutDdd !== 1 ? 's' : ''} não tem
              DDD brasileiro reconhecido (números internacionais, incompletos ou sem prefixo). Eles aparecem no total
              mas não nas distribuições por cidade/estado.
            </p>
          </div>
        )}

      </div>
    </PageShell>
  );
};
