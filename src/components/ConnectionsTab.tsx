import React, { useMemo, useState } from 'react';
import { Plus, Search, Radio, Filter, Wifi, WifiOff, QrCode, Activity } from 'lucide-react';
import { ConnectionStatus } from '../types';
import { useZapMass } from '../context/ZapMassContext';
import { ConnectionCardNew as ConnectionCard } from './ConnectionCardNew';
import { AddConnectionModal } from './AddConnectionModal';
import { SectionHeader, StatCard, Tabs, Input, Button, EmptyState } from './ui';

type FilterValue = 'ALL' | 'ONLINE' | 'OFFLINE' | 'PAIRING';

export const ConnectionsTab: React.FC = () => {
  const { connections, addConnection, removeConnection, reconnectConnection, forceQr } = useZapMass();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterValue>('ALL');

  const counts = useMemo(() => {
    const online = connections.filter((c) => c.status === ConnectionStatus.CONNECTED).length;
    const offline = connections.filter((c) => c.status === ConnectionStatus.DISCONNECTED).length;
    const pairing = connections.filter(
      (c) => c.status === ConnectionStatus.QR_READY || c.status === ConnectionStatus.CONNECTING
    ).length;
    const totalSentToday = connections.reduce((acc, c) => acc + c.messagesSentToday, 0);
    const totalQueue = connections.reduce((acc, c) => acc + c.queueSize, 0);
    const lowBattery = connections.filter((c) => (c.batteryLevel ?? 100) < 20).length;
    return { online, offline, pairing, totalSentToday, totalQueue, lowBattery };
  }, [connections]);

  const filteredConnections = useMemo(() => {
    return connections.filter((conn) => {
      const term = searchTerm.toLowerCase();
      const matchesSearch =
        !term ||
        conn.name.toLowerCase().includes(term) ||
        (conn.phoneNumber && conn.phoneNumber.includes(searchTerm));

      let matchesFilter = true;
      if (filterStatus === 'ONLINE') matchesFilter = conn.status === ConnectionStatus.CONNECTED;
      if (filterStatus === 'OFFLINE') matchesFilter = conn.status === ConnectionStatus.DISCONNECTED;
      if (filterStatus === 'PAIRING')
        matchesFilter =
          conn.status === ConnectionStatus.QR_READY || conn.status === ConnectionStatus.CONNECTING;

      return matchesSearch && matchesFilter;
    });
  }, [connections, searchTerm, filterStatus]);

  return (
    <div className="space-y-6 pb-8">
      <SectionHeader
        eyebrow={
          <>
            <Radio className="w-3 h-3" />
            Gestao de Frota
          </>
        }
        title="Conexoes WhatsApp"
        description="Controle sua frota de canais WhatsApp com visibilidade total da operacao em tempo real."
        icon={<Radio className="w-5 h-5" style={{ color: 'var(--brand-600)' }} />}
        actions={
          <Button
            variant="primary"
            size="lg"
            leftIcon={<Plus className="w-4 h-4" />}
            onClick={() => setIsModalOpen(true)}
          >
            Conectar WhatsApp
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard
          label="Canais Online"
          value={counts.online}
          helper={`${connections.length} cadastrados`}
          icon={<Wifi className="w-4 h-4" />}
          accent="success"
        />
        <StatCard
          label="Disparos Hoje"
          value={counts.totalSentToday.toLocaleString()}
          helper={
            counts.totalSentToday > 0
              ? `~${Math.round(counts.totalSentToday / Math.max(1, new Date().getHours() || 1))}/hora`
              : 'Aguardando disparos'
          }
          icon={<Activity className="w-4 h-4" />}
        />
        <StatCard
          label="Fila Global"
          value={counts.totalQueue.toLocaleString()}
          helper={counts.totalQueue > 100 ? 'Alta demanda' : 'Fluxo normal'}
          icon={<Activity className="w-4 h-4" />}
          accent={counts.totalQueue > 100 ? 'warning' : 'default'}
        />
        <StatCard
          label="Alertas"
          value={counts.offline + counts.pairing + counts.lowBattery}
          helper={`${counts.offline} offline - ${counts.lowBattery} bateria baixa`}
          icon={<WifiOff className="w-4 h-4" />}
          accent={counts.offline + counts.lowBattery > 0 ? 'warning' : 'default'}
        />
      </div>

      <div className="ui-card flex flex-col lg:flex-row lg:items-center gap-3">
        <Tabs
          value={filterStatus}
          onChange={(v) => setFilterStatus(v as FilterValue)}
          items={[
            { id: 'ALL', label: `Todas (${connections.length})` },
            { id: 'ONLINE', label: `Online (${counts.online})`, icon: <Wifi className="w-3.5 h-3.5" /> },
            { id: 'OFFLINE', label: `Offline (${counts.offline})`, icon: <WifiOff className="w-3.5 h-3.5" /> },
            { id: 'PAIRING', label: `Pareando (${counts.pairing})`, icon: <QrCode className="w-3.5 h-3.5" /> }
          ]}
        />
        <div className="flex-1">
          <Input
            leftIcon={<Search className="w-4 h-4" />}
            placeholder="Buscar por nome ou numero..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {filteredConnections.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 lg:gap-5">
          {filteredConnections.map((connection) => (
            <ConnectionCard
              key={connection.id}
              connection={connection}
              onDisconnect={removeConnection}
              onReconnect={reconnectConnection}
              onForceQr={forceQr}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Filter className="w-6 h-6" style={{ color: 'var(--brand-600)' }} />}
          title={
            searchTerm
              ? 'Nenhum resultado'
              : filterStatus !== 'ALL'
              ? 'Sem conexoes neste filtro'
              : 'Adicione seu primeiro canal'
          }
          description={
            searchTerm
              ? `Nada encontrado para "${searchTerm}". Ajuste sua busca ou limpe o filtro.`
              : filterStatus !== 'ALL'
              ? 'Nenhuma conexao corresponde ao filtro selecionado no momento.'
              : 'Conecte um numero WhatsApp para comecar a disparar com seguranca.'
          }
          action={
            !searchTerm && filterStatus === 'ALL' ? (
              <Button variant="primary" leftIcon={<Plus className="w-4 h-4" />} onClick={() => setIsModalOpen(true)}>
                Conectar WhatsApp
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => { setSearchTerm(''); setFilterStatus('ALL'); }}>
                Limpar filtros
              </Button>
            )
          }
        />
      )}

      <AddConnectionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={addConnection}
      />
    </div>
  );
};
