import { describe, expect, it } from 'vitest';
import {
  buildInboundAutomationDedupeKey,
  buildInboundBodyDedupeKey,
} from './inboundAutomationDedupe.js';

describe('buildInboundBodyDedupeKey', () => {
  it('é igual para a mesma resposta independente do messageId', () => {
    const a = buildInboundBodyDedupeKey('chip-a', '5547971856371', 'SAir');
    const b = buildInboundBodyDedupeKey('chip-a', '47971856371', 'sair');
    expect(a).toBe(b);
    expect(a).toBeTruthy();
  });

  it('difere entre chips', () => {
    const a = buildInboundBodyDedupeKey('d1', '5547999999999', 'sair');
    const b = buildInboundBodyDedupeKey('d2', '5547999999999', 'sair');
    expect(a).not.toBe(b);
  });
});

describe('buildInboundAutomationDedupeKey', () => {
  it('prioriza messageId', () => {
    expect(
      buildInboundAutomationDedupeKey({
        connectionId: 'c',
        messageId: 'ABC',
        phoneDigits: '1',
        timestampMs: 1,
        bodyText: 'sair',
      })
    ).toBe('msg:c:ABC');
  });
});
