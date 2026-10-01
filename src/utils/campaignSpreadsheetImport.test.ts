import { describe, expect, it } from 'vitest';
import {
  mapCampaignSpreadsheetDataRow,
  parseCampaignSpreadsheetRows,
  validateCampaignSpreadsheetPhone,
  buildCampaignSpreadsheetHeaderMap,
} from './campaignSpreadsheetImport';

describe('validateCampaignSpreadsheetPhone', () => {
  it('normaliza celular BR com DDI', () => {
    const r = validateCampaignSpreadsheetPhone('11 98888-7777');
    expect(r.ok).toBe(true);
    expect(r.phone.startsWith('55')).toBe(true);
  });

  it('rejeita número vazio', () => {
    expect(validateCampaignSpreadsheetPhone('').ok).toBe(false);
  });
});

describe('parseCampaignSpreadsheetRows', () => {
  it('parseia cabeçalho Telefone e Nome', () => {
    const sheet = [
      ['Telefone', 'Nome', 'Cidade'],
      ['5511999887766', 'Maria Silva', 'São Paulo'],
    ];
    const result = parseCampaignSpreadsheetRows(sheet);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].formatOk).toBe(true);
    expect(result.rows[0].vars.nome).toBeTruthy();
    expect(result.rows[0].vars.cidade).toBe('São Paulo');
  });

  it('falha sem coluna de telefone', () => {
    const result = parseCampaignSpreadsheetRows([['Nome'], ['João']]);
    expect(result.ok).toBe(false);
  });

  it('marca duplicado na planilha', () => {
    const sheet = [
      ['Telefone', 'Nome'],
      ['5511999887766', 'A'],
      ['5511999887766', 'B'],
    ];
    const result = parseCampaignSpreadsheetRows(sheet);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[1].formatOk).toBe(false);
    expect(result.rows[1].formatError).toMatch(/duplicado/i);
  });
});

describe('buildCampaignSpreadsheetHeaderMap', () => {
  it('reconhece whatsapp como telefone', () => {
    const map = buildCampaignSpreadsheetHeaderMap(['WhatsApp', 'Nome']);
    expect(map[0]).toBe('phone');
    expect(map[1]).toBe('name');
  });
});

describe('mapCampaignSpreadsheetDataRow', () => {
  it('preenche variáveis de campanha', () => {
    const headerMap = buildCampaignSpreadsheetHeaderMap(['Telefone', 'Nome', 'Cargo']);
    const row = mapCampaignSpreadsheetDataRow(headerMap, ['5511988776655', 'Ana Costa', 'Líder'], 2);
    expect(row.formatOk).toBe(true);
    expect(row.vars.cargo).toBe('Líder');
    expect(row.vars.telefone).toBe(row.phone);
  });
});
