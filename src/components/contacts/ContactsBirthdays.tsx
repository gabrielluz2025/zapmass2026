import React, { useMemo, useState } from 'react';
import { Cake, ChevronLeft, ChevronRight, Gift, MessageCircle, Send, Users, Sparkles } from 'lucide-react';
import type { Contact } from '../../types';

interface BirthdayContact {
  contact: Contact;
  day: number;
  month: number; // 1-12
  daysUntil: number | null; // dias até o próximo aniversário (0 = hoje)
}

interface ContactsBirthdaysProps {
  contacts: Contact[];
  onOpenChat: (contact: Contact) => void;
  onBirthdayCampaign: (contacts: Contact[]) => void;
}

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

/** Extrai dia/mes do birthday em vários formatos: DD/MM, DD/MM/YYYY, YYYY-MM-DD, DD-MM. */
function parseBirthday(raw?: string): { day: number; month: number } | null {
  if (!raw) return null;
  const s = raw.trim();
  // ISO 2025-03-14
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return { day: parseInt(m[3], 10), month: parseInt(m[2], 10) };
  // BR 14/03/2025 ou 14/03
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-]\d{2,4})?/);
  if (m) return { day: parseInt(m[1], 10), month: parseInt(m[2], 10) };
  return null;
}

function daysUntilNext(day: number, month: number): number {
  const now = new Date();
  const y = now.getFullYear();
  let next = new Date(y, month - 1, day);
  const today = new Date(y, now.getMonth(), now.getDate());
  if (next < today) next = new Date(y + 1, month - 1, day);
  return Math.round((next.getTime() - today.getTime()) / 86400000);
}

const ContactsBirthdaysBase: React.FC<ContactsBirthdaysProps> = ({
  contacts,
  onOpenChat,
  onBirthdayCampaign
}) => {
  const today = new Date();
  const [viewMonth, setViewMonth] = useState(today.getMonth()); // 0-11
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [selectedDay, setSelectedDay] = useState<number | null>(today.getDate());

  const withBdays = useMemo<BirthdayContact[]>(() => {
    const out: BirthdayContact[] = [];
    for (const c of contacts) {
      const b = parseBirthday(c.birthday);
      if (!b) continue;
      if (b.month < 1 || b.month > 12 || b.day < 1 || b.day > 31) continue;
      out.push({
        contact: c,
        day: b.day,
        month: b.month,
        daysUntil: daysUntilNext(b.day, b.month)
      });
    }
    return out;
  }, [contacts]);

  // Próximos 30 dias
  const upcoming30 = useMemo(
    () =>
      withBdays
        .filter((b) => b.daysUntil !== null && b.daysUntil! >= 0 && b.daysUntil! <= 30)
        .sort((a, b) => (a.daysUntil || 0) - (b.daysUntil || 0)),
    [withBdays]
  );

  const todayBdays = upcoming30.filter((b) => b.daysUntil === 0);
  const weekBdays = upcoming30.filter((b) => b.daysUntil !== null && b.daysUntil <= 7);
  const monthBdays = upcoming30;

  // Por mês calendário (visualização)
  const byDayOfViewMonth = useMemo(() => {
    const map: Record<number, BirthdayContact[]> = {};
    for (const b of withBdays) {
      if (b.month === viewMonth + 1) {
        if (!map[b.day]) map[b.day] = [];
        map[b.day].push(b);
      }
    }
    return map;
  }, [withBdays, viewMonth]);

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();

  const isCurrentMonth = viewMonth === today.getMonth() && viewYear === today.getFullYear();

  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
    setSelectedDay(null);
  };
  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
    setSelectedDay(null);
  };

  const selectedList = useMemo(() => {
    if (!selectedDay) return [];
    return byDayOfViewMonth[selectedDay] || [];
  }, [byDayOfViewMonth, selectedDay]);

  return (
    <div className="space-y-4">
      {/* KPIs no topo */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <BdayStat label="Hoje" value={todayBdays.length} accent="amber" hint={todayBdays.length > 0 ? 'Parabenize agora' : 'Ninguém hoje'} />
        <BdayStat label="Próximos 7 dias" value={weekBdays.length} accent="emerald" hint="Planeje campanha" />
        <BdayStat label="Próximos 30 dias" value={monthBdays.length} accent="sky" hint="Visão geral" />
        <BdayStat label="Com data cadastrada" value={withBdays.length} accent="violet" hint={`${contacts.length > 0 ? Math.round((withBdays.length / contacts.length) * 100) : 0}% da base`} />
      </div>

      {/* CTA gigante se tem aniversário hoje */}
      {todayBdays.length > 0 && (
        <div className="relative overflow-hidden rounded-2xl border border-amber-300/60 dark:border-amber-900/50 bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50 dark:from-amber-950/40 dark:via-orange-950/40 dark:to-amber-950/40 p-5">
          <div aria-hidden className="absolute -top-10 -right-10 w-48 h-48 rounded-full opacity-40"
            style={{ background: 'radial-gradient(closest-side, rgba(245,158,11,0.5), transparent 70%)' }}
          />
          <div className="relative flex flex-col md:flex-row md:items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/30 shrink-0">
              <Gift className="w-7 h-7 text-white" />
            </div>
            <div className="flex-1">
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-300">Aniversário de hoje</p>
              <h3 className="text-xl md:text-2xl font-black text-slate-900 dark:text-white mt-1 leading-tight">
                {todayBdays.length === 1
                  ? `${todayBdays[0].contact.name} faz aniversário HOJE!`
                  : `${todayBdays.length} contatos fazem aniversário HOJE!`}
              </h3>
              <p className="text-[13px] text-slate-600 dark:text-slate-300 mt-0.5">
                Envie uma mensagem personalizada em segundos. Taxa de resposta em aniversários chega a 3x a média.
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              {todayBdays.length === 1 && (
                <button
                  onClick={() => onOpenChat(todayBdays[0].contact)}
                  className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-900 text-amber-700 dark:text-amber-300 text-sm font-black hover:bg-amber-50 dark:hover:bg-amber-950/40 transition"
                >
                  <MessageCircle className="w-4 h-4" /> Chat
                </button>
              )}
              <button
                onClick={() => onBirthdayCampaign(todayBdays.map((b) => b.contact))}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white text-sm font-black shadow-md shadow-amber-500/30"
              >
                <Send className="w-4 h-4" /> Parabenizar todos
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Grid: calendário + lista */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Calendário */}
        <div className="ui-card p-5 lg:col-span-7">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <button
                onClick={prevMonth}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
                title="Mês anterior"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <h3 className="font-black text-slate-900 dark:text-white text-base min-w-[160px] text-center">
                {MONTH_NAMES[viewMonth]} <span className="text-slate-400">{viewYear}</span>
              </h3>
              <button
                onClick={nextMonth}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
                title="Próximo mês"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <button
              onClick={() => {
                setViewMonth(today.getMonth());
                setViewYear(today.getFullYear());
                setSelectedDay(today.getDate());
              }}
              className="text-[11px] font-black text-emerald-600 dark:text-emerald-400 hover:underline"
            >
              Hoje
            </button>
          </div>

          {/* Cabeçalho dias da semana */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {WEEKDAYS.map((w, i) => (
              <div key={i} className="text-center text-[10px] font-black uppercase tracking-wider text-slate-400 py-1">
                {w}
              </div>
            ))}
          </div>

          {/* Dias */}
          <div className="grid grid-cols-7 gap-1">
            {/* Espaços antes do dia 1 */}
            {Array.from({ length: firstWeekday }).map((_, i) => (
              <div key={`pad-${i}`} />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const list = byDayOfViewMonth[day] || [];
              const hasBdays = list.length > 0;
              const isToday = isCurrentMonth && day === today.getDate();
              const isSelected = selectedDay === day;
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => setSelectedDay(day)}
                  className={`relative aspect-square rounded-lg text-[12px] font-bold transition-all p-1 ${
                    isSelected
                      ? 'bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-md shadow-emerald-500/30'
                      : isToday
                        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/30'
                        : hasBdays
                          ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20'
                          : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className="absolute top-1 left-1.5 tabular-nums">{day}</span>
                  {hasBdays && (
                    <span className={`absolute bottom-1 right-1.5 inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 rounded-full text-[9px] font-black ${
                      isSelected ? 'bg-white text-emerald-600' : 'bg-amber-500 text-white'
                    }`}>
                      {list.length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Legenda */}
          <div className="flex items-center gap-3 mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-amber-500/50" /> Com aniversariante</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-emerald-500/50" /> Hoje</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-gradient-to-br from-emerald-500 to-teal-500" /> Selecionado</span>
          </div>
        </div>

        {/* Lista do dia selecionado OU próximos 30 dias */}
        <div className="ui-card p-5 lg:col-span-5">
          {selectedDay && selectedList.length > 0 ? (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="font-black text-slate-900 dark:text-white flex items-center gap-2 text-sm">
                    <Cake className="w-4 h-4 text-amber-500" /> Dia {selectedDay} de {MONTH_NAMES[viewMonth]}
                  </h3>
                  <p className="text-[11px] text-slate-500">{selectedList.length} aniversariante{selectedList.length > 1 ? 's' : ''}</p>
                </div>
                <button
                  onClick={() => onBirthdayCampaign(selectedList.map((b) => b.contact))}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-[11px] font-black hover:bg-amber-500/20"
                >
                  <Send className="w-3 h-3" /> Campanha
                </button>
              </div>
              <div className="space-y-1.5">
                {selectedList.map((b) => (
                  <BdayRow key={b.contact.id} bday={b} onChat={() => onOpenChat(b.contact)} />
                ))}
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-black text-slate-900 dark:text-white flex items-center gap-2 text-sm">
                  <Sparkles className="w-4 h-4 text-emerald-500" /> Próximos 30 dias
                </h3>
                {monthBdays.length > 0 && (
                  <button
                    onClick={() => onBirthdayCampaign(monthBdays.map((b) => b.contact))}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-[11px] font-black hover:bg-emerald-500/20"
                  >
                    <Send className="w-3 h-3" /> Todos
                  </button>
                )}
              </div>
              {monthBdays.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center py-10">
                  <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-2">
                    <Cake className="w-6 h-6 text-slate-400" />
                  </div>
                  <p className="text-xs text-slate-500">Nenhum aniversariante nos próximos 30 dias.</p>
                  <p className="text-[10.5px] text-slate-400 mt-1">Cadastre a data de nascimento nos contatos para ativar este recurso.</p>
                </div>
              ) : (
                <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
                  {monthBdays.map((b) => (
                    <BdayRow key={b.contact.id} bday={b} onChat={() => onOpenChat(b.contact)} showDaysUntil />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Dica extra se a base tem pouca cobertura */}
      {contacts.length > 0 && withBdays.length / contacts.length < 0.3 && (
        <div className="ui-card p-4 border-l-4 border-sky-500 bg-gradient-to-r from-sky-50/40 to-transparent dark:from-sky-950/20">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <p className="text-sm font-black text-slate-900 dark:text-white">Enriqueça sua base com aniversários</p>
              <p className="text-[12px] text-slate-600 dark:text-slate-400 mt-0.5">
                Apenas {Math.round((withBdays.length / contacts.length) * 100)}% dos seus contatos têm data de nascimento cadastrada. Adicione a coluna "Aniversário" (formato DD/MM ou DD/MM/AAAA) na próxima importação para desbloquear campanhas de aniversário no automático.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const ContactsBirthdays = React.memo(ContactsBirthdaysBase);

const BdayStat: React.FC<{ label: string; value: number; hint: string; accent: 'emerald' | 'amber' | 'sky' | 'violet' }> = ({ label, value, hint, accent }) => {
  const map: Record<string, string> = {
    emerald: 'from-emerald-500/15 to-emerald-500/5 border-emerald-200/60 dark:border-emerald-900/40 text-emerald-700 dark:text-emerald-300',
    amber: 'from-amber-500/15 to-amber-500/5 border-amber-200/60 dark:border-amber-900/40 text-amber-700 dark:text-amber-300',
    sky: 'from-sky-500/15 to-sky-500/5 border-sky-200/60 dark:border-sky-900/40 text-sky-700 dark:text-sky-300',
    violet: 'from-violet-500/15 to-violet-500/5 border-violet-200/60 dark:border-violet-900/40 text-violet-700 dark:text-violet-300'
  };
  return (
    <div className={`rounded-xl border p-3 bg-gradient-to-br ${map[accent]}`}>
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">{label}</p>
      <p className="text-3xl font-black tabular-nums text-slate-900 dark:text-white leading-none mt-1">{value}</p>
      <p className={`text-[11px] font-bold mt-1`}>{hint}</p>
    </div>
  );
};

const BdayRow: React.FC<{
  bday: BirthdayContact;
  onChat: () => void;
  showDaysUntil?: boolean;
}> = ({ bday, onChat, showDaysUntil }) => {
  const { contact, day, month, daysUntil } = bday;
  const label =
    daysUntil === 0
      ? 'hoje'
      : daysUntil === 1
        ? 'amanhã'
        : daysUntil !== null && daysUntil > 0
          ? `em ${daysUntil}d`
          : '';
  return (
    <div className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors group">
      <div className="w-9 h-9 rounded-lg bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 flex items-center justify-center font-black text-xs shrink-0">
        {contact.name.charAt(0).toUpperCase() || '?'}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{contact.name}</p>
        <p className="text-[11px] text-slate-500 truncate">
          {String(day).padStart(2, '0')}/{String(month).padStart(2, '0')}
          {showDaysUntil && label && <span className={`ml-1.5 font-bold ${daysUntil === 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400'}`}>• {label}</span>}
          {contact.phone && <span className="ml-1.5 text-slate-400">• {contact.phone}</span>}
        </p>
      </div>
      <button
        type="button"
        onClick={onChat}
        className="p-1.5 rounded-md text-slate-300 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 opacity-0 group-hover:opacity-100 transition-all"
        title="Abrir no chat"
      >
        <MessageCircle className="w-4 h-4" />
      </button>
    </div>
  );
};
