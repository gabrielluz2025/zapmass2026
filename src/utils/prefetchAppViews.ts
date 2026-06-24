/** Prefetch de chunks lazy ao passar o mouse na sidebar — abas pesadas abrem mais rápido. */
const PREFETCH: Record<string, () => Promise<unknown>> = {
  dashboard: () => import('../components/DashboardTab'),
  chat: () => import('../components/ChatTab'),
  campaigns: () => import('../components/CampaignsTab'),
  contacts: () => import('../components/ContactsTab'),
  'contacts-map': () => import('../components/contacts/ContactsMapTab'),
  admin: () => import('../components/admin/AdminPanel'),
  'admin-ops': () => import('../components/AdminServerTab'),
  'creator-studio': () => import('../components/creator/CreatorStudio'),
  'religious-members': () => import('../components/religious/ReligiousNewMemberTab'),
  'pastoral-visits': () => import('../components/religious/PastoralVisitsTab')
};

const prefetched = new Set<string>();

export function prefetchAppView(viewId: string): void {
  if (prefetched.has(viewId)) return;
  const load = PREFETCH[viewId];
  if (!load) return;
  prefetched.add(viewId);
  void load().catch(() => {
    prefetched.delete(viewId);
  });
}

/** Após login, aquece o painel padrão e campanhas/contatos em idle. */
export function prefetchDefaultAppViews(): void {
  prefetchAppView('dashboard');
  const run = () => {
    prefetchAppView('campaigns');
    prefetchAppView('contacts');
    prefetchAppView('contacts-map');
  };
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(run, { timeout: 4000 });
  } else {
    window.setTimeout(run, 1500);
  }
}
