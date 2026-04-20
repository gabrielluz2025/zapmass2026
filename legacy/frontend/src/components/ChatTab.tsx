import React, { useState, useRef, useEffect } from 'react';
import { Search, Send, User, Smartphone, Check, CheckCheck } from 'lucide-react';
import { useZapMass } from '../context/ZapMassContext';

export const ChatTab: React.FC = () => {
  const { conversations, connections, sendMessage, markAsRead } = useZapMass();
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const selectedConversation = conversations.find(c => c.id === selectedChatId);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    if (selectedChatId) {
       markAsRead(selectedChatId);
    }
  }, [selectedConversation?.messages, selectedChatId]);

  const handleSendMessage = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputText.trim() || !selectedChatId) return;

    sendMessage(selectedChatId, inputText);
    setInputText('');
  };

  const filteredConversations = conversations.filter(c => 
    c.contactName.toLowerCase().includes(searchTerm.toLowerCase()) || 
    c.contactPhone.includes(searchTerm)
  );

  return (
    <div className="flex h-[calc(100vh-6rem)] bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      
      {/* SIDEBAR */}
      <div className="w-full md:w-80 border-r border-gray-200 flex flex-col">
        <div className="p-4 bg-gray-50 border-b border-gray-100">
           <div className="relative">
             <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
             <input 
               type="text" 
               placeholder="Buscar conversa..."
               className="w-full pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-lg text-sm outline-none focus:ring-1 focus:ring-emerald-500"
               value={searchTerm}
               onChange={(e) => setSearchTerm(e.target.value)}
             />
           </div>
        </div>

        <div className="flex-1 overflow-y-auto">
           {filteredConversations.map(conv => {
             const connection = connections.find(c => c.id === conv.connectionId);
             return (
               <div 
                 key={conv.id}
                 onClick={() => setSelectedChatId(conv.id)}
                 className={`flex items-center gap-3 p-4 cursor-pointer hover:bg-gray-50 border-b border-gray-50 transition-colors ${selectedChatId === conv.id ? 'bg-emerald-50' : ''}`}
               >
                 <div className="relative">
                    <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-500">
                       <User className="w-5 h-5" />
                    </div>
                    {conv.unreadCount > 0 && (
                       <div className="absolute -top-1 -right-1 w-5 h-5 bg-emerald-500 rounded-full text-white text-[10px] flex items-center justify-center border-2 border-white">
                         {conv.unreadCount}
                       </div>
                    )}
                 </div>
                 <div className="flex-1 min-w-0">
                    <div className="flex justify-between">
                       <h3 className="text-sm font-semibold text-gray-900 truncate">{conv.contactName}</h3>
                       <span className="text-[10px] text-gray-400">{conv.lastMessageTime}</span>
                    </div>
                    <p className="text-xs text-gray-500 truncate mt-0.5">{conv.lastMessage}</p>
                 </div>
               </div>
             );
           })}
        </div>
      </div>

      {/* CHAT AREA */}
      <div className="flex-1 flex flex-col bg-[#efeae2]">
         {selectedConversation ? (
           <>
             {/* Header */}
             <div className="bg-white p-3 border-b border-gray-200 flex items-center gap-3 shadow-sm z-10">
                <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-500">
                   <User className="w-5 h-5" />
                </div>
                <div>
                   <h3 className="font-bold text-gray-800 text-sm">{selectedConversation.contactName}</h3>
                   <p className="text-xs text-gray-500">{selectedConversation.contactPhone}</p>
                </div>
             </div>

             {/* Messages */}
             <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {selectedConversation.messages.map((msg) => {
                  const isMe = msg.sender === 'me';
                  return (
                    <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                       <div className={`max-w-[70%] px-3 py-2 rounded-lg shadow-sm text-sm ${
                         isMe ? 'bg-[#d9fdd3] text-gray-900 rounded-tr-none' : 'bg-white text-gray-900 rounded-tl-none'
                       }`}>
                          <p>{msg.text}</p>
                          <div className="flex items-center justify-end gap-1 mt-1">
                             <span className="text-[10px] text-gray-500 opacity-70">{msg.timestamp}</span>
                             {isMe && <CheckCheck className="w-3 h-3 text-blue-500" />}
                          </div>
                       </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
             </div>

             {/* Input */}
             <form onSubmit={handleSendMessage} className="bg-gray-100 p-3 flex gap-2 border-t border-gray-200">
                <input 
                  type="text" 
                  className="flex-1 bg-white border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-1 focus:ring-emerald-500 text-sm"
                  placeholder="Digite sua mensagem..."
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                />
                <button 
                  type="submit" 
                  disabled={!inputText.trim()}
                  className="p-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                >
                   <Send className="w-5 h-5" />
                </button>
             </form>
           </>
         ) : (
           <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-[#f0f2f5]">
              <Smartphone className="w-16 h-16 text-gray-300 mb-4" />
              <h2 className="text-xl text-gray-600">ZapMass Chat</h2>
              <p className="text-sm text-gray-400">Selecione uma conversa para iniciar.</p>
           </div>
         )}
      </div>
    </div>
  );
};