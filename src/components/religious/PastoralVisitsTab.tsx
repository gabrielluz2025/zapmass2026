import React, { useMemo, useState, useCallback } from 'react';
import {
  Calendar,
  Loader2,
  MapPin,
  Plus,
  Trash2,
  CheckCircle2,
  Wine,
  AlertTriangle,
  Search,
  MessageCircle,
  Download
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAppProfile } from '../../context/AppProfileContext';
import { useAppView } from '../../context/AppViewContext';
import { useZapMassCore } from '../../context/ZapMassContext';
import { usePastoralVisits } from '../../hooks/usePastoralVisits';
import type { Contact } from '../../types';
import type { PastoralVisit } from '../../types/pastoralVisit';
import {
  communionPendingVisits,
  findOverlappingScheduledVisit,
  lastDoneVisitMsByPhone,
  scheduledVisitsInCalendarMonth,
  visitsDoneInCalendarMonth
} from '../../utils/pastoralVisitHelpers';
import { openChatNavigate } from '../../utils/openChatByPhoneNav';
import { downloadPastoralVisitIcs } from '../../utils/pastoralVisitIcs';
import { Badge, Button, Card, Input, Modal, Textarea } from '../ui';

const NO_VISIT_MS = 60 * 86400000;
const DURATIONS = [30, 60, 90] as const;

function normPhoneKey(phone: string): string {
  return (phone || '').replace(/\D/g, '');
}

function toDatetimeLocalValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseDatetimeLocal(s: string): number | null {
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

type ListFilter = 'all' | 'scheduled' | 'done' | 'communion' | 'stale_contacts';

export const PastoralVisitsTab: React.FC = () => {
  const { segment, loading: profileLoading } = useAppProfile();
  const { setCurrentView } = useAppView();
  const { contacts } = useZapMassCore();
  const { visits, loading, error, addVisit, updateVisit, deleteVisit } = usePastoralVisits();

  const [filter, setFilter] = useState<ListFilter>('scheduled');
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [contactQuery, setContactQuery] = useState('');
  const [pickedContact, setPickedContact] = useState<Contact | null>(null);
  const [startLocal, setStartLocal] = useState(() => toDatetimeLocalValue(Date.now() + 86400000));
  const [durationMin, setDurationMin] = useState<number>(60);
  const [communionNeeded, setCommunionNeeded] = useState(false);
  const [notes, setNotes] = useState('');
  const [doneModal, setDoneModal] = useState<PastoralVisit | null>(null);
  const [communionDone, setCommunionDone] = useState(false);

  React.useEffect(() => {
    if (profileLoading) return;
    if (segment !== 'religious') {
      toast('Esta área só está disponível no segmento Religioso.', { icon: '⛪' });
      setCurrentView('dashboard');
    }
  }, [profileLoading, segment, setCurrentView]);

  const now = Date.now();
  const monthRef = useMemo(() => new Date(), []);
  const year = monthRef.getFullYear();
  const monthIdx = monthRef.getMonth();

  const stats = useMemo(() => {
    const doneM = visitsDoneInCalendarMonth(visits, year, monthIdx).length;
    const schedM = scheduledVisitsInCalendarMonth(visits, year, monthIdx).length;
    const ceia = communionPendingVisits(visits).length;
    return { doneM, schedM, ceia };
  }, [visits, year, monthIdx]);

  const lastDoneByPhone = useMemo(() => lastDoneVisitMsByPhone(visits), [visits]);

  const validContacts = useMemo(
    () => contacts.filter((c) => c.status === 'VALID').sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt')),
    [contacts]
  );

  const contactSuggestions = useMemo(() => {
    const q = contactQuery.trim().toLowerCase();
    if (!q) return validContacts.slice(0, 12);
    return validContacts
      .filter(
        (c) =>
          (c.name || '').toLowerCase().includes(q) ||
          normPhoneKey(c.phone).includes(q.replace(/\D/g, ''))
      )
      .slice(0, 20);
  }, [validContacts, contactQuery]);

  const staleContacts = useMemo(() => {
    return validContacts.filter((c) => {
      const k = normPhoneKey(c.phone);
      const last = lastDoneByPhone.get(k);
      if (last == null) return true;
      return now - last > NO_VISIT_MS;
    });
  }, [validContacts, lastDoneByPhone, now]);

  const filteredVisits = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = [...visits];
    if (filter === 'scheduled') list = list.filter((v) => v.status === 'scheduled');
    else if (filter === 'done') list = list.filter((v) => v.status === 'done');
    else if (filter === 'communion') list = communionPendingVisits(list);
    if (q) {
      list = list.filter(
        (v) =>
          (v.contactName || '').toLowerCase().includes(q) ||
          normPhoneKey(v.phone).includes(q.replace(/\D/g, ''))
      );
    }
    list.sort((a, b) => b.scheduledStartMs - a.scheduledStartMs);
    return list;
  }, [visits, filter, search]);

  const openNew = () => {
    setPickedContact(null);
    setContactQuery('');
    setStartLocal(toDatetimeLocalValue(Date.now() + 86400000));
    setDurationMin(60);
    setCommunionNeeded(false);
    setNotes('');
    setModalOpen(true);
  };

  const submitNew = async () => {
    if (!pickedContact) {
      toast.error('Escolha um contato.');
      return;
    }
    const startMs = parseDatetimeLocal(startLocal);
    if (startMs == null) {
      toast.error('Data ou hora inválida.');
      return;
    }
    const endMs = startMs + durationMin * 60_000;
    if (endMs <= startMs) {
      toast.error('Duração inválida.');
      return;
    }
    const overlap = findOverlappingScheduledVisit(visits, startMs, endMs);
    if (overlap) {
      toast.error(
        `Já existe visita agendada neste horário (${overlap.contactName}). Ajuste o horário ou cancele a outra.`,
        { duration: 5000 }
      );
      return;
    }
    setSaving(true);
    try {
      await addVisit({
        contactId: pickedContact.id,
        phone: pickedContact.phone,
        contactName: pickedContact.name || 'Sem nome',
        scheduledStartMs: startMs,
        scheduledEndMs: endMs,
        communionNeeded,
        notes
      });
      toast.success('Visita agendada.');
      setModalOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao guardar.');
    } finally {
      setSaving(false);
    }
  };

  const markDoneOpen = (v: PastoralVisit) => {
    setCommunionDone(Boolean(v.communionNeeded && v.communionDoneAtMs));
    setDoneModal(v);
  };

  const markDoneSubmit = async () => {
    if (!doneModal) return;
    setSaving(true);
    try {
      const patch: Record<string, string | number | boolean | null> = {
        status: 'done',
        doneAtMs: Date.now()
      };
      if (doneModal.communionNeeded) {
        patch.communionDoneAtMs = communionDone ? Date.now() : null;
      }
      await updateVisit(doneModal.id, patch);
      toast.success('Visita registada como realizada.');
      setDoneModal(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao atualizar.');
    } finally {
      setSaving(false);
    }
  };

  const cancelVisit = async (v: PastoralVisit) => {
    if (!window.confirm(`Cancelar visita a ${v.contactName}?`)) return;
    try {
      await updateVisit(v.id, { status: 'cancelled' });
      toast.success('Visita cancelada.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha.');
    }
  };

  const removeVisit = async (v: PastoralVisit) => {
    if (!window.confirm(`Apagar definitivamente a visita a ${v.contactName}?`)) return;
    try {
      await deleteVisit(v.id);
      toast.success('Removida.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha.');
    }
  };

  const fmtRange = useCallback((v: PastoralVisit) => {
    const a = new Date(v.scheduledStartMs);
    const b = new Date(v.scheduledEndMs);
    const d = a.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
    const t1 = a.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const t2 = b.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return `${d} · ${t1}–${t2}`;
  }, []);

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

  const filterBtn = (id: ListFilter, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => setFilter(id)}
      className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg transition-all"
      style={{
        background: filter === id ? 'var(--brand-500)' : 'var(--surface-1)',
        color: filter === id ? '#fff' : 'var(--text-2)',
        border: filter === id ? 'none' : '1px solid var(--border-subtle)'
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="mx-auto max-w-[1200px] px-3 sm:px-5 py-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
            <MapPin className="w-6 h-6 text-emerald-500" />
            Visitas pastorais
          </h1>
          <p className="text-[13px] mt-1 max-w-xl" style={{ color: 'var(--text-3)' }}>
            Agende visitas, acompanhe o mês, Santa Ceia e quem está há mais tempo sem visita realizada (60 dias). Conflitos
            de horário são avisados entre visitas ZapMass agendadas.
          </p>
        </div>
        <Button variant="primary" leftIcon={<Plus className="w-4 h-4" />} onClick={openNew}>
          Nova visita
        </Button>
      </div>

      {error && (
        <div
          className="rounded-xl px-4 py-3 flex items-start gap-2 text-[12.5px] whitespace-pre-wrap leading-relaxed"
          style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--text-1)', border: '1px solid rgba(239,68,68,0.25)' }}
        >
          <AlertTriangle className="w-4 h-4 shrink-0 text-red-500 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
            Realizadas (mês)
          </p>
          <p className="text-3xl font-extrabold tabular-nums mt-1" style={{ color: 'var(--text-1)' }}>
            {stats.doneM}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
            Agendadas (mês)
          </p>
          <p className="text-3xl font-extrabold tabular-nums mt-1" style={{ color: 'var(--text-1)' }}>
            {stats.schedM}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
            Ceia pendente
          </p>
          <p className="text-3xl font-extrabold tabular-nums mt-1" style={{ color: 'var(--text-1)' }}>
            {stats.ceia}
          </p>
          <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
            Agendar levar ceia ou realizada sem registo de ceia
          </p>
        </Card>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {filterBtn('scheduled', 'Agendadas')}
          {filterBtn('done', 'Realizadas')}
          {filterBtn('communion', 'Ceia pendente')}
          {filterBtn('all', 'Todas')}
          {filterBtn('stale_contacts', 'Sem visita (60d)')}
        </div>
        {filter !== 'stale_contacts' ? (
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center mb-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-3)' }} />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filtrar por nome ou telefone…"
                className="pl-9"
              />
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className="py-16 flex justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
          </div>
        ) : filter === 'stale_contacts' ? (
          <div className="space-y-2">
            <p className="text-[12px] mb-2" style={{ color: 'var(--text-3)' }}>
              Contatos válidos sem visita <strong>realizada</strong> há mais de 60 dias (ou nunca registada aqui).
            </p>
            {staleContacts.length === 0 ? (
              <p className="text-[13px] py-8 text-center" style={{ color: 'var(--text-3)' }}>
                Nenhum neste critério.
              </p>
            ) : (
              <ul className="divide-y rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-subtle)' }}>
                {staleContacts.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between gap-2 px-3 py-2.5"
                    style={{ background: 'var(--surface-1)' }}
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-[13px] truncate" style={{ color: 'var(--text-1)' }}>
                        {c.name}
                      </p>
                      <p className="text-[11px] font-mono" style={{ color: 'var(--text-3)' }}>
                        {c.phone}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Abrir no Pipeline (WhatsApp)"
                        onClick={() => openChatNavigate(setCurrentView, c.phone, c.name)}
                      >
                        <MessageCircle className="w-4 h-4" style={{ color: 'var(--brand-600)' }} />
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setPickedContact(c);
                          setContactQuery(c.name);
                          setStartLocal(toDatetimeLocalValue(Date.now() + 86400000));
                          setModalOpen(true);
                        }}
                      >
                        Agendar
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : filteredVisits.length === 0 ? (
          <p className="text-[13px] py-10 text-center" style={{ color: 'var(--text-3)' }}>
            Nenhuma visita neste filtro.
          </p>
        ) : (
          <ul className="space-y-2">
            {filteredVisits.map((v) => (
              <li
                key={v.id}
                className="rounded-xl p-3 flex flex-col sm:flex-row sm:items-center gap-3 justify-between"
                style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-[14px]" style={{ color: 'var(--text-1)' }}>
                      {v.contactName}
                    </p>
                    {v.status === 'scheduled' && (
                      <Badge variant="info">Agendada</Badge>
                    )}
                    {v.status === 'done' && <Badge variant="success">Realizada</Badge>}
                    {v.status === 'cancelled' && <Badge variant="neutral">Cancelada</Badge>}
                    {v.status === 'no_show' && <Badge variant="warning">Não compareceu</Badge>}
                    {v.communionNeeded && (
                      <Badge variant={v.communionDoneAtMs ? 'success' : 'warning'}>
                        {v.communionDoneAtMs ? 'Ceia feita' : 'Ceia pendente'}
                      </Badge>
                    )}
                  </div>
                  <p className="text-[12px] mt-0.5 flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
                    <Calendar className="w-3.5 h-3.5 shrink-0" />
                    {fmtRange(v)}
                  </p>
                  {v.notes ? (
                    <p className="text-[12px] mt-1 line-clamp-2" style={{ color: 'var(--text-2)' }}>
                      {v.notes}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2 shrink-0 items-center">
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Abrir no Pipeline (WhatsApp)"
                    onClick={() => openChatNavigate(setCurrentView, v.phone, v.contactName)}
                  >
                    <MessageCircle className="w-4 h-4" style={{ color: 'var(--brand-600)' }} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Descarregar .ics (Google, Apple, Outlook)"
                    onClick={() => {
                      downloadPastoralVisitIcs(v);
                      toast.success('Ficheiro .ics gerado. Abra no calendário do telemóvel ou arraste para o Google Calendar.');
                    }}
                  >
                    <Download className="w-4 h-4" style={{ color: 'var(--text-2)' }} />
                  </Button>
                  {v.status === 'scheduled' && (
                    <>
                      <Button variant="primary" size="sm" leftIcon={<CheckCircle2 className="w-3.5 h-3.5" />} onClick={() => markDoneOpen(v)}>
                        Realizada
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => cancelVisit(v)}>
                        Cancelar
                      </Button>
                    </>
                  )}
                  <Button variant="ghost" size="sm" leftIcon={<Trash2 className="w-3.5 h-3.5" />} onClick={() => removeVisit(v)}>
                    Apagar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        isOpen={modalOpen}
        onClose={() => !saving && setModalOpen(false)}
        title="Nova visita pastoral"
        subtitle="Escolha o membro, data e duração. O sistema avisa se coincidir com outra visita agendada."
        icon={<MapPin className="w-5 h-5 text-emerald-500" />}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>
              Fechar
            </Button>
            <Button variant="primary" onClick={submitNew} loading={saving}>
              Guardar
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1" style={{ color: 'var(--text-3)' }}>
              Contato
            </label>
            <Input
              value={contactQuery}
              onChange={(e) => {
                setContactQuery(e.target.value);
                setPickedContact(null);
              }}
              placeholder="Pesquisar nome ou telefone…"
            />
            {pickedContact ? (
              <p className="text-[12px] mt-1.5" style={{ color: 'var(--brand-600)' }}>
                Selecionado: <strong>{pickedContact.name}</strong> ({pickedContact.phone})
              </p>
            ) : (
              <ul
                className="mt-2 max-h-40 overflow-y-auto rounded-lg border divide-y"
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                {contactSuggestions.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 text-[13px] hover:bg-[var(--surface-2)]"
                      style={{ color: 'var(--text-1)' }}
                      onClick={() => {
                        setPickedContact(c);
                        setContactQuery(c.name);
                      }}
                    >
                      {c.name}
                      <span className="block text-[11px] font-mono" style={{ color: 'var(--text-3)' }}>
                        {c.phone}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1" style={{ color: 'var(--text-3)' }}>
                Início
              </label>
              <input
                type="datetime-local"
                value={startLocal}
                onChange={(e) => setStartLocal(e.target.value)}
                className="ui-input ui-focus-ring w-full"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1" style={{ color: 'var(--text-3)' }}>
                Duração
              </label>
              <select
                value={durationMin}
                onChange={(e) => setDurationMin(Number(e.target.value))}
                className="ui-input ui-focus-ring w-full"
              >
                {DURATIONS.map((m) => (
                  <option key={m} value={m}>
                    {m} minutos
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" className="mt-1" checked={communionNeeded} onChange={(e) => setCommunionNeeded(e.target.checked)} />
            <span className="text-[13px] leading-snug" style={{ color: 'var(--text-1)' }}>
              <span className="inline-flex items-center gap-1 font-medium">
                <Wine className="w-3.5 h-3.5 text-amber-600" />
                Levar / administrar Santa Ceia nesta visita
              </span>
            </span>
          </label>
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1" style={{ color: 'var(--text-3)' }}>
              Notas (opcional)
            </label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Endereço, pedido de oração…" />
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(doneModal)}
        onClose={() => !saving && setDoneModal(null)}
        title="Marcar visita como realizada"
        subtitle={doneModal?.contactName}
        icon={<CheckCircle2 className="w-5 h-5 text-emerald-500" />}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDoneModal(null)} disabled={saving}>
              Voltar
            </Button>
            <Button variant="primary" onClick={markDoneSubmit} loading={saving}>
              Confirmar
            </Button>
          </div>
        }
      >
        {doneModal?.communionNeeded ? (
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" className="mt-1" checked={communionDone} onChange={(e) => setCommunionDone(e.target.checked)} />
            <span className="text-[13px]" style={{ color: 'var(--text-1)' }}>
              Santa Ceia foi administrada nesta visita
            </span>
          </label>
        ) : (
          <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>
            Nenhuma ceia estava marcada para esta visita.
          </p>
        )}
      </Modal>
    </div>
  );
};
