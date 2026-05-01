import React, { useState, useRef } from 'react';
import { X, Download, Smartphone, Copy, Check } from 'lucide-react';
import { QrCanvas } from './QrCanvas';

interface QRCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  qrCode: string;
  connectionName: string;
}

export const QRCodeModal: React.FC<QRCodeModalProps> = ({ 
  isOpen, 
  onClose, 
  qrCode, 
  connectionName 
}) => {
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const qrWrapperRef = useRef<HTMLDivElement | null>(null);

  if (!isOpen) return null;

  const handleDownload = () => {
    const canvas = qrWrapperRef.current?.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `qrcode-${connectionName.replace(/\s+/g, '-').toLowerCase()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(qrCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Erro ao copiar código:', error);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
      <div className="bg-slate-900/95 backdrop-blur-2xl border border-slate-700/50 rounded-3xl p-8 max-w-lg w-full shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-500/20 border border-amber-500/30 rounded-xl flex items-center justify-center">
              <Smartphone className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white">QR Code Ampliado</h3>
              <p className="text-sm text-slate-400">{connectionName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 bg-slate-800/50 hover:bg-slate-700/50 rounded-lg flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        {/* Toggle Buttons */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setShowCode(false)}
            className={`flex-1 px-4 py-2 rounded-xl transition-colors ${
              !showCode 
                ? 'bg-amber-500/20 border border-amber-500/30 text-amber-400' 
                : 'bg-slate-800/50 border border-slate-600/50 text-slate-400'
            }`}
          >
            QR Code
          </button>
          <button
            onClick={() => setShowCode(true)}
            className={`flex-1 px-4 py-2 rounded-xl transition-colors ${
              showCode 
                ? 'bg-amber-500/20 border border-amber-500/30 text-amber-400' 
                : 'bg-slate-800/50 border border-slate-600/50 text-slate-400'
            }`}
          >
            Código de Conexão
          </button>
        </div>

        {/* Content Area */}
        {!showCode ? (
          /* QR Code View */
          <div className="flex justify-center mb-6" ref={qrWrapperRef}>
            <div className="bg-white p-6 rounded-2xl shadow-2xl border-2 border-amber-500/30">
              <QrCanvas
                value={qrCode}
                size={384}
                ariaLabel={`QR Code Ampliado ${connectionName}`}
              />
            </div>
          </div>
        ) : (
          /* Connection Code View */
          <div className="mb-6">
            <div className="bg-slate-800/50 border border-slate-600/50 rounded-2xl p-6">
              <div className="text-center mb-4">
                <p className="text-sm text-slate-400 mb-2">Código de Conexão</p>
                <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-4 font-mono text-lg text-white break-all">
                  {qrCode}
                </div>
              </div>
              <button
                onClick={handleCopyCode}
                className="w-full bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 rounded-xl px-4 py-3 flex items-center justify-center gap-2 transition-colors"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-400" />
                    <span className="text-sm text-emerald-400 font-medium">Copiado!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 text-amber-400" />
                    <span className="text-sm text-amber-400 font-medium">Copiar Código</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Instructions */}
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-6">
          <div className="flex items-start gap-3">
            <Smartphone className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" />
            <div className="text-sm">
              <p className="text-amber-400 font-medium mb-1">
                {!showCode ? 'Como escanear o QR Code:' : 'Como usar o Código de Conexão:'}
              </p>
              <ol className="text-slate-300 space-y-1">
                {!showCode ? (
                  <>
                    <li>1. Abra o WhatsApp no seu celular</li>
                    <li>2. Vá em Menu → Dispositivos Conectados</li>
                    <li>3. Toque em "Conectar um dispositivo"</li>
                    <li>4. Aponte a câmera para este QR Code</li>
                  </>
                ) : (
                  <>
                    <li>1. Copie o código acima</li>
                    <li>2. Abra o WhatsApp no seu celular</li>
                    <li>3. Vá em Menu → Dispositivos Conectados</li>
                    <li>4. Toque em "Conectar um dispositivo"</li>
                    <li>5. Selecione "Link com número de telefone"</li>
                    <li>6. Cole o código copiado</li>
                  </>
                )}
              </ol>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          {!showCode && (
            <button
              onClick={handleDownload}
              className="flex-1 bg-slate-800/50 hover:bg-slate-700/50 border border-slate-600/50 rounded-xl px-4 py-3 flex items-center justify-center gap-2 transition-colors"
            >
              <Download className="w-4 h-4 text-slate-400" />
              <span className="text-sm text-slate-300">Baixar QR Code</span>
            </button>
          )}
          <button
            onClick={onClose}
            className={`${!showCode ? 'flex-1' : 'w-full'} bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 rounded-xl px-4 py-3 transition-colors`}
          >
            <span className="text-sm text-amber-400 font-medium">Fechar</span>
          </button>
        </div>
      </div>
    </div>
  );
};
