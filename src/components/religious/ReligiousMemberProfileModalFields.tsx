import React from 'react';
import { Church, User } from 'lucide-react';
import { BrDateInput, Input } from '../ui';
import {
  LEADER_GROUPS,
  MINISTER_ROLES,
  type MemberFormState,
  toggleInList
} from './religiousMemberFormShared';
import { WeddingAnniversaryHint } from './WeddingAnniversaryHint';

function ModalFieldLabel({ children, optional }: { children: React.ReactNode; optional?: boolean }) {
  return (
    <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">
      {children}
      {optional ? <span className="font-normal text-slate-400"> (opcional)</span> : null}
    </label>
  );
}

function Chip({
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
      className={`text-left rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-all border ${
        checked
          ? 'border-emerald-500/50 bg-emerald-500/10 text-slate-900 dark:text-slate-100'
          : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200'
      }`}
    >
      {label}
    </button>
  );
}

type Props = {
  form: MemberFormState;
  onPatch: (p: Partial<MemberFormState>) => void;
};

const grid2 = 'grid grid-cols-1 sm:grid-cols-2 gap-3';

/**
 * Bloco extra da ficha eclesiástica para o modal de Contatos (segmento religioso).
 */
export const ReligiousMemberProfileModalFields: React.FC<Props> = ({ form: f, onPatch }) => {
  const set = <K extends keyof MemberFormState>(k: K, v: MemberFormState[K]) => onPatch({ [k]: v } as Partial<MemberFormState>);

  return (
    <div className="space-y-5 border-t border-slate-100 dark:border-slate-800 pt-5">
      <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
        <User className="w-3.5 h-3.5" /> Ficha de membro (RG, família, eclesiástico)
      </h4>
      <p className="text-[11px] text-slate-500 dark:text-slate-400 -mt-2">
        Estes campos gravam em <strong>religiousMemberProfile</strong> no mesmo contato. CPF/RG: trate o acesso conforme a LGPD.
      </p>

      <div className="bg-slate-50 dark:bg-slate-800/40 p-4 rounded-xl border border-slate-100 dark:border-slate-700 space-y-4">
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Documento e pessoais extra</p>
        <div className={grid2}>
          <div>
            <ModalFieldLabel optional>RG</ModalFieldLabel>
            <Input value={f.rg} onChange={(e) => set('rg', e.target.value)} className="ui-input" />
          </div>
          <div>
            <ModalFieldLabel optional>Data emissão RG</ModalFieldLabel>
            <BrDateInput value={f.rgIssueDate} onValueChange={(v) => set('rgIssueDate', v)} className="ui-input" />
          </div>
          <div>
            <ModalFieldLabel optional>Órgão expedidor</ModalFieldLabel>
            <Input value={f.rgIssuer} onChange={(e) => set('rgIssuer', e.target.value)} className="ui-input" />
          </div>
          <div>
            <ModalFieldLabel optional>CPF</ModalFieldLabel>
            <Input value={f.cpf} onChange={(e) => set('cpf', e.target.value)} inputMode="numeric" className="ui-input" />
          </div>
          <div>
            <ModalFieldLabel optional>Nacionalidade</ModalFieldLabel>
            <Input value={f.nationality} onChange={(e) => set('nationality', e.target.value)} className="ui-input" />
          </div>
          <div>
            <ModalFieldLabel optional>Naturalidade</ModalFieldLabel>
            <Input value={f.birthPlace} onChange={(e) => set('birthPlace', e.target.value)} className="ui-input" />
          </div>
          <div className="sm:col-span-2">
            <ModalFieldLabel optional>Sexo</ModalFieldLabel>
            <div className="flex flex-wrap gap-2">
              {(['M', 'F'] as const).map((g) => (
                <Chip
                  key={g}
                  checked={f.gender === g}
                  label={g === 'M' ? 'Masculino' : 'Feminino'}
                  onToggle={() => set('gender', f.gender === g ? '' : g)}
                />
              ))}
            </div>
          </div>
          <div>
            <ModalFieldLabel optional>Escolaridade</ModalFieldLabel>
            <Input value={f.educationLevel} onChange={(e) => set('educationLevel', e.target.value)} className="ui-input" />
          </div>
          <div>
            <ModalFieldLabel optional>País</ModalFieldLabel>
            <Input value={f.country} onChange={(e) => set('country', e.target.value)} className="ui-input" />
          </div>
          <div>
            <ModalFieldLabel optional>Telefone fixo</ModalFieldLabel>
            <Input value={f.landline} onChange={(e) => set('landline', e.target.value)} inputMode="tel" className="ui-input" />
          </div>
        </div>
      </div>

      <div className="bg-slate-50 dark:bg-slate-800/40 p-4 rounded-xl border border-slate-100 dark:border-slate-700 space-y-4">
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Família</p>
        <div className={grid2}>
          <div>
            <ModalFieldLabel optional>Nome do pai</ModalFieldLabel>
            <Input value={f.fatherName} onChange={(e) => set('fatherName', e.target.value)} className="ui-input" />
          </div>
          <div>
            <ModalFieldLabel optional>Nome da mãe</ModalFieldLabel>
            <Input value={f.motherName} onChange={(e) => set('motherName', e.target.value)} className="ui-input" />
          </div>
          <div>
            <ModalFieldLabel optional>Estado civil</ModalFieldLabel>
            <Input value={f.maritalStatus} onChange={(e) => set('maritalStatus', e.target.value)} className="ui-input" />
          </div>
          <div>
            <ModalFieldLabel optional>Casado(a) com (nome do cônjuge)</ModalFieldLabel>
            <Input value={f.spouseName} onChange={(e) => set('spouseName', e.target.value)} className="ui-input" />
          </div>
          <div className="sm:col-span-2">
            <ModalFieldLabel optional>Data do casamento (bodas todo ano neste dia)</ModalFieldLabel>
            <BrDateInput
              value={f.weddingDate}
              onValueChange={(v) => set('weddingDate', v)}
              placeholder="DD/MM/AAAA (com ano para anos de casados)"
              className="ui-input"
            />
            {f.weddingDate.trim() ? <WeddingAnniversaryHint weddingDate={f.weddingDate} /> : null}
          </div>
        </div>
      </div>

      <div className="bg-emerald-50/40 dark:bg-emerald-950/20 p-4 rounded-xl border border-emerald-100/60 dark:border-emerald-900/40 space-y-4">
        <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-800/80 dark:text-emerald-300 flex items-center gap-2">
          <Church className="w-3.5 h-3.5" /> Eclesiástico (ficha)
        </p>
        <div>
          <p className="text-[10px] font-semibold text-slate-500 mb-1.5">Função ministerial</p>
          <div className="flex flex-wrap gap-1.5">
            {MINISTER_ROLES.map((r) => (
              <Chip
                key={r}
                checked={f.ministerRoles.includes(r)}
                label={r}
                onToggle={() => set('ministerRoles', toggleInList(f.ministerRoles, r))}
              />
            ))}
          </div>
        </div>
        <div>
          <p className="text-[10px] font-semibold text-slate-500 mb-1.5">Líder de conjunto</p>
          <div className="flex flex-wrap gap-1.5">
            {LEADER_GROUPS.map((r) => (
              <Chip
                key={r}
                checked={f.leaderGroups.includes(r)}
                label={r}
                onToggle={() => set('leaderGroups', toggleInList(f.leaderGroups, r))}
              />
            ))}
          </div>
        </div>
        <div>
          <ModalFieldLabel optional>Complemento de função (texto livre)</ModalFieldLabel>
          <Input value={f.roleFree} onChange={(e) => set('roleFree', e.target.value)} className="ui-input" placeholder="Ex.: líder de louvor" />
        </div>
        <div className={grid2}>
          <div>
            <ModalFieldLabel optional>Profissão de fé</ModalFieldLabel>
            <Input value={f.professionOfFaith} onChange={(e) => set('professionOfFaith', e.target.value)} className="ui-input" />
          </div>
          <div>
            <ModalFieldLabel optional>Data de batismo</ModalFieldLabel>
            <BrDateInput value={f.baptismDate} onValueChange={(v) => set('baptismDate', v)} className="ui-input" />
          </div>
          <div>
            <ModalFieldLabel optional>Igreja anterior</ModalFieldLabel>
            <Input value={f.previousChurch} onChange={(e) => set('previousChurch', e.target.value)} className="ui-input" />
          </div>
          <div>
            <ModalFieldLabel optional>Pastor anterior</ModalFieldLabel>
            <Input value={f.previousPastor} onChange={(e) => set('previousPastor', e.target.value)} className="ui-input" />
          </div>
          <div className="sm:col-span-2">
            <ModalFieldLabel optional>Recebido nesta igreja por</ModalFieldLabel>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ['faith', 'Profissão de fé'],
                  ['transfer', 'Transferência'],
                  ['acclaim', 'Aclamação']
                ] as const
              ).map(([id, label]) => (
                <Chip
                  key={id}
                  checked={f.receivedBy === id}
                  label={label}
                  onToggle={() => set('receivedBy', f.receivedBy === id ? '' : id)}
                />
              ))}
            </div>
          </div>
          <div>
            <ModalFieldLabel optional>Data de recebimento</ModalFieldLabel>
            <BrDateInput value={f.churchJoinDate} onValueChange={(v) => set('churchJoinDate', v)} className="ui-input" />
          </div>
          <div className="sm:col-span-2">
            <ModalFieldLabel optional>Batizado com Espírito Santo?</ModalFieldLabel>
            <div className="flex flex-wrap gap-1.5">
              {(['yes', 'no'] as const).map((v) => (
                <Chip
                  key={v}
                  checked={f.baptizedHolySpirit === v}
                  label={v === 'yes' ? 'Sim' : 'Não'}
                  onToggle={() => set('baptizedHolySpirit', f.baptizedHolySpirit === v ? '' : v)}
                />
              ))}
            </div>
          </div>
          <div>
            <ModalFieldLabel optional>Quando? (Espírito Santo)</ModalFieldLabel>
            <BrDateInput value={f.holySpiritDate} onValueChange={(v) => set('holySpiritDate', v)} className="ui-input" />
          </div>
        </div>
      </div>
    </div>
  );
};
