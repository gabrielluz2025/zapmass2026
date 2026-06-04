import { describe, expect, it } from 'vitest';
import {
  buildCampaignSpintax,
  campaignRotationIndexFromPhone,
  resolveCampaignSpintax
} from './campaignSpintax';

describe('campaignSpintax', () => {
  it('monta bloco com pipe', () => {
    expect(buildCampaignSpintax(['Olá', 'Oi', 'Paz'])).toBe('{Olá|Oi|Paz}');
  });

  it('uma opção retorna texto literal', () => {
    expect(buildCampaignSpintax(['Olá'])).toBe('Olá');
  });

  it('rodízio por índice', () => {
    const tpl = 'Oi {Olá|Oi|Paz}, {nome}!';
    expect(resolveCampaignSpintax(tpl, 0)).toBe('Oi Olá, {nome}!');
    expect(resolveCampaignSpintax(tpl, 1)).toBe('Oi Oi, {nome}!');
    expect(resolveCampaignSpintax(tpl, 2)).toBe('Oi Paz, {nome}!');
    expect(resolveCampaignSpintax(tpl, 3)).toBe('Oi Olá, {nome}!');
  });

  it('índice por telefone é estável', () => {
    expect(campaignRotationIndexFromPhone('5511999887766')).toBe(
      campaignRotationIndexFromPhone('5511999887766')
    );
  });
});
