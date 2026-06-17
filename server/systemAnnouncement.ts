export type SystemAnnouncementKind = 'info' | 'warning' | 'error';

export type SystemAnnouncement = {
  active: boolean;
  title: string;
  body: string;
  kind: SystemAnnouncementKind;
  showBanner: boolean;
  updatedAt: string;
  expiresAt: string | null;
  publishedBy?: string;
};

const KINDS = new Set<SystemAnnouncementKind>(['info', 'warning', 'error']);

export function parseSystemAnnouncement(raw: unknown): SystemAnnouncement | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.active !== true) return null;
  const title = typeof o.title === 'string' ? o.title.trim() : '';
  const body = typeof o.body === 'string' ? o.body.trim() : '';
  if (!title || !body) return null;
  const kind = typeof o.kind === 'string' && KINDS.has(o.kind as SystemAnnouncementKind)
    ? (o.kind as SystemAnnouncementKind)
    : 'info';
  const showBanner = o.showBanner !== false;
  const updatedAt = typeof o.updatedAt === 'string' ? o.updatedAt : new Date().toISOString();
  const expiresAt =
    typeof o.expiresAt === 'string' && o.expiresAt.trim() ? o.expiresAt.trim() : null;
  if (expiresAt) {
    const t = Date.parse(expiresAt);
    if (Number.isFinite(t) && t <= Date.now()) return null;
  }
  return {
    active: true,
    title: title.slice(0, 200),
    body: body.slice(0, 4000),
    kind,
    showBanner,
    updatedAt,
    expiresAt,
    publishedBy: typeof o.publishedBy === 'string' ? o.publishedBy.slice(0, 200) : undefined
  };
}

export function sanitizeAnnouncementInput(body: Record<string, unknown>): {
  title: string;
  message: string;
  kind: SystemAnnouncementKind;
  showBanner: boolean;
  pushToBell: boolean;
  expiresAt: string | null;
} | null {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const message = typeof body.message === 'string' ? body.message.trim() : typeof body.body === 'string' ? body.body.trim() : '';
  if (!title || !message) return null;
  const kindRaw = typeof body.kind === 'string' ? body.kind : 'warning';
  const kind = KINDS.has(kindRaw as SystemAnnouncementKind) ? (kindRaw as SystemAnnouncementKind) : 'warning';
  const showBanner = body.showBanner !== false;
  const pushToBell = body.pushToBell === true;
  let expiresAt: string | null = null;
  if (typeof body.expiresAt === 'string' && body.expiresAt.trim()) {
    const t = Date.parse(body.expiresAt);
    if (Number.isFinite(t)) expiresAt = new Date(t).toISOString();
  }
  return {
    title: title.slice(0, 200),
    message: message.slice(0, 4000),
    kind,
    showBanner,
    pushToBell,
    expiresAt
  };
}
