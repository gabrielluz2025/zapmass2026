import React, { useState, useEffect, useRef } from 'react';
import { X, QrCode, Smartphone, Loader2, CheckCircle2, KeyRound, Copy } from 'lucide-react';
import toast from 'react-hot-toast';
import { useZapMass } from '../context/ZapMassContext';
import { ConnectionStatus } from '../types';
import { QRCodeModal } from './QRCodeModal';
import { QrCanvas } from './QrCanvas';

interface AddConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (name: string) => void;
}

const QR_LOAD_TIMEOUT_MS = 120_000;

type InitPhase =
  | 'queued'
  | 'preparing'
  | 'launching-browser'
  | 'loading-whatsapp-web'
  | 'awaiting-scan'
  | 'authenticated'
  | 'ready'
  | 'failed';

const phaseLabels: Record<InitPhase, { title: string; sub: string }> = {
  'queued': { title: 'Na fila', sub: 'Aguardando worker disponível...' },
  'preparing': { title: 'Preparando sessão', sub: 'Limpando estado e isolando perfil do navegador.' },
  'launching-browser': { title: 'Iniciando navegador', sub: 'Abrindo o Chromium em segundo plano.' },
  'loading-whatsapp-web': { title: 'Conectando ao WhatsApp', sub: 'Carregando whatsapp.com (pode levar alguns segundos).' },
  'awaiting-scan': { title: 'Aguardando leitura', sub: 'Escaneie o QR com o seu celular.' },
  'authenticated': { title: 'Autenticado', sub: 'Sincronizando sessão...' },
  'ready': { title: 'Conectado', sub: 'Tudo pronto.' },
  'failed': { title: 'Falha ao iniciar', sub: 'Tente novamente em instantes.' }
};

export const AddConnectionModal: React.FC<AddConnectionModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const { socket, connections, isBackendConnected } = useZapMass();
  const [step, setStep] = useState<'naming' | 'loading_qr' | 'scanning' | 'success'>('naming');
  const [connectionName, setConnectionName] = useState('');
  const [qrCodeData, setQrCodeData] = useState<string | null>(null);
  const [currentConnectionId, setCurrentConnectionId] = useState<string | null>(null);
  const [phase, setPhase] = useState<InitPhase>('queued');
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [autoRetry, setAutoRetry] = useState<{ attempt: number; of: number } | null>(null);
  /** Modo "pareamento por código" no passo scanning. Quando true, mostra UI de telefone + código em vez do QR. */
  const [pairMode, setPairMode] = useState(false);
  const [pairPhone, setPairPhone] = useState('');
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [pairWaiting, setPairWaiting] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);
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
    setPhase('queued');
    setQueuePosition(null);
    setAutoRetry(null);
    setPairMode(false);
    setPairPhone('');
    setPairCode(null);
    setPairWaiting(false);
    setPairError(null);
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

    const onProgress = (data: { connectionId: string; phase: InitPhase; autoRetry?: number; of?: number }) => {
      const stepNow = stepRef.current;
      if (stepNow !== 'loading_qr' && stepNow !== 'scanning') return;
      if (priorConnectionIdsRef.current.has(data.connectionId)) return;
      const pending = pendingConnectionIdRef.current;
      if (pending && pending !== data.connectionId) return;
      if (data.phase === 'failed') return; // tratado por connection-init-failure.
      setPhase(data.phase);
      setQueuePosition(null);
      if (data.autoRetry && data.of) {
        setAutoRetry({ attempt: data.autoRetry, of: data.of });
      } else if (data.phase === 'preparing' || data.phase === 'awaiting-scan' || data.phase === 'authenticated' || data.phase === 'ready') {
        // Em fases positivas, mantém o aviso de retry visível somente se acabou de mudar.
      }
    };

    const onQueueProgress = (data: { phase?: string; queue?: { position?: number }; pendingFor?: string }) => {
      const stepNow = stepRef.current;
      if (stepNow !== 'loading_qr') return;
      // Só relevante para o fluxo de criação aberto neste modal.
      if (data.pendingFor && data.pendingFor !== 'create-connection') return;
      const pos = Number(data.queue?.position || 0);
      if (!Number.isFinite(pos) || pos <= 0) return;
      setPhase('queued');
      setQueuePosition(pos);
    };

    const onPairingCode = (data: { connectionId: string; code: string }) => {
      const pending = pendingConnectionIdRef.current;
      if (pending && pending !== data.connectionId) return;
      setPairCode(data.code);
      setPairWaiting(false);
      setPairError(null);
    };

    const onPairingPending = (data: { connectionId: string }) => {
      const pending = pendingConnectionIdRef.current;
      if (pending && pending !== data.connectionId) return;
      setPairWaiting(true);
      setPairError(null);
    };

    const onPairingFailed = (data: { connectionId: string; message?: string }) => {
      const pending = pendingConnectionIdRef.current;
      if (pending && pending !== data.connectionId) return;
      setPairWaiting(false);
      setPairCode(null);
      setPairError(data.message || 'Não foi possível obter o código.');
    };

    socket.on('qr-code', handleQrCode);
    socket.on('connection-ready', handleReady);
    socket.on('connection-progress', onProgress);
    socket.on('connection-queue-progress', onQueueProgress);
    socket.on('subscription-required', onSubscriptionRequired);
    socket.on('connection-limit-reached', onConnectionLimit);
    socket.on('connection-init-failure', onInitFailure);
    socket.on('session-worker-missing', onSessionWorkerMissing);
    socket.on('pairing-code', onPairingCode);
    socket.on('pairing-code-pending', onPairingPending);
    socket.on('pairing-code-failed', onPairingFailed);

    return () => {
        socket.off('qr-code', handleQrCode);
        socket.off('connection-ready', handleReady);
        socket.off('connection-progress', onProgress);
        socket.off('connection-queue-progress', onQueueProgress);
        socket.off('subscription-required', onSubscriptionRequired);
        socket.off('connection-limit-reached', onConnectionLimit);
        socket.off('connection-init-failure', onInitFailure);
        socket.off('session-worker-missing', onSessionWorkerMissing);
        socket.off('pairing-code', onPairingCode);
        socket.off('pairing-code-pending', onPairingPending);
        socket.off('pairing-code-failed', onPairingFailed);
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
      setPhase('queued');
      setStep('loading_qr');
      onSuccess(connectionName);
  };

  /** Envia ao servidor o pedido de pairing code para o `currentConnectionId`. */
  const handleRequestPairingCode = () => {
    if (!socket || !currentConnectionId) return;
    const digits = pairPhone.replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 16) {
      setPairError('Telefone inválido. Inclua o código do país (ex.: 5511999998888).');
      return;
    }
    setPairError(null);
    setPairCode(null);
    setPairWaiting(true);
    socket.emit('request-pairing-code', { id: currentConnectionId, phone: digits });
  };

  /** Formata "XXXXXXXX" → "XXXX-XXXX" para exibição. */
  const formatPairCode = (code: string) =>
    code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;

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
            <div className="flex flex-col items-center text-center py-6 max-w-sm w-full">
              <Loader2 className="w-12 h-12 text-emerald-600 animate-spin mb-4" />
              <h3 className="text-lg font-semibold text-gray-800">{phaseLabels[phase].title}</h3>
              <p className="text-gray-500 text-sm mt-1">{phaseLabels[phase].sub}</p>

              {queuePosition && queuePosition > 0 && (
                <div className="mt-3 px-3 py-1.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                  Posição na fila: {queuePosition}
                  {queuePosition === 1 ? ' — próximo a iniciar' : ''}
                </div>
              )}

              {autoRetry && (
                <div className="mt-3 px-3 py-1.5 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                  Tentativa automática {autoRetry.attempt}/{autoRetry.of}
                </div>
              )}

              <ol className="mt-5 w-full text-left space-y-1.5 text-[12px]">
                {[
                  { key: 'preparing', label: 'Preparar sessão' },
                  { key: 'launching-browser', label: 'Iniciar navegador' },
                  { key: 'loading-whatsapp-web', label: 'Conectar ao WhatsApp Web' },
                  { key: 'awaiting-scan', label: 'Aguardar QR' }
                ].map(({ key, label }) => {
                  const order: InitPhase[] = ['queued', 'preparing', 'launching-browser', 'loading-whatsapp-web', 'awaiting-scan'];
                  const idxNow = order.indexOf(phase);
                  const idxThis = order.indexOf(key as InitPhase);
                  const done = idxNow > idxThis;
                  const active = idxNow === idxThis;
                  return (
                    <li key={key} className="flex items-center gap-2">
                      <span
                        className={`inline-block w-2.5 h-2.5 rounded-full ${
                          done ? 'bg-emerald-500' : active ? 'bg-amber-500 animate-pulse' : 'bg-slate-300'
                        }`}
                      />
                      <span className={done || active ? 'text-slate-700' : 'text-slate-400'}>{label}</span>
                    </li>
                  );
                })}
              </ol>

              <p className="text-[11px] text-slate-400 mt-4">
                Várias contas em paralelo entram em fila no servidor — outras contas continuam a operar normalmente.
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
                className="mt-5 text-sm font-semibold text-emerald-700 hover:underline"
              >
                Cancelar e voltar
              </button>
            </div>
          )}

          {step === 'scanning' && qrCodeData && !pairMode && (
            <div className="flex flex-col items-center text-center w-full">
              <div className="bg-white p-4 rounded-xl border-2 border-emerald-100 shadow-inner mb-4 relative group">
                <div className="relative">
                    <button
                      type="button"
                      onClick={() => setQrZoomOpen(true)}
                      className="relative z-10 cursor-pointer rounded-lg transition-transform hover:scale-[1.02] active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                      aria-label="Ampliar QR Code"
                      title="Clique para ampliar"
                    >
                      <QrCanvas value={qrCodeData} size={208} className="rounded" ariaLabel="QR Code para ligar WhatsApp" />
                    </button>
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
              
              <p className="text-xs text-emerald-600 font-bold animate-pulse flex items-center gap-2 mb-3">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Aguardando leitura do código...
              </p>

              <button
                type="button"
                onClick={() => setPairMode(true)}
                className="text-[12px] font-semibold text-emerald-700 hover:underline inline-flex items-center gap-1.5"
              >
                <KeyRound className="w-3.5 h-3.5" />
                Não consegue escanear? Use código de 8 dígitos
              </button>
            </div>
          )}

          {step === 'scanning' && pairMode && (
            <div className="flex flex-col items-center text-center w-full">
              <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mb-3">
                <KeyRound className="w-6 h-6 text-emerald-700" />
              </div>
              <h3 className="text-base font-bold text-gray-800">Ligar por código de 8 dígitos</h3>
              <p className="text-[12px] text-gray-500 mt-1 mb-4 max-w-[300px]">
                Insira o número do WhatsApp que vai ligar. O servidor gera um código que você digita
                em <strong>WhatsApp &gt; Configurações &gt; Aparelhos conectados &gt; Conectar com número</strong>.
              </p>

              {!pairCode && (
                <div className="w-full">
                  <label htmlFor="pairPhone" className="sr-only">Telefone</label>
                  <input
                    id="pairPhone"
                    name="pairPhone"
                    type="tel"
                    inputMode="numeric"
                    autoFocus
                    placeholder="55 11 99999-8888"
                    className="ui-input text-center tracking-wider"
                    value={pairPhone}
                    onChange={(e) => setPairPhone(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRequestPairingCode();
                    }}
                    disabled={pairWaiting}
                  />
                  <p className="text-[10px] text-gray-400 mt-1">
                    Inclua o código do país (sem o "+" e sem espaços ou traços).
                  </p>

                  {pairError && (
                    <p className="text-[12px] text-red-600 font-semibold mt-2">{pairError}</p>
                  )}

                  <button
                    type="button"
                    onClick={handleRequestPairingCode}
                    disabled={pairWaiting || pairPhone.replace(/\D/g, '').length < 8}
                    className="mt-4 w-full brand-btn font-medium py-2.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {pairWaiting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Aguardando código...
                      </>
                    ) : (
                      <>
                        <KeyRound className="w-4 h-4" />
                        Gerar código
                      </>
                    )}
                  </button>
                </div>
              )}

              {pairCode && (
                <div className="w-full">
                  <p className="text-[11px] text-gray-500 uppercase font-bold tracking-wider mb-2">Seu código</p>
                  <div className="flex items-center justify-center gap-3">
                    <div
                      className="font-mono text-[28px] font-bold tracking-[0.25em] bg-emerald-50 border-2 border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl select-all"
                      aria-label="Código de pareamento"
                    >
                      {formatPairCode(pairCode)}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(pairCode).then(
                          () => toast.success('Código copiado!', { duration: 2000 }),
                          () => toast.error('Não foi possível copiar.')
                        );
                      }}
                      className="p-2.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition"
                      title="Copiar código"
                      aria-label="Copiar código"
                    >
                      <Copy className="w-4 h-4 text-gray-600" />
                    </button>
                  </div>
                  <p className="text-[12px] text-gray-600 mt-3">
                    No celular: <strong>WhatsApp &gt; Configurações &gt; Aparelhos conectados &gt; Conectar com número</strong>.
                    Digite este código.
                  </p>
                  <p className="text-[11px] text-emerald-600 font-bold animate-pulse flex items-center justify-center gap-2 mt-3">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Aguardando confirmação no celular...
                  </p>
                </div>
              )}

              <button
                type="button"
                onClick={() => {
                  setPairMode(false);
                  setPairCode(null);
                  setPairError(null);
                  setPairWaiting(false);
                }}
                className="mt-4 text-[12px] font-semibold text-emerald-700 hover:underline"
              >
                Voltar para QR Code
              </button>
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