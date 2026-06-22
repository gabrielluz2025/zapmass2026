/**
 * ContactsHeaderBar — mantido por compatibilidade (props usadas pelo ContactsTab).
 * O layout CRM v3 exibe todas as ações no ContactsCommandHero.
 * Este componente agora retorna null para evitar duplicação.
 */
export const ContactsHeaderBar: React.FC<{
  stats: unknown;
  hideWeddingWeekPill?: boolean;
  onNewContact: () => void;
  onImportXLSX: () => void;
  onImportVcf: () => void;
  onSmartImport: () => void;
  onDownloadTemplate: () => void;
  onExport: () => void;
  onOpenInsights: () => void;
  onOpenNormalizeNames?: () => void;
  onOpenNormalizeAddresses?: () => void;
  addressNormalizeBusy?: boolean;
  contactTempsReady?: boolean;
}> = () => null;

ContactsHeaderBar.displayName = 'ContactsHeaderBar';

import React from 'react';
