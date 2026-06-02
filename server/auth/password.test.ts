import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('password', () => {
  it('hash e verificação', async () => {
    const hash = await hashPassword('senha-teste-123');
    expect(await verifyPassword('senha-teste-123', hash)).toBe(true);
    expect(await verifyPassword('errada', hash)).toBe(false);
  });
});
