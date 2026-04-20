
import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, Plus, CheckCircle2, FileSpreadsheet, Users, Timer, 
  ChevronRight, Hash, Smartphone, ArrowRight, Loader2, Pause,
  Image as ImageIcon, Calendar, AlertTriangle, Send, X, Save,
  MoreVertical, Paperclip, Smile, Battery, Signal
} from 'lucide-react';
import { CampaignStatus, ConnectionStatus } from '../types';
import { useZapMass } from '../context/ZapMassContext';
import toast from 'react-hot-toast';

// Componente Visual: Simulação de Celular
const PhonePreview = ({ message, mediaName, variableData }: { message: string, mediaName?: string, variableData: any }) => {
  const previewText = message.replace(/{{nome}}/g, variableData.name || 'Maria')
                             .replace(/{{telefone}}/g, variableData.phone || '11 99999-9999');
  const now = new Date();
  const timeString = `${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`;

  return (
    <div className="w-[280px] h-[580px] bg-gray-900 rounded-[2.5rem] border-8 border-gray-800 shadow-2xl relative overflow-hidden mx-auto select-none">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-28 h-6 bg-gray-800 rounded-b-xl z-20"></div>
      <div className="w-full h-full bg-[#efeae2] flex flex-col pt-10 pb-4">
        <div className="bg-[#075e54] p-3 flex items-center gap-2 text-white shadow-sm shrink-0">
           <div className="w-8 h-8 rounded-full bg-gray-300 overflow-hidden border border-white/20">
             <img src={`https://ui-avatars.com/api/?name=${variableData.name}&background=random`} alt="Avatar" />
           </div>
           <div className="flex-1 min-w-0">
             <p className="text-sm font-bold truncate">{variableData.name}</p>
             <p className="text-[9px] opacity-80">online</p>
           </div>
        </div>
        <div className="flex-1 p-3 overflow-y-auto space-y-2 font-sans custom-scrollbar">
           <div className="flex justify-center mb-4">
              <span className="bg-[#e1f3fb] text-gray-800 text-[10px] px-2 py-1 rounded shadow-sm uppercase font-bold tracking-wide">Hoje</span>
           </div>
           <div className="flex justify-end animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="bg-[#d9fdd3] p-2 rounded-lg rounded-tr-none shadow-[0_1px_0.5px_rgba(0,0,0,0.13)] max-w-[90%] text-sm text-gray-900 relative group">
                 {mediaName && (
                   <div className="mb-2 rounded-lg bg-gray-200 h-28 w-full flex items-center justify-center text-gray-500 overflow-hidden relative border border-black/5">
                      <ImageIcon className="w-8 h-8 opacity-50" />
                      <span className="absolute bottom-1 right-2 text-[9px] bg-black/40 text-white px-1 rounded backdrop-blur-sm">Mídia</span>
                   </div>
                 )}
                 <p className="whitespace-pre-wrap leading-relaxed pb-3 min-w-[60px] text-[13px]">
                   {previewText || <span className="text-gray-400 italic">Digite sua mensagem...</span>}
                 </p>
                 <div className="absolute bottom-1 right-2 flex items-center gap-1">
                    <span className="text-[9px] text-gray-500 font-medium">{timeString}</span>
                    <CheckCircle2 className="w-3 h-3 text-[#53bdeb]" />
                 </div>
              </div>
           </div>
        </div>
        <div className="h-12 bg-gray-100 px-2 flex items-center gap-2 shrink-0">
           <Plus className="w-6 h-6 text-[#007bfc]" />
           <div className="flex-1 h-8 bg-white rounded-full px-3 text-sm text-gray-400 flex items-center shadow-sm">Mensagem</div>
           <div className="w-8 h-8 bg-[#00a884] rounded-full flex items-center justify-center text-white shadow-sm">
             <Send className="w-4 h-4 ml-0.5" />
           </div>
        </div>
      </div>
    </div>
  );
};

export const CampaignsTab: React.FC = () => {
  const { connections, contactLists, startCampaign, contacts, campaignStatus } = useZapMass();

  // Estados
  const [viewState, setViewState] = useState<'list' | 'studio'>('list');
  const [formData, setFormData] = useState({
    name: '',
    message: '',
    mediaFile: null as File | null,
    selectedConnectionIds: [] as string[],
    selectedListId: '',
    scheduleDate: '',
    scheduleTime: ''
  });
  const [spamScore, setSpamScore] = useState(0);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  // Efeito para resetar form
  useEffect(() => {
    if (viewState === 'studio') {
        setFormData({ name: '', message: '', mediaFile: null, selectedConnectionIds: [], selectedListId: '', scheduleDate: '', scheduleTime: '' });
        setSpamScore(0);
    }
  }, [viewState]);

  // Efeito Spam Score
  useEffect(() => {
     let score = 0;
     const msg = formData.message;
     if (msg.length > 0) {
        if (msg.toUpperCase() === msg && msg.length > 10) score += 40; 
        if ((msg.match(/http/g) || []).length > 1) score += 20; 
        if (['PROMOÇÃO', 'GRÁTIS', 'GANHE', 'CLIQUE'].some(w => msg.toUpperCase().includes(w))) score += 15;
        if (msg.length < 10) score += 10; 
     }
     setSpamScore(Math.min(score, 100));
  }, [formData.message]);

  // Inserir variável na posição do cursor
  const insertVariable = (variable: string) => {
    const textarea = textAreaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = formData.message;
    const before = text.substring(0, start);
    const after = text.substring(end, text.length);
    const newText = before + `{{${variable}}}` + after;
    
    setFormData(prev => ({ ...prev, message: newText }));
    
    // Restaurar foco
    setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + variable.length + 4;
        textarea.focus();
    }, 0);
  };

  const handleStartRealCampaign = () => {
      const selectedList = contactLists.find(l => l.id === formData.selectedListId);
      if (!selectedList || !selectedList.contactIds) return toast.error('Lista inválida ou vazia');

      const targetNumbers: string[] = [];
      selectedList.contactIds.forEach(id => {
          const contact = contacts.find(c => c.id === id);
          if (contact && contact.phone) targetNumbers.push(contact.phone);
      });

      if (targetNumbers.length === 0) return toast.error('Lista sem contatos válidos.');

      startCampaign(
          'session-ignored', 
          targetNumbers,
          formData.message,
          formData.selectedConnectionIds
      );

      setViewState('list');
  };

  const handleMediaUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          setFormData({ ...formData, mediaFile: file });
          toast.success('Mídia anexada (Simulação)');
      }
  };

  // --- RENDER ---
  if (viewState === 'list') {
      return (
          <div className="space-y-6">
              <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                  <div>
                      <h1 className="text-2xl font-bold text-gray-900">Campanhas</h1>
                      <p className="text-gray-500">Gestão de disparos em massa.</p>
                  </div>
                  <button 
                      onClick={() => setViewState('studio')}
                      disabled={campaignStatus.isRunning}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-emerald-600/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                      <Plus className="w-5 h-5" /> Nova Campanha
                  </button>
              </div>

              {(campaignStatus.isRunning || campaignStatus.total > 0) && (
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 flex flex-col md:flex-row items-center gap-8 animate-in slide-in-from-top-4">
                      <div className="relative w-32 h-32 flex items-center justify-center">
                          <svg className="w-full h-full transform -rotate-90">
                              <circle cx="64" cy="64" r="56" stroke="#f3f4f6" strokeWidth="12" fill="transparent" />
                              <circle 
                                cx="64" cy="64" r="56" stroke="#10b981" strokeWidth="12" fill="transparent" 
                                strokeDasharray={351.8} 
                                strokeDashoffset={351.8 - (351.8 * (campaignStatus.processed / (campaignStatus.total || 1)))} 
                                className="transition-all duration-500 ease-out"
                              />
                          </svg>
                          <div className="absolute inset-0 flex flex-col items-center justify-center">
                              <span className="text-2xl font-bold text-gray-800">{Math.round((campaignStatus.processed / (campaignStatus.total || 1)) * 100)}%</span>
                              <span className="text-[10px] text-gray-400 uppercase font-bold">Concluído</span>
                          </div>
                      </div>
                      <div className="flex-1 w-full grid grid-cols-1 md:grid-cols-3 gap-4">
                           <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-100 flex flex-col items-center justify-center">
                               <CheckCircle2 className="w-6 h-6 text-emerald-600 mb-1" />
                               <span className="text-2xl font-bold text-emerald-700">{campaignStatus.success}</span>
                               <span className="text-xs text-emerald-600 font-bold uppercase">Sucesso</span>
                           </div>
                           <div className="p-4 bg-red-50 rounded-lg border border-red-100 flex flex-col items-center justify-center">
                               <AlertTriangle className="w-6 h-6 text-red-600 mb-1" />
                               <span className="text-2xl font-bold text-red-700">{campaignStatus.failed}</span>
                               <span className="text-xs text-red-600 font-bold uppercase">Falhas</span>
                           </div>
                           <div className="p-4 bg-blue-50 rounded-lg border border-blue-100 flex flex-col items-center justify-center">
                               <Loader2 className={`w-6 h-6 text-blue-600 mb-1 ${campaignStatus.isRunning ? 'animate-spin' : ''}`} />
                               <span className="text-2xl font-bold text-blue-700">{campaignStatus.total - campaignStatus.processed}</span>
                               <span className="text-xs text-blue-600 font-bold uppercase">Na Fila</span>
                           </div>
                      </div>
                  </div>
              )}

              {!campaignStatus.isRunning && campaignStatus.total === 0 && (
                  <div className="bg-gray-50 rounded-xl border border-dashed border-gray-300 p-16 text-center">
                      <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm">
                          <Send className="w-8 h-8 text-gray-300 ml-1" />
                      </div>
                      <h3 className="text-xl font-bold text-gray-900">Pronto para disparar?</h3>
                      <p className="text-gray-500 mt-2 max-w-md mx-auto">Crie campanhas segmentadas, use variáveis personalizadas e acompanhe o desempenho em tempo real.</p>
                      <button onClick={() => setViewState('studio')} className="mt-6 text-emerald-600 font-bold hover:underline">Começar agora</button>
                  </div>
              )}
          </div>
      );
  }

  // STUDIO VIEW
  return (
      <div className="h-[calc(100vh-2rem)] flex flex-col md:flex-row bg-white rounded-2xl shadow-2xl overflow-hidden border border-gray-200">
          
          {/* LEFT: Configuração */}
          <div className="w-full md:w-1/2 lg:w-7/12 p-8 overflow-y-auto border-r border-gray-200 bg-gray-50/50 flex flex-col custom-scrollbar">
              <div className="flex items-center justify-between mb-8">
                  <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                      <span className="w-8 h-8 bg-emerald-100 text-emerald-600 rounded-lg flex items-center justify-center"><Smartphone className="w-5 h-5" /></span>
                      Campaign Studio
                  </h2>
                  <button onClick={() => setViewState('list')} className="text-sm text-gray-500 hover:text-gray-800 font-medium px-3 py-1.5 rounded hover:bg-gray-100 transition-colors">
                      Cancelar
                  </button>
              </div>

              <div className="space-y-8 flex-1">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <div className="group">
                          <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 block group-focus-within:text-emerald-600 transition-colors">Nome da Campanha</label>
                          <input 
                              type="text" 
                              className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none bg-white transition-all shadow-sm"
                              placeholder="Ex: Oferta Relâmpago"
                              value={formData.name}
                              onChange={e => setFormData({...formData, name: e.target.value})}
                          />
                      </div>
                      <div className="group">
                          <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 block group-focus-within:text-emerald-600 transition-colors">Lista de Contatos</label>
                          <select 
                              className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none bg-white transition-all shadow-sm cursor-pointer"
                              value={formData.selectedListId}
                              onChange={e => setFormData({...formData, selectedListId: e.target.value})}
                          >
                              <option value="">Selecione...</option>
                              {contactLists.map(list => (
                                  <option key={list.id} value={list.id}>{list.name} ({list.contactIds.length})</option>
                              ))}
                          </select>
                      </div>
                  </div>

                  {/* Message Editor */}
                  <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm relative group focus-within:border-emerald-400 focus-within:ring-4 focus-within:ring-emerald-50 transition-all">
                      <div className="flex justify-between items-center mb-3">
                          <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Mensagem</label>
                          <div className="flex gap-2">
                              <button onClick={() => insertVariable('nome')} className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-1 rounded border border-emerald-100 hover:bg-emerald-100 font-bold transition flex items-center gap-1">+ Nome</button>
                              <button onClick={() => insertVariable('telefone')} className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-1 rounded border border-emerald-100 hover:bg-emerald-100 font-bold transition flex items-center gap-1">+ Tel</button>
                          </div>
                      </div>
                      
                      <textarea 
                          ref={textAreaRef}
                          className="w-full h-48 p-0 border-none focus:ring-0 outline-none resize-none text-gray-700 text-sm leading-relaxed"
                          placeholder="Olá {{nome}}, confira nossas novidades..."
                          value={formData.message}
                          onChange={e => setFormData({...formData, message: e.target.value})}
                      />

                      <div className="flex justify-between items-center mt-4 pt-4 border-t border-gray-100">
                          <div className="flex gap-2">
                              <label className="cursor-pointer p-2 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-emerald-600 transition-colors flex items-center gap-2 text-xs font-medium border border-transparent hover:border-gray-200">
                                  <ImageIcon className="w-4 h-4" /> Anexar Mídia
                                  <input type="file" accept="image/*" className="hidden" onChange={handleMediaUpload} />
                              </label>
                          </div>
                          <div className="flex items-center gap-2" title="Score de risco de bloqueio">
                              <div className="flex gap-0.5">
                                 {[1,2,3,4,5].map(i => (
                                     <div key={i} className={`w-1.5 h-3 rounded-sm ${spamScore/20 >= i ? (spamScore > 60 ? 'bg-red-500' : 'bg-emerald-500') : 'bg-gray-200'}`} />
                                 ))}
                              </div>
                              <span className="text-[10px] font-bold text-gray-400">SPAM SCORE</span>
                          </div>
                      </div>
                      {formData.mediaFile && (
                          <div className="absolute bottom-16 left-5 bg-blue-50 text-blue-700 px-3 py-1.5 rounded-lg text-xs flex items-center gap-2 border border-blue-100 animate-in fade-in slide-in-from-bottom-2">
                              <ImageIcon className="w-3 h-3"/> {formData.mediaFile.name}
                              <button onClick={() => setFormData({...formData, mediaFile: null})} className="hover:text-blue-900"><X className="w-3 h-3"/></button>
                          </div>
                      )}
                  </div>

                  {/* Connections & Scheduling */}
                  <div>
                      <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 block">Chips de Disparo (Multi-Device)</label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
                          {connections.map(conn => (
                              <label key={conn.id} className={`relative flex items-center p-3 border rounded-xl cursor-pointer transition-all ${formData.selectedConnectionIds.includes(conn.id) ? 'border-emerald-500 bg-emerald-50/50 ring-1 ring-emerald-500' : 'border-gray-200 hover:border-emerald-200 hover:bg-white'} ${conn.status !== 'CONNECTED' ? 'opacity-60 grayscale' : ''}`}>
                                  <input 
                                      type="checkbox" 
                                      className="absolute top-3 right-3 w-4 h-4 text-emerald-600 rounded border-gray-300 focus:ring-emerald-500"
                                      checked={formData.selectedConnectionIds.includes(conn.id)}
                                      onChange={(e) => {
                                          const newIds = e.target.checked 
                                          ? [...formData.selectedConnectionIds, conn.id]
                                          : formData.selectedConnectionIds.filter(id => id !== conn.id);
                                          setFormData({...formData, selectedConnectionIds: newIds});
                                      }}
                                      disabled={conn.status !== ConnectionStatus.CONNECTED}
                                  />
                                  <div className="w-10 h-10 rounded-full bg-gray-200 mr-3 flex-shrink-0 overflow-hidden">
                                     {conn.profilePicUrl ? <img src={conn.profilePicUrl} className="w-full h-full object-cover" /> : <Smartphone className="w-5 h-5 m-auto text-gray-500"/>}
                                  </div>
                                  <div className="overflow-hidden">
                                      <div className="text-sm font-bold text-gray-800 truncate">{conn.name}</div>
                                      <div className="flex items-center gap-2 mt-0.5">
                                          <div className={`w-1.5 h-1.5 rounded-full ${conn.status === 'CONNECTED' ? 'bg-emerald-500' : 'bg-red-500'}`}></div>
                                          <span className="text-[10px] text-gray-500 font-medium">{conn.phoneNumber || 'Sem número'}</span>
                                      </div>
                                  </div>
                                  {conn.status === 'CONNECTED' && (
                                     <div className="absolute bottom-3 right-3 flex items-center gap-1 text-gray-400">
                                         <Battery className="w-3 h-3" /> <span className="text-[9px]">98%</span>
                                     </div>
                                  )}
                              </label>
                          ))}
                      </div>

                      <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 flex flex-col sm:flex-row gap-4 items-center">
                          <div className="flex items-center gap-3 text-gray-700 font-medium text-sm w-full sm:w-auto">
                             <div className="w-8 h-8 rounded-lg bg-gray-200 flex items-center justify-center text-gray-500"><Calendar className="w-4 h-4" /></div>
                             Agendar?
                          </div>
                          <div className="flex gap-2 w-full sm:w-auto flex-1">
                              <input 
                                type="date" 
                                className="flex-1 p-2 rounded-lg border border-gray-300 text-sm bg-white focus:border-emerald-500 outline-none" 
                                value={formData.scheduleDate}
                                onChange={e => setFormData({...formData, scheduleDate: e.target.value})}
                              />
                              <input 
                                type="time" 
                                className="w-24 p-2 rounded-lg border border-gray-300 text-sm bg-white focus:border-emerald-500 outline-none" 
                                value={formData.scheduleTime}
                                onChange={e => setFormData({...formData, scheduleTime: e.target.value})}
                              />
                          </div>
                      </div>
                  </div>
              </div>
          </div>

          {/* RIGHT: Live Preview */}
          <div className="w-full md:w-1/2 lg:w-5/12 bg-[#f0f2f5] p-6 flex flex-col items-center justify-center relative border-l border-gray-200">
              <div className="absolute top-8 text-center w-full z-10">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em]">Visualização</span>
              </div>
              
              <PhonePreview 
                  message={formData.message} 
                  mediaName={formData.mediaFile?.name}
                  variableData={{ name: 'Cliente VIP', phone: '11 99999-9999' }}
              />

              <div className="absolute bottom-0 left-0 w-full p-6 bg-white/80 backdrop-blur-md border-t border-gray-200 flex justify-between items-center z-20">
                  <div>
                      <div className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-1">Total Estimado</div>
                      <div className="text-lg font-bold text-gray-900 flex items-baseline gap-1">
                          {formData.selectedListId ? contactLists.find(l => l.id === formData.selectedListId)?.contactIds.length : 0} 
                          <span className="text-xs font-normal text-gray-500">contatos</span>
                      </div>
                  </div>
                  <button 
                      onClick={handleStartRealCampaign}
                      disabled={!formData.name || !formData.message || formData.selectedConnectionIds.length === 0 || !formData.selectedListId}
                      className="bg-emerald-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-emerald-700 shadow-xl shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none flex items-center gap-2 transform active:scale-95 transition-all"
                  >
                      {formData.scheduleDate ? 'Agendar Disparo' : 'Enviar Agora'} <Send className="w-4 h-4" />
                  </button>
              </div>
          </div>
      </div>
  );
};
