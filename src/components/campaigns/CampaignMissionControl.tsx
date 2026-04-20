import React, { useMemo, useState } from 'react';
import { Activity, BarChart3, CalendarDays, Cpu, History, Layers, Sparkles, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Campaign, CampaignStatus, ConnectionStatus, WhatsAppConnection } from '../../types';
import { Badge, Button, Card, Input, Tabs } from '../ui';
import {
  clearAuditLog,
  deleteTemplate,
  loadAuditLog,
  loadTemplates,
  saveTemplate
} from '../../utils/campaignMissionStorage';
import { templateToWizardDraft } from '../../utils/campaignDraft';
import type { CampaignAuditEntry, CampaignWizardDraft, SavedCampaignTemplate } from '../../types/campaignMission';

type MissionTab = 'timeline' | 'chips' | 'templates' | 'audit';

interface CampaignMissionControlProps {
  campaigns: Campaign[];
  connections: WhatsAppConnection[];
  onOpenDetails: (id: string) => void;
  onApplyDraft: (draft: CampaignWizardDraft) => void;
  onCreate: () => void;
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const CampaignMissionControl: React.FC<CampaignMissionControlProps> = ({
  campaigns,
  connections,
  onOpenDetails,
  onApplyDraft,
  onCreate
}) => {
  const [missionTab, setMissionTab] = useState<MissionTab>('timeline');
  const [templates, setTemplates] = useState<SavedCampaignTemplate[]>(() => loadTemplates());
  const [audit, setAudit] = useState<CampaignAuditEntry[]>(() => loadAuditLog());
  const [tplName, setTplName] = useState('');

  const refreshTemplates = () => setTemplates(loadTemplates());
  const refreshAudit = () => setAudit(loadAuditLog());

  const timelineBuckets = useMemo(() => {
    const days = 14;
    const buckets: { key: string; label: string; count: number; running: number }[] = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = dayKey(d);
      const label = d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
      const onDay = campaigns.filter((c) => c.createdAt && c.createdAt.slice(0, 10) === key);
      buckets.push({
        key,
        label,
        count: onDay.length,
        running: onDay.filter((c) => c.status === CampaignStatus.RUNNING || c.status === CampaignStatus.PAUSED).length
      });
    }
    return buckets;
  }, [campaigns]);

  const maxBar = useMemo(() => Math.max(1, ...timelineBuckets.map((b) => b.count)), [timelineBuckets]);

  const chipLoad = useMemo(() => {
    return connections.map((conn) => {
      const relevant = campaigns.filter(
        (c) => Array.isArray(c.selectedConnectionIds) && c.selectedConnectionIds.includes(conn.id)
      );
      const sent = relevant.reduce((a, c) => a + (c.successCount || 0), 0);
      const failed = relevant.reduce((a, c) => a + (c.failedCount || 0), 0);
      const active = relevant.filter(
        (c) => c.status === CampaignStatus.RUNNING || c.status === CampaignStatus.PAUSED
      ).length;
      return { conn, sent, failed, active, campaigns: relevant.length };
    });
  }, [campaigns, connections]);

  const saveQuickTemplate = () => {
    const name = tplName.trim();
    if (name.length < 2) {
      toast.error('Dê um nome ao modelo (mín. 2 caracteres).');
      return;
    }
    try {
      const raw = localStorage.getItem('zapmass:last_wizard_template_payload');
      if (!raw) {
        toast.error('Nada para salvar. Abra o assistente, preencha mensagem e use "Guardar rascunho no assistente" primeiro.');
        return;
      }
      const parsed = JSON.parse(raw) as {
        delaySeconds: number;
        campaignFlowMode: 'sequential' | 'reply';
        stages: SavedCampaignTemplate['stages'];
      };
      saveTemplate({
        name,
        delaySeconds: parsed.delaySeconds,
        campaignFlowMode: parsed.campaignFlowMode,
        stages: parsed.stages
      });
      setTplName('');
      refreshTemplates();
      toast.success('Modelo salvo.');
    } catch {
      toast.error('Não foi possível ler o rascunho. Abra Nova campanha e tente de novo.');
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 border-l-4 border-emerald-500">
        <div className="flex flex-col sm:flex-row sm:items-start gap-3">
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'rgba(16,185,129,0.12)' }}
          >
            <Sparkles className="w-5 h-5 text-emerald-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="ui-title text-[16px]">Centro de missões</h2>
            <p className="ui-subtitle text-[12.5px] mt-1">
              Linha do tempo, carga por chip, modelos reutilizáveis e trilha de auditoria local. O laboratório A/B fica na{' '}
              <strong>última etapa</strong> do assistente (modo sequencial).
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              <Button variant="primary" size="sm" onClick={onCreate}>
                Nova campanha
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <Tabs
        value={missionTab}
        onChange={(v) => setMissionTab(v as MissionTab)}
        items={[
          { id: 'timeline', label: 'Linha do tempo', icon: <CalendarDays className="w-3.5 h-3.5" /> },
          { id: 'chips', label: 'Saúde dos chips', icon: <Cpu className="w-3.5 h-3.5" /> },
          { id: 'templates', label: 'Modelos', icon: <Layers className="w-3.5 h-3.5" /> },
          { id: 'audit', label: 'Auditoria', icon: <History className="w-3.5 h-3.5" /> }
        ]}
      />

      {missionTab === 'timeline' && (
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-4 h-4" style={{ color: 'var(--brand-600)' }} />
            <h3 className="ui-title text-[14px]">Campanhas criadas nos últimos 14 dias</h3>
          </div>
          <div className="flex items-end gap-1 h-36 px-1 overflow-x-auto pb-2">
            {timelineBuckets.map((b) => (
              <div key={b.key} className="flex flex-col items-center gap-1 min-w-[28px] flex-1">
                <div
                  className="w-full rounded-t-md transition-all min-h-[4px]"
                  style={{
                    height: `${Math.max(8, (b.count / maxBar) * 100)}%`,
                    background: b.running > 0 ? 'linear-gradient(to top, #10b981, #6ee7b7)' : 'var(--brand-300)',
                    maxHeight: '120px'
                  }}
                  title={`${b.label}: ${b.count} campanha(s)`}
                />
                <span className="text-[9px] text-center leading-tight" style={{ color: 'var(--text-3)' }}>
                  {b.label.replace(/\.$/, '')}
                </span>
              </div>
            ))}
          </div>
          <p className="text-[11px] mt-2" style={{ color: 'var(--text-3)' }}>
            Altura = quantidade de campanhas criadas naquele dia. Verde mais claro indica atividade ainda em execução ou pausada.
          </p>
        </Card>
      )}

      {missionTab === 'chips' && (
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-4 h-4" style={{ color: 'var(--brand-600)' }} />
            <h3 className="ui-title text-[14px]">Carga por chip (histórico das campanhas listadas)</h3>
          </div>
          {connections.length === 0 ? (
            <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>
              Nenhum chip cadastrado.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead>
                  <tr style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border-subtle)' }}>
                    <th className="py-2 pr-2">Chip</th>
                    <th className="py-2 pr-2">Status</th>
                    <th className="py-2 pr-2">Campanhas</th>
                    <th className="py-2 pr-2">Ativas</th>
                    <th className="py-2 pr-2">Envios ok</th>
                    <th className="py-2">Falhas</th>
                  </tr>
                </thead>
                <tbody>
                  {chipLoad.map(({ conn, sent, failed, active, campaigns: cc }) => (
                    <tr key={conn.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td className="py-2.5 pr-2 font-semibold" style={{ color: 'var(--text-1)' }}>
                        {conn.name}
                      </td>
                      <td className="py-2.5 pr-2">
                        <Badge variant={conn.status === ConnectionStatus.CONNECTED ? 'success' : 'warning'} dot>
                          {conn.status}
                        </Badge>
                      </td>
                      <td className="py-2.5 pr-2 tabular-nums">{cc}</td>
                      <td className="py-2.5 pr-2 tabular-nums">{active}</td>
                      <td className="py-2.5 pr-2 tabular-nums text-emerald-600">{sent.toLocaleString()}</td>
                      <td className="py-2.5 tabular-nums text-red-500">{failed.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {missionTab === 'templates' && (
        <Card>
          <h3 className="ui-title text-[14px] mb-1">Biblioteca de modelos</h3>
          <p className="ui-subtitle text-[12px] mb-4">
            No assistente, após escrever a mensagem, use o botão <strong>Guardar como modelo</strong> (disponível na etapa Mensagem). Depois
            liste e aplique aqui.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 mb-4">
            <Input
              placeholder="Nome rápido (salva último rascunho do assistente)"
              value={tplName}
              onChange={(e) => setTplName(e.target.value)}
            />
            <Button variant="secondary" type="button" onClick={saveQuickTemplate}>
              Salvar modelo
            </Button>
          </div>
          {templates.length === 0 ? (
            <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>
              Nenhum modelo ainda.
            </p>
          ) : (
            <ul className="space-y-2">
              {templates.map((t) => (
                <li
                  key={t.id}
                  className="flex flex-col sm:flex-row sm:items-center gap-2 p-3 rounded-xl"
                  style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[13px]" style={{ color: 'var(--text-1)' }}>
                      {t.name}
                    </p>
                    <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                      {t.stages.length} etapa(s) · {t.campaignFlowMode} · intervalo {t.delaySeconds}s ·{' '}
                      {new Date(t.updatedAt).toLocaleString('pt-BR')}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="primary"
                      type="button"
                      onClick={() => {
                        onApplyDraft(templateToWizardDraft(t));
                        toast.success('Modelo carregado no assistente. Escolha o público e os chips.');
                      }}
                    >
                      Usar no assistente
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      type="button"
                      leftIcon={<Trash2 className="w-4 h-4" />}
                      onClick={() => {
                        deleteTemplate(t.id);
                        refreshTemplates();
                        toast.success('Modelo removido.');
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {missionTab === 'audit' && (
        <Card>
          <div className="flex items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4" style={{ color: 'var(--brand-600)' }} />
              <h3 className="ui-title text-[14px]">Auditoria (local)</h3>
            </div>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => {
                clearAuditLog();
                refreshAudit();
                toast.success('Log limpo neste navegador.');
              }}
            >
              Limpar
            </Button>
          </div>
          <p className="text-[11px] mb-3" style={{ color: 'var(--text-3)' }}>
            Registros de ações neste aparelho. Não substitui logs do servidor.
          </p>
          {audit.length === 0 ? (
            <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>
              Sem eventos ainda.
            </p>
          ) : (
            <ul className="space-y-2 max-h-[320px] overflow-y-auto">
              {audit.map((e) => (
                <li
                  key={e.id}
                  className="text-[12px] py-2 px-3 rounded-lg"
                  style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
                >
                  <span className="text-[10px] font-mono" style={{ color: 'var(--text-3)' }}>
                    {new Date(e.at).toLocaleString('pt-BR')}
                  </span>
                  <span className="text-[11px] font-bold ml-2 px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-2)' }}>
                    {e.action}
                  </span>
                  <p className="mt-1" style={{ color: 'var(--text-1)' }}>
                    {e.label}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
};
