import React, { useState, useEffect, useMemo } from 'react';
import {
  LayoutDashboard,
  Radio,
  MessageCircle,
  Send,
  Users,
  BarChart3,
  Flame,
  Settings,
  Shield,
  Zap,
  X,
  ChevronsLeft,
  ChevronsRight,
  Moon,
  Sun,
  LogOut,
  Code2,
  Crown,
  Server,
  BookOpen,
  UserPlus,
  Church,
  Globe2,
  Sparkles,
  MapPin
} from 'lucide-react';
import { useZapMassUiSnapshot } from '../../context/ZapMassContext';
import { useAuth } from '../../context/AuthContext';
import { ProfileAvatar } from './ProfileAvatar';
import { getSavedMode, toggleMode } from '../../theme';
import { isPlatformAdminUser } from '../../utils/adminAccess';
import { canAccessCreatorStudio } from '../../utils/creatorStudioAccess';
import { useAppProfile } from '../../context/AppProfileContext';
import { prefetchAppView } from '../../utils/prefetchAppViews';

interface SidebarProps {
  currentView: string;
  onChangeView: (view: string) => void;
  isOpen?: boolean;
  onClose?: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

interface NavItemDef {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  description?: string;
}

interface NavGroup {
  label: string;
  items: NavItemDef[];
}

const navGroups: NavGroup[] = [
  {
    label: 'Principal',
    items: [
      { id: 'dashboard', label: 'Painel', icon: LayoutDashboard, description: 'Visão geral' },
      {
        id: 'religious-members',
        label: 'Ficha membro',
        icon: Church,
        description: 'Cadastro eclesiástico (só segmento religioso)'
      },
      {
        id: 'pastoral-visits',
        label: 'Visitas',
        icon: MapPin,
        description: 'Agenda pastoral, ceia e acompanhamento'
      },
      {
        id: 'team',
        label: 'Funcionários',
        icon: UserPlus,
        description: 'Convidar quem opera com você'
      },
      { id: 'connections', label: 'Conexões', icon: Radio, description: 'Frota WhatsApp' },
      { id: 'chat', label: 'Bate-papo', icon: MessageCircle, description: 'Conversas WhatsApp em tempo real' }
    ]
  },
  {
    label: 'Disparos',
    items: [
      { id: 'campaigns', label: 'Campanhas', icon: Send, description: 'Criar e gerenciar' },
      { id: 'contacts', label: 'Contatos', icon: Users, description: 'Listas e base' },
      {
        id: 'contacts-map',
        label: 'Mapa dos contatos',
        icon: Globe2,
        description: 'Atlas territorial, calor e campanhas por região'
      },
      { id: 'reports', label: 'Relatórios', icon: BarChart3, description: 'Análise e métricas' }
    ]
  },
  {
    label: 'Operações',
    items: [{ id: 'warmup', label: 'Aquecimento', icon: Flame, description: 'Warmup seguro' }]
  },
  {
    label: 'Sistema',
    items: [
      { id: 'help', label: 'Como usar', icon: BookOpen, description: 'Tutorial passo a passo' },
      { id: 'subscription', label: 'Minha assinatura', icon: Crown, description: 'Plano, renovação e cartão' },
      { id: 'settings', label: 'Configurações', icon: Settings, description: 'Ajustes gerais' }
    ]
  }
];

const ADMIN_NAV_ITEM: NavItemDef = {
  id: 'admin',
  label: 'Painel do criador',
  icon: Shield,
  description: 'Preços, teste e textos remotos'
};

const CREATOR_STUDIO_ITEM: NavItemDef = {
  id: 'creator-studio',
  label: 'Estúdio',
  icon: Code2,
  description: 'Ferramentas internas e API'
};

const ADMIN_OPS_ITEM: NavItemDef = {
  id: 'admin-ops',
  label: 'Servidor & alertas',
  icon: Server,
  description: 'RAM, fila e integrações'
};

const AI_ASSISTANT_NAV_ITEM: NavItemDef = {
  id: 'ai-assistant',
  label: 'Assistente IA',
  icon: Sparkles,
  description: 'Gemini — administrador da plataforma'
};

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  onChangeView,
  isOpen = false,
  onClose,
  collapsed = false,
  onToggleCollapsed
}) => {
  const { backendLinkState } = useZapMassUiSnapshot();
  const linkLabel =
    backendLinkState === 'online'
      ? 'Online'
      : backendLinkState === 'reconnecting'
        ? 'Reconectando'
        : 'Offline';
  const linkDotClass =
    backendLinkState === 'online'
      ? 'bg-emerald-400'
      : backendLinkState === 'reconnecting'
        ? 'bg-amber-400'
        : 'bg-red-400';
  const { user, signOut } = useAuth();
  const { segment } = useAppProfile();
  const [mode, setMode] = useState(getSavedMode());

  const navGroupsDisplay = useMemo(() => {
    let groups = navGroups.map((g) => {
      if (g.label !== 'Principal') return g;
      const items =
        segment === 'religious'
          ? g.items
          : g.items.filter((it) => it.id !== 'religious-members' && it.id !== 'pastoral-visits');
      return { ...g, items };
    });
    if (isPlatformAdminUser(user)) {
      groups = groups.map((gr) => {
        if (gr.label === 'Sistema') {
          return {
            ...gr,
            items: [AI_ASSISTANT_NAV_ITEM, ...gr.items, ADMIN_NAV_ITEM]
          };
        }
        if (gr.label === 'Operações') return { ...gr, items: [...gr.items, ADMIN_OPS_ITEM] };
        return gr;
      });
    }
    if (canAccessCreatorStudio(user?.email ?? null)) {
      return [
        ...groups,
        {
          label: 'Estúdio criador',
          items: [CREATOR_STUDIO_ITEM]
        }
      ];
    }
    return groups;
  }, [user, segment]);

  useEffect(() => {
    setMode(getSavedMode());
  }, []);

  const widthClass = collapsed ? 'w-[68px]' : 'w-[256px]';

  return (
    <aside
      className={`zm-sidebar-aurora flex flex-col ${widthClass} h-screen fixed left-0 top-0 z-40 transition-all duration-300 ease-in-out motion-reduce:transition-none motion-reduce:duration-0 ${
        isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      }`}
      style={{
        borderRight: '1px solid var(--sidebar-border)'
      }}
    >
      <div
        className="absolute top-0 left-0 right-0 h-px pointer-events-none"
        style={{ background: 'linear-gradient(90deg, transparent, rgba(16,185,129,0.5), transparent)' }}
      />

      <button
        onClick={onClose}
        className="lg:hidden absolute top-3 right-3 z-10 p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
        aria-label="Fechar menu"
      >
        <X className="w-4 h-4" />
      </button>

      <div className={`px-4 pt-5 pb-4 ${collapsed ? 'px-3' : ''}`}>
        <div className={`flex items-center ${collapsed ? 'justify-center' : 'gap-3'}`}>
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{
              background: 'linear-gradient(135deg, var(--brand-500), var(--brand-700))',
              boxShadow: '0 0 20px rgba(16,185,129,0.35)'
            }}
          >
            <Zap className="w-4 h-4 text-white fill-white" />
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="text-white font-bold text-[15px] tracking-tight leading-none">ZapMass</div>
              <div className="flex items-center gap-1.5 mt-1">
                <div
                  className={`w-1.5 h-1.5 rounded-full ${linkDotClass}`}
                  style={
                    backendLinkState === 'online'
                      ? { boxShadow: '0 0 6px rgba(52,211,153,0.8)' }
                      : backendLinkState === 'reconnecting'
                        ? { boxShadow: '0 0 6px rgba(251,191,36,0.7)' }
                        : {}
                  }
                />
                <span
                  className="text-[10px] font-semibold uppercase tracking-widest"
                  style={{ color: 'var(--sidebar-text-muted)' }}
                >
                  {linkLabel}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div
        className={`mx-4 mb-2 ${collapsed ? 'mx-3' : ''}`}
        style={{ height: '1px', background: 'var(--sidebar-border)' }}
      />

      <nav className={`flex-1 overflow-y-auto px-3 py-2 space-y-4 ${collapsed ? 'px-2' : ''}`}>
        {navGroupsDisplay.map((group) => (
          <div key={group.label}>
            {!collapsed && (
              <div className="px-3 mb-1.5">
                <span
                  className="text-[10px] font-bold uppercase tracking-[0.18em]"
                  style={{ color: 'var(--sidebar-text-muted)', opacity: 0.7 }}
                >
                  {group.label}
                </span>
              </div>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = currentView === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onChangeView(item.id)}
                    onMouseEnter={() => prefetchAppView(item.id)}
                    onFocus={() => prefetchAppView(item.id)}
                    aria-current={isActive ? 'page' : undefined}
                    title={collapsed ? item.label : undefined}
                    className={`zm-nav-item-aurora w-full flex items-center gap-3 ${
                      collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2'
                    } text-[13px] font-medium group relative ${
                      isActive ? 'is-active text-white' : 'text-slate-400 hover:text-slate-100'
                    }`}
                  >
                    {isActive && !collapsed && (
                      <div
                        className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r-full bg-emerald-400 hidden"
                        style={{ boxShadow: '0 0 10px rgba(52,211,153,0.7)' }}
                      />
                    )}
                    <Icon
                      className={`flex-shrink-0 transition-colors ${
                        isActive ? 'text-emerald-400' : 'text-slate-500 group-hover:text-slate-200'
                      }`}
                      style={{ width: '17px', height: '17px' }}
                    />
                    {!collapsed && (
                      <>
                        <span className="flex-1 text-left truncate">{item.label}</span>
                        {isActive && (
                          <div
                            className="w-1.5 h-1.5 rounded-full bg-emerald-400"
                            style={{ boxShadow: '0 0 6px rgba(52,211,153,0.8)' }}
                          />
                        )}
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div
        className={`mx-4 mt-2 mb-3 ${collapsed ? 'mx-3' : ''}`}
        style={{ height: '1px', background: 'var(--sidebar-border)' }}
      />

      <div className={`px-3 pb-4 space-y-2 ${collapsed ? 'px-2' : ''}`}>
        <div
          className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between px-3 py-2'} rounded-lg`}
          style={!collapsed ? { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' } : {}}
        >
          {!collapsed && <span className="text-[11.5px] font-semibold text-slate-400">Aparência</span>}
          <button
            onClick={() => setMode(toggleMode(mode))}
            className="p-1.5 rounded-md transition-all hover:bg-white/10 text-slate-400 hover:text-white active:scale-90"
            title={mode === 'dark' ? 'Modo claro' : 'Modo escuro'}
          >
            {mode === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>

        {onToggleCollapsed && (
          <button
            onClick={onToggleCollapsed}
            className={`hidden lg:flex items-center ${
              collapsed ? 'justify-center w-full py-2' : 'justify-between px-3 py-2 w-full'
            } rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors`}
            title={collapsed ? 'Expandir' : 'Recolher'}
          >
            {!collapsed && <span className="text-[11.5px] font-semibold">Recolher</span>}
            {collapsed ? <ChevronsRight className="w-4 h-4" /> : <ChevronsLeft className="w-4 h-4" />}
          </button>
        )}

        {!collapsed && user && (() => {
          const displayName = user.displayName || user.email?.split('@')[0] || 'Usuario';
          const email = user.email || '';
          const photoURL = user.photoURL || null;
          return (
            <div
              className="flex items-center gap-3 px-2.5 py-2.5 rounded-lg transition-all group"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
              title={email}
            >
              <div className="relative flex-shrink-0">
                <ProfileAvatar
                  photoURL={photoURL}
                  displayName={displayName}
                  className="w-8 h-8 rounded-md object-cover"
                  fallbackClassName="w-8 h-8 rounded-md flex items-center justify-center text-[11px] font-bold"
                  fallbackStyle={{ background: '#059669', color: '#fff' }}
                />
                <div
                  className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 bg-emerald-400"
                  style={{ borderColor: 'var(--sidebar-bg)' }}
                />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] font-bold text-white truncate leading-tight">{displayName}</p>
                <p className="text-[10px] text-emerald-400 font-semibold truncate leading-tight mt-0.5">
                  {email || 'ZapMass Pro'}
                </p>
              </div>
              <button
                type="button"
                onClick={signOut}
                className="p-1 text-slate-500 hover:text-red-400 transition-colors active:scale-90 opacity-0 group-hover:opacity-100"
                title="Sair da conta"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })()}
      </div>
    </aside>
  );
};
