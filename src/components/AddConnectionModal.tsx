import React, { useState, useEffect, useRef } from 'react';
import { X, QrCode, Smartphone, Loader2, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useZapMass } from '../context/ZapMassContext';
import { ConnectionStatus } from '../types';
import { QRCodeModal } from './QRCodeModal';

interface AddConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (name: string) => void;
}

const QR_LOAD_TIMEOUT_MS = 120_000;

export const AddConnectionModal: React.FC<AddConnectionModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const { socket, connections, isBackendConnected } = useZapMass();
  const [step, setStep] = useState<'naming' | 'loading_qr' | 'scanning' | 'success'>('naming');
  const [connectionName, setConnectionName] = useState('');
  const [qrCodeData, setQrCodeData] = useState<string | null>(null);
  const [currentConnectionId, setCurrentConnectionId] = useState<string | null>(null);
  /** Evita corrida: ready pode chegar antes do setState do QR no mesmo tick. */
  const pendingConnectionIdRef = useRef<string | null>(null);
  const stepRef = useRef(step);
  stepRef.current = step;
  /** Ids de canais antes de clicar em "Gerar QR" — acha o canal novo se o evento socket falhar. */
  const priorConnectionIdsRef = useRef<Set<string>>(new Set());
  const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [qrZoomOpen, setQrZoomOpen] = useState(false);

  const prevIsOpenRef = useRef(false);

  // Reset state only quando o modal passa de fechado -> aberto (evita regressao ao naming por re-renders)
  useEffect(() => {
    const wasOpen = prevIsOpenRef.current;
    prevIsOpenRef.current = isOpen;
    if (!isOpen || wasOpen) return;
    setStep('naming');
    setConnectionName('');
    setQrCodeData(null);
    setCurrentConnectionId(null);
    pendingConnectionIdRef.current = null;
    priorConnectionIdsRef.current = new Set();
    setQrZoomOpen(false);
  }, [isOpen]);

  /** Se o evento `qr-code` nao chegar, o contexto ainda actualiza a lista com qrCode no canal novo. */
  useEffect(() => {
    if (step !== 'loading_qr') return;
    const newChannel = connections.find(
      (c) =>
        !priorConnectionIdsRef.current.has(c.id) &&
        (c.status === ConnectionStatus.QR_READY || c.status === ConnectionStatus.CONNECTING) &&
        Boolean(c.qrCode?.length)
    );
    if (newChannel?.qrCode) {
      setQrCodeData(newChannel.qrCode);
      setCurrentConnectionId(newChannel.id);
      pendingConnectionIdRef.current = newChannel.id;
      setStep('scanning');
      if (loadTimerRef.current) {
        clearTimeout(loadTimerRef.current);
        loadTimerRef.current = null;
      }
      toast.success('QR code disponível! Escaneie com o celular.', { icon: '📷', duration: 3500 });
    }
  }, [connections, step]);

  useEffect(() => {
    if (step !== 'loading_qr' || !isOpen) {
      if (loadTimerRef.current) {
        clearTimeout(loadTimerRef.current);
        loadTimerRef.current = null;
      }
      return;
    }
    if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
    loadTimerRef.current = setTimeout(() => {
      loadTimerRef.current = null;
      if (stepRef.current === 'loading_qr') {
        toast.error(
          'Ainda sem QR code. Verifique: servidor Node a correr, uma instância (evite API sem worker com Redis) e a pasta de dados fora de pastas muito lentas. Tente "Gerar QR" de novo ou reinicie o backend.',
          { duration: 12_000 }
        );
        setStep('naming');
      }
    }, QR_LOAD_TIMEOUT_MS);
    return () => {
      if (loadTimerRef.current) {
        clearTimeout(loadTimerRef.current);
        loadTimerRef.current = null;
      }
    };
  }, [step, isOpen]);

  // Só ouve QR/ready enquanto o modal está aberto — evita toast "QR gerado" com modal fechado ou no passo "naming".
  useEffect(() => {
    if (!socket || !isOpen) return;

    const handleQrCode = (data: { connectionId: string; qrCode: string }) => {
      const stepNow = stepRef.current;
      if (stepNow !== 'loading_qr' && stepNow !== 'scanning') return;
      /** QR de canal já existente (ex.: reconnect) quando o usuário espera apenas um canal NOVO após "Gerar QR". */
      if (stepNow === 'loading_qr' && priorConnectionIdsRef.current.has(data.connectionId)) return;

      console.log('QR Code Recebido Real:', data);
      setQrCodeData(data.qrCode);
      setCurrentConnectionId(data.connectionId);
      pendingConnectionIdRef.current = data.connectionId;
      setStep('scanning');
      if (loadTimerRef.current) {
        clearTimeout(loadTimerRef.current);
        loadTimerRef.current = null;
      }
      toast.success('QR Code Gerado! Escaneie agora.', {
        icon: '📷',
        duration: 4000
      });
    };

    const handleReady = (data: { connectionId: string }) => {
      const pending = pendingConnectionIdRef.current;
      const s = stepRef.current;
      if (s !== 'scanning' && s !== 'loading_qr') return;
      if (!pending || data.connectionId !== pending) return;
      setStep('success');
      toast.success('Dispositivo Sincronizado!', {
        icon: '🚀'
      });
      setTimeout(() => {
        onClose();
      }, 2000);
    };

    /** Assinatura/limite reprovados pelo servidor — volta ao form e limpa QR (inclui se já estiver em scanning). */
    const onSubscriptionRequired = () => {
      const s = stepRef.current;
      if (loadTimerRef.current) {
        clearTimeout(loadTimerRef.current);
        loadTimerRef.current = null;
      }
      if (s !== 'loading_qr' && s !== 'scanning') return;
      setStep('naming');
      setQrCodeData(null);
      setCurrentConnectionId(null);
      pendingConnectionIdRef.current = null;
      setQrZoomOpen(false);
    };

    const onConnectionLimit = () => {
      const s = stepRef.current;
      if (loadTimerRef.current) {
        clearTimeout(loadTimerRef.current);
        loadTimerRef.current = null;
      }
      if (s !== 'loading_qr' && s !== 'scanning') return;
      setStep('naming');
      setQrCodeData(null);
      setCurrentConnectionId(null);
      pendingConnectionIdRef.current = null;
      setQrZoomOpen(false);
    };

    const onSessionWorkerMissing = () => {
      if (stepRef.current === 'loading_qr') {
        if (loadTimerRef.current) {
          clearTimeout(loadTimerRef.current);
          loadTimerRef.current = null;
        }
        setStep('naming');
      }
    };

    const onInitFailure = (data: { connectionId: string; message?: string }) => {
      if (stepRef.current !== 'loading_qr') return;
      if (priorConnectionIdsRef.current.has(data.connectionId)) return;
      if (loadTimerRef.current) {
        clearTimeout(loadTimerRef.current);
        loadTimerRef.current = null;
      }
      setStep('naming');
      const det = (data.message || 'Erro desconhecido').trim().slice(0, 300);
      toast.error(
        `Não foi possível iniciar o motor do WhatsApp. ${det}`,
        { duration: 10_000 }
      );
    };

    socket.on('qr-code', handleQrCode);
    socket.on('connection-ready', handleReady);
    socket.on('subscription-required', onSubscriptionRequired);
    socket.on('connection-limit-reached', onConnectionLimit);
    socket.on('connection-init-failure', onInitFailure);
    socket.on('session-worker-missing', onSessionWorkerMissing);

    return () => {
        socket.off('qr-code', handleQrCode);
        socket.off('connection-ready', handleReady);
        socket.off('subscription-required', onSubscriptionRequired);
        socket.off('connection-limit-reached', onConnectionLimit);
        socket.off('connection-init-failure', onInitFailure);
        socket.off('session-worker-missing', onSessionWorkerMissing);
    };
  }, [socket, isOpen, onClose]);

  const handleCreate = () => {
      if (step !== 'naming') return;
      if (!connectionName.trim()) return;
      if (!isBackendConnected) {
        toast.error('Sem ligação ao servidor. Aguarde o indicador "Online" ou recarregue a página.');
        return;
      }
      priorConnectionIdsRef.current = new Set(connections.map((c) => c.id));
      setStep('loading_qr');
      onSuccess(connectionName);
  };

  if (!isOpen) return null;

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm transition-opacity p-4">
      <div className="ui-card w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="ui-card-header flex justify-between items-center bg-[color:var(--surface-2)]">
          <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <QrCode className="w-5 h-5 text-emerald-600" />
            Nova Conexão (WhatsApp Web)
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-black/5 rounded-xl transition-colors ui-muted">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-8 flex flex-col items-center justify-center flex-1">
          
          {step === 'naming' && (
            <div className="w-full">
              <label htmlFor="connectionName" className="block text-sm font-medium text-gray-700 mb-2">Nome da Sessão</label>
              <input 
                id="connectionName"
                name="connectionName"
                type="text" 
                autoFocus
                placeholder="Ex: Comercial, Suporte, Marketing..."
                className="ui-input"
                value={connectionName}
                onChange={(e) => setConnectionName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && connectionName.trim()) {
                    handleCreate();
                  }
                }}
              />
              <p className="text-xs text-gray-500 mt-2">Dê um nome para identificar este chip.</p>
              
              <button 
                disabled={!connectionName.trim()}
                onClick={handleCreate}
                className="mt-6 w-full brand-btn font-medium py-3 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                Gerar QR Code
              </button>
            </div>
          )}

          {step === 'loading_qr' && (
            <div className="flex flex-col items-center text-center py-8 max-w-sm">
              <Loader2 className="w-12 h-12 text-emerald-600 animate-spin mb-4" />
              <h3 className="text-lg font-semibold text-gray-800">Iniciando motor do WhatsApp...</h3>
              <p className="text-gray-500 text-sm mt-1">
                Abrindo o Chrome em segundo plano. Pode levar 30–90 s no primeiro arranque. Se várias pessoas
                conectam ao mesmo tempo, o sistema processa em fila sem bloquear outras contas.
              </p>
              <button
                type="button"
                onClick={() => {
                  if (loadTimerRef.current) {
                    clearTimeout(loadTimerRef.current);
                    loadTimerRef.current = null;
                  }
                  setStep('naming');
                }}
                className="mt-6 text-sm font-semibold text-emerald-700 hover:underline"
              >
                Cancelar e voltar
              </button>
            </div>
          )}

          {step === 'scanning' && qrCodeData && (
            <div className="flex flex-col items-center text-center w-full">
              <div className="bg-white p-4 rounded-xl border-2 border-emerald-100 shadow-inner mb-4 relative group">
                {/* Efeito de Pulse ao redor do QR Code */}
                <div className="relative">
                    <button
                      type="button"
                      onClick={() => setQrZoomOpen(true)}
                      className="relative z-10 cursor-pointer rounded-lg transition-transform hover:scale-[1.02] active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                      aria-label="Ampliar QR Code"
                      title="Clique para ampliar"
                    >
                      <img 
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(qrCodeData)}`} 
                        alt="" 
                        className="w-52 h-52 object-contain pointer-events-none"
                      />
                    </button>
                    {/* Ring Pulse Animation */}
                    <div className="absolute -inset-4 border-2 border-emerald-400/50 rounded-xl animate-pulse z-0 pointer-events-none"></div>
                </div>
              </div>
              
              <div className="text-left w-full bg-gray-50 p-3 rounded-lg border border-gray-100 mb-4">
                <h4 className="font-semibold text-gray-700 text-xs mb-1 flex items-center gap-2">
                  <Smartphone className="w-3 h-3" />
                  Escaneie com seu celular:
                </h4>
                <ol className="list-decimal list-inside text-[10px] text-gray-600 space-y-0.5 ml-1">
                  <li>Abra o WhatsApp {'>'} Configurações</li>
                  <li>Aparelhos conectados {'>'} Conectar</li>
                  <li>Aponte a câmera para este código</li>
                </ol>
              </div>
              
              <p className="text-xs text-emerald-600 font-bold animate-pulse flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Aguardando leitura do código...
              </p>
            </div>
          )}

          {step === 'success' && (
            <div className="flex flex-col items-center text-center py-6 animate-in fade-in zoom-in duration-300">
              <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mb-6">
                <CheckCircle2 className="w-10 h-10 text-emerald-600" />
              </div>
              <h3 className="text-2xl font-bold text-gray-800">Conectado com Sucesso!</h3>
              <p className="text-gray-500 mt-2">O dispositivo foi sincronizado e está pronto para uso.</p>
            </div>
          )}

        </div>
      </div>
    </div>
    <QRCodeModal
      isOpen={qrZoomOpen && Boolean(qrCodeData)}
      onClose={() => setQrZoomOpen(false)}
      qrCode={qrCodeData ?? ''}
      connectionName={connectionName.trim() || 'Nova conexão'}
    />
    </>
  );
};