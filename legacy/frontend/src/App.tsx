import React, { useState, useMemo } from 'react';
import { Plus, Search, Radio, BarChart3, MessageCircle, Zap, Filter } from 'lucide-react';
import { Toaster } from 'react-hot-toast';
import { Sidebar } from './components/Sidebar';
import { ConnectionCard } from './components/ConnectionCard';
import { AddConnectionModal } from './components/AddConnectionModal';
import { CampaignsTab } from './components/CampaignsTab';
import { DashboardTab } from './components/DashboardTab';
import { ContactsTab } from './components/ContactsTab';
import { SettingsTab } from './components/SettingsTab';
import { ChatTab } from './components/ChatTab';
import { ConnectionStatus } from './types';
import { ZapMassProvider, useZapMass } from './context/ZapMassContext';

// Main Layout Component that consumes the Context
const MainLayout: React.FC = () => {
  const { 
    connections, 
    addConnection, 
    removeConnection, 
    reconnectConnection,
    updateConnectionStatus 
  } = useZapMass();

  const [currentView, setCurrentView] = useState('connections');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'ONLINE' | 'OFFLINE' | 'WARNING'>('ALL');

  // Filter Logic
  const filteredConnections = useMemo(() => {
    return connections.filter(conn => {
      const matchesSearch = conn.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          (conn.phoneNumber && conn.phoneNumber.includes(searchTerm));
      
      let matchesFilter = true;
      if (filterStatus === 'ONLINE') matchesFilter = conn.status === ConnectionStatus.CONNECTED;
      if (filterStatus === 'OFFLINE') matchesFilter = conn.status === ConnectionStatus.DISCONNECTED;
      if (filterStatus === 'WARNING') matchesFilter = (conn.batteryLevel !== undefined && conn.batteryLevel < 20) || conn.signalStrength === 'WEAK';

      return matchesSearch && matchesFilter;
    });
  }, [connections, searchTerm, filterStatus]);

  // Dashboard Metrics for Header
  const totalSentToday = connections.reduce((acc, curr) => acc + curr.messagesSentToday, 0);
  const totalQueue = connections.reduce((acc, curr) => acc + curr.queueSize, 0);
  const onlineCount = connections.filter(c => c.status === ConnectionStatus.CONNECTED).length;

  const renderContent = () => {
    switch (currentView) {
      case 'dashboard':
        return <DashboardTab />;
      case 'chat':
        return <ChatTab />;
      case 'campaigns':
        return <CampaignsTab />;
      case 'contacts':
        return <ContactsTab />;
      case 'settings':
        return <SettingsTab />;
      case 'connections':
      default:
        return (
          <div className="max-w-7xl mx-auto space-y-8 pb-12">
            {/* Page Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                  <Radio className="w-6 h-6 text-emerald-600" />
                  Gestão de Conexões
                </h1>
                <p className="text-gray-500 mt-1">Gerencie seus canais de disparo e monitore a saúde da operação.</p>
              </div>
              
              <button 
                onClick={() => setIsModalOpen(true)}
                className="group bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl font-medium shadow-lg shadow-emerald-600/20 flex items-center gap-2 transition-all transform hover:-translate-y-0.5 active:translate-y-0"
              >
                <Plus className="w-5 h-5" />
                Conectar WhatsApp
              </button>
            </div>

            {/* Metrics Dashboard */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-500 mb-1">Total Disparos (Hoje)</p>
                  <h3 className="text-2xl font-bold text-gray-900 animate-pulse-slow">{totalSentToday.toLocaleString()}</h3>
                </div>
                <div className="w-12 h-12 bg-emerald-50 rounded-lg flex items-center justify-center">
                  <MessageCircle className="w-6 h-6 text-emerald-600" />
                </div>
              </div>

              <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-500 mb-1">Dispositivos Online</p>
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-2xl font-bold text-gray-900">{onlineCount} <span className="text-sm font-normal text-gray-400">/ {connections.length}</span></h3>
                  </div>
                </div>
                <div className="w-12 h-12 bg-blue-50 rounded-lg flex items-center justify-center">
                  <Zap className="w-6 h-6 text-blue-600" />
                </div>
              </div>

              <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-500 mb-1">Fila de Espera Global</p>
                  <h3 className={`text-2xl font-bold transition-colors duration-300 ${totalQueue > 100 ? 'text-amber-500' : 'text-gray-900'}`}>{totalQueue.toLocaleString()}</h3>
                </div>
                <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${totalQueue > 100 ? 'bg-amber-50' : 'bg-gray-50'}`}>
                  <BarChart3 className={`w-6 h-6 ${totalQueue > 100 ? 'text-amber-500' : 'text-gray-400'}`} />
                </div>
              </div>
            </div>

            {/* Filters & Toolbar */}
            <div className="flex flex-col md:flex-row gap-4 justify-between items-center bg-white p-2 rounded-xl border border-gray-200 shadow-sm">
               <div className="flex p-1 bg-gray-100 rounded-lg w-full md:w-auto">
                  <button 
                    onClick={() => setFilterStatus('ALL')}
                    className={`flex-1 md:flex-none px-4 py-1.5 rounded-md text-sm font-medium transition-all ${filterStatus === 'ALL' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    Todos
                  </button>
                  <button 
                    onClick={() => setFilterStatus('ONLINE')}
                    className={`flex-1 md:flex-none px-4 py-1.5 rounded-md text-sm font-medium transition-all ${filterStatus === 'ONLINE' ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    Online ({connections.filter(c => c.status === ConnectionStatus.CONNECTED).length})
                  </button>
                  <button 
                    onClick={() => setFilterStatus('OFFLINE')}
                    className={`flex-1 md:flex-none px-4 py-1.5 rounded-md text-sm font-medium transition-all ${filterStatus === 'OFFLINE' ? 'bg-white text-red-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    Offline ({connections.filter(c => c.status === ConnectionStatus.DISCONNECTED).length})
                  </button>
                  <button 
                    onClick={() => setFilterStatus('WARNING')}
                    className={`flex-1 md:flex-none px-4 py-1.5 rounded-md text-sm font-medium transition-all flex items-center justify-center gap-1 ${filterStatus === 'WARNING' ? 'bg-white text-amber-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    Alertas
                  </button>
               </div>

               <div className="relative w-full md:w-80">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <input 
                    type="text" 
                    placeholder="Buscar conexão..." 
                    className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-transparent focus:bg-white focus:border-emerald-500 rounded-lg text-sm outline-none transition-all"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
               </div>
            </div>

            {/* Grid of Connections */}
            {filteredConnections.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {filteredConnections.map(connection => (
                  <ConnectionCard 
                    key={connection.id} 
                    connection={connection} 
                    onDisconnect={removeConnection}
                    onReconnect={reconnectConnection}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-gray-300">
                <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Filter className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="text-lg font-medium text-gray-900">Nenhum resultado encontrado</h3>
                <p className="text-gray-500 mt-1">
                  {searchTerm 
                    ? `Não encontramos nada para "${searchTerm}"` 
                    : filterStatus !== 'ALL' 
                      ? `Nenhuma conexão com o filtro "${filterStatus}"` 
                      : 'Adicione sua primeira conexão WhatsApp.'}
                </p>
                {searchTerm && (
                  <button 
                    onClick={() => setSearchTerm('')}
                    className="mt-4 text-emerald-600 font-medium hover:underline"
                  >
                    Limpar busca
                  </button>
                )}
              </div>
            )}
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <Sidebar currentView={currentView} onChangeView={setCurrentView} />
      <main className="flex-1 md:ml-64 p-4 md:p-8 overflow-y-auto h-screen">
        {renderContent()}
      </main>
      <AddConnectionModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        onSuccess={addConnection} 
      />
    </div>
  );
};

// Root App Component wrapped with Provider
const App: React.FC = () => {
  return (
    <ZapMassProvider>
      <Toaster position="top-right" />
      <MainLayout />
    </ZapMassProvider>
  );
};

export default App;