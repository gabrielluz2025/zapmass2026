/**
 * Brasil Neon — mapa único em colmeia hexagonal por UF.
 * Visual distinto: fundo claro, scan animado, sem Leaflet e sem abas.
 */
import React, { useMemo, useState } from 'react';
import type { CampaignGeoState, Contact } from '../../types';
import { normalizeBrazilPhoneDigits, phoneDigitsToUf } from '../../utils/brazilPhoneGeo';

type Layer = 'contacts' | 'campaign';

type Props = {
  contacts: Contact[];
  campaignGeo: CampaignGeoState;
  isLive?: boolean;
  /** hero = mapa em destaque, controles flutuantes, sem cabeçalho duplicado */
  variant?: 'default' | 'hero';
};

/** Posição aproximada de cada UF no viewBox 0–100 (silhueta do Brasil). */
const UF_LAYOUT: Record<string, { x: number; y: number }> = {
  RR: { x: 54, y: 10 },
  AP: { x: 61, y: 16 },
  AM: { x: 40, y: 20 },
  PA: { x: 50, y: 28 },
  MA: { x: 57, y: 36 },
  TO: { x: 53, y: 44 },
  PI: { x: 61, y: 42 },
  CE: { x: 67, y: 38 },
  RN: { x: 71, y: 36 },
  PB: { x: 73, y: 40 },
  PE: { x: 71, y: 44 },
  AL: { x: 75, y: 46 },
  SE: { x: 73, y: 50 },
  BA: { x: 65, y: 50 },
  RO: { x: 36, y: 46 },
  AC: { x: 30, y: 40 },
  MT: { x: 42, y: 50 },
  MS: { x: 44, y: 60 },
  GO: { x: 50, y: 54 },
  DF: { x: 54, y: 52 },
  MG: { x: 58, y: 56 },
  ES: { x: 62, y: 60 },
  RJ: { x: 64, y: 64 },
  SP: { x: 56, y: 66 },
  PR: { x: 50, y: 70 },
  SC: { x: 52, y: 74 },
  RS: { x: 48, y: 78 },
};

const ALL_UFS = Object.keys(UF_LAYOUT);

function hexPoints(cx: number, cy: number, r: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 30);
    return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
  }).join(' ');
}

function heatColor(intensity: number, layer: Layer): string {
  if (intensity <= 0) return layer === 'contacts' ? '#e8e4df' : '#ebe8e4';
  const t = Math.min(1, intensity);
  if (layer === 'contacts') {
    return `color-mix(in srgb, #14b8a6 ${Math.round(20 + t * 75)}%, #faf8f5)`;
  }
  return `color-mix(in srgb, #f97316 ${Math.round(25 + t * 70)}%, #faf8f5)`;
}

export const BrasilNeonCanvas: React.FC<Props> = ({ contacts, campaignGeo, isLive, variant = 'default' }) => {
  const isHero = variant === 'hero';
  const [layer, setLayer] = useState<Layer>('contacts');
  const [hoverUf, setHoverUf] = useState<string | null>(null);

  const contactByUf = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of contacts) {
      const d = normalizeBrazilPhoneDigits(c.phone || '');
      const uf = d.length >= 10 ? phoneDigitsToUf(d) : null;
      if (!uf || !UF_LAYOUT[uf]) continue;
      m.set(uf, (m.get(uf) ?? 0) + 1);
    }
    return m;
  }, [contacts]);

  const campaignByUf = useMemo(() => {
    const m = new Map<string, number>();
    const byUf = campaignGeo.byUf || {};
    for (const uf of ALL_UFS) {
      const s = byUf[uf];
      if (!s) continue;
      const v = Math.max(0, s.delivered || 0, s.read || 0, s.replied || 0);
      if (v > 0) m.set(uf, v);
    }
    return m;
  }, [campaignGeo.byUf]);

  const values = layer === 'contacts' ? contactByUf : campaignByUf;
  const maxVal = useMemo(() => Math.max(1, ...Array.from(values.values())), [values]);
  const total = useMemo(() => Array.from(values.values()).reduce((a, b) => a + b, 0), [values]);

  const topUfs = useMemo(
    () =>
      ALL_UFS.map((uf) => ({ uf, v: values.get(uf) ?? 0 }))
        .filter((x) => x.v > 0)
        .sort((a, b) => b.v - a.v)
        .slice(0, 5),
    [values]
  );

  const hasCampaign = campaignByUf.size > 0;

  return (
    <div className={`bn-canvas h-full flex flex-col ${isHero ? 'bn-canvas--hero' : ''}`}>
      {!isHero && (
        <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-teal-700/80">Mapa único</p>
            <h3 className="text-[17px] font-black text-stone-900 leading-tight">Colmeia Brasil</h3>
            <p className="text-[11px] text-stone-500 mt-0.5">Um painel — densidade por estado (DDD)</p>
          </div>
          {isLive && (
            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Ao vivo
            </span>
          )}
        </div>
      )}

      <div
        className={
          isHero
            ? 'absolute top-4 right-4 z-20 flex gap-1 p-1 rounded-xl bg-white/90 backdrop-blur-md shadow-lg border border-stone-200/80'
            : 'flex gap-1 p-1 rounded-xl bg-stone-100/90 mb-3 w-fit'
        }
      >
        {(
          [
            { id: 'contacts' as const, label: 'Sua base' },
            { id: 'campaign' as const, label: 'Disparos', disabled: !hasCampaign },
          ] as const
        ).map((opt) => (
          <button
            key={opt.id}
            type="button"
            disabled={'disabled' in opt && opt.disabled}
            onClick={() => setLayer(opt.id)}
            className="px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all disabled:opacity-40"
            style={{
              background: layer === opt.id ? '#fff' : 'transparent',
              color: layer === opt.id ? '#0f766e' : '#78716c',
              boxShadow: layer === opt.id ? '0 2px 8px rgba(0,0,0,0.06)' : 'none',
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div
        className={`relative flex-1 overflow-hidden bn-canvas__stage ${
          isHero ? 'min-h-[320px] rounded-none border-0' : 'min-h-[280px] rounded-2xl'
        }`}
      >
        <div className="bn-canvas__scan" aria-hidden />
        <svg viewBox="0 0 100 88" className="w-full h-full relative z-[1]" role="img" aria-label="Mapa hexagonal do Brasil">
          {ALL_UFS.map((uf) => {
            const pos = UF_LAYOUT[uf];
            const v = values.get(uf) ?? 0;
            const intensity = v / maxVal;
            const r = 3.2 + intensity * 2.8;
            const active = hoverUf === uf;
            return (
              <g key={uf}>
                <polygon
                  points={hexPoints(pos.x, pos.y, r)}
                  fill={heatColor(intensity, layer)}
                  stroke={active ? '#0d9488' : intensity > 0 ? 'rgba(13,148,136,0.35)' : '#d6d3d1'}
                  strokeWidth={active ? 0.55 : 0.35}
                  className="transition-all duration-300 cursor-pointer"
                  onMouseEnter={() => setHoverUf(uf)}
                  onMouseLeave={() => setHoverUf(null)}
                />
                {intensity > 0.35 && (
                  <text
                    x={pos.x}
                    y={pos.y + 0.8}
                    textAnchor="middle"
                    className="pointer-events-none select-none"
                    style={{ fontSize: 2.8, fontWeight: 800, fill: intensity > 0.6 ? '#fff' : '#134e4a' }}
                  >
                    {uf}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {hoverUf && (
          <div className="absolute bottom-3 left-3 right-3 z-10 rounded-xl px-3 py-2 bg-white/95 border border-stone-200 shadow-lg backdrop-blur-sm">
            <p className="text-[12px] font-bold text-stone-900">
              {hoverUf} · {(values.get(hoverUf) ?? 0).toLocaleString('pt-BR')}{' '}
              {layer === 'contacts' ? 'contatos' : 'eventos'}
            </p>
          </div>
        )}
      </div>

      {!isHero && (
        <>
          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="text-[22px] font-black tabular-nums text-stone-900">{total.toLocaleString('pt-BR')}</p>
            <p className="text-[10px] text-stone-500 text-right">
              {layer === 'contacts' ? 'contatos mapeados' : 'retornos por UF'}
            </p>
          </div>

          {topUfs.length > 0 && (
            <ul className="mt-2 space-y-1">
              {topUfs.map(({ uf, v }, i) => (
                <li key={uf} className="flex items-center gap-2 text-[11px]">
                  <span className="w-4 text-stone-400 font-bold tabular-nums">{i + 1}</span>
                  <span className="font-bold text-stone-800 w-6">{uf}</span>
                  <div className="flex-1 h-1 rounded-full bg-stone-200 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-teal-500 transition-all duration-500"
                      style={{ width: `${Math.round((v / maxVal) * 100)}%` }}
                    />
                  </div>
                  <span className="tabular-nums text-stone-600 w-10 text-right">{v.toLocaleString('pt-BR')}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {isHero && isLive && (
        <span className="absolute top-4 left-4 z-20 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/90 text-white shadow-md">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          Ao vivo
        </span>
      )}
    </div>
  );
};
