import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { atomicWriteJsonFile, parseJsonObjectLenient } from './safeJsonFile.js';

describe('parseJsonObjectLenient', () => {
  it('parseia objeto completo', () => {
    const r = parseJsonObjectLenient('{"a":{"dailyLimit":100}}');
    expect(r?.salvaged).toBe(false);
    expect(r?.value).toEqual({ a: { dailyLimit: 100 } });
  });

  it('recupera JSON truncado no último objeto fechado', () => {
    const r = parseJsonObjectLenient('{"chip1":{"dailyLimit":40},"chip2":{"dailyLimit":');
    expect(r?.salvaged).toBe(true);
    expect(r?.value).toEqual({ chip1: { dailyLimit: 40 } });
  });

  it('trata arquivo vazio como objeto vazio', () => {
    expect(parseJsonObjectLenient('   ')).toEqual({ value: {}, salvaged: false });
  });

  it('recupera chip completo quando o seguinte ficou no meio da string', () => {
    const r = parseJsonObjectLenient(
      '{"chip1":{"dailyLimit":40,"friendlyName":"Disparo 01"},"chip2":{"friendlyName":"Disparo'
    );
    expect(r?.salvaged).toBe(true);
    expect(r?.value).toEqual({ chip1: { dailyLimit: 40, friendlyName: 'Disparo 01' } });
  });

  it('retorna null se não houver objeto recuperável', () => {
    expect(parseJsonObjectLenient('{"chip1":')).toBeNull();
  });
});

describe('atomicWriteJsonFile', () => {
  it('grava JSON válido via tmp+rename', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapmass-json-'));
    const file = path.join(dir, 'connections_settings.json');
    atomicWriteJsonFile(file, { conn_1: { dailyLimit: 50 } });
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(parsed).toEqual({ conn_1: { dailyLimit: 50 } });
    const leftovers = fs.readdirSync(dir).filter((n) => n.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });
});
