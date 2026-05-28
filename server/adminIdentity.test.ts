import { afterEach, describe, expect, it } from 'vitest';
import { adminEmailSet, adminUidSet, isPlatformAdminDecoded } from './adminIdentity.js';

describe('adminIdentity', () => {
  const prevEmails = process.env.ADMIN_EMAILS;
  const prevUids = process.env.ZAPMASS_ADMIN_UIDS;

  afterEach(() => {
    if (prevEmails === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = prevEmails;
    if (prevUids === undefined) delete process.env.ZAPMASS_ADMIN_UIDS;
    else process.env.ZAPMASS_ADMIN_UIDS = prevUids;
  });

  it('aceita email em ADMIN_EMAILS (case-insensitive)', () => {
    process.env.ADMIN_EMAILS = 'Admin@Example.com';
    delete process.env.ZAPMASS_ADMIN_UIDS;
    expect(adminEmailSet().has('admin@example.com')).toBe(true);
    expect(
      isPlatformAdminDecoded({ uid: 'u1', email: 'Admin@Example.com' })
    ).toBe(true);
  });

  it('aceita uid em ZAPMASS_ADMIN_UIDS ou ADMIN_UIDS sem email', () => {
    delete process.env.ADMIN_EMAILS;
    process.env.ZAPMASS_ADMIN_UIDS = 'firebaseUid123';
    process.env.ADMIN_UIDS = 'otherUid';
    expect(adminUidSet().has('firebaseUid123')).toBe(true);
    expect(adminUidSet().has('otherUid')).toBe(true);
    expect(
      isPlatformAdminDecoded({ uid: 'firebaseUid123', email: '' })
    ).toBe(true);
  });

  it('aceita custom claim admin', () => {
    delete process.env.ADMIN_EMAILS;
    delete process.env.ZAPMASS_ADMIN_UIDS;
    expect(
      isPlatformAdminDecoded({ uid: 'x', email: 'a@b.com', admin: true })
    ).toBe(true);
  });

  it('nega uid de workspace member sem lista admin', () => {
    delete process.env.ADMIN_EMAILS;
    delete process.env.ZAPMASS_ADMIN_UIDS;
    expect(
      isPlatformAdminDecoded({ uid: 'staffUid', email: 'staff@client.com' })
    ).toBe(false);
  });
});
