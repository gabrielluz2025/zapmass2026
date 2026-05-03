import type { Contact, ReligiousMemberProfile } from '../../types';
import { storedDateToBrDisplay } from '../../utils/brDateMask';
import { parseWeddingDayMonth, yearsCelebratingAtNextAnniversary } from '../../utils/weddingAnniversary';

export const MINISTER_ROLES = [
  'Congregado',
  'Membro',
  'Cooperador',
  'Diácono',
  'Diaconisa',
  'Presbítero',
  'Evangelista',
  'Pastor'
] as const;

export const LEADER_GROUPS = ['Crianças', 'Adolescentes', 'Jovens', 'Irmãs'] as const;

const MINISTER_SET = new Set<string>(MINISTER_ROLES as readonly string[]);

export type MemberFormState = {
  name: string;
  phone: string;
  landline: string;
  email: string;
  church: string;
  roleFree: string;
  birthday: string;
  profession: string;
  street: string;
  number: string;
  neighborhood: string;
  zipCode: string;
  city: string;
  state: string;
  country: string;
  notes: string;
  rg: string;
  rgIssueDate: string;
  rgIssuer: string;
  cpf: string;
  nationality: string;
  birthPlace: string;
  gender: '' | 'M' | 'F';
  educationLevel: string;
  fatherName: string;
  motherName: string;
  maritalStatus: string;
  spouseName: string;
  weddingDate: string;
  ministerRoles: string[];
  leaderGroups: string[];
  professionOfFaith: string;
  baptismDate: string;
  previousChurch: string;
  previousPastor: string;
  receivedBy: '' | 'faith' | 'transfer' | 'acclaim';
  churchJoinDate: string;
  baptizedHolySpirit: '' | 'yes' | 'no';
  holySpiritDate: string;
};

export function emptyForm(): MemberFormState {
  return {
    name: '',
    phone: '',
    landline: '',
    email: '',
    church: '',
    roleFree: '',
    birthday: '',
    profession: '',
    street: '',
    number: '',
    neighborhood: '',
    zipCode: '',
    city: '',
    state: '',
    country: 'Brasil',
    notes: '',
    rg: '',
    rgIssueDate: '',
    rgIssuer: '',
    cpf: '',
    nationality: '',
    birthPlace: '',
    gender: '',
    educationLevel: '',
    fatherName: '',
    motherName: '',
    maritalStatus: '',
    spouseName: '',
    weddingDate: '',
    ministerRoles: [],
    leaderGroups: [],
    professionOfFaith: '',
    baptismDate: '',
    previousChurch: '',
    previousPastor: '',
    receivedBy: '',
    churchJoinDate: '',
    baptizedHolySpirit: '',
    holySpiritDate: ''
  };
}

export function normalizeBRPhone(raw: string): string {
  const d = (raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length >= 12 && d.length <= 13 && d.startsWith('55')) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

export function parseContactRole(role: string): { ministerFromRole: string[]; roleFree: string } {
  const t = (role || '').trim();
  if (!t) return { ministerFromRole: [], roleFree: '' };
  const parts = t.split(' · ');
  const left = (parts[0] || '').trim();
  const roleFree = parts.slice(1).join(' · ').trim();
  const tokens = left.split(',').map((s) => s.trim()).filter(Boolean);
  const ministerFromRole = tokens.filter((x) => MINISTER_SET.has(x));
  const unmatched = tokens.filter((x) => !MINISTER_SET.has(x));
  const extraFree = [...unmatched, roleFree].filter(Boolean).join(' · ');
  return { ministerFromRole, roleFree: extraFree };
}

/** Preenche o estado da ficha a partir de um contato (edição no modal ou hidratação). */
export function contactToMemberForm(c: Contact): MemberFormState {
  const r = c.religiousMemberProfile || {};
  const parsed = parseContactRole(c.role || '');
  const ministerRoles =
    r.ministerRoles && r.ministerRoles.length > 0 ? [...r.ministerRoles] : [...parsed.ministerFromRole];
  return {
    ...emptyForm(),
    name: c.name || '',
    phone: c.phone || '',
    email: c.email || '',
    church: c.church || '',
    roleFree: parsed.roleFree,
    birthday: storedDateToBrDisplay(c.birthday || ''),
    profession: c.profession || '',
    street: c.street || '',
    number: c.number || '',
    neighborhood: c.neighborhood || '',
    zipCode: c.zipCode || '',
    city: c.city || '',
    state: c.state || '',
    country: r.country || 'Brasil',
    notes: c.notes || '',
    rg: r.rg || '',
    rgIssueDate: storedDateToBrDisplay(r.rgIssueDate || ''),
    rgIssuer: r.rgIssuer || '',
    cpf: r.cpf || '',
    nationality: r.nationality || '',
    birthPlace: r.birthPlace || '',
    gender: r.gender === 'M' || r.gender === 'F' ? r.gender : '',
    landline: r.landline || '',
    educationLevel: r.educationLevel || '',
    fatherName: r.fatherName || '',
    motherName: r.motherName || '',
    maritalStatus: r.maritalStatus || '',
    spouseName: r.spouseName || '',
    weddingDate: storedDateToBrDisplay(r.weddingDate || ''),
    ministerRoles,
    leaderGroups: [...(r.leaderGroups || [])],
    professionOfFaith: r.professionOfFaith || '',
    baptismDate: storedDateToBrDisplay(r.baptismDate || ''),
    previousChurch: r.previousChurch || '',
    previousPastor: r.previousPastor || '',
    receivedBy: r.receivedBy === 'faith' || r.receivedBy === 'transfer' || r.receivedBy === 'acclaim' ? r.receivedBy : '',
    churchJoinDate: storedDateToBrDisplay(r.churchJoinDate || ''),
    baptizedHolySpirit: r.baptizedHolySpirit === 'yes' || r.baptizedHolySpirit === 'no' ? r.baptizedHolySpirit : '',
    holySpiritDate: storedDateToBrDisplay(r.holySpiritDate || '')
  };
}

export function toggleInList(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

export function buildReligiousProfile(f: MemberFormState): ReligiousMemberProfile {
  const p: ReligiousMemberProfile = {};
  const s = (v: string) => v.trim();
  if (s(f.rg)) p.rg = s(f.rg);
  if (s(f.rgIssueDate)) p.rgIssueDate = s(f.rgIssueDate);
  if (s(f.rgIssuer)) p.rgIssuer = s(f.rgIssuer);
  if (s(f.cpf)) p.cpf = s(f.cpf);
  if (s(f.nationality)) p.nationality = s(f.nationality);
  if (s(f.birthPlace)) p.birthPlace = s(f.birthPlace);
  if (f.gender === 'M' || f.gender === 'F') p.gender = f.gender;
  if (s(f.landline)) p.landline = normalizeBRPhone(f.landline) || s(f.landline);
  if (s(f.educationLevel)) p.educationLevel = s(f.educationLevel);
  if (s(f.fatherName)) p.fatherName = s(f.fatherName);
  if (s(f.motherName)) p.motherName = s(f.motherName);
  if (s(f.maritalStatus)) p.maritalStatus = s(f.maritalStatus);
  if (s(f.spouseName)) p.spouseName = s(f.spouseName);
  if (s(f.weddingDate)) p.weddingDate = s(f.weddingDate);
  if (f.ministerRoles.length) p.ministerRoles = [...f.ministerRoles];
  if (f.leaderGroups.length) p.leaderGroups = [...f.leaderGroups];
  if (s(f.professionOfFaith)) p.professionOfFaith = s(f.professionOfFaith);
  if (s(f.baptismDate)) p.baptismDate = s(f.baptismDate);
  if (s(f.previousChurch)) p.previousChurch = s(f.previousChurch);
  if (s(f.previousPastor)) p.previousPastor = s(f.previousPastor);
  if (f.receivedBy === 'faith' || f.receivedBy === 'transfer' || f.receivedBy === 'acclaim') p.receivedBy = f.receivedBy;
  if (s(f.churchJoinDate)) p.churchJoinDate = s(f.churchJoinDate);
  if (f.baptizedHolySpirit === 'yes' || f.baptizedHolySpirit === 'no') p.baptizedHolySpirit = f.baptizedHolySpirit;
  if (s(f.holySpiritDate)) p.holySpiritDate = s(f.holySpiritDate);
  if (s(f.country)) p.country = s(f.country);
  return p;
}

/**
 * Mapa completo para gravar no Firestore (substitui `religiousMemberProfile` inteiro).
 * Inclui arrays vazios para limpar funções/lideranças quando o utilizador desmarca tudo.
 */
export function buildReligiousProfileComplete(f: MemberFormState): ReligiousMemberProfile {
  const p = buildReligiousProfile(f);
  p.ministerRoles = [...f.ministerRoles];
  p.leaderGroups = [...f.leaderGroups];
  return p;
}

export function mergeReligiousProfile(
  prev: ReligiousMemberProfile | undefined,
  next: ReligiousMemberProfile
): ReligiousMemberProfile {
  return { ...(prev || {}), ...next };
}

/** Há algum dado útil na ficha (para omitir o campo no Firestore em contatos novos). */
export function hasReligiousProfileData(p: ReligiousMemberProfile): boolean {
  for (const v of Object.values(p)) {
    if (Array.isArray(v)) {
      if (v.length > 0) return true;
      continue;
    }
    if (typeof v === 'string' && v.trim()) return true;
  }
  return false;
}

export function religiousExportColumns(): Array<{ label: string; width: number; get: (c: Contact) => string }> {
  return [
    { label: 'RG (ficha)', width: 14, get: (c) => c.religiousMemberProfile?.rg || '' },
    { label: 'RG emissão', width: 12, get: (c) => c.religiousMemberProfile?.rgIssueDate || '' },
    { label: 'RG órgão', width: 14, get: (c) => c.religiousMemberProfile?.rgIssuer || '' },
    { label: 'CPF (ficha)', width: 14, get: (c) => c.religiousMemberProfile?.cpf || '' },
    { label: 'Nacionalidade', width: 14, get: (c) => c.religiousMemberProfile?.nationality || '' },
    { label: 'Naturalidade', width: 16, get: (c) => c.religiousMemberProfile?.birthPlace || '' },
    { label: 'Sexo (ficha)', width: 8, get: (c) => c.religiousMemberProfile?.gender || '' },
    { label: 'Tel fixo', width: 16, get: (c) => c.religiousMemberProfile?.landline || '' },
    { label: 'País', width: 12, get: (c) => c.religiousMemberProfile?.country || '' },
    { label: 'Escolaridade', width: 14, get: (c) => c.religiousMemberProfile?.educationLevel || '' },
    { label: 'Nome pai', width: 22, get: (c) => c.religiousMemberProfile?.fatherName || '' },
    { label: 'Nome mãe', width: 22, get: (c) => c.religiousMemberProfile?.motherName || '' },
    { label: 'Estado civil', width: 14, get: (c) => c.religiousMemberProfile?.maritalStatus || '' },
    { label: 'Cônjuge', width: 22, get: (c) => c.religiousMemberProfile?.spouseName || '' },
    { label: 'Data casamento', width: 12, get: (c) => c.religiousMemberProfile?.weddingDate || '' },
    {
      label: 'Anos próx. bodas',
      width: 12,
      get: (c) => {
        const wd = (c.religiousMemberProfile?.weddingDate || '').trim();
        const md = parseWeddingDayMonth(wd);
        if (!md?.fullYear) return '';
        const y = yearsCelebratingAtNextAnniversary(md);
        return y != null ? String(y) : '';
      }
    },
    { label: 'Funções (ficha)', width: 28, get: (c) => (c.religiousMemberProfile?.ministerRoles || []).join('; ') },
    { label: 'Lider conjunto', width: 22, get: (c) => (c.religiousMemberProfile?.leaderGroups || []).join('; ') },
    { label: 'Profissão de fé', width: 18, get: (c) => c.religiousMemberProfile?.professionOfFaith || '' },
    { label: 'Batismo (data)', width: 12, get: (c) => c.religiousMemberProfile?.baptismDate || '' },
    { label: 'Igreja anterior', width: 22, get: (c) => c.religiousMemberProfile?.previousChurch || '' },
    { label: 'Pastor anterior', width: 20, get: (c) => c.religiousMemberProfile?.previousPastor || '' },
    { label: 'Recebido por', width: 16, get: (c) => c.religiousMemberProfile?.receivedBy || '' },
    { label: 'Data recebimento', width: 14, get: (c) => c.religiousMemberProfile?.churchJoinDate || '' },
    { label: 'Batizado ES', width: 10, get: (c) => c.religiousMemberProfile?.baptizedHolySpirit || '' },
    { label: 'Data ES', width: 12, get: (c) => c.religiousMemberProfile?.holySpiritDate || '' }
  ];
}
