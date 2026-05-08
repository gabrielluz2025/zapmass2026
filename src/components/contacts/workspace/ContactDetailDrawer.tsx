import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  X, Phone, Mail, MapPin, Church, Briefcase, Cake, Tag, Edit3, Trash2,
  MessageCircle, Rocket, Copy, Flame, Snowflake, Clock, User as UserIcon,
  Sparkles, ListPlus, CalendarClock, Printer, ScrollText, Ban, ShieldCheck
} from 'lucide-react';
import { formatFollowUpLabel, parseFollowUpMs, localStartOfTodayMs } from '../../../utils/followUp';
import type { Contact, ContactCampaignDelivery, ReligiousMemberProfile } from '../../../types';
import { useAppProfile } from '../../../context/AppProfileContext';
import { useWorkspace } from '../../../context/WorkspaceContext';
import { parseWeddingDayMonth, yearsCelebratingAtNextAnniversary } from '../../../utils/weddingAnniversary';
import { useZapMassCore } from '../../../context/ZapMassContext';
import toast from 'react-hot-toast';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../../../services/firebase';

type Temperature = 'hot' | 'warm' | 'cold' | 'new';
interface TempStats {
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  lastSentTs: number;
  lastReplyTs: number;
  lastReadTs: number;
  temp: Temperature;
  score: number;
}

interface Props {
  contact: Contact | null;
  tempStats?: TempStats;
  onClose: () => void;
  onEdit: (contact: Contact) => void;
  onDelete: (contact: Contact) => void;
  onOpenChat: (contact: Contact) => void;
  onCreateCampaign: (contact: Contact) => void;
  onCopyPhone: (contact: Contact) => void;
  onAddToList: (contact: Contact) => void;
}

const tempLabel: Record<Temperature, { label: string; icon: React.ReactNode; color: string }> = {
  hot: { label: 'Quente', icon: <Flame className="w-3.5 h-3.5" />, color: 'bg-red-500/10 text-red-600 border-red-500/20 dark:text-red-300' },
  warm: { label: 'Morno', icon: <Sparkles className="w-3.5 h-3.5" />, color: 'bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-300' },
  cold: { label: 'Frio', icon: <Snowflake className="w-3.5 h-3.5" />, color: 'bg-sky-500/10 text-sky-600 border-sky-500/20 dark:text-sky-300' },
  new: { label: 'Sem histórico', icon: <Clock className="w-3.5 h-3.5" />, color: 'bg-slate-500/10 text-slate-600 border-slate-500/20 dark:text-slate-300' }
};

const formatDate = (ts: number): string => {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: '2-digit' });
};

const formatConsentIso = (iso?: string): string => {
  if (!iso || !iso.trim()) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  return new Date(t).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const formatPhone = (raw: string): string => {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('55')) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 12 && digits.startsWith('55')) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return raw || '—';
};

function escapeHtml(s: string): string {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const RECEIVED_PT: Record<string, string> = {
  faith: 'Profissão de fé',
  transfer: 'Transferência',
  acclaim: 'Aclamação'
};

/** Linhas não vazias da ficha eclesiástica para o drawer e para impressão. */
function religiousFichaRows(r: ReligiousMemberProfile | undefined): { label: string; value: string }[] {
  if (!r) return [];
  const rows: { label: string; value: string }[] = [];
  const push = (label: string, v?: string) => {
    const t = (v || '').trim();
    if (t) rows.push({ label, value: t });
  };
  push('RG', r.rg);
  push('Data emissão RG', r.rgIssueDate);
  push('Órgão expedidor RG', r.rgIssuer);
  push('CPF', r.cpf);
  push('Nacionalidade', r.nationality);
  push('Naturalidade', r.birthPlace);
  if (r.gender === 'M') rows.push({ label: 'Sexo', value: 'Masculino' });
  else if (r.gender === 'F') rows.push({ label: 'Sexo', value: 'Feminino' });
  if (r.landline) rows.push({ label: 'Telefone fixo', value: r.landline });
  push('Escolaridade', r.educationLevel);
  push('País', r.country);
  push('Nome do pai', r.fatherName);
  push('Nome da mãe', r.motherName);
  push('Estado civil', r.maritalStatus);
  push('Casado(a) com', r.spouseName);
  push('Data do casamento (bodas)', r.weddingDate);
  const mdWed = parseWeddingDayMonth(r.weddingDate);
  if (mdWed?.fullYear) {
    const yNext = yearsCelebratingAtNextAnniversary(mdWed);
    if (yNext != null) rows.push({ label: 'Anos de casados (na próxima bodas)', value: String(yNext) });
  }
  if (r.ministerRoles?.length) rows.push({ label: 'Funções ministeriais', value: r.ministerRoles.join(', ') });
  if (r.leaderGroups?.length) rows.push({ label: 'Líder de conjunto', value: r.leaderGroups.join(', ') });
  push('Profissão de fé', r.professionOfFaith);
  push('Data de batismo', r.baptismDate);
  push('Igreja anterior', r.previousChurch);
  push('Pastor anterior', r.previousPastor);
  if (r.receivedBy && RECEIVED_PT[r.receivedBy]) {
    rows.push({ label: 'Recebido nesta igreja por', value: RECEIVED_PT[r.receivedBy] });
  }
  push('Data de recebimento', r.churchJoinDate);
  if (r.baptizedHolySpirit === 'yes') rows.push({ label: 'Batizado com o Espírito Santo', value: 'Sim' });
  else if (r.baptizedHolySpirit === 'no') rows.push({ label: 'Batizado com o Espírito Santo', value: 'Não' });
  push('Data (Espírito Santo)', r.holySpiritDate);
  return rows;
}

export const ContactDetailDrawer: React.FC<Props> = ({
  contact,
  tempStats,
  onClose,
  onEdit,
  onDelete,
  onOpenChat,
  onCreateCampaign,
  onCopyPhone,
  onAddToList
}) => {
  const { segment } = useAppProfile();
  const { effectiveWorkspaceUid } = useWorkspace();
  const { updateContact } = useZapMassCore();
  const [marketingBusy, setMarketingBusy] = useState(false);
  const [campaignDeliveries, setCampaignDeliveries] = useState<ContactCampaignDelivery[]>([]);

  const fichaRows = useMemo(() => religiousFichaRows(contact?.religiousMemberProfile), [contact?.religiousMemberProfile]);

  const printFichaPdf = useCallback(() => {
    if (!contact || segment !== 'religious') return;
    const w = window.open('', '_blank', 'noopener,noreferrer');
    if (!w) return;
    const core: { label: string; value: string }[] = [
      { label: 'Nome', value: contact.name || '—' },
      { label: 'Telefone (WhatsApp)', value: formatPhone(contact.phone || '') },
      { label: 'E-mail', value: (contact.email || '').trim() || '—' },
      { label: 'Aniversário', value: (contact.birthday || '').trim() || '—' },
      { label: 'Endereço', value: [contact.street, contact.number].filter(Boolean).join(', ') || '—' },
      { label: 'Bairro', value: (contact.neighborhood || '').trim() || '—' },
      { label: 'Cidade / UF', value: [contact.city, contact.state].filter(Boolean).join(' / ') || '—' },
      { label: 'CEP', value: (contact.zipCode || '').trim() || '—' },
      { label: 'Igreja', value: (contact.church || '').trim() || '—' },
      { label: 'Cargo (igreja)', value: (contact.role || '').trim() || '—' },
      { label: 'Profissão', value: (contact.profession || '').trim() || '—' },
      { label: 'Notas', value: (contact.notes || '').trim() || '—' }
    ];
    const rowsHtml = [...core, ...religiousFichaRows(contact.religiousMemberProfile)]
      .map(
        (row) =>
          `<div class="row"><div class="l">${escapeHtml(row.label)}</div><div class="v">${escapeHtml(row.value)}</div></div>`
      )
      .join('');
    const title = `Ficha — ${contact.name || 'Contato'}`;
    w.document.write(
      `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
        '<style>@media print{body{padding:12px}}body{font-family:system-ui,-apple-system,sans-serif;padding:24px;max-width:720px;margin:0 auto;color:#111}h1{font-size:20px;margin:0 0 4px}p.sub{color:#555;font-size:12px;margin:0 0 20px}h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#444;margin:20px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px}.row{display:flex;border-bottom:1px solid #eee;padding:7px 0;gap:12px}.l{width:38%;min-width:120px;color:#555;font-size:12px;font-weight:600}.v{flex:1;font-size:13px;white-space:pre-wrap;word-break:break-word}</style></head><body>' +
        `<h1>${escapeHtml(contact.name || 'Contato')}</h1><p class="sub">ZapMass — ficha de membro (resumo) · ${new Date().toLocaleString('pt-BR')}</p>` +
        '<h2>Dados gerais e ficha eclesiástica</h2>' +
        rowsHtml +
        '</body></html>'
    );
    w.document.close();
    w.focus();
    w.print();
    window.setTimeout(() => {
      try {
        w.close();
      } catch {
        /* ignore */
      }
    }, 400);
  }, [contact, segment]);

  useEffect(() => {
    if (!contact) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [contact, onClose]);

  const putMarketingOptOut = useCallback(async () => {
    if (!contact) return;
    setMarketingBusy(true);
    try {
      await updateContact(contact.id, {
        marketingOptOut: true,
        marketingOptIn: false,
        marketingConsentAt: new Date().toISOString(),
        marketingConsentText: 'Lista negra (manual)'
      });
      toast.success('Marcado na lista negra de marketing.');
    } catch {
      toast.error('Não foi possível atualizar.');
    } finally {
      setMarketingBusy(false);
    }
  }, [contact, updateContact]);

  const removeMarketingOptOut = useCallback(async () => {
    if (!contact) return;
    setMarketingBusy(true);
    try {
      await updateContact(contact.id, { marketingOptOut: false });
      toast.success('Removido da lista negra de marketing.');
    } catch {
      toast.error('Não foi possível atualizar.');
    } finally {
      setMarketingBusy(false);
    }
  }, [contact, updateContact]);

  const putMarketingOptIn = useCallback(async () => {
    if (!contact) return;
    setMarketingBusy(true);
    try {
      const at = new Date().toISOString();
      await updateContact(contact.id, {
        marketingOptOut: false,
        marketingOptIn: true,
        marketingConsentAt: at,
        marketingConsentText: 'Autorização registrada manualmente no CRM.'
      });
      toast.success('Autorização de marketing registrada.');
    } catch {
      toast.error('Não foi possível atualizar.');
    } finally {
      setMarketingBusy(false);
    }
  }, [contact, updateContact]);

  useEffect(() => {
    if (!contact?.id || !effectiveWorkspaceUid) {
      setCampaignDeliveries([]);
      return;
    }
    const uid = effectiveWorkspaceUid;
    const snapQuery = query(
      collection(db, 'users', uid, 'contacts', contact.id, 'campaignDeliveries'),
      orderBy('updatedAt', 'desc')
    );
    const unsub = onSnapshot(
      snapQuery,
      (snap) => {
        const rows: ContactCampaignDelivery[] = [];
        snap.forEach((docSnap) => {
          const raw = docSnap.data() as Record<string, unknown>;
          rows.push({
            campaignId: docSnap.id,
            campaignName: typeof raw.campaignName === 'string' ? raw.campaignName : '',
            sentCount: Math.max(0, Math.floor(Number(raw.sentCount) || 0)),
            totalStages: Math.max(1, Math.floor(Number(raw.totalStages) || 1)),
            updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined
          });
        });
        setCampaignDeliveries(rows);
      },
      () => {
        setCampaignDeliveries([]);
      }
    );
    return () => unsub();
  }, [contact?.id, effectiveWorkspaceUid]);

  if (!contact) return null;

  const temp = tempStats?.temp || 'new';
  const tempInfo = tempLabel[temp];
  const initials = (contact.name || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() || '').join('') || '?';

  const addressLine = [contact.street, contact.number].filter(Boolean).join(', ');
  const cityLine = [contact.city, contact.state].filter(Boolean).join(' · ');
  const hasAddress = !!(addressLine || contact.neighborhood || cityLine || contact.zipCode);

  return (
    <>
      {/* backdrop — clique fecha */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={onClose}
        aria-hidden
      />
      {/* drawer */}
      <aside
        className="fixed top-0 right-0 z-50 h-screen w-full sm:w-[440px] bg-white dark:bg-slate-900 shadow-2xl border-l border-slate-200 dark:border-slate-800 flex flex-col animate-in slide-in-from-right duration-200"
        role="dialog"
        aria-label="Detalhes do contato"
      >
        {/* header */}
        <div
          className="relative px-5 pt-5 pb-4 border-b border-slate-200 dark:border-slate-800"
          style={{
            background:
              'linear-gradient(135deg, color-mix(in srgb, var(--brand-600) 10%, transparent) 0%, transparent 60%)'
          }}
        >
          <button
            onClick={onClose}
            className="absolute top-3 right-3 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="flex items-start gap-3">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center text-white font-bold text-lg shrink-0 shadow-lg"
              style={{ background: 'linear-gradient(135deg, var(--brand-500), var(--brand-700))' }}
            >
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white truncate">
                {contact.name || 'Sem nome'}
              </h2>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-semibold ${tempInfo.color}`}
                >
                  {tempInfo.icon}
                  {tempInfo.label}
                </span>
                {contact.status === 'INVALID' && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-semibold bg-rose-500/10 text-rose-600 border-rose-500/20 dark:text-rose-300">
                    Telefone inválido
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* ações rápidas */}
          <div className="grid grid-cols-4 gap-2 mt-4">
            <QuickActionBtn icon={<MessageCircle className="w-4 h-4" />} label="Chat" onClick={() => onOpenChat(contact)} accent="emerald" />
            <QuickActionBtn icon={<Rocket className="w-4 h-4" />} label="Campanha" onClick={() => onCreateCampaign(contact)} accent="brand" />
            <QuickActionBtn icon={<Edit3 className="w-4 h-4" />} label="Editar" onClick={() => onEdit(contact)} accent="sky" />
            <QuickActionBtn icon={<ListPlus className="w-4 h-4" />} label="Lista" onClick={() => onAddToList(contact)} accent="violet" />
          </div>
        </div>

        {/* corpo rolável */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Contato */}
          <Section title="Contato">
            <InfoRow
              icon={<Phone className="w-4 h-4" />}
              label="Telefone"
              value={formatPhone(contact.phone || '')}
              action={
                <button
                  onClick={() => onCopyPhone(contact)}
                  className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
                  title="Copiar telefone"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              }
            />
            {contact.email && (
              <InfoRow icon={<Mail className="w-4 h-4" />} label="E-mail" value={contact.email} />
            )}
            {contact.birthday && (
              <InfoRow icon={<Cake className="w-4 h-4" />} label="Aniversário" value={contact.birthday} />
            )}
          </Section>

          {/* Endereço */}
          {hasAddress && (
            <Section title="Endereço">
              {addressLine && <InfoRow icon={<MapPin className="w-4 h-4" />} label="Rua" value={addressLine} />}
              {contact.neighborhood && <InfoRow icon={<MapPin className="w-4 h-4" />} label="Bairro" value={contact.neighborhood} />}
              {cityLine && <InfoRow icon={<MapPin className="w-4 h-4" />} label="Cidade" value={cityLine} />}
              {contact.zipCode && <InfoRow icon={<MapPin className="w-4 h-4" />} label="CEP" value={contact.zipCode} />}
            </Section>
          )}

          {/* Igreja / Trabalho */}
          {(contact.church || contact.role || contact.profession) && (
            <Section title="Vínculos">
              {contact.church && <InfoRow icon={<Church className="w-4 h-4" />} label="Igreja" value={contact.church} />}
              {contact.role && <InfoRow icon={<UserIcon className="w-4 h-4" />} label="Cargo (igreja)" value={contact.role} />}
              {contact.profession && <InfoRow icon={<Briefcase className="w-4 h-4" />} label="Profissão" value={contact.profession} />}
            </Section>
          )}

          {segment === 'religious' && (
            <Section title="Ficha de membro">
              <div className="rounded-xl border border-emerald-200/80 dark:border-emerald-900/50 bg-emerald-50/40 dark:bg-emerald-950/25 px-3 py-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
                    <ScrollText className="w-4 h-4 shrink-0" />
                    <p className="text-[11px] leading-snug text-emerald-900/90 dark:text-emerald-200/90">
                      Dados alargados (RG, família, eclesiástico). Use <strong>Editar</strong> ou a aba <strong>Ficha membro</strong> para alterar.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => printFichaPdf()}
                    className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-emerald-600/30 bg-white dark:bg-slate-900 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100/60 dark:hover:bg-emerald-900/40 transition"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    PDF
                  </button>
                </div>
                {fichaRows.length === 0 ? (
                  <p className="text-sm text-slate-600 dark:text-slate-400 px-1">
                    Ainda não há campos da ficha preenchidos neste contato.
                  </p>
                ) : (
                  <div className="space-y-1 max-h-[min(50vh,320px)] overflow-y-auto pr-1">
                    {fichaRows.map((row, idx) => (
                      <div
                        key={`${idx}-${row.label}`}
                        className="flex gap-2 px-2 py-1.5 rounded-lg bg-white/80 dark:bg-slate-900/60 border border-emerald-100/60 dark:border-emerald-900/30"
                      >
                        <span className="text-[10px] uppercase tracking-wide font-bold text-slate-500 dark:text-slate-400 w-[40%] shrink-0 leading-tight">
                          {row.label}
                        </span>
                        <span className="text-[13px] text-slate-800 dark:text-slate-200 leading-snug break-words min-w-0">
                          {row.value}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* Tags */}
          {Array.isArray(contact.tags) && contact.tags.length > 0 && (
            <Section title="Tags">
              <div className="flex flex-wrap gap-1.5">
                {contact.tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                  >
                    <Tag className="w-3 h-3" />
                    {t}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {(parseFollowUpMs(contact.followUpAt) != null || (contact.followUpNote || '').trim()) && (
            <Section title="Retorno">
              {parseFollowUpMs(contact.followUpAt) != null && (
                <div
                  className={`flex items-start gap-2 px-2.5 py-2 rounded-lg border ${
                    (parseFollowUpMs(contact.followUpAt) ?? 0) < localStartOfTodayMs()
                      ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900/50'
                      : 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/40'
                  }`}
                >
                  <CalendarClock className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
                  <div>
                    <div className="text-xs font-bold text-slate-700 dark:text-slate-200">
                      {(parseFollowUpMs(contact.followUpAt) ?? 0) < localStartOfTodayMs() ? 'Atrasado para' : 'Agendado para'}{' '}
                      {formatFollowUpLabel(contact.followUpAt)}
                    </div>
                  </div>
                </div>
              )}
              {(contact.followUpNote || '').trim() && (
                <p className="text-sm text-slate-600 dark:text-slate-400 whitespace-pre-wrap px-1">{contact.followUpNote}</p>
              )}
            </Section>
          )}

          {/* Engajamento */}
          {tempStats && tempStats.sent > 0 && (
            <Section title="Engajamento">
              <div className="grid grid-cols-2 gap-2">
                <Metric label="Enviadas" value={tempStats.sent} />
                <Metric label="Entregues" value={tempStats.delivered} />
                <Metric label="Lidas" value={tempStats.read} />
                <Metric label="Respondidas" value={tempStats.replied} />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                <div>Últ. envio: {formatDate(tempStats.lastSentTs)}</div>
                <div>Últ. resposta: {formatDate(tempStats.lastReplyTs)}</div>
              </div>
            </Section>
          )}

          <Section title="Marketing e campanhas">
            <div className="flex flex-wrap gap-2 mb-2">
              {contact.marketingOptOut ? (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md border text-xs font-semibold bg-slate-800/10 text-slate-800 border-slate-500/25 dark:text-slate-200">
                  <Ban className="w-3.5 h-3.5" />
                  Lista negra de disparos
                </span>
              ) : contact.marketingOptIn ? (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md border text-xs font-semibold bg-emerald-500/10 text-emerald-700 border-emerald-500/25 dark:text-emerald-300">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Autorizou marketing
                </span>
              ) : (
                <span className="text-sm text-slate-500 dark:text-slate-400 px-1">
                  Sem registro de autorização ou bloqueio.
                </span>
              )}
            </div>
            <div className="space-y-1.5 text-[12.5px] text-slate-600 dark:text-slate-300 px-1 mb-3">
              <div className="flex justify-between gap-2">
                <span className="text-slate-500 dark:text-slate-400">Registrado em</span>
                <span className="font-medium text-slate-800 dark:text-slate-100">
                  {formatConsentIso(contact.marketingConsentAt)}
                </span>
              </div>
              {(contact.marketingConsentText || '').trim().length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-bold mb-0.5">
                    Texto da resposta / observação
                  </div>
                  <p className="text-sm whitespace-pre-wrap rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-2.5 py-2">
                    {contact.marketingConsentText}
                  </p>
                </div>
              )}
              <div className="flex justify-between gap-2 pt-1">
                <span className="text-slate-500 dark:text-slate-400">Mensagens de campanha recebidas (total, todas as campanhas)</span>
                <span className="font-bold tabular-nums text-slate-900 dark:text-white">
                  {contact.campaignMessagesReceived ?? 0}
                </span>
              </div>
              {campaignDeliveries.length > 0 && (
                <div className="pt-3 mt-1 border-t border-slate-200 dark:border-slate-700">
                  <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 mb-2">
                    Por campanha (etapas)
                  </div>
                  <div className="space-y-2 max-h-[min(40vh,280px)] overflow-y-auto pr-0.5">
                    {campaignDeliveries.map((row) => {
                      const total = Math.max(1, row.totalStages);
                      const sent = row.sentCount;
                      const pending = Math.max(0, total - sent);
                      const doneAll = sent >= total;
                      return (
                        <div
                          key={row.campaignId}
                          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/40 px-2.5 py-2 text-[12px]"
                        >
                          <div className="font-semibold text-slate-900 dark:text-white leading-snug">
                            {(row.campaignName || '').trim() || 'Campanha'}
                          </div>
                          <div className="grid grid-cols-3 gap-x-2 gap-y-0.5 mt-1.5 text-[11px] text-slate-600 dark:text-slate-300">
                            <span className="text-slate-500 dark:text-slate-400">Recebidas</span>
                            <span className="font-mono font-semibold text-right tabular-nums col-span-2">{sent}</span>
                            <span className="text-slate-500 dark:text-slate-400">Etapas previstas</span>
                            <span className="font-mono font-semibold text-right tabular-nums col-span-2">{total}</span>
                            <span className="text-slate-500 dark:text-slate-400">Pendentes</span>
                            <span
                              className={`font-mono font-semibold text-right tabular-nums col-span-2 ${
                                doneAll ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
                              }`}
                            >
                              {doneAll ? '0' : pending}
                            </span>
                          </div>
                          {sent > total && (
                            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                              Entregues acima do plano ({sent} &gt; {total}): campanha pode ter sido alterada ou houve
                              reenvio.
                            </p>
                          )}
                          {row.updatedAt && (
                            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
                              Atual.: {formatConsentIso(row.updatedAt)}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <p className="text-[10.5px] text-slate-500 dark:text-slate-400 leading-snug pt-1">
                O total geral sobe a cada envio. Por campanha, comparamos com o número de etapas da campanha (fluxo
                por respostas ou sequência) no momento do envio.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              {!contact.marketingOptOut && (
                <button
                  type="button"
                  disabled={marketingBusy}
                  onClick={() => void putMarketingOptOut()}
                  className="w-full py-2 rounded-lg text-sm font-semibold border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <Ban className="w-4 h-4" />
                  Colocar na lista negra
                </button>
              )}
              {contact.marketingOptOut && (
                <button
                  type="button"
                  disabled={marketingBusy}
                  onClick={() => void removeMarketingOptOut()}
                  className="w-full py-2 rounded-lg text-sm font-semibold border border-emerald-500/40 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-500/10 transition disabled:opacity-50"
                >
                  Remover da lista negra
                </button>
              )}
              {!contact.marketingOptIn && !contact.marketingOptOut && (
                <button
                  type="button"
                  disabled={marketingBusy}
                  onClick={() => void putMarketingOptIn()}
                  className="w-full py-2 rounded-lg text-sm font-semibold border border-emerald-600/35 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-500/15 transition disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <ShieldCheck className="w-4 h-4" />
                  Registrar autorização manual (lead quente)
                </button>
              )}
            </div>
          </Section>

          {/* Notas */}
          {contact.notes && (
            <Section title="Notas">
              <p className="text-sm text-slate-600 dark:text-slate-400 whitespace-pre-wrap">
                {contact.notes}
              </p>
            </Section>
          )}
        </div>

        {/* footer — destruir */}
        <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800">
          <button
            onClick={() => onDelete(contact)}
            className="w-full py-2 rounded-lg text-sm font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 transition flex items-center justify-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Remover contato
          </button>
        </div>
      </aside>
    </>
  );
};

const QuickActionBtn: React.FC<{
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  accent: 'emerald' | 'brand' | 'sky' | 'violet';
}> = ({ icon, label, onClick, accent }) => {
  const map: Record<typeof accent, string> = {
    emerald: 'text-emerald-600 dark:text-emerald-300 hover:bg-emerald-500/10 border-emerald-500/30',
    brand: 'text-[var(--brand-600)] hover:bg-[color-mix(in_srgb,var(--brand-500)_12%,transparent)] border-[color-mix(in_srgb,var(--brand-500)_30%,transparent)]',
    sky: 'text-sky-600 dark:text-sky-300 hover:bg-sky-500/10 border-sky-500/30',
    violet: 'text-violet-600 dark:text-violet-300 hover:bg-violet-500/10 border-violet-500/30'
  } as const;
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-1 px-2 py-2 rounded-lg border transition bg-white dark:bg-slate-900 ${map[accent]}`}
    >
      {icon}
      <span className="text-[11px] font-semibold">{label}</span>
    </button>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
      {title}
    </div>
    <div className="space-y-1.5">{children}</div>
  </div>
);

const InfoRow: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  action?: React.ReactNode;
}> = ({ icon, label, value, action }) => (
  <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 transition group">
    <div className="text-slate-400 dark:text-slate-500 shrink-0">{icon}</div>
    <div className="min-w-0 flex-1">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">{label}</div>
      <div className="text-sm text-slate-900 dark:text-white truncate">{value}</div>
    </div>
    {action && <div className="opacity-0 group-hover:opacity-100 transition">{action}</div>}
  </div>
);

const Metric: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
    <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">{label}</div>
    <div className="text-lg font-bold text-slate-900 dark:text-white">{value}</div>
  </div>
);
