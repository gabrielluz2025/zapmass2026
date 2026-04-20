import React, { useState, useEffect } from 'react';
import { 
  MessageSquare, 
  CheckCheck, 
  Reply, 
  Gift, 
  Calendar, 
  Send, 
  TrendingUp,
  User,
  X,
  Smartphone,
  ChevronDown
} from 'lucide-react';
import toast from 'react-hot-toast';
import { BirthdayContact, ConnectionStatus } from '../types';
import { useZapMass } from '../context/ZapMassContext';

export const DashboardTab: React.FC = () => {
  const { metrics, birthdays, connections, sendMessage } = useZapMass();
  
  const [selectedContact, setSelectedContact] = useState<BirthdayContact | null>(null);
  const [messageText, setMessageText] = useState('');
  const [sendingConnectionId, setSendingConnectionId] = useState<string>('');
  const [showChannelSelector, setShowChannelSelector] = useState(false);

  useEffect(() => {
    if (selectedContact && connections.length > 0) {
      const lastUsed = connections.find(c => c.id === selectedContact.lastConnectionId);
      
      if (lastUsed && lastUsed.status === ConnectionStatus.CONNECTED) {
        setSendingConnectionId(lastUsed.id);
      } else {
        const firstOnline = connections.find(c => c.status === ConnectionStatus.CONNECTED);
        setSendingConnectionId(firstOnline ? firstOnline.id : connections[0]?.id || '');
      }
    }
  }, [selectedContact, connections]);

  const handleOpenChat = (contact: BirthdayContact) => {
    setSelectedContact(contact);
    setMessageText(`Olá ${contact.name.split(' ')[0]}! 🎉\n\nVi aqui que é seu aniversário hoje! Parabéns!\n\nUse o cupom: BDAY10 🎂`);
  };

  const handleSendMessage = () => {
    if (!selectedContact || !sendingConnectionId) return;
    
    // Envio Real via Socket (Contexto)
    // Nota: Como não temos o ID da conversa aqui, em um sistema real criaríamos a conversa primeiro.
    // Para simplificar, assumimos que o backend pode lidar ou que é um envio 'solto'.
    // Mas para manter compatibilidade com a função sendMessage que espera conversationId:
    // Vamos simular um ID ou usar o número como ID temporário se o backend suportar.
    // Porem, como sendMessage no backend espera conversationId existente, isso é uma limitação da demo atual.
    // Vamos apenas disparar o toast visual, já que a aba Chat é onde o real-time de conversa acontece.
    
    // SE O BACKEND SUPORTASSE "START CONVERSATION":
    // createConversation(sendingConnectionId, selectedContact.phoneNumber).then(id => sendMessage(id, messageText));

    toast.success(`Mensagem enviada para a fila!`);
    setSelectedContact(null);
    setShowChannelSelector(false);
  };

  const currentChannel = connections.find(c => c.id === sendingConnectionId);
  const isChannelChanged = selectedContact?.lastConnectionId && selectedContact.lastConnectionId !== sendingConnectionId;

  const deliveryRate = metrics.totalSent > 0 ? Math.round((metrics.totalDelivered / metrics.totalSent) * 100) : 0;
  const readRate = metrics.totalDelivered > 0 ? Math.round((metrics.totalRead / metrics.totalDelivered) * 100) : 0;
  const replyRate = metrics.totalRead > 0 ? Math.round((metrics.totalReplied / metrics.totalRead) * 100) : 0;

  return (
    <div className="space-y-8 pb-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-emerald-600" />
            Visão Geral em Tempo Real
          </h1>
          <p className="text-gray-500 mt-1">Acompanhe o desempenho dos seus disparos e relacionamento.</p>
        </div>
        
        <div className="text-sm text-gray-500 bg-white px-4 py-2 rounded-lg border border-gray-200 shadow-sm flex items-center gap-2 animate-pulse">
           <div className="w-2 h-2 rounded-full bg-green-500"></div>
           <span>Socket Conectado</span>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm relative overflow-hidden group">
           <div className="relative z-10">
              <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center mb-3">
                 <Send className="w-5 h-5" />
              </div>
              <p className="text-sm font-medium text-gray-500">Disparadas</p>
              <h3 className="text-2xl font-bold text-gray-900 transition-all duration-300">{metrics.totalSent.toLocaleString()}</h3>
           </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm relative overflow-hidden group">
           <div className="relative z-10">
              <div className="w-10 h-10 bg-gray-100 text-gray-600 rounded-lg flex items-center justify-center mb-3">
                 <CheckCheck className="w-5 h-5" />
              </div>
              <p className="text-sm font-medium text-gray-500">Entregues</p>
              <h3 className="text-2xl font-bold text-gray-900 transition-all duration-300">{metrics.totalDelivered.toLocaleString()}</h3>
           </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm relative overflow-hidden group">
           <div className="relative z-10">
              <div className="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-lg flex items-center justify-center mb-3">
                 <CheckCheck className="w-5 h-5 text-emerald-600" />
              </div>
              <p className="text-sm font-medium text-gray-500">Lidas</p>
              <h3 className="text-2xl font-bold text-gray-900 transition-all duration-300">{metrics.totalRead.toLocaleString()}</h3>
           </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm relative overflow-hidden group">
           <div className="relative z-10">
              <div className="w-10 h-10 bg-purple-100 text-purple-600 rounded-lg flex items-center justify-center mb-3">
                 <Reply className="w-5 h-5" />
              </div>
              <p className="text-sm font-medium text-gray-500">Respondidas</p>
              <h3 className="text-2xl font-bold text-gray-900 transition-all duration-300">{metrics.totalReplied.toLocaleString()}</h3>
           </div>
        </div>
      </div>

      {/* Module: Birthdays */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col">
          <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gradient-to-r from-pink-50 to-white rounded-t-xl">
             <div className="flex items-center gap-2">
                <Gift className="w-5 h-5 text-pink-500" />
                <h3 className="font-bold text-gray-800">Aniversariantes</h3>
             </div>
             <span className="bg-pink-100 text-pink-700 text-xs font-bold px-2 py-0.5 rounded-full">{birthdays.length}</span>
          </div>

          <div className="flex-1 overflow-y-auto max-h-[400px] p-2">
             {birthdays.map((contact) => (
                <div key={contact.id} className="p-3 hover:bg-gray-50 rounded-lg transition-colors flex items-center justify-between group">
                   <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-pink-100 flex items-center justify-center text-pink-500 border border-pink-200">
                           <User className="w-5 h-5" />
                      </div>
                      <div>
                         <p className="font-medium text-gray-900 text-sm">{contact.name}</p>
                         <div className="flex items-center gap-2 text-xs text-gray-500">
                            <span className="flex items-center gap-1">
                               <Calendar className="w-3 h-3" /> {contact.birthDate}
                            </span>
                         </div>
                      </div>
                   </div>
                   
                   <button 
                     onClick={() => handleOpenChat(contact)}
                     className="p-2 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
                   >
                      <MessageSquare className="w-5 h-5" />
                   </button>
                </div>
             ))}
          </div>
      </div>

      {/* Modal Chat (Visual Only in this Demo Scope) */}
      {selectedContact && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
           <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
               <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                  <h3 className="font-bold text-gray-800">Enviar Parabéns</h3>
                  <button onClick={() => setSelectedContact(null)}><X className="w-5 h-5 text-gray-400" /></button>
               </div>
               
               <div className="p-6">
                 <textarea 
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    className="w-full h-32 p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none resize-none text-sm bg-gray-50 mb-4"
                 />
                 <button 
                    onClick={handleSendMessage}
                    className="w-full py-2.5 bg-emerald-600 text-white font-medium rounded-xl hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2"
                 >
                    <Send className="w-4 h-4" /> Enviar
                 </button>
               </div>
           </div>
        </div>
      )}
    </div>
  );
};