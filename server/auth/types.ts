export type AuthPrincipal = {
  provider: 'vps' | 'firebase';
  authUid: string;
  tenantUid: string;
  email: string;
  role: 'owner' | 'staff';
  ownerUid?: string;
};
