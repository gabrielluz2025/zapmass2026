/**
 * Carrega e mescla dados `users/{uid}/...` com colecoes de raiz legadas (`/contacts`, etc.),
 * espelhando o app (ZapMassContext + mergeLegacyUserDocs) para o painel admin nao exibir zeros
 * quando os dados ainda estao so na raiz.
 */
import type { Firestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import type { Contact, ContactList, Campaign } from '../src/types';
import { CampaignStatus } from '../src/types';
import { mergeContacts, mergeContactLists, mergeCampaigns } from '../src/utils/mergeLegacyUserDocs';

function asEpoch(v: unknown): number {
  if (!v) return 0;
  if (typeof (v as { toDate?: () => Date }).toDate === 'function') {
    try {
      return (v as { toDate: () => Date }).toDate().getTime();
    } catch {
      return 0;
    }
  }
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : 0;
  }
  return 0;
}

function mapContactDoc(d: QueryDocumentSnapshot): Contact {
  const raw = d.data() as Record<string, unknown>;
  const birthday =
    (raw.birthday ||
      raw.aniversario ||
      raw.dataNascimento ||
      raw.data_nascimento ||
      raw.dataAniversario ||
      raw.dob ||
      raw.birthdate ||
      raw.birthDate ||
      '') as string;
  const email = (raw.email || raw.e_mail || '') as string;
  const notes = (raw.notes || raw.observacoes || raw.obs || '') as string;
  const st = String(raw.status || 'VALID').toUpperCase() === 'INVALID' ? 'INVALID' : 'VALID';
  return {
    id: d.id,
    name: (raw.name || raw.nome || 'Sem Nome') as string,
    phone: (raw.phone || raw.telefone || '') as string,
    city: (raw.city || raw.cidade || '') as string,
    state: (raw.state || raw.uf || raw.estado || '') as string,
    street: (raw.street || raw.rua || raw.logradouro || raw.endereco || '') as string,
    number: (raw.number || raw.numero || raw.num || '') as string,
    neighborhood: (raw.neighborhood || raw.bairro || '') as string,
    zipCode: (raw.zipCode || raw.cep || raw.zip || '') as string,
    church: (raw.church || raw.igreja || '') as string,
    role: (raw.role || raw.cargo || raw.funcao || '') as string,
    profession: (raw.profession || raw.profissao || raw.cargoProfissional || raw.cargo_profissional || '') as string,
    birthday,
    email,
    notes,
    tags: Array.isArray(raw.tags) ? (raw.tags as string[]) : [],
    status: st as Contact['status'],
    lastMsg: (raw.lastMsg || raw.ultimaMsg) as string | undefined
  } as Contact;
}

function mapListDoc(d: QueryDocumentSnapshot): ContactList {
  const raw = d.data() as Record<string, unknown>;
  const created =
    typeof raw.createdAt === 'string'
      ? raw.createdAt
      : asEpoch(raw.createdAt) > 0
        ? new Date(asEpoch(raw.createdAt)).toISOString()
        : '';
  return {
    id: d.id,
    name: (raw.name || 'Lista') as string,
    contactIds: Array.isArray(raw.contactIds) ? (raw.contactIds as string[]) : [],
    description: raw.description as string | undefined,
    createdAt: created,
    tags: Array.isArray(raw.tags) ? (raw.tags as string[]) : undefined,
    count: raw.count as number | undefined
  };
}

const CAMPAIGN_STATUS_VALUES = new Set<string>(Object.values(CampaignStatus));

function parseCampaignStatus(raw: Record<string, unknown>): Campaign['status'] {
  const s = String(raw.status || 'DRAFT');
  if (s === 'STARTED') return CampaignStatus.RUNNING;
  if (CAMPAIGN_STATUS_VALUES.has(s)) return s as Campaign['status'];
  return CampaignStatus.DRAFT;
}

function mapCampaignDoc(d: QueryDocumentSnapshot): Campaign {
  const raw = d.data() as Record<string, unknown>;
  const total = Number(raw.totalContacts) || Number(raw.total) || 0;
  return {
    id: d.id,
    name: (raw.name || 'Campanha') as string,
    message: (raw.message || '') as string,
    messageStages: Array.isArray(raw.messageStages) ? (raw.messageStages as string[]) : undefined,
    replyFlow: raw.replyFlow as Campaign['replyFlow'],
    totalContacts: total,
    processedCount: Number(raw.processedCount) || 0,
    successCount: Number(raw.successCount) || 0,
    failedCount: Number(raw.failedCount) || 0,
    status: parseCampaignStatus(raw),
    selectedConnectionIds: Array.isArray(raw.selectedConnectionIds)
      ? (raw.selectedConnectionIds as string[])
      : Array.isArray(raw.connectionIds)
        ? (raw.connectionIds as string[])
        : [],
    contactListId: String(raw.contactListId || ''),
    contactListName: String(raw.contactListName || ''),
    createdAt: (() => {
      if (typeof raw.createdAt === 'string') return raw.createdAt;
      if (asEpoch(raw.createdAt) > 0) return new Date(asEpoch(raw.createdAt)).toISOString();
      return '';
    })()
  };
}

export type MergedInsightData = {
  contacts: Contact[];
  lists: ContactList[];
  campaigns: Campaign[];
  conns: Record<string, unknown>[];
  /**
   * Menor `createdAt` visto em qualquer documento (usuario + legado) antes do merge, para
   * estimativa de "primeira atividade" alinhada ao que o usuario criou, mesmo com legado na raiz.
   */
  rawMinActivityEpoch: number;
};

export async function loadMergedUserInsightData(db: Firestore, uid: string): Promise<MergedInsightData> {
  const [contactsUser, listsUser, campUser, connSnap, contactsRoot, listsRoot, campRoot] = await Promise.all([
    db.collection('users').doc(uid).collection('contacts').get(),
    db.collection('users').doc(uid).collection('contact_lists').get(),
    db.collection('users').doc(uid).collection('campaigns').get(),
    db.collection('users').doc(uid).collection('connections').get().catch(() => null),
    db.collection('contacts').get().catch((e) => {
      console.warn('[insightMerge] /contacts legado:', (e as Error)?.message || e);
      return { empty: true, docs: [] as QueryDocumentSnapshot[] } as { empty: boolean; docs: QueryDocumentSnapshot[] };
    }),
    db.collection('contact_lists').get().catch((e) => {
      console.warn('[insightMerge] /contact_lists legado:', (e as Error)?.message || e);
      return { empty: true, docs: [] as QueryDocumentSnapshot[] } as { empty: boolean; docs: QueryDocumentSnapshot[] };
    }),
    db.collection('campaigns').get().catch((e) => {
      console.warn('[insightMerge] /campaigns legado:', (e as Error)?.message || e);
      return { empty: true, docs: [] as QueryDocumentSnapshot[] } as { empty: boolean; docs: QueryDocumentSnapshot[] };
    })
  ]);

  const userC = contactsUser.docs.map((d) => mapContactDoc(d));
  const legC = Array.isArray((contactsRoot as { docs: QueryDocumentSnapshot[] }).docs)
    ? (contactsRoot as { docs: QueryDocumentSnapshot[] }).docs.map((d) => mapContactDoc(d))
    : [];
  const userL = listsUser.docs.map((d) => mapListDoc(d));
  const legL = Array.isArray((listsRoot as { docs: QueryDocumentSnapshot[] }).docs)
    ? (listsRoot as { docs: QueryDocumentSnapshot[] }).docs.map((d) => mapListDoc(d))
    : [];
  const userP = campUser.docs.map((d) => mapCampaignDoc(d));
  const legP = Array.isArray((campRoot as { docs: QueryDocumentSnapshot[] }).docs)
    ? (campRoot as { docs: QueryDocumentSnapshot[] }).docs.map((d) => mapCampaignDoc(d))
    : [];

  const contacts = mergeContacts(userC, legC);
  const lists = mergeContactLists(userL, legL);
  const campaigns = mergeCampaigns(userP, legP);
  const conns = connSnap?.docs?.map((d) => d.data() as Record<string, unknown>) || [];

  const rawEpochs: number[] = [];
  for (const s of [contactsUser, listsUser, campUser, contactsRoot, listsRoot, campRoot] as Array<{
    docs: QueryDocumentSnapshot[];
  }>) {
    for (const d of s?.docs || []) {
      const data = d.data() as Record<string, unknown>;
      const t = asEpoch(data.createdAt);
      if (t > 0) rawEpochs.push(t);
    }
  }
  const rawMinActivityEpoch = rawEpochs.length > 0 ? Math.min(...rawEpochs) : 0;

  return { contacts, lists, campaigns, conns, rawMinActivityEpoch };
}
