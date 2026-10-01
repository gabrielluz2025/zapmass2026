import React, { useCallback, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Loader2,
  Upload,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { ConnectionStatus, WhatsAppConnection } from '../../types';
import { Button } from '../ui';
import {
  CAMPAIGN_SPREADSHEET_TEMPLATE_HEADERS,
  type CampaignSpreadsheetParsedRow,
  parseCampaignSpreadsheetRows,
} from '../../utils/campaignSpreadsheetImport';
import {
  apiVerifyCampaignRecipientPhones,
  type CampaignRecipientWaVerifyResult,
} from '../../services/campaignsApi';

export type CampaignSpreadsheetWaStatus = CampaignRecipientWaVerifyResult | 'pending';

export type CampaignSpreadsheetRowState = CampaignSpreadsheetParsedRow & {
  waStatus: CampaignSpreadsheetWaStatus;
  sendPhone: string;
  include: boolean;
};

type Props = {
  connections: WhatsAppConnection[];
  rows: CampaignSpreadsheetRowState[];
  onRowsChange: (rows: CampaignSpreadsheetRowState[]) => void;
  verifyConnectionId: string;
  onVerifyConnectionIdChange: (id: string) => void;
  verificationDone: boolean;
  onVerificationDoneChange: (done: boolean) => void;
  fileLabel: string;
  onFileLabelChange: (label: string) => void;
};

function downloadCampaignTemplateXlsx(): void {
  const wb = XLSX.utils.book_new();
  const sample = [
    CAMPAIGN_SPREADSHEET_TEMPLATE_HEADERS,
    [
      '5511999887766',
      'Maria Silva',
      'São Paulo',
      'Igreja Exemplo',
      'Líder',
      'Engenheira',
      'maria@email.com',
      '1990-03-15',
      'João Silva',
      '2018-06-12',
      '8',
    ],
  ];
  const ws = XLSX.utils.aoa_to_sheet(sample);
  ws['!cols'] = CAMPAIGN_SPREADSHEET_TEMPLATE_HEADERS.map(() => ({ wch: 18 }));
  XLSX.utils.book_append_sheet(wb, ws, 'Destinatarios');
  const instr = [
    ['Instrucoes'],
    ['1. Telefone obrigatorio: DDI 55 + DDD + numero (celular).'],
    ['2. Nome e demais colunas sao opcionais — viram variaveis {nome}, {cidade}, etc. na mensagem.'],
    ['3. Para encerrar dados cedo, na coluna Telefone escreva ZAPMASS_FIM_DADOS (linha e abaixo ignorados).'],
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(instr);
  XLSX.utils.book_append_sheet(wb, ws2, 'Ajuda');
  XLSX.writeFile(wb, 'modelo_campanha_zapmass.xlsx');
}

function rowToState(r: CampaignSpreadsheetParsedRow): CampaignSpreadsheetRowState {
  return {
    ...r,
    waStatus: 'pending',
    sendPhone: r.phone,
    include: r.formatOk,
  };
}

function applyWaResult(
  rows: CampaignSpreadsheetRowState[],
  result: { phone: string; result: CampaignRecipientWaVerifyResult; canonical?: string }
): CampaignSpreadsheetRowState[] {
  const key = result.phone;
  return rows.map((row) => {
    if (!row.formatOk || row.phone !== key) return row;
    const sendPhone =
      result.result === 'corrected' && result.canonical ? result.canonical : row.phone;
    const include =
      result.result === 'found' || result.result === 'corrected' || result.result === 'uncertain';
    return {
      ...row,
      waStatus: result.result,
      sendPhone,
      include,
      phone: sendPhone,
      vars: { ...row.vars, telefone: sendPhone },
    };
  });
}

export const CampaignSpreadsheetAudience: React.FC<Props> = ({
  connections,
  rows,
  onRowsChange,
  verifyConnectionId,
  onVerifyConnectionIdChange,
  verificationDone,
  onVerificationDoneChange,
  fileLabel,
  onFileLabelChange,
}) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyProgress, setVerifyProgress] = useState({ done: 0, total: 0 });

  const onlineConnections = useMemo(
    () =>
      connections.filter(
        (c) => c.status === ConnectionStatus.CONNECTED && Boolean(c.phoneNumber?.trim())
      ),
    [connections]
  );

  const stats = useMemo(() => {
    const formatOk = rows.filter((r) => r.formatOk).length;
    const formatBad = rows.length - formatOk;
    const waOk = rows.filter((r) => r.waStatus === 'found' || r.waStatus === 'corrected').length;
    const waMissing = rows.filter((r) => r.waStatus === 'missing').length;
    const waUncertain = rows.filter((r) => r.waStatus === 'uncertain').length;
    const toSend = rows.filter((r) => r.include && r.formatOk).length;
    return { formatOk, formatBad, waOk, waMissing, waUncertain, toSend };
  }, [rows]);

  const handleDownloadTemplate = () => {
    downloadCampaignTemplateXlsx();
    toast.success('Modelo baixado. Preencha e importe abaixo.');
  };

  const handleFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      const lower = file.name.toLowerCase();
      if (!lower.endsWith('.xlsx') && !lower.endsWith('.xls')) {
        toast.error('Use um arquivo Excel (.xlsx).');
        return;
      }
      try {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const sheetRows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
          header: 1,
          raw: false,
          defval: '',
        });
        const parsed = parseCampaignSpreadsheetRows(sheetRows);
        if (!parsed.ok) {
          toast.error(parsed.error, { duration: 7000 });
          return;
        }
        onRowsChange(parsed.rows.map(rowToState));
        onFileLabelChange(file.name);
        onVerificationDoneChange(false);
        toast.success(
          `${parsed.rows.length} linha(s) carregada(s).${parsed.cutByMarker ? ' Marcador de fim aplicado.' : ''} Clique em «Verificar números».`
        );
      } catch {
        toast.error('Falha ao ler a planilha.');
      }
    },
    [onRowsChange, onFileLabelChange, onVerificationDoneChange]
  );

  const runVerify = async () => {
    const validPhones = rows.filter((r) => r.formatOk).map((r) => r.phone);
    if (validPhones.length === 0) {
      toast.error('Nenhum telefone com formato válido na planilha.');
      return;
    }
    const connId = verifyConnectionId || onlineConnections[0]?.id;
    if (!connId) {
      toast.error('Conecte um chip WhatsApp antes de verificar números.');
      return;
    }
    setVerifying(true);
    setVerifyProgress({ done: 0, total: validPhones.length });
    let offset = 0;
    let working = [...rows];
    try {
      while (offset < validPhones.length) {
        const batch = await apiVerifyCampaignRecipientPhones({
          phones: validPhones,
          connectionId: connId,
          offset,
          limit: 80,
        });
        for (const item of batch.results) {
          working = applyWaResult(working, item);
        }
        onRowsChange(working);
        offset = batch.nextOffset;
        setVerifyProgress({ done: Math.min(offset, validPhones.length), total: validPhones.length });
        if (!batch.hasMore) break;
      }
      onVerificationDoneChange(true);
      const ok = working.filter(
        (r) => r.waStatus === 'found' || r.waStatus === 'corrected'
      ).length;
      toast.success(
        `Verificação concluída: ${ok} com WhatsApp confirmado. Revise a lista antes de avançar.`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha na verificação.';
      toast.error(msg, { duration: 8000 });
    } finally {
      setVerifying(false);
    }
  };

  const toggleInclude = (lineNumber: number) => {
    onRowsChange(
      rows.map((r) => (r.lineNumber === lineNumber ? { ...r, include: !r.include } : r))
    );
  };

  const previewRows = rows.slice(0, 12);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={handleDownloadTemplate}>
          <Download className="w-4 h-4 mr-1.5" />
          Baixar modelo (.xlsx)
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="w-4 h-4 mr-1.5" />
          Importar planilha
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={handleFile}
        />
      </div>

      {fileLabel && (
        <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>
          Arquivo: <strong style={{ color: 'var(--text-2)' }}>{fileLabel}</strong>
        </p>
      )}

      {rows.length > 0 && (
        <>
          <div
            className="rounded-xl px-4 py-3 text-[12px] flex flex-wrap gap-x-4 gap-y-1"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}
          >
            <span>{rows.length} linha(s)</span>
            <span style={{ color: 'var(--brand-600)' }}>{stats.formatOk} formato OK</span>
            {stats.formatBad > 0 && (
              <span style={{ color: '#b45309' }}>{stats.formatBad} formato inválido</span>
            )}
            {verificationDone && (
              <>
                <span style={{ color: '#059669' }}>{stats.waOk} no WhatsApp</span>
                {stats.waMissing > 0 && (
                  <span style={{ color: '#dc2626' }}>{stats.waMissing} sem WhatsApp</span>
                )}
                {stats.waUncertain > 0 && (
                  <span style={{ color: '#6b7280' }}>{stats.waUncertain} incertos</span>
                )}
              </>
            )}
            <span className="font-semibold">{stats.toSend} selecionados para envio</span>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="text-[12px] flex flex-col gap-1" style={{ color: 'var(--text-2)' }}>
              Chip para consulta WhatsApp
              <select
                className="text-[13px] px-3 py-2 rounded-lg min-w-[200px]"
                style={{
                  background: 'var(--surface-0)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-1)',
                }}
                value={verifyConnectionId || onlineConnections[0]?.id || ''}
                onChange={(e) => onVerifyConnectionIdChange(e.target.value)}
                disabled={verifying}
              >
                {onlineConnections.length === 0 && (
                  <option value="">Nenhum chip online</option>
                )}
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || c.id}
                    {c.status === ConnectionStatus.CONNECTED ? ' · online' : ' · offline'}
                  </option>
                ))}
              </select>
            </label>
            <Button
              type="button"
              size="sm"
              onClick={runVerify}
              disabled={verifying || rows.length === 0}
            >
              {verifying ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  Verificando… {verifyProgress.done}/{verifyProgress.total}
                </>
              ) : (
                'Verificar números'
              )}
            </Button>
          </div>

          {!verificationDone && stats.formatOk > 0 && (
            <p
              className="text-[11.5px] flex items-center gap-1.5"
              style={{ color: '#b45309' }}
            >
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              Valide no WhatsApp antes de avançar — evita disparos para números inexistentes.
            </p>
          )}

          <div
            className="rounded-xl overflow-hidden text-[11.5px]"
            style={{ border: '1px solid var(--border-subtle)' }}
          >
            <table className="w-full">
              <thead style={{ background: 'var(--surface-2)' }}>
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Linha</th>
                  <th className="text-left px-3 py-2 font-semibold">Telefone</th>
                  <th className="text-left px-3 py-2 font-semibold">Nome</th>
                  <th className="text-left px-3 py-2 font-semibold">Formato</th>
                  <th className="text-left px-3 py-2 font-semibold">WhatsApp</th>
                  <th className="text-center px-3 py-2 font-semibold">Enviar</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((r) => (
                  <tr key={r.lineNumber} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    <td className="px-3 py-1.5">{r.lineNumber}</td>
                    <td className="px-3 py-1.5 font-mono text-[11px]">{r.sendPhone || r.phoneRaw}</td>
                    <td className="px-3 py-1.5">{r.vars.nome || '—'}</td>
                    <td className="px-3 py-1.5">
                      {r.formatOk ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 inline" />
                      ) : (
                        <span className="text-amber-700">{r.formatError || 'Inválido'}</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      {r.waStatus === 'pending' && '—'}
                      {r.waStatus === 'found' && (
                        <span className="text-emerald-700">Confirmado</span>
                      )}
                      {r.waStatus === 'corrected' && (
                        <span className="text-emerald-700">Corrigido (9º dígito)</span>
                      )}
                      {r.waStatus === 'missing' && (
                        <span className="text-red-600">Sem WhatsApp</span>
                      )}
                      {r.waStatus === 'uncertain' && (
                        <span className="text-gray-600">Incerto</span>
                      )}
                      {r.waStatus === 'invalid_format' && (
                        <span className="text-amber-700">Formato</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <input
                        type="checkbox"
                        checked={r.include && r.formatOk}
                        disabled={!r.formatOk}
                        onChange={() => toggleInclude(r.lineNumber)}
                        aria-label={`Incluir linha ${r.lineNumber}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > previewRows.length && (
              <p className="px-3 py-2 text-[11px]" style={{ color: 'var(--text-3)' }}>
                Mostrando {previewRows.length} de {rows.length} linhas.
              </p>
            )}
          </div>
        </>
      )}

      {rows.length === 0 && (
        <p className="text-[12px] py-4 text-center" style={{ color: 'var(--text-3)' }}>
          Baixe o modelo, preencha telefones (e opcionalmente nomes/variáveis) e importe o arquivo.
        </p>
      )}
    </div>
  );
};
