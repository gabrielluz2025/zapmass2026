import React, { useState, useEffect, useRef } from 'react';
import { X, QrCode, Smartphone, Loader2, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useZapMass } from '../context/ZapMassContext';

interface AddConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (name: string) => void;
}

export const AddConnectionModal: React.FC<AddConnectionModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const { socket } = useZapMass();
  const [step, setStep] = useState<'naming' | 'loading_qr' | 'scanning' | 'success'>('naming');
  const [connectionName, setConnectionName] = useState('');
  const [qrCodeData, setQrCodeData] = useState<string | null>(null);
  const [currentConnectionId, setCurrentConnectionId] = useState<string | null>(null);
  /** Evita corrida: ready pode chegar antes do setState do QR no mesmo tick. */
  const pendingConnectionIdRef = useRef<string | null>(null);
  const stepRef = useRef(step);
  stepRef.current = step;

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStep('naming');
      setConnectionName('');
      setQrCodeData(null);
      setCurrentConnectionId(null);
      pendingConnectionIdRef.current = null;
    }
  }, [isOpen]);

  // Socket Listeners for Real-Time Events
  useEffect(() => {
    if (!socket) return;

    const handleQrCode = (data: { connectionId: string, qrCode: string }) => {
        console.log('QR Code Recebido Real:', data);
        setQrCodeData(data.qrCode);
        setCurrentConnectionId(data.connectionId);
        pendingConnectionIdRef.current = data.connectionId;
        setStep('scanning');
        toast.success('QR Code Gerado! Escaneie agora.', {
            icon: '📷',
            duration: 4000
        });
    };

    const handleReady = (data: { connectionId: string }) => {
        const pending = pendingConnectionIdRef.current;
        const s = stepRef.current;
        if (
            data.connectionId === currentConnectionId ||
            data.connectionId === pending ||
            s === 'scanning' ||
            s === 'loading_qr'
        ) {
            setStep('success');
            toast.success('Dispositivo Sincronizado!', {
               icon: '🚀'
            });
            setTimeout(() => {
                onClose();
            }, 2000);
        }
    };

    socket.on('qr-code', handleQrCode);
    socket.on('connection-ready', handleReady);

    return () => {
        socket.off('qr-code', handleQrCode);
        socket.off('connection-ready', handleReady);
    };
  }, [socket, currentConnectionId, onClose]);

  const handleCreate = () => {
      if (!connectionName.trim()) return;
      setStep('loading_qr');
      // Envia evento para criar conexão real
      onSuccess(connectionName); 
  };

  if (!isOpen) return null;

  return (
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
            <div className="flex flex-col items-center text-center py-8">
              <Loader2 className="w-12 h-12 text-emerald-600 animate-spin mb-4" />
              <h3 className="text-lg font-semibold text-gray-800">Iniciando motor do WhatsApp...</h3>
              <p className="text-gray-500 text-sm mt-1">Isso pode levar alguns segundos.</p>
            </div>
          )}

          {step === 'scanning' && qrCodeData && (
            <div className="flex flex-col items-center text-center w-full">
              <div className="bg-white p-4 rounded-xl border-2 border-emerald-100 shadow-inner mb-4 relative group">
                {/* Efeito de Pulse ao redor do QR Code */}
                <div className="relative">
                    <img 
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(qrCodeData)}`} 
                      alt="QR Code" 
                      className="w-52 h-52 object-contain relative z-10"
                    />
                    {/* Ring Pulse Animation */}
                    <div className="absolute -inset-4 border-2 border-emerald-400/50 rounded-xl animate-pulse z-0"></div>
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
  );
};