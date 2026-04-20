import React from 'react';
import { BarChart3, Smartphone, History } from 'lucide-react';
import { useZapMass } from '../context/ZapMassContext';

export const ReportsTab: React.FC = () => {
  const { metrics, connections, campaignsHistory } = useZapMass();

  return (
    <div className="space-y-8 pb-10">
      <div className="flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Relatórios do Sistema</h1>
          <p className="text-gray-500">Dados consolidados de todas as operações e canais em tempo real.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* LEFTSIDE: Campaign History (Substitui o Gráfico Fake) */}
        <div className="lg:col-span-2 bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex flex-col min-h-[300px]">
          <div className="flex justify-between items-center mb-6">
            <h3 className="font-bold text-gray-800 flex items-center gap-2">
              <History className="w-5 h-5 text-gray-500" />
              Histórico de Campanhas Recentes
            </h3>
          </div>

          <div className="overflow-x-auto flex-1">
             {campaignsHistory.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 py-10">
                   <BarChart3 className="w-10 h-10 mb-2 opacity-20" />
                   <p>Nenhuma campanha finalizada nesta sessão.</p>
                </div>
             ) : (
                <table className="w-full text-sm text-left">
                   <thead className="bg-gray-50 text-gray-500">
                      <tr>
                         <th className="px-4 py-2 rounded-tl-lg">Campanha</th>
                         <th className="px-4 py-2">Data</th>
                         <th className="px-4 py-2">Total</th>
                         <th className="px-4 py-2 rounded-tr-lg">Sucesso</th>
                      </tr>
                   </thead>
                   <tbody>
                      {campaignsHistory.map(camp => (
                         <tr key={camp.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3 font-medium text-gray-900">{camp.name}</td>
                            <td className="px-4 py-3 text-gray-500">{camp.createdAt}</td>
                            <td className="px-4 py-3">{camp.totalContacts}</td>
                            <td className="px-4 py-3 text-emerald-600 font-bold">{camp.successCount}</td>
                         </tr>
                      ))}
                   </tbody>
                </table>
             )}
          </div>
        </div>

        {/* RIGHTSIDE: Real Metrics (Substitui o Card Financeiro Fake) */}
        <div className="bg-gradient-to-br from-gray-900 to-gray-800 text-white p-6 rounded-xl shadow-lg flex flex-col justify-between">
          <div>
            <h3 className="text-gray-300 text-sm font-medium mb-1">Total Disparado (Sessão Atual)</h3>
            <div className="text-4xl font-bold mb-6">{metrics.totalSent.toLocaleString()}</div>
            
            <div className="space-y-4">
               <div className="flex justify-between items-center">
                 <span className="text-gray-400 text-sm">Entregues</span>
                 <span className="font-mono text-gray-300">{metrics.totalDelivered.toLocaleString()}</span>
               </div>
               <div className="flex justify-between items-center">
                 <span className="text-emerald-300 text-sm font-bold">Respostas</span>
                 <span className="font-mono text-white text-lg font-bold">{metrics.totalReplied}</span>
               </div>
               <div className="h-px bg-gray-700 my-4"></div>
               <div className="flex justify-between items-center">
                 <span className="text-gray-400 text-sm">Taxa de Leitura</span>
                 <span className="bg-emerald-500/20 text-emerald-300 px-2 py-1 rounded text-xs font-bold">
                    {metrics.totalSent > 0 ? Math.round((metrics.totalRead / metrics.totalSent) * 100) : 0}%
                 </span>
               </div>
            </div>
          </div>
        </div>
      </div>

      {/* BOTTOM: Real Channel Status (Substitui a Tabela Fake) */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
         <div className="p-6 border-b border-gray-100">
           <h3 className="font-bold text-gray-800 flex items-center gap-2">
              <Smartphone className="w-5 h-5 text-gray-500" />
              Status dos Canais Conectados
           </h3>
         </div>
         <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 text-gray-500 border-b border-gray-100">
               <tr>
                 <th className="px-6 py-3">Canal</th>
                 <th className="px-6 py-3">Envios (Sessão)</th>
                 <th className="px-6 py-3">Status</th>
                 <th className="px-6 py-3">Fila</th>
               </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
               {connections.length === 0 && (
                  <tr>
                     <td colSpan={4} className="px-6 py-8 text-center text-gray-400">Nenhum canal conectado no momento.</td>
                  </tr>
               )}
               {connections.map((channel) => (
                 <tr key={channel.id} className="hover:bg-gray-50">
                   <td className="px-6 py-4 font-medium text-gray-900 flex items-center gap-2">
                     <div className={`w-2 h-2 rounded-full ${channel.status === 'CONNECTED' ? 'bg-emerald-500' : 'bg-red-500'}`}></div>
                     {channel.name}
                     <span className="text-xs text-gray-400 font-normal">({channel.phoneNumber || '...'})</span>
                   </td>
                   <td className="px-6 py-4">{channel.messagesSentToday.toLocaleString()}</td>
                   <td className="px-6 py-4">
                      {channel.status === 'CONNECTED' ? (
                          <span className="text-emerald-700 font-bold text-xs bg-emerald-50 px-2 py-1 rounded border border-emerald-100">ONLINE</span>
                      ) : (
                          <span className="text-red-700 font-bold text-xs bg-red-50 px-2 py-1 rounded border border-red-100">{channel.status}</span>
                      )}
                   </td>
                   <td className="px-6 py-4 text-gray-600">
                     {channel.queueSize}
                   </td>
                 </tr>
               ))}
            </tbody>
         </table>
      </div>
    </div>
  );
};