import React, { useCallback, useEffect, useState } from 'react';
import { Download, Loader2, Shield, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import {
  downloadDataExport,
  fetchLegalAcceptances,
  requestDataDeletion,
  type LegalAcceptanceRow
} from '../../services/tenantExtrasApi';
import { Card, Button } from '../ui';

/** Portal LGPD: exportar dados e solicitar exclusão. */
export const LgpdPrivacyPanel: React.FC = () => {
  const { user } = useAuth();
  const [acceptances, setAcceptances] = useState<LegalAcceptanceRow[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'export' | 'delete' | null>(null);
  const [loadingAcc, setLoadingAcc] = useState(true);

  const loadAcceptances = useCallback(async () => {
    if (!user) return;
    setLoadingAcc(true);
    try {
      const token = await user.getIdToken();
      setAcceptances(await fetchLegalAcceptances(token));
    } finally {
      setLoadingAcc(false);
    }
  }, [user]);

  useEffect(() => {
    void loadAcceptances();
  }, [loadAcceptances]);

  const handleExport = async () => {
    if (!user) return;
    setBusy('export');
    try {
      const token = await user.getIdToken();
      await downloadDataExport(token);
      toast.success('Exportação iniciada (JSON).');
    } catch {
      toast.error('Falha ao exportar dados.');
    } finally {
      setBusy(null);
    }
  };

  const handleDeleteRequest = async () => {
    if (!user) return;
    if (!window.confirm('Registrar solicitação de exclusão de todos os dados da conta? A equipe ZION entrará em contato.')) {
      return;
    }
    setBusy('delete');
    try {
      const token = await user.getIdToken();
      const res = await requestDataDeletion(token, note);
      if (res.ok) {
        toast.success(res.message || 'Solicitação registrada.');
        setNote('');
      } else {
        toast.error(res.error || 'Erro ao registrar.');
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(16,185,129,0.12)' }}>
          <Shield className="w-4 h-4" style={{ color: 'var(--brand-600)' }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
            Seus dados (LGPD)
          </p>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-3)' }}>
            Exporte uma cópia portável ou solicite exclusão conforme a Política de Privacidade.
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            <Button
              variant="secondary"
              size="sm"
              leftIcon={busy === 'export' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              disabled={busy !== null}
              onClick={() => void handleExport()}
            >
              Exportar meus dados (JSON)
            </Button>
          </div>
          <div className="mt-4 space-y-2">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Motivo ou observação (opcional) para solicitação de exclusão"
              className="w-full text-[12px] rounded-lg px-3 py-2 resize-none"
              style={{ background: 'var(--surface-0)', border: '1px solid var(--border-subtle)', color: 'var(--text-1)' }}
            />
            <Button
              variant="danger"
              size="sm"
              leftIcon={busy === 'delete' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              disabled={busy !== null}
              onClick={() => void handleDeleteRequest()}
            >
              Solicitar exclusão de dados
            </Button>
          </div>
          {!loadingAcc && acceptances.length > 0 ? (
            <div className="mt-4 pt-3 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
              <p className="text-[10px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--text-3)' }}>
                Aceites registrados
              </p>
              <ul className="text-[11px] space-y-1" style={{ color: 'var(--text-2)' }}>
                {acceptances.slice(0, 6).map((a, i) => (
                  <li key={`${a.doc_type}-${i}`}>
                    {a.doc_type} v{a.doc_version} — {new Date(a.accepted_at).toLocaleString('pt-BR')}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
};
