export enum ConnectionStatus {
  CONNECTED = 'CONNECTED',
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  QR_READY = 'QR_READY',
  SUSPENDED = 'SUSPENDED', 
  BUSY = 'BUSY'
}

export interface WhatsAppConnection {
  id: string;
  name: string;
  phoneNumber: string | null; 
  status: ConnectionStatus;
  lastActivity: string;
  batteryLevel?: number;
  profilePicUrl?: string;
  queueSize: number;
  messagesSentToday: number;
  totalMessagesSent?: number;
  connectedSince?: number;
  healthScore?: number;
  signalStrength: 'STRONG' | 'MEDIUM' | 'WEAK';
}

export interface DashboardMetrics {
  totalSent: number;
  totalDelivered: number;
  totalRead: number;
  totalReplied: number;
}

export interface ChatMessage {
  id: string;
  text: string;
  timestamp: string;
  sender: 'me' | 'them';
  status: 'sent' | 'delivered' | 'read';
  type: 'text' | 'image' | 'audio' | 'sticker' | 'video' | 'document';
  mediaUrl?: string; // URL para imagem/sticker/video/document
  fromCampaign?: boolean;
  campaignId?: string;
  timestampMs?: number;
}

export interface Conversation {
  id: string;
  contactName: string;
  contactPhone: string;
  profilePicUrl?: string;
  connectionId: string;
  unreadCount: number;
  lastMessage: string;
  lastMessageTime: string;
  lastMessageTimestamp?: number; // Unix ms — usado para ordenação real
  messages: ChatMessage[];
  tags: string[];
}
