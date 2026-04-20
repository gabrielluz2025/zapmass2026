import React from 'react';
import { MessageSquare, Users, Settings, LayoutDashboard, Radio, LogOut, MessageCircle } from 'lucide-react';
import { useZapMass } from '../context/ZapMassContext';

interface SidebarProps {
  currentView: string;
  onChangeView: (view: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentView, onChangeView }) => {
  const { isBackendConnected } = useZapMass();

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'chat', label: 'Bate-papo', icon: MessageCircle },
    { id: 'connections', label: 'Conexões', icon: Radio },
    { id: 'campaigns', label: 'Campanhas', icon: MessageSquare },
    { id: 'contacts', label: 'Contatos', icon: Users },
    { id: 'settings', label: 'Configurações', icon: Settings },
  ];

  return (
    <aside className="hidden md:flex flex-col w-64 bg-white border-r border-gray-200 h-screen fixed left-0 top-0 z-30">
      <div className="p-6 border-b border-gray-100 flex items-center gap-3">
        <div className="w-8 h-8 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-lg flex items-center justify-center shadow-lg shadow-emerald-500/20 relative">
          <MessageSquare className="text-white w-5 h-5" />
          {/* Indicador de Status Visual no Ícone */}
          <div className={`absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 border-white ${isBackendConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
        </div>
        <div className="flex flex-col">
          <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-gray-800 to-gray-600 leading-none">
            ZapMass
          </span>
          <div className="flex items-center gap-1.5 mt-1">
             <div className={`w-1.5 h-1.5 rounded-full ${isBackendConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
             <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">
               {isBackendConnected ? 'Online' : 'Desconectado'}
             </span>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onChangeView(item.id)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-200 group ${
              currentView === item.id 
                ? 'bg-emerald-50 text-emerald-700 shadow-sm ring-1 ring-emerald-100' 
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
            }`}
          >
            <item.icon className={`w-5 h-5 ${currentView === item.id ? 'text-emerald-600' : 'text-gray-400 group-hover:text-gray-600'}`} />
            {item.label}
          </button>
        ))}
      </nav>

      <div className="p-4 border-t border-gray-100">
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-gray-50 border border-gray-100">
          <img 
            src="https://picsum.photos/100/100" 
            alt="User" 
            className="w-8 h-8 rounded-full border border-gray-200"
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">Admin User</p>
            <p className="text-xs text-gray-500 truncate">admin@zapmass.com</p>
          </div>
          <button className="text-gray-400 hover:text-red-500 transition-colors">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
};