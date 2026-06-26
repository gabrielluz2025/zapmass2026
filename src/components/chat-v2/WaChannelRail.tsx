/**
 * Rail esquerdo de canais/chips — coluna de 68px estilo Discord/Slack.
 * Cada chip WhatsApp vira um ícone clicável com badge de não-lidas.
 */
import React, { useState } from 'react';
import { Globe } from 'lucide-react';
import type { WhatsAppConnection, Conversation } from '../../types';
import { connectionBadgeHue, unreadCount } from './lib/conversationDisplay';

type Props = {
  connections: WhatsAppConnection[];
  conversations: Conversation[];
  activeId: string | 'ALL';
  onChange: (id: string | 'ALL') => void;
};

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function getChannelUnread(conversations: Conversation[], connectionId: string): number {
  return conversations
    .filter((c) => c.connectionId === connectionId)
    .reduce((n, c) => n + unreadCount(c), 0);
}

function getTotalUnread(conversations: Conversation[]): number {
  return conversations.reduce((n, c) => n + unreadCount(c), 0);
}

export const WaChannelRail: React.FC<Props> = ({ connections, conversations, activeId, onChange }) => {
  const totalUnread = getTotalUnread(conversations);

  return (
    <nav className="wa-channel-rail">
      {/* Todos os canais */}
      <button
        type="button"
        className="wa-rail-btn"
        data-active={activeId === 'ALL' ? 'true' : 'false'}
        onClick={() => onChange('ALL')}
        title="Todas as conversas"
      >
        <Globe className="w-5 h-5 pointer-events-none" />
        {totalUnread > 0 && (
          <span className="wa-rail-badge">{totalUnread > 99 ? '99+' : totalUnread}</span>
        )}
      </button>

      {connections.length > 0 && (
        <div className="wa-rail-divider" />
      )}

      {/* Um botão por chip */}
      {connections.map((conn) => (
        <WaChannelButton
          key={conn.id}
          conn={conn}
          conversations={conversations}
          isActive={activeId === conn.id}
          onChange={onChange}
        />
      ))}
    </nav>
  );
};

type ButtonProps = {
  conn: WhatsAppConnection;
  conversations: Conversation[];
  isActive: boolean;
  onChange: (id: string | 'ALL') => void;
};

const WaChannelButton: React.FC<ButtonProps> = ({ conn, conversations, isActive, onChange }) => {
  const [imageError, setImageError] = useState(false);
  const hue = connectionBadgeHue(conn.id);
  const initials = getInitials(conn.name || conn.id.slice(0, 6));
  const unread = getChannelUnread(conversations, conn.id);
  const isOnline = conn.status === 'CONNECTED';

  return (
    <button
      type="button"
      className="wa-rail-btn"
      data-active={isActive ? 'true' : 'false'}
      onClick={() => onChange(conn.id)}
      title={`${conn.name || conn.id}${isOnline ? ' · Online' : ' · Offline'}`}
    >
      {conn.profilePicUrl && !imageError ? (
        <img
          src={conn.profilePicUrl}
          alt={initials}
          className="wa-rail-avatar pointer-events-none"
          style={{ objectFit: 'cover' }}
          onError={() => setImageError(true)}
        />
      ) : (
        <span
          className="wa-rail-avatar pointer-events-none"
          style={{ background: `hsl(${hue}, 55%, 38%)` }}
        >
          {initials}
        </span>
      )}
      {/* Indicador online/offline */}
      <span
        className="wa-rail-status-dot"
        style={{ background: isOnline ? '#25d366' : '#94a3b8' }}
        aria-label={isOnline ? 'Online' : 'Offline'}
      />
      {unread > 0 && (
        <span className="wa-rail-badge">{unread > 99 ? '99+' : unread}</span>
      )}
    </button>
  );
};
