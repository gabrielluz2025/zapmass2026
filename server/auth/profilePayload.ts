import type { AuthPrincipal } from './types.js';
import { findUserById } from './userRepository.js';
import { findStaffMemberById } from './staffRepository.js';

export type VpsUserPayload = {
  id: string;
  email: string;
  displayName: string | null;
  photoUrl: string | null;
  role: 'owner' | 'staff';
  tenantUid: string;
  ownerUid?: string;
  loginSlug?: string;
};

export async function buildVpsUserPayload(principal: AuthPrincipal): Promise<VpsUserPayload | null> {
  if (principal.role === 'staff') {
    const member = await findStaffMemberById(principal.authUid);
    if (!member || member.revoked_at) return null;
    const owner = await findUserById(principal.tenantUid);
    return {
      id: member.id,
      email: owner?.email || principal.email,
      displayName: member.display_name || null,
      photoUrl: member.photo_url || null,
      role: 'staff',
      tenantUid: principal.tenantUid,
      ownerUid: principal.tenantUid,
      loginSlug: member.login_slug
    };
  }
  const user = await findUserById(principal.tenantUid);
  if (!user || user.disabled_at) return null;
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    photoUrl: user.photo_url || null,
    role: 'owner',
    tenantUid: user.id
  };
}
