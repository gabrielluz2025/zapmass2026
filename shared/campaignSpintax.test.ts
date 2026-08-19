import { describe, expect, it } from 'vitest';
import {
  analyzeCampaignSpintax,
  buildCampaignSpintax,
  campaignRotationIndexFromPhone,
  countCampaignSpintaxVariations,
  extractCampaignSpintaxBlocks,
  resolveCampaignSpintax,
} from './campaignSpintax';

describe('campaignSpintax', () => {
  it('monta bloco com pipe', () => {
    expect(buildCampaignSpintax(['Olá', 'Oi', 'Paz'])).toBe('{Olá|Oi|Paz}');
  });

  it('uma opção retorna texto literal', () => {
    expect(buildCampaignSpintax(['Olá'])).toBe('Olá');
  });

  it('remove linhas e espaços extras ao montar o bloco', () => {
    expect(buildCampaignSpintax(['  Olá  ', 'Oi\n', '', ' Paz '])).toBe('{Olá|Oi|Paz}');
  });

  it('preserva um pipe literal dentro de uma opção', () => {
    const token = buildCampaignSpintax(['Sim | agora', 'Não']);
    expect(token).toBe('{Sim ｜ agora|Não}');
    expect(resolveCampaignSpintax(token!, 0)).toBe('Sim | agora');
    expect(resolveCampaignSpintax(token!, 1)).toBe('Não');
  });

  it('rodízio por índice sem alterar variáveis simples', () => {
    const tpl = '{Olá|Oi|Paz}, {nome}!';
    expect(resolveCampaignSpintax(tpl, 0)).toBe('Olá, {nome}!');
    expect(resolveCampaignSpintax(tpl, 1)).toBe('Oi, {nome}!');
    expect(resolveCampaignSpintax(tpl, 2)).toBe('Paz, {nome}!');
    expect(resolveCampaignSpintax(tpl, 3)).toBe('Olá, {nome}!');
  });

  it('resolve múltiplos blocos com o mesmo índice', () => {
    expect(resolveCampaignSpintax('{Olá|Oi}, {nome}! {Tudo bem?|Como você está?}', 1)).toBe(
      'Oi, {nome}! Como você está?'
    );
  });

  it('não trata variáveis como SpinTrax', () => {
    const result = analyzeCampaignSpintax('Olá {nome}, sua cidade é {cidade}.');
    expect(result.blocks).toHaveLength(0);
    expect(result.variations).toBe(1);
    expect(result.sample).toBe('Olá {nome}, sua cidade é {cidade}.');
  });

  it('conta o produto de todos os blocos', () => {
    expect(countCampaignSpintaxVariations('{A|B} {1|2|3}')).toBe(6);
  });

  it('extrai posições dos blocos para a interface', () => {
    expect(extractCampaignSpintaxBlocks('X {A|B} Y')).toEqual([
      { raw: '{A|B}', options: ['A', 'B'], start: 2, end: 7 },
    ]);
  });

  it('índice por telefone é estável', () => {
    expect(campaignRotationIndexFromPhone('5511999887766')).toBe(
      campaignRotationIndexFromPhone('5511999887766')
    );
  });
});
