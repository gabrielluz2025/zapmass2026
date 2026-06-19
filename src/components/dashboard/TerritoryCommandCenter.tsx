/**
 * Territory Command — um único painel geográfico unificado.
 * Substitui DDDPulseMap + CommercialIntelligenceMap + ContactAddressMap + BrazilCampaignMap soltos.
 */
import React, { useMemo, useState } from 'react';
import {
  Activity,
  Globe2,
  MapPin,
  Radio,
  Send,
  Sparkles,
  Target,
  Users,
} from 'lucide-react';
import type { Campaign, CampaignGeoState, Contact } from '../../types';
import { DDDPulseMap } from './DDDPulseMap';
import { CommercialIntelligenceMap } from './CommercialIntelligenceMap';
import { ContactAddressMap } from './ContactAddressMap';
import { BrazilCampaignMap, type GeoLayer } from './BrazilCampaignMap';

type TerritoryMode = 'pulse' | 'intel' | 'pins' | 'blast';

type Props = {
  contacts: Contact[];
  campaigns: Campaign[];
  campaignGeo: CampaignGeoState;
  isLive?: boolean;
};

const MODES: Array<{
  id: TerritoryMode;
  label: string;
  hint: string;
  icon: React.ReactNode;
}> = [
  { id: 'pulse', label: 'Pulso DDD', hint: 'Base por código de área', icon: <Globe2 className="w-3.5 h-3.5" /> },
  { id: 'intel', label: 'Intel', hint: 'Conversão por região', icon: <Target className="w-3.5 h-3.5" /> },
  { id: 'pins', label: 'Endereços', hint: 'Pins no mapa real', icon: <MapPin className="w-3.5 h-3.5" /> },
  { id: 'blast', label: 'Disparos', hint: 'Cobertura de campanha', icon: <Send className="w-3.5 h-3.5" /> },
];

export const TerritoryCommandCenter: React.FC<Props> = ({
  contacts,
  campaigns,
  campaignGeo,
  isLive = false,
}) => {
  const [mode, setMode] = useState<TerritoryMode>('pulse');
  const [geoLayer, setGeoLayer] = useState<GeoLayer>('delivered');

  const hasCampaignGeo = Object.keys(campaignGeo.byUf || {}).length > 0;

  const headline = useMemo(() => {
    const running = campaigns.filter((c) => c.status === 'RUNNING').length;
    return {
      contacts: contacts.length,
      campaigns: campaigns.length,
      running,
      states: new Set(
        contacts
          .map((c) => String(c.phone || '').replace(/\D/g, '').slice(0, 2))
          .filter((d) => d.length === 2)
      ).size,
    };
  }, [contacts, campaigns]);

  return (
    <section
      className="zm-dash-section rounded-[28px] overflow-hidden relative"
      style={{
        background: 'linear-gradient(155deg, #07080f 0%, #0f1224 42%, #0a1420 100%)',
        border: '1px solid rgba(99,102,241,0.22)',
        boxShadow: '0 32px 80px -40px rgba(99,102,241,0.45)',
      }}
    >
      {/* Grid decorativo */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.35]"
        aria-hidden
        style={{
          backgroundImage:
            'linear-gradient(rgba(99,102,241,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.08) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
          maskImage: 'radial-gradient(ellipse 80% 70% at 50% 0%, black, transparent)',
        }}
      />

      <div className="relative px-5 sm:px-7 pt-6 pb-5">
        <div className="flex flex-col lg:flex-row lg:items-end gap-5 mb-5">
          <div className="flex-1 min-w-0">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full mb-3"
              style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.35)' }}>
              <Sparkles className="w-3 h-3  /**
 * Territory Command — um único painel geográfico unificado.
 * Substitui DDDPulseMap + CommercialIntelligenceMap + ContactAddressMap + BrazilCampaignMap soltos.
 */
import React, { useMemo, useState } from 'react';
import {
  Activity,
  Globe2,
  MapPin,
  Radio,
  Send,
  Sparkles,
  Target,
  Users,
} from 'lucide-react';
import type { Campaign, CampaignGeoState, Contact } from '../../types';
import { DDDPulseMap } from './DDDPulseMap';
import { CommercialIntelligenceMap } from './CommercialIntelligenceMap';
import { ContactAddressMap } from './ContactAddressMap';
import { BrazilCampaignMap, type GeoLayer } from './BrazilCampaignMap';

type TerritoryMode = 'pulse' | 'intel' | 'pins' | 'blast';

type Props = {
  contacts: Contact[];
  campaigns: Campaign[];
  campaignGeo: CampaignGeoState;
  isLive?: boolean;
};

const MODES: Array<{
  id: TerritoryMode;
  label: string;
  hint: string;
  icon: React.ReactNode;
}> = [
  { id: 'pulse', label: 'Pulso DDD', hint: 'Base por código de área', icon: <Globe2 className="w-3.5 h-3.5" /> },
  { id: 'intel', label: 'Intel', hint: 'Conversão por região', icon: <Target className="w-3.5 h-3.5" /> },
  { id: 'pins', label: 'Endereços', hint: 'Pins no mapa real', icon: <MapPin className="w-3.5 h-3.5" /> },
  { id: 'blast', label: 'Disparos', hint: 'Cobertura de campanha', icon: <Send className="w-3.5 h-3.5" /> },
];

export const TerritoryCommandCenter: React.FC<Props> = ({
  contacts,
  campaigns,
  campaignGeo,
  isLive = false,
}) => {
  const [mode, setMode] = useState<TerritoryMode>('pulse');
  const [geoLayer, setGeoLayer] = useState<GeoLayer>('delivered');

  const hasCampaignGeo = Object.keys(campaignGeo.byUf || {}).length > 0;

  const headline = useMemo(() => {
    const running = campaigns.filter((c) => c.status === 'RUNNING').length;
    return {
      contacts: contacts.length,
      campaigns: campaigns.length,
      running,
      states: new Set(
        contacts
          .map((c) => String(c.phone || '').replace(/\D/g, '').slice(0, 2))
          .filter((d) => d.length === 2)
      ).size,
    };
  }, [contacts, campaigns]);

  return (
    <section
      className="zm-dash-section rounded-[28px] overflow-hidden relative"
      style={{
        background: 'linear-gradient(155deg, #07080f 0%, #0f1224 42%, #0a1420 100%)',
        border: '1px solid rgba(99,102,241,0.22)',
        boxShadow: '0 32px 80px -40px rgba(99,102,241,0.45)',
      }}
    >
      {/* Grid decorativo */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.35]"
        aria-hidden
        style={{
          backgroundImage:
            'linear-gradient(rgba(99,102,241,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.08) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
          maskImage: 'radial-gradient(ellipse 80% 70% at 50% 0%, black, transparent)',
        }}
      />

      <div className="relative px-5 sm:px-7 pt-6 pb-5">
        <div className="flex flex-col lg:flex-row lg:items-end gap-5 mb-5">
          <div className="flex-1 min-w-0">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full mb-3"
              style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.35)' }}>
              <Sparkles className="w-3 h-3 text-cyan-300" />
              <span className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-indigo-200">
                Territory Command
              </span>
              {isLive && (
                <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  live
                </span>
              )}
            </div>
            <h2 className="text-[22px] sm:text-[26px] font-black text-white leading-tight">
              Mapa único do seu território
            </h2>
            <p className="text-[12.5px] mt-1 max-w-xl" style={{ color: 'rgba(226,232,240,0.65)' }}>
              Pulso nacional, inteligência comercial, endereços e cobertura de disparo — tudo no mesmo cockpit, sem mapas duplicados.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {[
              { icon: <Users className="w-3.5 h-3.5" />, label: 'Contatos', val: headline.contacts },
              { icon: <Radio className="w-3.5 h-3.5" />, label: 'Campanhas', val: headline.campaigns },
              { icon: <Activity className="w-3.5 h-3.5" />, label: 'Ao vivo', val: headline.running },
            ].map((k) => (
              <div
                key={k.label}
                className="flex items-center gap-2 px-3 py-2 rounded-xl min-w-[110px]"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <span className="text-cyan-300">{k.icon}</span>
                <div>
                  <p className="text-[9px] uppercase tracking-wider font-bold text-slate-500">{k.label}</p>
                  <p className="text-[15px] font-black tabular-nums text-white">{k.val.toLocaleString('pt-BR')}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Modos */}
        <div
          className="flex gap-1 p-1 rounded-2xl overflow-x-auto mb-4"
          style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          {MODES.map((m) => {
            const active = mode === m.id;
            const disabled = m.id === 'blast' && !hasCampaignGeo;
            return (
              <button
                key={m.id}
                type="button"
                disabled={disabled}
                onClick={() => setMode(m.id)}
                className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl shrink-0 transition-all disabled:opacity-35"
                style={{
                  background: active ? 'linear-gradient(135deg, rgba(99,102,241,0.35), rgba(6,182,212,0.2))' : 'transparent',
                  border: active ? '1px solid rgba(129,140,248,0.5)' : '1px solid transparent',
                  color: active ? '#e0e7ff' : 'rgba(148,163,184,0.9)',
                  boxShadow: active ? '0 8px 24px -8px rgba(99,102,241,0.55)' : 'none',
                }}
              >
                {m.icon}
                <span className="text-left">
                  <span className="block text-[12px] font-bold leading-none">{m.label}</span>
                  <span className="block text-[9px] opacity-70 mt-0.5">{m.hint}</span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Viewport único */}
        <div
          className="rounded-2xl overflow-hidden min-h-[460px]"
          style={{
            background: 'rgba(15,23,42,0.55)',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
          }}
        >
          {mode === 'pulse' && (
            <DDDPulseMap contacts={contacts} campaigns={campaigns} isLive={isLive} embedded />
          )}
          {mode === 'intel' && <CommercialIntelligenceMap embedded />}
          {mode === 'pins' && <ContactAddressMap embedded />}
          {mode === 'blast' && hasCampaignGeo && (
            <div className="p-4 sm:p-5">
              <BrazilCampaignMap
                byUf={campaignGeo.byUf}
                layer={geoLayer}
                onLayerChange={setGeoLayer}
                isLive={false}
                campaignLabel={campaignGeo.campaignId ?? undefined}
                updatedAt={campaignGeo.updatedAt}
              />
            </div>
          )}
          {mode === 'blast' && !hasCampaignGeo && (
            <div className="flex flex-col items-center justify-center min-h-[460px] gap-3 px-6 text-center">
              <Send className="w-10 h-10 text-cyan-400 opacity-60" />
              <p className="text-[14px] font-bold text-white">Nenhum disparo geolocalizado ainda</p>
              <p className="text-[12px] max-w-sm" style={{ color: 'rgba(148,163,184,0.85)' }}>
                Quando uma campanha estiver em execução ou concluída, a cobertura por estado aparece aqui.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
.Value -replace 'indigo', 'cyan' " />
              <span className="text-[10px] font-extrabold uppercase tracking-[0.18em]  /**
 * Territory Command — um único painel geográfico unificado.
 * Substitui DDDPulseMap + CommercialIntelligenceMap + ContactAddressMap + BrazilCampaignMap soltos.
 */
import React, { useMemo, useState } from 'react';
import {
  Activity,
  Globe2,
  MapPin,
  Radio,
  Send,
  Sparkles,
  Target,
  Users,
} from 'lucide-react';
import type { Campaign, CampaignGeoState, Contact } from '../../types';
import { DDDPulseMap } from './DDDPulseMap';
import { CommercialIntelligenceMap } from './CommercialIntelligenceMap';
import { ContactAddressMap } from './ContactAddressMap';
import { BrazilCampaignMap, type GeoLayer } from './BrazilCampaignMap';

type TerritoryMode = 'pulse' | 'intel' | 'pins' | 'blast';

type Props = {
  contacts: Contact[];
  campaigns: Campaign[];
  campaignGeo: CampaignGeoState;
  isLive?: boolean;
};

const MODES: Array<{
  id: TerritoryMode;
  label: string;
  hint: string;
  icon: React.ReactNode;
}> = [
  { id: 'pulse', label: 'Pulso DDD', hint: 'Base por código de área', icon: <Globe2 className="w-3.5 h-3.5" /> },
  { id: 'intel', label: 'Intel', hint: 'Conversão por região', icon: <Target className="w-3.5 h-3.5" /> },
  { id: 'pins', label: 'Endereços', hint: 'Pins no mapa real', icon: <MapPin className="w-3.5 h-3.5" /> },
  { id: 'blast', label: 'Disparos', hint: 'Cobertura de campanha', icon: <Send className="w-3.5 h-3.5" /> },
];

export const TerritoryCommandCenter: React.FC<Props> = ({
  contacts,
  campaigns,
  campaignGeo,
  isLive = false,
}) => {
  const [mode, setMode] = useState<TerritoryMode>('pulse');
  const [geoLayer, setGeoLayer] = useState<GeoLayer>('delivered');

  const hasCampaignGeo = Object.keys(campaignGeo.byUf || {}).length > 0;

  const headline = useMemo(() => {
    const running = campaigns.filter((c) => c.status === 'RUNNING').length;
    return {
      contacts: contacts.length,
      campaigns: campaigns.length,
      running,
      states: new Set(
        contacts
          .map((c) => String(c.phone || '').replace(/\D/g, '').slice(0, 2))
          .filter((d) => d.length === 2)
      ).size,
    };
  }, [contacts, campaigns]);

  return (
    <section
      className="zm-dash-section rounded-[28px] overflow-hidden relative"
      style={{
        background: 'linear-gradient(155deg, #07080f 0%, #0f1224 42%, #0a1420 100%)',
        border: '1px solid rgba(99,102,241,0.22)',
        boxShadow: '0 32px 80px -40px rgba(99,102,241,0.45)',
      }}
    >
      {/* Grid decorativo */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.35]"
        aria-hidden
        style={{
          backgroundImage:
            'linear-gradient(rgba(99,102,241,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.08) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
          maskImage: 'radial-gradient(ellipse 80% 70% at 50% 0%, black, transparent)',
        }}
      />

      <div className="relative px-5 sm:px-7 pt-6 pb-5">
        <div className="flex flex-col lg:flex-row lg:items-end gap-5 mb-5">
          <div className="flex-1 min-w-0">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full mb-3"
              style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.35)' }}>
              <Sparkles className="w-3 h-3 text-cyan-300" />
              <span className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-indigo-200">
                Territory Command
              </span>
              {isLive && (
                <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  live
                </span>
              )}
            </div>
            <h2 className="text-[22px] sm:text-[26px] font-black text-white leading-tight">
              Mapa único do seu território
            </h2>
            <p className="text-[12.5px] mt-1 max-w-xl" style={{ color: 'rgba(226,232,240,0.65)' }}>
              Pulso nacional, inteligência comercial, endereços e cobertura de disparo — tudo no mesmo cockpit, sem mapas duplicados.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {[
              { icon: <Users className="w-3.5 h-3.5" />, label: 'Contatos', val: headline.contacts },
              { icon: <Radio className="w-3.5 h-3.5" />, label: 'Campanhas', val: headline.campaigns },
              { icon: <Activity className="w-3.5 h-3.5" />, label: 'Ao vivo', val: headline.running },
            ].map((k) => (
              <div
                key={k.label}
                className="flex items-center gap-2 px-3 py-2 rounded-xl min-w-[110px]"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <span className="text-cyan-300">{k.icon}</span>
                <div>
                  <p className="text-[9px] uppercase tracking-wider font-bold text-slate-500">{k.label}</p>
                  <p className="text-[15px] font-black tabular-nums text-white">{k.val.toLocaleString('pt-BR')}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Modos */}
        <div
          className="flex gap-1 p-1 rounded-2xl overflow-x-auto mb-4"
          style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          {MODES.map((m) => {
            const active = mode === m.id;
            const disabled = m.id === 'blast' && !hasCampaignGeo;
            return (
              <button
                key={m.id}
                type="button"
                disabled={disabled}
                onClick={() => setMode(m.id)}
                className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl shrink-0 transition-all disabled:opacity-35"
                style={{
                  background: active ? 'linear-gradient(135deg, rgba(99,102,241,0.35), rgba(6,182,212,0.2))' : 'transparent',
                  border: active ? '1px solid rgba(129,140,248,0.5)' : '1px solid transparent',
                  color: active ? '#e0e7ff' : 'rgba(148,163,184,0.9)',
                  boxShadow: active ? '0 8px 24px -8px rgba(99,102,241,0.55)' : 'none',
                }}
              >
                {m.icon}
                <span className="text-left">
                  <span className="block text-[12px] font-bold leading-none">{m.label}</span>
                  <span className="block text-[9px] opacity-70 mt-0.5">{m.hint}</span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Viewport único */}
        <div
          className="rounded-2xl overflow-hidden min-h-[460px]"
          style={{
            background: 'rgba(15,23,42,0.55)',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
          }}
        >
          {mode === 'pulse' && (
            <DDDPulseMap contacts={contacts} campaigns={campaigns} isLive={isLive} embedded />
          )}
          {mode === 'intel' && <CommercialIntelligenceMap embedded />}
          {mode === 'pins' && <ContactAddressMap embedded />}
          {mode === 'blast' && hasCampaignGeo && (
            <div className="p-4 sm:p-5">
              <BrazilCampaignMap
                byUf={campaignGeo.byUf}
                layer={geoLayer}
                onLayerChange={setGeoLayer}
                isLive={false}
                campaignLabel={campaignGeo.campaignId ?? undefined}
                updatedAt={campaignGeo.updatedAt}
              />
            </div>
          )}
          {mode === 'blast' && !hasCampaignGeo && (
            <div className="flex flex-col items-center justify-center min-h-[460px] gap-3 px-6 text-center">
              <Send className="w-10 h-10 text-cyan-400 opacity-60" />
              <p className="text-[14px] font-bold text-white">Nenhum disparo geolocalizado ainda</p>
              <p className="text-[12px] max-w-sm" style={{ color: 'rgba(148,163,184,0.85)' }}>
                Quando uma campanha estiver em execução ou concluída, a cobertura por estado aparece aqui.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
.Value -replace 'indigo', 'cyan' ">
                Territory Command
              </span>
              {isLive && (
                <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  live
                </span>
              )}
            </div>
            <h2 className="text-[22px] sm:text-[26px] font-black text-white leading-tight">
              Mapa único do seu território
            </h2>
            <p className="text-[12.5px] mt-1 max-w-xl" style={{ color: 'rgba(226,232,240,0.65)' }}>
              Pulso nacional, inteligência comercial, endereços e cobertura de disparo — tudo no mesmo cockpit, sem mapas duplicados.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {[
              { icon: <Users className="w-3.5 h-3.5" />, label: 'Contatos', val: headline.contacts },
              { icon: <Radio className="w-3.5 h-3.5" />, label: 'Campanhas', val: headline.campaigns },
              { icon: <Activity className="w-3.5 h-3.5" />, label: 'Ao vivo', val: headline.running },
            ].map((k) => (
              <div
                key={k.label}
                className="flex items-center gap-2 px-3 py-2 rounded-xl min-w-[110px]"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <span className=" /**
 * Territory Command — um único painel geográfico unificado.
 * Substitui DDDPulseMap + CommercialIntelligenceMap + ContactAddressMap + BrazilCampaignMap soltos.
 */
import React, { useMemo, useState } from 'react';
import {
  Activity,
  Globe2,
  MapPin,
  Radio,
  Send,
  Sparkles,
  Target,
  Users,
} from 'lucide-react';
import type { Campaign, CampaignGeoState, Contact } from '../../types';
import { DDDPulseMap } from './DDDPulseMap';
import { CommercialIntelligenceMap } from './CommercialIntelligenceMap';
import { ContactAddressMap } from './ContactAddressMap';
import { BrazilCampaignMap, type GeoLayer } from './BrazilCampaignMap';

type TerritoryMode = 'pulse' | 'intel' | 'pins' | 'blast';

type Props = {
  contacts: Contact[];
  campaigns: Campaign[];
  campaignGeo: CampaignGeoState;
  isLive?: boolean;
};

const MODES: Array<{
  id: TerritoryMode;
  label: string;
  hint: string;
  icon: React.ReactNode;
}> = [
  { id: 'pulse', label: 'Pulso DDD', hint: 'Base por código de área', icon: <Globe2 className="w-3.5 h-3.5" /> },
  { id: 'intel', label: 'Intel', hint: 'Conversão por região', icon: <Target className="w-3.5 h-3.5" /> },
  { id: 'pins', label: 'Endereços', hint: 'Pins no mapa real', icon: <MapPin className="w-3.5 h-3.5" /> },
  { id: 'blast', label: 'Disparos', hint: 'Cobertura de campanha', icon: <Send className="w-3.5 h-3.5" /> },
];

export const TerritoryCommandCenter: React.FC<Props> = ({
  contacts,
  campaigns,
  campaignGeo,
  isLive = false,
}) => {
  const [mode, setMode] = useState<TerritoryMode>('pulse');
  const [geoLayer, setGeoLayer] = useState<GeoLayer>('delivered');

  const hasCampaignGeo = Object.keys(campaignGeo.byUf || {}).length > 0;

  const headline = useMemo(() => {
    const running = campaigns.filter((c) => c.status === 'RUNNING').length;
    return {
      contacts: contacts.length,
      campaigns: campaigns.length,
      running,
      states: new Set(
        contacts
          .map((c) => String(c.phone || '').replace(/\D/g, '').slice(0, 2))
          .filter((d) => d.length === 2)
      ).size,
    };
  }, [contacts, campaigns]);

  return (
    <section
      className="zm-dash-section rounded-[28px] overflow-hidden relative"
      style={{
        background: 'linear-gradient(155deg, #07080f 0%, #0f1224 42%, #0a1420 100%)',
        border: '1px solid rgba(99,102,241,0.22)',
        boxShadow: '0 32px 80px -40px rgba(99,102,241,0.45)',
      }}
    >
      {/* Grid decorativo */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.35]"
        aria-hidden
        style={{
          backgroundImage:
            'linear-gradient(rgba(99,102,241,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.08) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
          maskImage: 'radial-gradient(ellipse 80% 70% at 50% 0%, black, transparent)',
        }}
      />

      <div className="relative px-5 sm:px-7 pt-6 pb-5">
        <div className="flex flex-col lg:flex-row lg:items-end gap-5 mb-5">
          <div className="flex-1 min-w-0">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full mb-3"
              style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.35)' }}>
              <Sparkles className="w-3 h-3 text-cyan-300" />
              <span className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-indigo-200">
                Territory Command
              </span>
              {isLive && (
                <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  live
                </span>
              )}
            </div>
            <h2 className="text-[22px] sm:text-[26px] font-black text-white leading-tight">
              Mapa único do seu território
            </h2>
            <p className="text-[12.5px] mt-1 max-w-xl" style={{ color: 'rgba(226,232,240,0.65)' }}>
              Pulso nacional, inteligência comercial, endereços e cobertura de disparo — tudo no mesmo cockpit, sem mapas duplicados.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {[
              { icon: <Users className="w-3.5 h-3.5" />, label: 'Contatos', val: headline.contacts },
              { icon: <Radio className="w-3.5 h-3.5" />, label: 'Campanhas', val: headline.campaigns },
              { icon: <Activity className="w-3.5 h-3.5" />, label: 'Ao vivo', val: headline.running },
            ].map((k) => (
              <div
                key={k.label}
                className="flex items-center gap-2 px-3 py-2 rounded-xl min-w-[110px]"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <span className="text-cyan-300">{k.icon}</span>
                <div>
                  <p className="text-[9px] uppercase tracking-wider font-bold text-slate-500">{k.label}</p>
                  <p className="text-[15px] font-black tabular-nums text-white">{k.val.toLocaleString('pt-BR')}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Modos */}
        <div
          className="flex gap-1 p-1 rounded-2xl overflow-x-auto mb-4"
          style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          {MODES.map((m) => {
            const active = mode === m.id;
            const disabled = m.id === 'blast' && !hasCampaignGeo;
            return (
              <button
                key={m.id}
                type="button"
                disabled={disabled}
                onClick={() => setMode(m.id)}
                className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl shrink-0 transition-all disabled:opacity-35"
                style={{
                  background: active ? 'linear-gradient(135deg, rgba(99,102,241,0.35), rgba(6,182,212,0.2))' : 'transparent',
                  border: active ? '1px solid rgba(129,140,248,0.5)' : '1px solid transparent',
                  color: active ? '#e0e7ff' : 'rgba(148,163,184,0.9)',
                  boxShadow: active ? '0 8px 24px -8px rgba(99,102,241,0.55)' : 'none',
                }}
              >
                {m.icon}
                <span className="text-left">
                  <span className="block text-[12px] font-bold leading-none">{m.label}</span>
                  <span className="block text-[9px] opacity-70 mt-0.5">{m.hint}</span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Viewport único */}
        <div
          className="rounded-2xl overflow-hidden min-h-[460px]"
          style={{
            background: 'rgba(15,23,42,0.55)',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
          }}
        >
          {mode === 'pulse' && (
            <DDDPulseMap contacts={contacts} campaigns={campaigns} isLive={isLive} embedded />
          )}
          {mode === 'intel' && <CommercialIntelligenceMap embedded />}
          {mode === 'pins' && <ContactAddressMap embedded />}
          {mode === 'blast' && hasCampaignGeo && (
            <div className="p-4 sm:p-5">
              <BrazilCampaignMap
                byUf={campaignGeo.byUf}
                layer={geoLayer}
                onLayerChange={setGeoLayer}
                isLive={false}
                campaignLabel={campaignGeo.campaignId ?? undefined}
                updatedAt={campaignGeo.updatedAt}
              />
            </div>
          )}
          {mode === 'blast' && !hasCampaignGeo && (
            <div className="flex flex-col items-center justify-center min-h-[460px] gap-3 px-6 text-center">
              <Send className="w-10 h-10 text-cyan-400 opacity-60" />
              <p className="text-[14px] font-bold text-white">Nenhum disparo geolocalizado ainda</p>
              <p className="text-[12px] max-w-sm" style={{ color: 'rgba(148,163,184,0.85)' }}>
                Quando uma campanha estiver em execução ou concluída, a cobertura por estado aparece aqui.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
.Value -replace 'indigo', 'cyan' ">{k.icon}</span>
                <div>
                  <p className="text-[9px] uppercase tracking-wider font-bold text-slate-500">{k.label}</p>
                  <p className="text-[15px] font-black tabular-nums text-white">{k.val.toLocaleString('pt-BR')}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Modos */}
        <div
          className="flex gap-1 p-1 rounded-2xl overflow-x-auto mb-4"
          style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          {MODES.map((m) => {
            const active = mode === m.id;
            const disabled = m.id === 'blast' && !hasCampaignGeo;
            return (
              <button
                key={m.id}
                type="button"
                disabled={disabled}
                onClick={() => setMode(m.id)}
                className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl shrink-0 transition-all disabled:opacity-35"
                style={{
                  background: active ? 'linear-gradient(135deg, rgba(99,102,241,0.35), rgba(6,182,212,0.2))' : 'transparent',
                  border: active ? '1px solid rgba(129,140,248,0.5)' : '1px solid transparent',
                  color: active ? '#e0e7ff' : 'rgba(148,163,184,0.9)',
                  boxShadow: active ? '0 8px 24px -8px rgba(99,102,241,0.55)' : 'none',
                }}
              >
                {m.icon}
                <span className="text-left">
                  <span className="block text-[12px] font-bold leading-none">{m.label}</span>
                  <span className="block text-[9px] opacity-70 mt-0.5">{m.hint}</span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Viewport único */}
        <div
          className="rounded-2xl overflow-hidden min-h-[460px]"
          style={{
            background: 'rgba(15,23,42,0.55)',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
          }}
        >
          {mode === 'pulse' && (
            <DDDPulseMap contacts={contacts} campaigns={campaigns} isLive={isLive} embedded />
          )}
          {mode === 'intel' && <CommercialIntelligenceMap embedded />}
          {mode === 'pins' && <ContactAddressMap embedded />}
          {mode === 'blast' && hasCampaignGeo && (
            <div className="p-4 sm:p-5">
              <BrazilCampaignMap
                byUf={campaignGeo.byUf}
                layer={geoLayer}
                onLayerChange={setGeoLayer}
                isLive={false}
                campaignLabel={campaignGeo.campaignId ?? undefined}
                updatedAt={campaignGeo.updatedAt}
              />
            </div>
          )}
          {mode === 'blast' && !hasCampaignGeo && (
            <div className="flex flex-col items-center justify-center min-h-[460px] gap-3 px-6 text-center">
              <Send className="w-10 h-10  /**
 * Territory Command — um único painel geográfico unificado.
 * Substitui DDDPulseMap + CommercialIntelligenceMap + ContactAddressMap + BrazilCampaignMap soltos.
 */
import React, { useMemo, useState } from 'react';
import {
  Activity,
  Globe2,
  MapPin,
  Radio,
  Send,
  Sparkles,
  Target,
  Users,
} from 'lucide-react';
import type { Campaign, CampaignGeoState, Contact } from '../../types';
import { DDDPulseMap } from './DDDPulseMap';
import { CommercialIntelligenceMap } from './CommercialIntelligenceMap';
import { ContactAddressMap } from './ContactAddressMap';
import { BrazilCampaignMap, type GeoLayer } from './BrazilCampaignMap';

type TerritoryMode = 'pulse' | 'intel' | 'pins' | 'blast';

type Props = {
  contacts: Contact[];
  campaigns: Campaign[];
  campaignGeo: CampaignGeoState;
  isLive?: boolean;
};

const MODES: Array<{
  id: TerritoryMode;
  label: string;
  hint: string;
  icon: React.ReactNode;
}> = [
  { id: 'pulse', label: 'Pulso DDD', hint: 'Base por código de área', icon: <Globe2 className="w-3.5 h-3.5" /> },
  { id: 'intel', label: 'Intel', hint: 'Conversão por região', icon: <Target className="w-3.5 h-3.5" /> },
  { id: 'pins', label: 'Endereços', hint: 'Pins no mapa real', icon: <MapPin className="w-3.5 h-3.5" /> },
  { id: 'blast', label: 'Disparos', hint: 'Cobertura de campanha', icon: <Send className="w-3.5 h-3.5" /> },
];

export const TerritoryCommandCenter: React.FC<Props> = ({
  contacts,
  campaigns,
  campaignGeo,
  isLive = false,
}) => {
  const [mode, setMode] = useState<TerritoryMode>('pulse');
  const [geoLayer, setGeoLayer] = useState<GeoLayer>('delivered');

  const hasCampaignGeo = Object.keys(campaignGeo.byUf || {}).length > 0;

  const headline = useMemo(() => {
    const running = campaigns.filter((c) => c.status === 'RUNNING').length;
    return {
      contacts: contacts.length,
      campaigns: campaigns.length,
      running,
      states: new Set(
        contacts
          .map((c) => String(c.phone || '').replace(/\D/g, '').slice(0, 2))
          .filter((d) => d.length === 2)
      ).size,
    };
  }, [contacts, campaigns]);

  return (
    <section
      className="zm-dash-section rounded-[28px] overflow-hidden relative"
      style={{
        background: 'linear-gradient(155deg, #07080f 0%, #0f1224 42%, #0a1420 100%)',
        border: '1px solid rgba(99,102,241,0.22)',
        boxShadow: '0 32px 80px -40px rgba(99,102,241,0.45)',
      }}
    >
      {/* Grid decorativo */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.35]"
        aria-hidden
        style={{
          backgroundImage:
            'linear-gradient(rgba(99,102,241,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.08) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
          maskImage: 'radial-gradient(ellipse 80% 70% at 50% 0%, black, transparent)',
        }}
      />

      <div className="relative px-5 sm:px-7 pt-6 pb-5">
        <div className="flex flex-col lg:flex-row lg:items-end gap-5 mb-5">
          <div className="flex-1 min-w-0">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full mb-3"
              style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.35)' }}>
              <Sparkles className="w-3 h-3 text-cyan-300" />
              <span className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-indigo-200">
                Territory Command
              </span>
              {isLive && (
                <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  live
                </span>
              )}
            </div>
            <h2 className="text-[22px] sm:text-[26px] font-black text-white leading-tight">
              Mapa único do seu território
            </h2>
            <p className="text-[12.5px] mt-1 max-w-xl" style={{ color: 'rgba(226,232,240,0.65)' }}>
              Pulso nacional, inteligência comercial, endereços e cobertura de disparo — tudo no mesmo cockpit, sem mapas duplicados.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {[
              { icon: <Users className="w-3.5 h-3.5" />, label: 'Contatos', val: headline.contacts },
              { icon: <Radio className="w-3.5 h-3.5" />, label: 'Campanhas', val: headline.campaigns },
              { icon: <Activity className="w-3.5 h-3.5" />, label: 'Ao vivo', val: headline.running },
            ].map((k) => (
              <div
                key={k.label}
                className="flex items-center gap-2 px-3 py-2 rounded-xl min-w-[110px]"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <span className="text-cyan-300">{k.icon}</span>
                <div>
                  <p className="text-[9px] uppercase tracking-wider font-bold text-slate-500">{k.label}</p>
                  <p className="text-[15px] font-black tabular-nums text-white">{k.val.toLocaleString('pt-BR')}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Modos */}
        <div
          className="flex gap-1 p-1 rounded-2xl overflow-x-auto mb-4"
          style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          {MODES.map((m) => {
            const active = mode === m.id;
            const disabled = m.id === 'blast' && !hasCampaignGeo;
            return (
              <button
                key={m.id}
                type="button"
                disabled={disabled}
                onClick={() => setMode(m.id)}
                className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl shrink-0 transition-all disabled:opacity-35"
                style={{
                  background: active ? 'linear-gradient(135deg, rgba(99,102,241,0.35), rgba(6,182,212,0.2))' : 'transparent',
                  border: active ? '1px solid rgba(129,140,248,0.5)' : '1px solid transparent',
                  color: active ? '#e0e7ff' : 'rgba(148,163,184,0.9)',
                  boxShadow: active ? '0 8px 24px -8px rgba(99,102,241,0.55)' : 'none',
                }}
              >
                {m.icon}
                <span className="text-left">
                  <span className="block text-[12px] font-bold leading-none">{m.label}</span>
                  <span className="block text-[9px] opacity-70 mt-0.5">{m.hint}</span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Viewport único */}
        <div
          className="rounded-2xl overflow-hidden min-h-[460px]"
          style={{
            background: 'rgba(15,23,42,0.55)',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
          }}
        >
          {mode === 'pulse' && (
            <DDDPulseMap contacts={contacts} campaigns={campaigns} isLive={isLive} embedded />
          )}
          {mode === 'intel' && <CommercialIntelligenceMap embedded />}
          {mode === 'pins' && <ContactAddressMap embedded />}
          {mode === 'blast' && hasCampaignGeo && (
            <div className="p-4 sm:p-5">
              <BrazilCampaignMap
                byUf={campaignGeo.byUf}
                layer={geoLayer}
                onLayerChange={setGeoLayer}
                isLive={false}
                campaignLabel={campaignGeo.campaignId ?? undefined}
                updatedAt={campaignGeo.updatedAt}
              />
            </div>
          )}
          {mode === 'blast' && !hasCampaignGeo && (
            <div className="flex flex-col items-center justify-center min-h-[460px] gap-3 px-6 text-center">
              <Send className="w-10 h-10 text-cyan-400 opacity-60" />
              <p className="text-[14px] font-bold text-white">Nenhum disparo geolocalizado ainda</p>
              <p className="text-[12px] max-w-sm" style={{ color: 'rgba(148,163,184,0.85)' }}>
                Quando uma campanha estiver em execução ou concluída, a cobertura por estado aparece aqui.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
.Value -replace 'indigo', 'cyan'  opacity-60" />
              <p className="text-[14px] font-bold text-white">Nenhum disparo geolocalizado ainda</p>
              <p className="text-[12px] max-w-sm" style={{ color: 'rgba(148,163,184,0.85)' }}>
                Quando uma campanha estiver em execução ou concluída, a cobertura por estado aparece aqui.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
