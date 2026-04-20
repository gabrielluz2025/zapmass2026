import { isAdminUserEmail } from './adminAccess';

/** Ligado pelo BAT/script de desenvolvimento (nunca em build de cliente). */
export function isCreatorStudioEnv(): boolean {
  return import.meta.env.VITE_CREATOR_STUDIO === 'true';
}

export function canAccessCreatorStudio(email: string | null | undefined): boolean {
  return isCreatorStudioEnv() && isAdminUserEmail(email);
}
