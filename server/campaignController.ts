import { io } from './server.js';
import { currentCampaign, messageQueue } from './whatsappService.js';

// Controle de pausa/retomada
let isPaused = false;
let pauseReason = '';

export const pauseCampaign = (reason = 'Manual') => {
  if (!currentCampaign.isRunning) return false;
  
  isPaused = true;
  pauseReason = reason;
  
  io.emit('campaign-paused', { 
    reason,
    processed: currentCampaign.processed,
    total: currentCampaign.total 
  });
  
  console.log(`[Campaign] ⏸️ Campanha pausada: ${reason}`);
  return true;
};

export const resumeCampaign = () => {
  if (!currentCampaign.isRunning || !isPaused) return false;
  
  isPaused = false;
  pauseReason = '';
  
  io.emit('campaign-resumed', {
    processed: currentCampaign.processed,
    total: currentCampaign.total
  });
  
  console.log('[Campaign] ▶️ Campanha retomada');
  
  // Retomar processamento da fila
  import('./whatsappService.js').then(({ processQueue }) => {
    processQueue();
  });
  
  return true;
};

export const stopCampaign = (reason = 'Manual') => {
  if (!currentCampaign.isRunning) return false;
  
  currentCampaign.isRunning = false;
  isPaused = false;
  
  io.emit('campaign-stopped', { 
    reason,
    finalStats: {
      processed: currentCampaign.processed,
      success: currentCampaign.successCount,
      failed: currentCampaign.failCount,
      total: currentCampaign.total
    }
  });
  
  console.log(`[Campaign] ⏹️ Campanha parada: ${reason}`);
  return true;
};

export const getCampaignState = () => ({
  isRunning: currentCampaign.isRunning,
  isPaused,
  pauseReason,
  stats: {
    total: currentCampaign.total,
    processed: currentCampaign.processed,
    success: currentCampaign.successCount,
    failed: currentCampaign.failCount
  }
});

// Hook para verificar pausa antes de processar mensagens
export const shouldProcessMessage = () => {
  return currentCampaign.isRunning && !isPaused;
};
