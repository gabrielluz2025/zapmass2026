const isWin = process.platform === 'win32';

// Evolution API Configuration
export const evolutionConfig = {
    // URL da Evolution API
    apiUrl: process.env.EVOLUTION_API_URL || (isWin ? 'http://localhost:8080' : 'http://evolution:8080'),
    
    // API Key para autenticação
    apiKey: process.env.EVOLUTION_API_KEY || 'zapmass-secure-key-2026',
    
    // URL do webhook (Evolution POSTa eventos aqui). No Swarm use hostname interno alcançável pelo contentor evolution (ex.: http://api:3001/webhook/evolution), não o domínio público.
    webhookUrl: process.env.ZAPMASS_WEBHOOK_URL || (isWin ? 'http://localhost:3001/webhook/evolution' : 'http://api:3001/webhook/evolution'),
    
    // Timeout para requests HTTP (30s)
    timeout: 30000,
    
    // Retry automático
    maxRetries: 3,
    retryDelay: 2000,
};
