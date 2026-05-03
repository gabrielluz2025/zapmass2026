import React, { useEffect, useMemo, useState } from 'react';
import { Church, Loader2, UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAppProfile } from '../../context/AppProfileContext';
import { useAppView } from '../../context/AppViewContext';
import { useZapMass } from '../../context/ZapMassContext';
import type { Contact } from '../../types';
import { Button, Card, Input, SectionHeader, Textarea } from '../ui';

function normalizeBRPhone(raw: string): string {
  const d = (raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length >= 12 && d.length <= 13 && d.startsWith('55')) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

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

/**
 * Cadastro rápido de membro (segmento religioso). Grava em Contatos como na aba Contatos.
 */
export const ReligiousNewMemberTab: React.FC = () => {
  const { segment, loading: profileLoading } = useAppProfile();
  const { setCurrentView } = useAppView();
  const { addContact, updateContact, contacts } = useZapMass();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [church, setChurch] = useState('');
  const [role, setRole] = useState('');
  const [birthday, setBirthday] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

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

  const reset = () => {
    setName('');
    setPhone('');
    setChurch('');
    setRole('');
    setBirthday('');
    setEmail('');
    setNotes('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    const clean = normalizeBRPhone(phone);
    const digits = clean.replace(/\D/g, '');
    if (!trimmedName) {
      toast.error('Indique o nome do membro.');
      return;
    }
    if (digits.length < 10) {
      toast.error('Telefone inválido. Use DDD + número (ex.: 11999998888).');
      return;
    }

    setSaving(true);
    try {
      const key = normPhoneKey(clean);
      const existing = key ? contactByPhone.get(key) : undefined;

      if (existing) {
        await updateContact(existing.id, {
          name: pickLonger(existing.name, trimmedName),
          phone: clean,
          church: pickLonger(existing.church, church),
          role: pickLonger(existing.role, role),
          birthday: pickLonger(existing.birthday, birthday),
          email: pickLonger(existing.email, email),
          notes: [existing.notes, notes.trim()].filter(Boolean).join('\n').trim() || existing.notes
        });
      } else {
        const incoming: Contact = {
          id: Date.now().toString(),
          name: trimmedName,
          phone: clean,
          church: church.trim() || undefined,
          role: role.trim() || undefined,
          birthday: birthday.trim() || undefined,
          email: email.trim() || undefined,
          notes: notes.trim() || undefined,
          tags: ['Novo', 'Membro'],
          status: digits.length >= 10 ? 'VALID' : 'INVALID',
          lastMsg: 'Nunca'
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

  return (
    <div className="space-y-6 pb-12 max-w-2xl">
      <SectionHeader
        icon={<Church className="w-5 h-5" />}
        title="Novo membro"
        description="Registo rápido na base de contatos (igreja, célula, pastoral). Os dados aparecem na aba Contatos e podem ser usados em campanhas com {nome}, {igreja}, {cargo}, etc."
      />

      <Card className="p-5 sm:p-6">
        <form onSubmit={(ev) => void handleSubmit(ev)} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="text-[11px] font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: 'var(--text-3)' }}>
                Nome completo *
              </label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Maria Silva" autoComplete="name" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-[11px] font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: 'var(--text-3)' }}>
                WhatsApp (telefone) *
              </label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="11999998888 ou +55 11 99999-8888"
                inputMode="tel"
                autoComplete="tel"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: 'var(--text-3)' }}>
                Igreja / célula / grupo
              </label>
              <Input value={church} onChange={(e) => setChurch(e.target.value)} placeholder="Ex.: Sede — Jovens" />
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: 'var(--text-3)' }}>
                Função ou ministério
              </label>
              <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Ex.: diaconisa, recepção" />
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: 'var(--text-3)' }}>
                Data de nascimento
              </label>
              <Input value={birthday} onChange={(e) => setBirthday(e.target.value)} placeholder="DD/MM/AAAA ou AAAA-MM-DD" />
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: 'var(--text-3)' }}>
                E-mail
              </label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="opcional"
                autoComplete="email"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-[11px] font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: 'var(--text-3)' }}>
                Notas
              </label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observações internas (opcional)" rows={3} />
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button type="submit" variant="primary" disabled={saving} leftIcon={<UserPlus className="w-4 h-4" />}>
              {saving ? 'A guardar…' : 'Guardar membro'}
            </Button>
            <Button type="button" variant="secondary" disabled={saving} onClick={() => reset()}>
              Limpar formulário
            </Button>
            <Button type="button" variant="ghost" onClick={() => setCurrentView('contacts')}>
              Abrir Contatos
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
};
