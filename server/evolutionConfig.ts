// Evolution API Configuration
export const evolutionConfig = {
    // URL da Evolution API
    apiUrl: process.env.EVOLUTION_API_URL || 'http://localhost:8080',
    
    // API Key para autenticação
    apiKey: process.env.EVOLUTION_API_KEY || 'zapmass-secure-key-2026',
    
    // URL do webhook do ZapMass (para receber eventos)
    webhookUrl: process.env.ZAPMASS_WEBHOOK_URL || 'http://localhost:3001/webhook/evolution',
    
    // Timeout para requests HTTP (30s)
    timeout: 30000,
    
    // Retry automático
    maxRetries: 3,
    retryDelay: 2000,
};
