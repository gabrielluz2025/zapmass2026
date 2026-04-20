import { runBackup } from './backup.js';

const reason = process.env.BACKUP_REASON || 'manual';

runBackup(reason)
  .then((result) => {
    console.log(`Backup salvo em: ${result.backupDir}`);
    console.log(`Fontes copiadas: ${result.sources.join(', ') || 'nenhuma'}`);
    if (result.skipped.length > 0) {
      console.log(`Fontes ignoradas: ${result.skipped.join(', ')}`);
    }
  })
  .catch((error) => {
    console.error('Falha ao criar backup:', error);
    process.exit(1);
  });
