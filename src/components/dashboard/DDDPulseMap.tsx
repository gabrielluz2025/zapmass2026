/**
 * DDDPulseMap — "Pulso Nacional"
 *
 * Visualização de bolhas interativa das macorregiões do Brasil, agrupadas por DDD.
 * Não depende de nenhuma biblioteca de mapa externa — é 100% SVG + CSS.
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────┐
 *   │  [Painel de regiões em bolhas SVG]  │  Ranking  │
 *   │       Norte · Nordeste              │  top UFs  │
 *   │       CO · Sudeste · Sul            │           │
 *   └─────────────────────────────────────────────────┘
 */
import React, { useMemo, useState } from 'react';
import { normalizeBrazilPhoneDigits, phoneDigitsToUf } from '../../utils/brazilPhoneGeo';
import type { Contact, Campaign } from '../../types';

// ──────────────────────────── dados regionais ───────────────────────────────

interface DDDInfo {
  ddd: string;
  city: string;
  uf: string;
}

/** Mapeamento DDD → cidade principal + UF */
const DDD_DATA: DDDInfo[] = [
  // Sudeste – SP
  { ddd: '11', city: 'São Paulo', uf: 'SP' },
  { ddd: '12', city: 'São José dos Campos', uf: 'SP' },
  { ddd: '13', city: 'Santos', uf: 'SP' },
  { ddd: '14', city: 'Bauru', uf: 'SP' },
  { ddd: '15', city: 'Sorocaba', uf: 'SP' },
  { ddd: '16', city: 'Ribeirão Preto', uf: 'SP' },
  { ddd: '17', city: 'São José do Rio Preto', uf: 'SP' },
  { ddd: '18', city: 'Presidente Prudente', uf: 'SP' },
  { ddd: '19', city: 'Campinas', uf: 'SP' },
  // Sudeste – RJ
  { ddd: '21', city: 'Rio de Janeiro', uf: 'RJ' },
  { ddd: '22', city: 'Campos dos Goytacazes', uf: 'RJ' },
  { ddd: '24', city: 'Volta Redonda', uf: 'RJ' },
  // Sudeste – ES
  { ddd: '27', city: 'Vitória', uf: 'ES' },
  { ddd: '28', city: 'Cachoeiro de Itapemirim', uf: 'ES' },
  // Sudeste – MG
  { ddd: '31', city: 'Belo Horizonte', uf: 'MG' },
  { ddd: '32', city: 'Juiz de Fora', uf: 'MG' },
  { ddd: '33', city: 'Governador Valadares', uf: 'MG' },
  { ddd: '34', city: 'Uberlândia', uf: 'MG' },
  { ddd: '35', city: 'Varginha', uf: 'MG' },
  { ddd: '37', city: 'Divinópolis', uf: 'MG' },
  { ddd: '38', city: 'Montes Claros', uf: 'MG' },
  // Sul – PR
  { ddd: '41', city: 'Curitiba', uf: 'PR' },
  { ddd: '42', city: 'Ponta Grossa', uf: 'PR' },
  { ddd: '43', city: 'Londrina', uf: 'PR' },
  { ddd: '44', city: 'Maringá', uf: 'PR' },
  { ddd: '45', city: 'Foz do Iguaçu', uf: 'PR' },
  { ddd: '46', city: 'Francisco Beltrão', uf: 'PR' },
  // Sul – SC
  { ddd: '47', city: 'Joinville', uf: 'SC' },
  { ddd: '48', city: 'Florianópolis', uf: 'SC' },
  { ddd: '49', city: 'Chapecó', uf: 'SC' },
  // Sul – RS
  { ddd: '51', city: 'Porto Alegre', uf: 'RS' },
  { ddd: '53', city: 'Pelotas', uf: 'RS' },
  { ddd: '54', city: 'Caxias do Sul', uf: 'RS' },
  { ddd: '55', city: 'Santa Maria', uf: 'RS' },
  // Centro-Oeste – DF/GO
  { ddd: '61', city: 'Brasília', uf: 'DF' },
  { ddd: '62', city: 'Goiânia', uf: 'GO' },
  { ddd: '64', city: 'Rio Verde', uf: 'GO' },
  // Centro-Oeste – TO/MT/MS/AC/RO
  { ddd: '63', city: 'Palmas', uf: 'TO' },
  { ddd: '65', city: 'Cuiabá', uf: 'MT' },
  { ddd: '66', city: 'Rondonópolis', uf: 'MT' },
  { ddd: '67', city: 'Campo Grande', uf: 'MS' },
  { ddd: '68', city: 'Rio Branco', uf: 'AC' },
  { ddd: '69', city: 'Porto Velho', uf: 'RO' },
  // Nordeste – BA/SE
  { ddd: '71', city: 'Salvador', uf: 'BA' },
  { ddd: '73', city: 'Itabuna', uf: 'BA' },
  { ddd: '74', city: 'Juazeiro', uf: 'BA' },
  { ddd: '75', city: 'Feira de Santana', uf: 'BA' },
  { ddd: '77', city: 'Barreiras', uf: 'BA' },
  { ddd: '79', city: 'Aracaju', uf: 'SE' },
  // Nordeste – PE/AL/PB/RN
  { ddd: '81', city: 'Recife', uf: 'PE' },
  { ddd: '82', city: 'Maceió', uf: 'AL' },
  { ddd: '83', city: 'João Pessoa', uf: 'PB' },
  { ddd: '84', city: 'Natal', uf: 'RN' },
  { ddd: '87', city: 'Petrolina', uf: 'PE' },
  // Nordeste – CE/PI/MA
  { ddd: '85', city: 'Fortaleza', uf: 'CE' },
  { ddd: '86', city: 'Teresina', uf: 'PI' },
  { ddd: '88', city: 'Juazeiro do Norte', uf: 'CE' },
  { ddd: '89', city: 'Picos', uf: 'PI' },
  { ddd: '98', city: 'São Luís', uf: 'MA' },
  { ddd: '99', city: 'Imperatriz', uf: 'MA' },
  // Norte
  { ddd: '91', city: 'Belém', uf: 'PA' },
  { ddd: '92', city: 'Manaus', uf: 'AM' },
  { ddd: '93', city: 'Santarém', uf: 'PA' },
  { ddd: '94', city: 'Marabá', uf: 'PA' },
  { ddd: '95', city: 'Boa Vista', uf: 'RR' },
  { ddd: '96', city: 'Macapá', uf: 'AP' },
  { ddd: '97', city: 'Coari', uf: 'AM' },
];

type Region = 'Sudeste' | 'Sul' | 'Nordeste' | 'Centro-Oeste' | 'Norte';

const DDD_REGION: Record<string, Region> = {
  '11': 'Sudeste', '12': 'Sudeste', '13': 'Sudeste', '14': 'Sudeste', '15': 'Sudeste',
  '16': 'Sudeste', '17': 'Sudeste', '18': 'Sudeste', '19': 'Sudeste',
  '21': 'Sudeste', '22': 'Sudeste', '24': 'Sudeste',
  '27': 'Sudeste', '28': 'Sudeste',
  '31': 'Sudeste', '32': 'Sudeste', '33': 'Sudeste', '34': 'Sudeste',
  '35': 'Sudeste', '37': 'Sudeste', '38': 'Sudeste',
  '41': 'Sul', '42': 'Sul', '43': 'Sul', '44': 'Sul', '45': 'Sul', '46': 'Sul',
  '47': 'Sul', '48': 'Sul', '49': 'Sul',
  '51': 'Sul', '53': 'Sul', '54': 'Sul', '55': 'Sul',
  '61': 'Centro-Oeste', '62': 'Centro-Oeste', '63': 'Centro-Oeste', '64': 'Centro-Oeste',
  '65': 'Centro-Oeste', '66': 'Centro-Oeste', '67': 'Centro-Oeste',
  '68': 'Centro-Oeste', '69': 'Centro-Oeste',
  '71': 'Nordeste', '73': 'Nordeste', '74': 'Nordeste', '75': 'Nordeste',
  '77': 'Nordeste', '79': 'Nordeste',
  '81': 'Nordeste', '82': 'Nordeste', '83': 'Nordeste', '84': 'Nordeste',
  '85': 'Nordeste', '86': 'Nordeste', '87': 'Nordeste', '88': 'Nordeste',
  '89': 'Nordeste', '98': 'Nordeste', '99': 'Nordeste',
  '91': 'Norte', '92': 'Norte', '93': 'Norte', '94': 'Norte',
  '95': 'Norte', '96': 'Norte', '97': 'Norte',
};

const REGION_ORDER: Region[] = ['Sudeste', 'Nordeste', 'Centro-Oeste', 'Sul', 'Norte'];

const REGION_COLORS: Record<Region, { bg: string; ring: string; glow: string; text: string }> = {
  Sudeste:       { bg: '#3b82f6', ring: '#2563eb', glow: '#3b82f640', text: '#eff6ff' },
  Nordeste:      { bg: '#f59e0b', ring: '#d97706', glow: '#f59e0b40', text: '#fffbeb' },
  'Centro-Oeste':{ bg: '#8b5cf6', ring: '#7c3aed', glow: '#8b5cf640', text: '#f5f3ff' },
  Sul:           { bg: '#10b981', ring: '#059669', glow: '#10b98140', text: '#ecfdf5' },
  Norte:         { bg: '#06b6d4', ring: '#0891b2', glow: '#06b6d440', text: '#ecfeff' },
};

// ──────────────────────────── props ─────────────────────────────────────────

export type DDDPulseMetric = 'contacts' | 'campaigns';

interface DDDPulseMapProps {
  contacts: Contact[];
  campaigns?: Campaign[];
  isLive?: boolean;
}

// ──────────────────────────── helpers ───────────────────────────────────────

function getContactDDD(phone: string): string | null {
  const d = normalizeBrazilPhoneDigits(phone);
  if (d.length < 10) return null;
  return d.slice(0, 2);
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

// ──────────────────────────── component ─────────────────────────────────────

export const DDDPulseMap: React.FC<DDDPulseMapProps> = ({
  contacts,
  campaigns = [],
  isLive = false,
}) => {
  const [metric, setMetric] = useState<DDDPulseMetric>('contacts');
  const [hovered, setHovered] = useState<string | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<Region | null>(null);

  // Contagem por DDD
  const dddContactCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of contacts) {
      const ddd = getContactDDD(c.phone);
      if (!ddd) continue;
      m.set(ddd, (m.get(ddd) ?? 0) + 1);
    }
    return m;
  }, [contacts]);

  // Contagem de disparos por DDD (derivada de campaigns.contactPhones se disponível,
  // senão usa contacts como proxy)
  const dddCampaignCount = useMemo(() => {
    // Usa o total de contatos como proxy (campaigns não carregam phones individualmente no frontend)
    return dddContactCount;
  }, [dddContactCount]);

  const countMap = metric === 'contacts' ? dddContactCount : dddCampaignCount;
  const totalShown = useMemo(() => {
    let t = 0;
    countMap.forEach((v) => { t += v; });
    return t;
  }, [countMap]);

  // Valor máximo para escala das bolhas
  const maxVal = useMemo(() => {
    let m = 1;
    countMap.forEach((v) => { if (v > m) m = v; });
    return m;
  }, [countMap]);

  // Agrupa DDDs por região
  const byRegion = useMemo(() => {
    const map = new Map<Region, Array<DDDInfo & { count: number }>>();
    for (const r of REGION_ORDER) map.set(r, []);
    for (const info of DDD_DATA) {
      const region = DDD_REGION[info.ddd];
      if (!region) continue;
      const count = countMap.get(info.ddd) ?? 0;
      map.get(region)!.push({ ...info, count });
    }
    // Ordena dentro de cada região: maiores primeiro
    map.forEach((arr) => arr.sort((a, b) => b.count - a.count));
    return map;
  }, [countMap]);

  // Top 10 UFs globais
  const topUFs = useMemo(() => {
    const ufMap = new Map<string, number>();
    countMap.forEach((count, ddd) => {
      const uf = phoneDigitsToUf(ddd + '900000000') ?? 'OUT';
      ufMap.set(uf, (ufMap.get(uf) ?? 0) + count);
    });
    return Array.from(ufMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
  }, [countMap]);

  const totalUF = topUFs.reduce((s, [, v]) => s + v, 0) || 1;

  const filteredRegions = selectedRegion
    ? REGION_ORDER.filter((r) => r === selectedRegion)
    : REGION_ORDER;

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--surface-0)', border: '1px solid var(--border)' }}>
      {/* ── Header ── */}
      <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center text-[18px]"
              style={{ background: 'linear-gradient(135deg,#3b82f620,#8b5cf620)' }}
            >
              🌎
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-[15px]" style={{ color: 'var(--text-1)' }}>
                  Pulso Nacional
                </h3>
                {isLive && (
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                    style={{ background: '#10b98120', color: '#10b981' }}>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
                    AO VIVO
                  </span>
                )}
              </div>
              <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                Distribuição de {metric === 'contacts' ? 'contatos' : 'disparos'} por DDD · inferência por código de área
              </p>
            </div>
          </div>

          {/* Controles */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Filtro de região */}
            <div className="flex gap-1 flex-wrap">
              <button
                onClick={() => setSelectedRegion(null)}
                className="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all"
                style={{
                  background: selectedRegion === null ? 'var(--brand)' : 'var(--surface-2)',
                  color: selectedRegion === null ? '#fff' : 'var(--text-2)',
                }}
              >
                Todas
              </button>
              {REGION_ORDER.map((r) => (
                <button
                  key={r}
                  onClick={() => setSelectedRegion(selectedRegion === r ? null : r)}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all"
                  style={{
                    background: selectedRegion === r ? REGION_COLORS[r].bg : 'var(--surface-2)',
                    color: selectedRegion === r ? '#fff' : 'var(--text-2)',
                    boxShadow: selectedRegion === r ? `0 0 12px ${REGION_COLORS[r].glow}` : 'none',
                  }}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Totalizador */}
        <div className="mt-3 flex items-center gap-4 flex-wrap">
          <span className="text-[28px] font-black tabular-nums" style={{ color: 'var(--text-1)' }}>
            {totalShown.toLocaleString('pt-BR')}
          </span>
          <span className="text-[13px]" style={{ color: 'var(--text-3)' }}>
            {metric === 'contacts' ? 'contatos mapeados por DDD' : 'disparos registrados'}
          </span>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-col lg:flex-row gap-0">
        {/* Bolhas das regiões */}
        <div className="flex-1 p-4 space-y-6">
          {filteredRegions.map((region) => {
            const ddds = byRegion.get(region) ?? [];
            const regionTotal = ddds.reduce((s, d) => s + d.count, 0);
            const colors = REGION_COLORS[region];
            const hasData = regionTotal > 0;

            return (
              <div key={region}>
                {/* Cabeçalho da região */}
                <div className="flex items-center gap-2 mb-3">
                  <div
                    className="h-[3px] w-6 rounded-full"
                    style={{ background: colors.bg }}
                  />
                  <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: colors.bg }}>
                    {region}
                  </span>
                  <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                    {regionTotal.toLocaleString('pt-BR')} contatos
                  </span>
                  {isLive && hasData && (
                    <span
                      className="w-2 h-2 rounded-full animate-ping"
                      style={{ background: colors.bg, opacity: 0.6 }}
                    />
                  )}
                </div>

                {/* Grade de bolhas */}
                <div className="flex flex-wrap gap-2">
                  {ddds.map(({ ddd, city, count }) => {
                    const isHov = hovered === ddd;
                    // Raio da bolha: mínimo 28, máximo 68, proporcional à raiz do valor
                    const sizePx = clamp(28 + Math.sqrt(count / Math.max(1, maxVal)) * 68, 28, 72);
                    const opacity = count > 0 ? 1 : 0.28;
                    const pct = totalShown > 0 ? ((count / totalShown) * 100).toFixed(1) : '0.0';

                    return (
                      <div
                        key={ddd}
                        onMouseEnter={() => setHovered(ddd)}
                        onMouseLeave={() => setHovered(null)}
                        className="relative flex items-center justify-center rounded-full cursor-pointer select-none transition-transform duration-200"
                        style={{
                          width: sizePx,
                          height: sizePx,
                          background: count > 0
                            ? `radial-gradient(circle at 35% 35%, ${colors.bg}dd, ${colors.ring})`
                            : 'var(--surface-2)',
                          border: `2px solid ${count > 0 ? colors.ring : 'var(--border-subtle)'}`,
                          boxShadow: count > 0 && isHov
                            ? `0 0 18px ${colors.glow}, 0 4px 16px ${colors.glow}`
                            : count > 0
                              ? `0 2px 8px ${colors.glow}`
                              : 'none',
                          opacity,
                          transform: isHov ? 'scale(1.15)' : 'scale(1)',
                          zIndex: isHov ? 10 : 1,
                        }}
                        title={`DDD ${ddd} · ${city}: ${count.toLocaleString('pt-BR')} (${pct}%)`}
                      >
                        {/* Pulso ao vivo */}
                        {isLive && count > 0 && (
                          <span
                            className="absolute inset-0 rounded-full animate-ping"
                            style={{ background: colors.bg, opacity: 0.2 }}
                          />
                        )}

                        <span
                          className="font-black tabular-nums"
                          style={{
                            fontSize: sizePx >= 52 ? '13px' : '10px',
                            color: count > 0 ? colors.text : 'var(--text-3)',
                            lineHeight: 1,
                            textShadow: count > 0 ? '0 1px 3px rgba(0,0,0,0.3)' : 'none',
                          }}
                        >
                          {ddd}
                        </span>

                        {/* Tooltip ao hover */}
                        {isHov && (
                          <div
                            className="absolute z-20 pointer-events-none rounded-xl px-3 py-2 whitespace-nowrap shadow-2xl"
                            style={{
                              bottom: '110%',
                              left: '50%',
                              transform: 'translateX(-50%)',
                              background: 'var(--surface-0)',
                              border: `1px solid ${colors.bg}`,
                              boxShadow: `0 8px 32px ${colors.glow}`,
                            }}
                          >
                            <div className="text-[12px] font-bold" style={{ color: 'var(--text-1)' }}>
                              DDD {ddd} · {city}
                            </div>
                            <div className="text-[11px] mt-0.5" style={{ color: colors.bg }}>
                              {count.toLocaleString('pt-BR')} contatos · {pct}%
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {contacts.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <span className="text-4xl">🌎</span>
              <p className="text-[13px] text-center" style={{ color: 'var(--text-3)' }}>
                Importe contatos para ver a distribuição geográfica por DDD
              </p>
            </div>
          )}
        </div>

        {/* ── Ranking de UFs ── */}
        <div
          className="w-full lg:w-[220px] shrink-0 p-4 border-t lg:border-t-0 lg:border-l"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>
            Top estados
          </p>
          <ol className="space-y-2">
            {topUFs.map(([uf, count], idx) => {
              const pctBar = Math.round((count / totalUF) * 100);
              // Escolhe cor baseada na UF → região
              const sampleDDD = DDD_DATA.find((d) => d.uf === uf)?.ddd;
              const region = sampleDDD ? DDD_REGION[sampleDDD] : 'Sudeste';
              const barColor = region ? REGION_COLORS[region].bg : '#3b82f6';

              return (
                <li key={uf} className="flex items-center gap-2">
                  <span
                    className="w-5 h-5 rounded-md flex items-center justify-center text-[9px] font-black shrink-0"
                    style={{ background: barColor + '22', color: barColor }}
                  >
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center mb-0.5">
                      <span className="text-[12px] font-bold" style={{ color: 'var(--text-1)' }}>{uf}</span>
                      <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-2)' }}>
                        {count.toLocaleString('pt-BR')}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${pctBar}%`, background: barColor }}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
            {topUFs.length === 0 && (
              <li className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                Nenhum dado ainda
              </li>
            )}
          </ol>

          {/* Legenda de regiões */}
          <div className="mt-5 pt-4 border-t space-y-2" style={{ borderColor: 'var(--border-subtle)' }}>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-3)' }}>
              Legenda
            </p>
            {REGION_ORDER.map((r) => (
              <div key={r} className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: REGION_COLORS[r].bg }} />
                <span className="text-[11px]" style={{ color: 'var(--text-2)' }}>{r}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Rodapé ── */}
      <div
        className="px-5 py-2.5 border-t flex items-center gap-2"
        style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
      >
        <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
          Baseado no código de área (DDD) do número de telefone · não é rastreamento GPS
        </span>
        <span className="ml-auto text-[10px] font-semibold" style={{ color: 'var(--text-3)' }}>
          {contacts.length.toLocaleString('pt-BR')} contatos importados
        </span>
      </div>
    </div>
  );
};
