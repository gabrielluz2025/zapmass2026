
import React, { useState, useMemo } from 'react';
import { Search, Upload, Trash2, FolderOpen, Users, PlusSquare, Filter, User, FileSpreadsheet, X, CheckCircle2, AlertCircle } from 'lucide-react';
import { useZapMass } from '../context/ZapMassContext';
import Papa from 'papaparse';
import toast from 'react-hot-toast';

export const ContactsTab: React.FC = () => {
  const { contacts, addContact, removeContact, createContactList, contactLists, deleteContactList } = useZapMass();
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<'contacts' | 'lists'>('contacts');
  
  // States para Importação e Seleção
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
  const [newListName, setNewListName] = useState('');
  const [isCreatingList, setIsCreatingList] = useState(false);
  const [filterTag, setFilterTag] = useState<string>('ALL');

  // --- IMPORT CSV LOGIC ---
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportProgress(10); // Start visual progress

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        setImportProgress(50);
        let addedCount = 0;
        let errorCount = 0;

        // Processamento em lote para não travar a UI
        const chunk = results.data as any[];
        
        for (const row of chunk) {
            // Tenta encontrar colunas com nomes variados
            const name = row['Nome'] || row['nome'] || row['Name'] || row['name'] || 'Sem Nome';
            const phoneRaw = row['Telefone'] || row['telefone'] || row['Phone'] || row['phone'] || row['Celular'] || row['Whatsapp'];
            const tagsRaw = row['Tags'] || row['tags'] || '';
            
            if (phoneRaw) {
                const cleanPhone = phoneRaw.toString().replace(/\D/g, '');
                // Validação básica: Brasil (10 ou 11 dígitos) ou Internacional (>7)
                if (cleanPhone.length >= 10) {
                    const tagsArray = tagsRaw ? tagsRaw.split(';').map((t: string) => t.trim()) : ['Importado'];
                    
                    await addContact({
                        id: '', 
                        name,
                        phone: cleanPhone,
                        status: 'VALID',
                        tags: tagsArray,
                        city: row['Cidade'] || row['City'] || '',
                        role: row['Cargo'] || '',
                        church: row['Igreja'] || '',
                        source: 'IMPORT'
                    });
                    addedCount++;
                } else {
                    errorCount++;
                }
            }
        }
        setImportProgress(100);
        setTimeout(() => {
            setIsImportModalOpen(false);
            setImportProgress(0);
            toast.success(`Importação concluída! ${addedCount} adicionados. ${errorCount > 0 ? `${errorCount} inválidos ignorados.` : ''}`, { duration: 5000 });
        }, 800);
      },
      error: (err) => {
        setImportProgress(0);
        toast.error("Erro ao ler arquivo CSV");
        console.error(err);
      }
    });
  };

  // --- SELECTION LOGIC ---
  const toggleSelectAll = () => {
    if (selectedContactIds.size === filteredContacts.length) {
      setSelectedContactIds(new Set());
    } else {
      setSelectedContactIds(new Set(filteredContacts.map(c => c.id)));
    }
  };

  const toggleSelectOne = (id: string) => {
    const newSet = new Set(selectedContactIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedContactIds(newSet);
  };

  // --- CREATE LIST LOGIC ---
  const handleCreateList = async () => {
    if (!newListName.trim()) {
      toast.error('Digite um nome para a lista.');
      return;
    }
    if (selectedContactIds.size === 0) {
      toast.error('Selecione pelo menos um contato.');
      return;
    }

    await createContactList(newListName, Array.from(selectedContactIds));
    toast.success(`Lista "${newListName}" criada com ${selectedContactIds.size} contatos!`);
    setNewListName('');
    setIsCreatingList(false);
    setSelectedContactIds(new Set());
    setViewMode('lists');
  };

  // --- FILTRAGEM ---
  const allTags = useMemo(() => {
      const tags = new Set<string>();
      contacts.forEach(c => c.tags.forEach(t => tags.add(t)));
      return Array.from(tags);
  }, [contacts]);

  const filteredContacts = useMemo(() => {
    return contacts.filter(c => {
        const matchesSearch = c.name.toLowerCase().includes(searchTerm.toLowerCase()) || c.phone.includes(searchTerm);
        const matchesTag = filterTag === 'ALL' || c.tags.includes(filterTag);
        return matchesSearch && matchesTag;
    });
  }, [contacts, searchTerm, filterTag]);

  // Helper para cores de tags
  const getTagColor = (tag: string) => {
      const colors = [
          'bg-blue-50 text-blue-700 border-blue-100', 
          'bg-purple-50 text-purple-700 border-purple-100', 
          'bg-orange-50 text-orange-700 border-orange-100', 
          'bg-pink-50 text-pink-700 border-pink-100',
          'bg-indigo-50 text-indigo-700 border-indigo-100'
      ];
      const index = tag.length % colors.length;
      return colors[index];
  }

  return (
    <div className="space-y-6 pb-10">
      
      {/* Header Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
         <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex items-center justify-between group hover:border-emerald-200 transition-colors">
            <div>
               <p className="text-gray-500 text-sm font-medium">Total de Contatos</p>
               <h3 className="text-2xl font-bold text-gray-900">{contacts.length.toLocaleString()}</h3>
            </div>
            <div className="w-10 h-10 bg-emerald-50 rounded-lg flex items-center justify-center text-emerald-600 group-hover:bg-emerald-100 transition-colors">
               <Users className="w-5 h-5" />
            </div>
         </div>
         <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex items-center justify-between group hover:border-blue-200 transition-colors">
            <div>
               <p className="text-gray-500 text-sm font-medium">Listas Criadas</p>
               <h3 className="text-2xl font-bold text-gray-900">{contactLists.length}</h3>
            </div>
            <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600 group-hover:bg-blue-100 transition-colors">
               <FolderOpen className="w-5 h-5" />
            </div>
         </div>
         <div 
            onClick={() => setIsImportModalOpen(true)}
            className="bg-gradient-to-r from-emerald-600 to-teal-600 p-5 rounded-xl shadow-lg text-white flex flex-col justify-center cursor-pointer transform hover:scale-[1.02] transition-all relative overflow-hidden"
         >
             <div className="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-full -mr-10 -mt-10 blur-xl"></div>
             <h3 className="font-bold text-lg mb-1 flex items-center gap-2">
                 <Upload className="w-5 h-5" /> Importar Base
             </h3>
             <p className="text-emerald-100 text-xs font-medium">Excel (.csv) ou vCard</p>
         </div>
      </div>

      {/* Tabs Switcher */}
      <div className="border-b border-gray-200 flex gap-6">
         <button 
            onClick={() => setViewMode('contacts')}
            className={`pb-3 text-sm font-medium transition-colors border-b-2 ${viewMode === 'contacts' ? 'border-emerald-500 text-emerald-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
         >
            Todos os Contatos
         </button>
         <button 
            onClick={() => setViewMode('lists')}
            className={`pb-3 text-sm font-medium transition-colors border-b-2 ${viewMode === 'lists' ? 'border-emerald-500 text-emerald-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
         >
            Minhas Listas
         </button>
      </div>

      {/* VIEW: ALL CONTACTS */}
      {viewMode === 'contacts' && (
        <>
          {/* Actions Bar */}
          <div className="flex flex-col md:flex-row gap-4 justify-between items-center bg-white p-3 rounded-xl border border-gray-200 shadow-sm">
            <div className="relative w-full md:w-96">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input 
                type="text" 
                placeholder="Buscar por nome ou telefone..." 
                className="w-full pl-9 pr-4 py-2 bg-gray-50 border-transparent focus:bg-white focus:border-emerald-500 border rounded-lg text-sm outline-none transition-all"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <div className="flex gap-2 relative w-full md:w-auto items-center flex-wrap">
               {/* Bulk Actions */}
               {selectedContactIds.size > 0 && (
                 <div className="flex items-center gap-3 mr-2 animate-in fade-in slide-in-from-right-4 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-100">
                    <span className="text-xs font-bold text-emerald-700">
                      {selectedContactIds.size} selecionados
                    </span>
                    <button 
                       onClick={() => setIsCreatingList(true)}
                       className="text-emerald-700 hover:text-emerald-800 text-sm font-medium flex items-center gap-1 hover:underline"
                    >
                       <PlusSquare className="w-4 h-4" /> Criar Lista
                    </button>
                 </div>
               )}
               
               <div className="h-6 w-px bg-gray-200 mx-2 hidden md:block"></div>

               {/* Filter Dropdown */}
               <div className="relative group">
                   <button className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-100">
                      <Filter className="w-4 h-4" />
                      {filterTag === 'ALL' ? 'Todas as Tags' : filterTag}
                   </button>
                   {/* Dropdown Content */}
                   <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-xl border border-gray-100 hidden group-hover:block z-20">
                      <button onClick={() => setFilterTag('ALL')} className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 first:rounded-t-lg">Todas</button>
                      {allTags.map(tag => (
                          <button key={tag} onClick={() => setFilterTag(tag)} className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">{tag}</button>
                      ))}
                   </div>
               </div>
            </div>
          </div>

          {/* Create List Inline Form */}
          {isCreatingList && (
             <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-xl flex items-center gap-4 animate-in zoom-in-95 shadow-sm">
                <input 
                  type="text" 
                  autoFocus
                  placeholder="Nome da nova lista (Ex: Clientes VIP)"
                  className="flex-1 px-4 py-2 border border-emerald-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateList()}
                />
                <button onClick={handleCreateList} className="bg-emerald-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-emerald-700 text-sm shadow-sm">Salvar</button>
                <button onClick={() => setIsCreatingList(false)} className="text-gray-500 hover:text-gray-700 font-medium text-sm px-3">Cancelar</button>
             </div>
          )}

          {/* Table */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col h-[500px]">
            <div className="overflow-y-auto custom-scrollbar flex-1">
              <table className="w-full text-sm text-left">
                  <thead className="bg-gray-50 text-gray-500 font-medium border-b border-gray-200 sticky top-0 z-10">
                    <tr>
                      <th className="px-6 py-3 w-10 bg-gray-50">
                        <input 
                          type="checkbox" 
                          className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer border-gray-300"
                          checked={filteredContacts.length > 0 && selectedContactIds.size === filteredContacts.length}
                          onChange={toggleSelectAll}
                        />
                      </th>
                      <th className="px-6 py-3 bg-gray-50">Nome</th>
                      <th className="px-6 py-3 bg-gray-50">Telefone</th>
                      <th className="px-6 py-3 bg-gray-50">Tags</th>
                      <th className="px-6 py-3 bg-gray-50 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredContacts.length === 0 && (
                        <tr><td colSpan={5} className="py-12 text-center text-gray-500">
                            <div className="flex flex-col items-center">
                                <Search className="w-12 h-12 text-gray-200 mb-2" />
                                <p className="font-medium">Nenhum contato encontrado.</p>
                                <p className="text-xs mt-1">Tente mudar os filtros ou importe novos contatos.</p>
                            </div>
                        </td></tr>
                    )}
                    {filteredContacts.map((contact) => (
                      <tr key={contact.id} className={`hover:bg-gray-50/80 transition-colors ${selectedContactIds.has(contact.id) ? 'bg-emerald-50/30' : ''}`}>
                        <td className="px-6 py-3">
                           <input 
                              type="checkbox" 
                              className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer border-gray-300"
                              checked={selectedContactIds.has(contact.id)}
                              onChange={() => toggleSelectOne(contact.id)}
                            />
                        </td>
                        <td className="px-6 py-3">
                            <div className="flex items-center gap-3">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${contact.source === 'IMPORT' ? 'bg-blue-100 text-blue-600' : 'bg-emerald-100 text-emerald-600'}`}>
                                    {contact.name.charAt(0).toUpperCase()}
                                </div>
                                <div>
                                    <div className="font-medium text-gray-900">{contact.name}</div>
                                    {contact.source === 'IMPORT' && <span className="text-[9px] text-blue-500 bg-blue-50 px-1 rounded">Importado</span>}
                                </div>
                            </div>
                        </td>
                        <td className="px-6 py-3 font-mono text-gray-600 text-xs">{contact.phone}</td>
                        <td className="px-6 py-3">
                            <div className="flex gap-1 flex-wrap max-w-[200px]">
                                {contact.tags.map(tag => (
                                    <span key={tag} className={`text-[10px] px-2 py-0.5 rounded-full border ${getTagColor(tag)}`}>
                                        {tag}
                                    </span>
                                ))}
                            </div>
                        </td>
                        <td className="px-6 py-3 text-right">
                          <button onClick={() => removeContact(contact.id)} className="text-gray-400 hover:text-red-500 transition-colors p-1.5 hover:bg-red-50 rounded-lg">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* VIEW: MY LISTS */}
      {viewMode === 'lists' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in fade-in">
            {contactLists.length === 0 && (
                <div className="col-span-full py-16 text-center bg-white rounded-xl border border-dashed border-gray-300">
                    <FolderOpen className="w-16 h-16 text-gray-200 mx-auto mb-4" />
                    <h3 className="text-lg font-bold text-gray-900">Nenhuma lista criada</h3>
                    <p className="text-gray-500 mb-6 max-w-md mx-auto">Listas ajudam a segmentar seus disparos. Selecione contatos na aba "Todos os Contatos" e clique em "Salvar Lista".</p>
                    <button onClick={() => setViewMode('contacts')} className="bg-emerald-50 text-emerald-700 px-6 py-2 rounded-lg font-bold hover:bg-emerald-100 transition-colors">
                        Ir para contatos
                    </button>
                </div>
            )}

            {contactLists.map(list => (
                <div key={list.id} className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-lg transition-all group relative overflow-hidden hover:border-emerald-200">
                    <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                         <button 
                           onClick={() => {
                               if(window.confirm('Excluir esta lista permanentemente?')) deleteContactList(list.id);
                           }}
                           className="text-gray-400 hover:text-red-500 bg-white shadow-sm p-2 rounded-lg border border-gray-100 hover:bg-red-50"
                           title="Excluir Lista"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>

                    <div className="flex items-center gap-4 mb-4">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white shadow-blue-500/20 shadow-lg shrink-0">
                            <FolderOpen className="w-6 h-6" />
                        </div>
                        <div className="min-w-0">
                            <h3 className="font-bold text-gray-900 text-lg leading-tight truncate pr-8">{list.name}</h3>
                            <span className="text-xs text-gray-400 flex items-center gap-1">
                                {new Date(list.createdAt).toLocaleDateString()}
                            </span>
                        </div>
                    </div>
                    
                    <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-50">
                        <div className="flex -space-x-2">
                            {[...Array(Math.min(3, list.contactIds.length))].map((_, i) => (
                                <div key={i} className="w-7 h-7 rounded-full bg-gray-100 border-2 border-white flex items-center justify-center text-[8px] text-gray-400">
                                    <User className="w-3 h-3" />
                                </div>
                            ))}
                            {list.contactIds.length > 3 && (
                                <div className="w-7 h-7 rounded-full bg-gray-50 border-2 border-white flex items-center justify-center text-[9px] font-bold text-gray-500">
                                    +{list.contactIds.length - 3}
                                </div>
                            )}
                        </div>
                        <div className="text-sm font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-100">
                            {list.contactIds.length} <span className="font-normal text-emerald-600 text-xs">membros</span>
                        </div>
                    </div>
                </div>
            ))}
        </div>
      )}

      {/* IMPORT MODAL */}
      {isImportModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 animate-in fade-in zoom-in-95 relative">
                  <button 
                    onClick={() => setIsImportModalOpen(false)} 
                    className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full p-1"
                  >
                      <X className="w-5 h-5" />
                  </button>

                  <h2 className="text-xl font-bold text-gray-900 mb-2 flex items-center gap-2">
                      <FileSpreadsheet className="w-6 h-6 text-green-600" /> Importar Contatos
                  </h2>
                  <p className="text-sm text-gray-500 mb-6">Suporta arquivos .CSV ou Excel. A primeira linha deve conter os cabeçalhos (Nome, Telefone, Tags).</p>

                  <div className="border-2 border-dashed border-gray-300 rounded-xl bg-gray-50 p-8 text-center hover:bg-gray-100 hover:border-emerald-400 transition-colors group relative cursor-pointer">
                      <input 
                        type="file" 
                        accept=".csv" 
                        onChange={handleFileUpload} 
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        disabled={importProgress > 0 && importProgress < 100}
                      />
                      
                      {importProgress > 0 && importProgress < 100 ? (
                          <div className="flex flex-col items-center py-4">
                              <div className="w-12 h-12 border-4 border-emerald-200 border-t-emerald-600 rounded-full animate-spin mb-4"></div>
                              <p className="text-emerald-700 font-bold">Processando...</p>
                          </div>
                      ) : (
                          <>
                            <div className="w-16 h-16 bg-white rounded-full shadow-sm flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                                <Upload className="w-8 h-8 text-emerald-500" />
                            </div>
                            <h3 className="text-gray-700 font-bold mb-1">Clique ou Arraste aqui</h3>
                            <p className="text-xs text-gray-400">Tamanho máx: 10MB</p>
                          </>
                      )}
                  </div>

                  <div className="mt-6 flex justify-between items-center bg-blue-50 p-3 rounded-lg border border-blue-100">
                      <div className="flex items-center gap-2 text-blue-800 text-xs">
                          <AlertCircle className="w-4 h-4" />
                          <span>Baixe o modelo padrão para evitar erros.</span>
                      </div>
                      <button className="text-blue-600 font-bold text-xs hover:underline">Download Modelo</button>
                  </div>
              </div>
          </div>
      )}

    </div>
  );
};
