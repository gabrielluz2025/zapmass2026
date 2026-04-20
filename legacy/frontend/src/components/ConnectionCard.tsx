import React from 'react';
import { Wifi, WifiOff, Trash2, Smartphone, RefreshCw, Send, ListOrdered, Signal, SignalHigh, SignalLow, QrCode, Battery } from 'lucide-react';
import { WhatsAppConnection, ConnectionStatus } from '../types';

interface ConnectionCardProps {
  connection: WhatsAppConnection;
  onDisconnect: (id: string) => void;
  onReconnect: (id: string) => void;
}

export const ConnectionCard: React.FC<ConnectionCardProps> = ({ 
  connection, 
  onDisconnect, 
  onReconnect 
}) => {
  const isConnected = connection.status === ConnectionStatus.CONNECTED;
  
  // Verifica se há QR code disponível (propriedade injetada dinamicamente pelo contexto)
  const qrCodeImage = (connection as any).qrCode;
  const isQrReady = connection.status === ConnectionStatus.QR_READY || !!qrCodeImage;
  const isConnecting = !isConnected && !isQrReady && (connection.status === ConnectionStatus.CONNECTING);

  // Define cores baseadas no status
  const statusColor = isConnected ? 'emerald' : isQrReady ? 'amber' : isConnecting ? 'blue' : 'red';
  const statusText = isConnected ? 'Online' : isQrReady ? 'Ler QR Code' : isConnecting ? 'Iniciando...' : 'Desconectado';

  return (
    <div className={`bg-white rounded-xl shadow-sm border p-0 transition-all duration-200 hover:shadow-lg flex flex-col relative overflow-hidden ${
        isQrReady ? 'border-amber-300 ring-4 ring-amber-50' : 'border-gray-100 hover:border-emerald-200'
    }`}>
      
      {/* Barra de Status Topo */}
      <div className={`w-full h-1.5 bg-${statusColor}-500`} />

      <div className="p-5 flex-1 flex flex-col">
        {/* Header do Card */}
        <div className="flex justify-between items-start mb-4">
          <div className="flex items-center space-x-3">
            <div className="relative">
              {isConnected && connection.profilePicUrl ? (
                <img 
                  src={connection.profilePicUrl} 
                  alt={connection.name} 
                  className="w-14 h-14 rounded-full object-cover border-2 border-gray-100 shadow-sm"
                />
              ) : (
                <div className={`w-14 h-14 rounded-full flex items-center justify-center border-2 ${
                    isQrReady ? 'bg-amber-50 border-amber-200 text-amber-600' : 'bg-gray-50 border-gray-100 text-gray-400'
                }`}>
                   {isQrReady ? <QrCode className="w-7 h-7" /> : <Smartphone className="w-7 h-7" />}
                </div>
              )}
              
              {/* Badge de Status */}
              <div className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-2 border-white flex items-center justify-center shadow-sm bg-${statusColor}-500 text-white`}>
                 {isConnecting ? <RefreshCw className="w-2.5 h-2.5 animate-spin" /> : 
                  isQrReady ? <QrCode className="w-2.5 h-2.5" /> :
                  isConnected ? <Wifi className="w-2.5 h-2.5" /> : <WifiOff className="w-2.5 h-2.5" />}
              </div>
            </div>

            <div>
              <h3 className="font-bold text-gray-800 text-base leading-tight">{connection.name}</h3>
              <p className="text-sm text-gray-500 font-mono mt-0.5 truncate max-w-[120px]">
                {isConnected ? connection.phoneNumber : statusText}
              </p>
            </div>
          </div>
          
          <div className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-${statusColor}-50 text-${statusColor}-700 border border-${statusColor}-100`}>
             {connection.status}
          </div>
        </div>

        {/* CONTEÚDO PRINCIPAL: QR CODE ou ESTATÍSTICAS */}
        {isQrReady && qrCodeImage ? (
           <div className="flex-1 flex flex-col items-center justify-center bg-amber-50/50 border border-amber-100 rounded-lg p-3 mb-2 animate-in fade-in">
              <img src={qrCodeImage} alt="QR Code" className="w-40 h-40 object-contain mix-blend-multiply" />
              <p className="text-xs text-amber-700 font-semibold mt-2 animate-pulse">Abra o WhatsApp &gt; Conectar Aparelho</p>
           </div>
        ) : (
           <div className="grid grid-cols-2 gap-3 mb-2 mt-auto">
             <div className="bg-gray-50 p-2.5 rounded-lg border border-gray-100">
                <span className="text-xs text-gray-500 block mb-1">Envios Hoje</span>
                <span className="text-lg font-bold text-gray-900">{connection.messagesSentToday || 0}</span>
             </div>
             <div className="bg-gray-50 p-2.5 rounded-lg border border-gray-100">
                <span className="text-xs text-gray-500 block mb-1">Fila</span>
                <span className="text-lg font-bold text-gray-900">{connection.queueSize || 0}</span>
             </div>
           </div>
        )}

      </div>

      {/* Footer Actions */}
      <div className="bg-gray-50 px-5 py-3 border-t border-gray-100 flex justify-between items-center">
         {/* Info Técnica (Bateria/Sinal) */}
         <div className="flex items-center gap-3">
            {isConnected && (
                <>
                    <div className="flex items-center gap-1 text-gray-400" title="Nível de Bateria">
                        <Battery className={`w-4 h-4 ${connection.batteryLevel && connection.batteryLevel < 20 ? 'text-red-500' : 'text-gray-400'}`} />
                        <span className="text-xs font-medium">{connection.batteryLevel ?? '--'}%</span>
                    </div>
                    <div className="h-3 w-px bg-gray-300"></div>
                    <div className="flex items-center gap-1 text-gray-400" title="Qualidade do Sinal">
                        {connection.signalStrength === 'STRONG' ? <SignalHigh className="w-4 h-4 text-emerald-500"/> : <Signal className="w-4 h-4 text-amber-500"/>}
                    </div>
                </>
            )}
         </div>

         {/* Botões */}
         <div className="flex gap-2">
            {!isConnected && !isConnecting && !isQrReady && (
                <button 
                  onClick={() => onReconnect(connection.id)}
                  className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                  title="Tentar Reconectar"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
            )}
            <button 
              onClick={() => onDisconnect(connection.id)}
              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
              title="Desconectar / Remover"
            >
              <Trash2 className="w-4 h-4" />
            </button>
         </div>
      </div>
    </div>
  );
};