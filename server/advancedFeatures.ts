/**
 * ZapMass - Recursos Avançados (Melhorias 4-10)
 * Implementações complementares para whatsappService
 */

import { Server as SocketIOServer } from 'socket.io';

// --- WARMUP GRADUAL DE CANAIS ---
export interface WarmupConfig {
    connectionId: string;
    createdAt: number;
    currentLimit: number; // msgs/hora
}

const warmupConfigs = new Map<string, WarmupConfig>();

export const initWarmup = (connectionId: string) => {
    warmupConfigs.set(connectionId, {
        connectionId,
        createdAt: Date.now(),
        currentLimit: 10 // Começa com 10 msgs/hora
    });
    console.log(`[Warmup] Canal ${connectionId} iniciado com limite de 10 msgs/hora`);
};

export const getWarmupLimit = (connectionId: string): number => {
    const config = warmupConfigs.get(connectionId);
    if (!config) return 100; // Padrão para canais antigos
    
    const daysActive = (Date.now() - config.createdAt) / (1000 * 60 * 60 * 24);
    
    if (daysActive < 1) return 10;
    if (daysActive < 7) return 30;
    if (daysActive < 14) return 50;
    if (daysActive < 30) return 75;
    return 100; // Maduro
};

// --- DETECÇÃO PREDITIVA DE FALHAS ---
export interface PredictiveMetrics {
    recentLatencies: number[];
    recentTimeouts: number;
    consecutiveSlowResponses: number;
}

const predictiveMetrics = new Map<string, PredictiveMetrics>();

export const recordLatency = (connectionId: string, latency: number) => {
    let metrics = predictiveMetrics.get(connectionId);
    if (!metrics) {
        metrics = { recentLatencies: [], recentTimeouts: 0, consecutiveSlowResponses: 0 };
        predictiveMetrics.set(connectionId, metrics);
    }
    
    metrics.recentLatencies.push(latency);
    if (metrics.recentLatencies.length > 10) metrics.recentLatencies.shift();
    
    if (latency > 5000) {
        metrics.consecutiveSlowResponses++;
    } else {
        metrics.consecutiveSlowResponses = 0;
    }
};

export const predictFailure = (connectionId: string): boolean => {
    const metrics = predictiveMetrics.get(connectionId);
    if (!metrics) return false;
    
    // Prevê falha se:
    // 1. 3+ respostas lentas consecutivas
    // 2. Latência média > 8s nos últimos 10
    const avgLatency = metrics.recentLatencies.reduce((a, b) => a + b, 0) / metrics.recentLatencies.length;
    
    if (metrics.consecutiveSlowResponses >= 3 || avgLatency > 8000) {
        console.warn(`[Predictive] ⚠️ Canal ${connectionId} provavelmente vai falhar. Restart proativo recomendado.`);
        return true;
    }
    
    return false;
};

// --- ANÁLISE DE PADRÕES DE FALHA ---
export interface FailurePattern {
    ddd?: string;
    hour?: number;
    failureCount: number;
    totalAttempts: number;
}

const failurePatterns: FailurePattern[] = [];

export const recordFailurePattern = (phoneNumber: string, hour: number, failed: boolean) => {
    const ddd = phoneNumber.slice(2, 4); // Extrai DDD (assumindo 55DDDNUMERO)
    
    let pattern = failurePatterns.find(p => p.ddd === ddd && p.hour === hour);
    if (!pattern) {
        pattern = { ddd, hour, failureCount: 0, totalAttempts: 0 };
        failurePatterns.push(pattern);
    }
    
    pattern.totalAttempts++;
    if (failed) pattern.failureCount++;
    
    const failureRate = pattern.failureCount / pattern.totalAttempts;
    if (failureRate > 0.7 && pattern.totalAttempts > 20) {
        console.warn(`[FailurePattern] 🔍 DDD ${ddd} às ${hour}h tem ${Math.round(failureRate * 100)}% de falha`);
    }
};

export const shouldAvoidPattern = (phoneNumber: string): boolean => {
    const ddd = phoneNumber.slice(2, 4);
    const hour = new Date().getHours();
    
    const pattern = failurePatterns.find(p => p.ddd === ddd && p.hour === hour);
    if (pattern && pattern.totalAttempts > 20) {
        const failureRate = pattern.failureCount / pattern.totalAttempts;
        return failureRate > 0.7; // Evitar se > 70% falha
    }
    
    return false;
};

// --- SIMULAÇÃO DE COMPORTAMENTO HUMANO ---
export const getHumanizedDelay = (): number => {
    const hour = new Date().getHours();
    const dayOfWeek = new Date().getDay();
    
    // Domingo: mais devagar
    if (dayOfWeek === 0) {
        return Math.random() * 15000 + 10000; // 10-25s
    }
    
    // Horários de pico: mais rápido
    if (hour >= 9 && hour < 18 && dayOfWeek >= 1 && dayOfWeek <= 5) {
        return Math.random() * 3000 + 2000; // 2-5s
    }
    
    // Madrugada: muito devagar ou nenhum envio
    if (hour >= 23 || hour < 7) {
        return Math.random() * 30000 + 20000; // 20-50s
    }
    
    // Padrão
    return Math.random() * 8000 + 5000; // 5-13s
};

export const shouldTakeBreak = (): boolean => {
    const hour = new Date().getHours();
    const minute = new Date().getMinutes();
    
    // Pausa para almoço (12h-13h30)
    if (hour === 12 || (hour === 13 && minute < 30)) {
        return Math.random() < 0.7; // 70% chance de pausar
    }
    
    // Pausa para café (15h-15h15)
    if (hour === 15 && minute < 15) {
        return Math.random() < 0.5; // 50% chance
    }
    
    return false;
};

// --- WEBHOOK DE EVENTOS CRÍTICOS ---
export const sendWebhook = async (event: string, data: any, webhookUrl?: string) => {
    if (!webhookUrl) return;
    
    try {
        const payload = {
            event,
            timestamp: new Date().toISOString(),
            data
        };
        
        await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        console.log(`[Webhook] ✅ Evento ${event} enviado`);
    } catch (error) {
        console.error(`[Webhook] ❌ Falha ao enviar ${event}:`, error);
    }
};

// --- AUTO-SCALING ---
export const analyzeCapacity = (
    queueSize: number,
    activeChannels: number,
    messagesPerHour: number
): { needsScaling: boolean; suggestedChannels: number } => {
    const capacityPerChannel = 100; // msgs/hora
    const totalCapacity = activeChannels * capacityPerChannel;
    const utilizationRate = messagesPerHour / totalCapacity;
    
    if (utilizationRate > 0.8) {
        const neededChannels = Math.ceil(messagesPerHour / capacityPerChannel);
        const additionalNeeded = neededChannels - activeChannels;
        
        console.warn(`[AutoScaling] ⚠️ Utilização: ${Math.round(utilizationRate * 100)}%. Sugestão: +${additionalNeeded} canais`);
        
        return {
            needsScaling: true,
            suggestedChannels: additionalNeeded
        };
    }
    
    return { needsScaling: false, suggestedChannels: 0 };
};

// --- LOAD BALANCER INTELIGENTE ---
export interface ChannelScore {
    connectionId: string;
    healthScore: number;
    queueSize: number;
    successRate: number;
}

export const selectBestChannel = (channels: ChannelScore[]): string | null => {
    if (channels.length === 0) return null;
    
    // Filtrar apenas canais saudáveis (health > 50)
    const healthyChannels = channels.filter(c => c.healthScore > 50);
    if (healthyChannels.length === 0) return channels[0].connectionId; // Fallback
    
    // Ordenar por: health score (70%) + menos fila (30%)
    const scored = healthyChannels.map(c => ({
        ...c,
        finalScore: (c.healthScore * 0.7) + ((100 - c.queueSize) * 0.3)
    })).sort((a, b) => b.finalScore - a.finalScore);
    
    return scored[0].connectionId;
};

export default {
    initWarmup,
    getWarmupLimit,
    recordLatency,
    predictFailure,
    recordFailurePattern,
    shouldAvoidPattern,
    getHumanizedDelay,
    shouldTakeBreak,
    sendWebhook,
    analyzeCapacity,
    selectBestChannel
};
