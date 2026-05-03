import React, { useEffect, useMemo, useState } from 'react';
import { Church, Loader2, UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAppProfile } from '../../context/AppProfileContext';
import { useAppView } from '../../context/AppViewContext';
import { useZapMass } from '../../context/ZapMassContext';
import type { Contact } from '../../types';
import { Button, Card, Input, SectionHeader, Textarea } from '../ui';
import {
  LEADER_GROUPS,
  MINISTER_ROLES,
  buildReligiousProfile,
  emptyForm,
  mergeReligiousProfile,
  normalizeBRPhone,
  toggleInList,
  type MemberFormState
} from './religiousMemberFormShared';

function normPhoneKey(p: string): string {
  let d = (p || '').replace(/\D/g, '');
  if (!d) return '';
  if ((d.length === 10 || d.length === 11) && !d.startsWith('55')) d = `55${d}`;
  return d;
}

function pickLonger(current?: string, incoming?: string): string {
  const cur = (current || '').trim();
  const inc = (incoming || '').trim();
  if (!cur) return inc;
  if (!inc) return cur;
  return inc.length > cur.length ? inc : cur;
}

function FieldLabel({ children, optional }: { children: React.ReactNode; optional?: boolean }) {
  return (
    <label className="text-[11px] font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: 'var(--text-3)' }}>
      {children}
      {optional ? <span style={{ color: 'var(--text-3)', fontWeight: 400 }}> (opcional)</span> : null}
    </label>
  );
}

function CheckboxChip({
  checked,
  label,
  onToggle
}: {
  checked: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="text-left rounded-xl px-3 py-2 text-[12px] font-medium transition-all border"
      style={{
        borderColor: checked ? 'rgba(16,185,129,0.55)' : 'var(--border)',
        background: checked ? 'rgba(16,185,129,0.1)' : 'var(--surface-0)',
        color: 'var(--text-1)'
      }}
    >
      {label}
    </button>
  );
}

/**
 * Ficha de membro (segmento religioso). Dados alargados em `religiousMemberProfile`; núcleo em campos de Contact.
 */
export const ReligiousNewMemberTab: React.FC = () => {
  const { segment, loading: profileLoading } = useAppProfile();
  const { setCurrentView } = useAppView();
  const { addContact, updateContact, contacts } = useZapMass();
  const [f, setF] = useState<MemberFormState>(() => emptyForm());
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof MemberFormState>(k: K, v: MemberFormState[K]) => setF((prev) => ({ ...prev, [k]: v }));

  useEffect(() => {
    if (profileLoading) return;
    if (segment !== 'religious') {
      toast('Esta área só está disponível no segmento Religioso.', { icon: '⛪' });
      setCurrentView('dashboard');
    }
  }, [profileLoading, segment, setCurrentView]);

  const contactByPhone = useMemo(() => {
    const m = new Map<string, Contact>();
    for (const c of contacts) {
      const k = normPhoneKey(c.phone || '');
      if (k) m.set(k, c);
    }
    return m;
  }, [contacts]);

  if (profileLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3" style={{ color: 'var(--text-3)' }}>
        <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
        <p className="text-[13px]">A carregar…</p>
      </div>
    );
  }

  if (segment !== 'religious') {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-2 text-center px-4" style={{ color: 'var(--text-3)' }}>
        <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
        <p className="text-[13px]">A voltar ao Painel…</p>
      </div>
    );
  }

  const reset = () => setF(emptyForm());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = f.name.trim();
    const clean = normalizeBRPhone(f.phone);
    const digits = clean.replace(/\D/g, '');
    if (!trimmedName) {
      toast.error('Indique o nome completo.');
      return;
    }
    if (digits.length < 10) {
      toast.error('Celular / WhatsApp inválido. Use DDD + número (ex.: 11999998888).');
      return;
    }

    const profile = buildReligiousProfile(f);
    const roleFromCheckboxes = f.ministerRoles.length > 0 ? f.ministerRoles.join(', ') : '';
    const roleCombined = [roleFromCheckboxes, f.roleFree.trim()].filter(Boolean).join(' · ') || undefined;

    setSaving(true);
    try {
      const key = normPhoneKey(clean);
      const existing = key ? contactByPhone.get(key) : undefined;

      if (existing) {
        const mergedProfile = mergeReligiousProfile(existing.religiousMemberProfile, profile);
        await updateContact(existing.id, {
          name: pickLonger(existing.name, trimmedName),
          phone: clean,
          church: pickLonger(existing.church, f.church),
          role: pickLonger(existing.role, roleCombined),
          profession: pickLonger(existing.profession, f.profession),
          birthday: pickLonger(existing.birthday, f.birthday),
          email: pickLonger(existing.email, f.email),
          street: pickLonger(existing.street, f.street),
          number: pickLonger(existing.number, f.number),
          neighborhood: pickLonger(existing.neighborhood, f.neighborhood),
          zipCode: pickLonger(existing.zipCode, f.zipCode),
          city: pickLonger(existing.city, f.city),
          state: pickLonger(existing.state, f.state),
          notes: [existing.notes, f.notes.trim()].filter(Boolean).join('\n').trim() || existing.notes,
          religiousMemberProfile: mergedProfile
        });
      } else {
        const incoming: Contact = {
          id: Date.now().toString(),
          name: trimmedName,
          phone: clean,
          church: f.church.trim() || undefined,
          role: roleCombined,
          profession: f.profession.trim() || undefined,
          birthday: f.birthday.trim() || undefined,
          email: f.email.trim() || undefined,
          street: f.street.trim() || undefined,
          number: f.number.trim() || undefined,
          neighborhood: f.neighborhood.trim() || undefined,
          zipCode: f.zipCode.trim() || undefined,
          city: f.city.trim() || undefined,
          state: f.state.trim().toUpperCase().slice(0, 2) || undefined,
          notes: f.notes.trim() || undefined,
          tags: ['Novo', 'Membro'],
          status: digits.length >= 10 ? 'VALID' : 'INVALID',
          lastMsg: 'Nunca',
          religiousMemberProfile: Object.keys(profile).length > 0 ? profile : undefined
        };
        await addContact(incoming);
      }
      reset();
    } catch (err) {
      console.error(err);
      toast.error('Não foi possível guardar. Tente de novo.');
    } finally {
      setSaving(false);
    }
  };

  const grid2 = 'grid grid-cols-1 sm:grid-cols-2 gap-4';

  return (
    <div className="space-y-6 pb-14 max-w-4xl mx-auto">
      <SectionHeader
        icon={<Church className="w-5 h-5" />}
        title="Ficha de membro"
        description="Cadastro alinhado a uma ficha eclesiástica: dados pessoais, família, endereço e funções. Grava nos Contatos (telefone principal = WhatsApp). Campos sensíveis (CPF, RG) ficam na sua base — trate o acesso conforme a LGPD."
      />

      <form onSubmit={(ev) => void handleSubmit(ev)} className="space-y-5">
        <Card className="p-5 sm:p-6">
          <h3 className="text-[14px] font-bold mb-4" style={{ color: 'var(--text-1)' }}>
            Dados pessoais
          </h3>
          <div className={grid2}>
            <div className="sm:col-span-2">
              <FieldLabel>Nome completo *</FieldLabel>
              <Input value={f.name} onChange={(e) => set('name', e.target.value)} autoComplete="name" />
            </div>
            <div>
              <FieldLabel optional>RG</FieldLabel>
              <Input value={f.rg} onChange={(e) => set('rg', e.target.value)} />
            </div>
            <div>
              <FieldLabel optional>Data emissão RG</FieldLabel>
              <Input value={f.rgIssueDate} onChange={(e) => set('rgIssueDate', e.target.value)} placeholder="DD/MM/AAAA" />
            </div>
            <div>
              <FieldLabel optional>Órgão expedidor</FieldLabel>
              <Input value={f.rgIssuer} onChange={(e) => set('rgIssuer', e.target.value)} />
            </div>
            <div>
              <FieldLabel optional>CPF</FieldLabel>
              <Input value={f.cpf} onChange={(e) => set('cpf', e.target.value)} inputMode="numeric" />
            </div>
            <div>
              <FieldLabel optional>Nacionalidade</FieldLabel>
              <Input value={f.nationality} onChange={(e) => set('nationality', e.target.value)} />
            </div>
            <div>
              <FieldLabel optional>Data de nascimento</FieldLabel>
              <Input value={f.birthday} onChange={(e) => set('birthday', e.target.value)} placeholder="DD/MM/AAAA" />
            </div>
            <div>
              <FieldLabel optional>Naturalidade</FieldLabel>
              <Input value={f.birthPlace} onChange={(e) => set('birthPlace', e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <FieldLabel optional>Sexo</FieldLabel>
              <div className="flex flex-wrap gap-2">
                {(['M', 'F'] as const).map((g) => (
                  <CheckboxChip
                    key={g}
                    checked={f.gender === g}
                    label={g === 'M' ? 'Masculino' : 'Feminino'}
                    onToggle={() => set('gender', f.gender === g ? '' : g)}
                  />
                ))}
              </div>
            </div>
            <div>
              <FieldLabel optional>Escolaridade</FieldLabel>
              <Input value={f.educationLevel} onChange={(e) => set('educationLevel', e.target.value)} />
            </div>
            <div>
              <FieldLabel optional>Profissão</FieldLabel>
              <Input value={f.profession} onChange={(e) => set('profession', e.target.value)} />
            </div>
          </div>
        </Card>

        <Card className="p-5 sm:p-6">
          <h3 className="text-[14px] font-bold mb-4" style={{ color: 'var(--text-1)' }}>
            Endereço e contacto
          </h3>
          <div className={grid2}>
            <div className="sm:col-span-2">
              <FieldLabel optional>Endereço (rua, av.)</FieldLabel>
              <Input value={f.street} onChange={(e) => set('street', e.target.value)} />
            </div>
            <div>
              <FieldLabel optional>Número</FieldLabel>
              <Input value={f.number} onChange={(e) => set('number', e.target.value)} />
            </div>
            <div>
              <FieldLabel optional>Bairro</FieldLabel>
              <Input value={f.neighborhood} onChange={(e) => set('neighborhood', e.target.value)} />
            </div>
            <div>
              <FieldLabel optional>CEP</FieldLabel>
              <Input value={f.zipCode} onChange={(e) => set('zipCode', e.target.value)} />
            </div>
            <div>
              <FieldLabel optional>Cidade</FieldLabel>
              <Input value={f.city} onChange={(e) => set('city', e.target.value)} />
            </div>
            <div>
              <FieldLabel optional>UF</FieldLabel>
              <Input value={f.state} onChange={(e) => set('state', e.target.value.toUpperCase())} maxLength={2} placeholder="SP" />
            </div>
            <div>
              <FieldLabel optional>País</FieldLabel>
              <Input value={f.country} onChange={(e) => set('country', e.target.value)} />
            </div>
            <div>
              <FieldLabel>Celular / WhatsApp *</FieldLabel>
              <Input value={f.phone} onChange={(e) => set('phone', e.target.value)} inputMode="tel" autoComplete="tel" />
            </div>
            <div>
              <FieldLabel optional>Telefone fixo</FieldLabel>
              <Input value={f.landline} onChange={(e) => set('landline', e.target.value)} inputMode="tel" />
            </div>
            <div className="sm:col-span-2">
              <FieldLabel optional>E-mail</FieldLabel>
              <Input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} autoComplete="email" />
            </div>
          </div>
        </Card>

        <Card className="p-5 sm:p-6">
          <h3 className="text-[14px] font-bold mb-4" style={{ color: 'var(--text-1)' }}>
            Família
          </h3>
          <div className={grid2}>
            <div>
              <FieldLabel optional>Nome do pai</FieldLabel>
              <Input value={f.fatherName} onChange={(e) => set('fatherName', e.target.value)} />
            </div>
            <div>
              <FieldLabel optional>Nome da mãe</FieldLabel>
              <Input value={f.motherName} onChange={(e) => set('motherName', e.target.value)} />
            </div>
            <div>
              <FieldLabel optional>Estado civil</FieldLabel>
              <Input value={f.maritalStatus} onChange={(e) => set('maritalStatus', e.target.value)} />
            </div>
            <div>
              <FieldLabel optional>Nome do cônjuge</FieldLabel>
              <Input value={f.spouseName} onChange={(e) => set('spouseName', e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <FieldLabel optional>Data do casamento</FieldLabel>
              <Input value={f.weddingDate} onChange={(e) => set('weddingDate', e.target.value)} placeholder="DD/MM/AAAA" />
            </div>
          </div>
        </Card>

        <Card className="p-5 sm:p-6">
          <h3 className="text-[14px] font-bold mb-4" style={{ color: 'var(--text-1)' }}>
            Dados eclesiásticos
          </h3>
          <div className="space-y-5">
            <div>
              <FieldLabel optional>Igreja / célula atual</FieldLabel>
              <Input value={f.church} onChange={(e) => set('church', e.target.value)} placeholder="Onde congrega hoje" />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-3)' }}>
                Função ministerial (marque todas)
              </p>
              <div className="flex flex-wrap gap-2">
                {MINISTER_ROLES.map((r) => (
                  <CheckboxChip
                    key={r}
                    checked={f.ministerRoles.includes(r)}
                    label={r}
                    onToggle={() => set('ministerRoles', toggleInList(f.ministerRoles, r))}
                  />
                ))}
              </div>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-3)' }}>
                Líder de conjunto
              </p>
              <div className="flex flex-wrap gap-2">
                {LEADER_GROUPS.map((r) => (
                  <CheckboxChip
                    key={r}
                    checked={f.leaderGroups.includes(r)}
                    label={r}
                    onToggle={() => set('leaderGroups', toggleInList(f.leaderGroups, r))}
                  />
                ))}
              </div>
            </div>
            <div className={grid2}>
              <div className="sm:col-span-2">
                <FieldLabel optional>Complemento de função / ministério (texto livre)</FieldLabel>
                <Input value={f.roleFree} onChange={(e) => set('roleFree', e.target.value)} />
              </div>
              <div>
                <FieldLabel optional>Profissão de fé</FieldLabel>
                <Input value={f.professionOfFaith} onChange={(e) => set('professionOfFaith', e.target.value)} />
              </div>
              <div>
                <FieldLabel optional>Data de batismo</FieldLabel>
                <Input value={f.baptismDate} onChange={(e) => set('baptismDate', e.target.value)} />
              </div>
              <div>
                <FieldLabel optional>Igreja anterior</FieldLabel>
                <Input value={f.previousChurch} onChange={(e) => set('previousChurch', e.target.value)} />
              </div>
              <div>
                <FieldLabel optional>Pastor anterior</FieldLabel>
                <Input value={f.previousPastor} onChange={(e) => set('previousPastor', e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <FieldLabel optional>Recebido nesta igreja por</FieldLabel>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ['faith', 'Profissão de fé'],
                      ['transfer', 'Transferência'],
                      ['acclaim', 'Aclamação']
                    ] as const
                  ).map(([id, label]) => (
                    <CheckboxChip
                      key={id}
                      checked={f.receivedBy === id}
                      label={label}
                      onToggle={() => set('receivedBy', f.receivedBy === id ? '' : id)}
                    />
                  ))}
                </div>
              </div>
              <div>
                <FieldLabel optional>Data de recebimento</FieldLabel>
                <Input value={f.churchJoinDate} onChange={(e) => set('churchJoinDate', e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <FieldLabel optional>Batizado com Espírito Santo?</FieldLabel>
                <div className="flex flex-wrap gap-2">
                  {(['yes', 'no'] as const).map((v) => (
                    <CheckboxChip
                      key={v}
                      checked={f.baptizedHolySpirit === v}
                      label={v === 'yes' ? 'Sim' : 'Não'}
                      onToggle={() => set('baptizedHolySpirit', f.baptizedHolySpirit === v ? '' : v)}
                    />
                  ))}
                </div>
              </div>
              <div>
                <FieldLabel optional>Quando? (Espírito Santo)</FieldLabel>
                <Input value={f.holySpiritDate} onChange={(e) => set('holySpiritDate', e.target.value)} />
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-5 sm:p-6">
          <FieldLabel optional>Observações internas</FieldLabel>
          <Textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} rows={3} placeholder="Notas gerais (aparecem também em Contatos)" />
        </Card>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" disabled={saving} leftIcon={<UserPlus className="w-4 h-4" />}>
            {saving ? 'A guardar…' : 'Guardar ficha'}
          </Button>
          <Button type="button" variant="secondary" disabled={saving} onClick={() => reset()}>
            Limpar formulário
          </Button>
          <Button type="button" variant="ghost" onClick={() => setCurrentView('contacts')}>
            Abrir Contatos
          </Button>
        </div>
      </form>
    </div>
  );
};
