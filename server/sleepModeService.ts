/**
 * Modo silêncio noturno (20h–8h horário de Brasília).
 * Pausa campanhas até o usuário autorizar continuar por campanha.
 */

const MS_BR = 3 * 60 * 60 * 1000;

/** Hora atual no fuso de Brasília (0–23). */
export function brazilHour(now = Date.now()): number {
    return new Date(now - MS_BR).getUTCHours();
}

/** True entre 20h e 7:59 (horário Brasil). */
export function isBrazilNightHour(now = Date.now()): boolean {
    const h = brazilHour(now);
    return h >= 20 || h < 8;
}

/** Chave única do período noturno (para não repetir o mesmo aviso na mesma noite). */
export function brazilNightPeriodKey(now = Date.now()): string {
    const br = new Date(now - MS_BR);
    const y = br.getUTCFullYear();
    const m = String(br.getUTCMonth() + 1).padStart(2, '0');
    const d = String(br.getUTCDate()).padStart(2, '0');
    const h = br.getUTCHours();
    // Antes das 8h ainda pertence à "noite" que começou no dia anterior
    if (h < 8) {
        const prev = new Date(br.getTime() - 24 * 60 * 60 * 1000);
        const py = prev.getUTCFullYear();
        const pm = String(prev.getUTCMonth() + 1).padStart(2, '0');
        const pd = String(prev.getUTCDate()).padStart(2, '0');
        return `${py}-${pm}-${pd}-night`;
    }
    return `${y}-${m}-${d}-night`;
}

/** Milissegundos até as 8h de Brasília (próximo fim do silêncio). */
export function msUntilBrazil8am(now = Date.now()): number {
    const br = new Date(now - MS_BR);
    const h = br.getUTCHours();
    const m = br.getUTCMinutes();
    const s = br.getUTCSeconds();
    if (h >= 8 && h < 20) return 0;
    if (h >= 20) {
        const hoursUntil = (24 - h) + 8;
        return (hoursUntil * 3600 - m * 60 - s) * 1000;
    }
    // h < 8
    return ((8 - h) * 3600 - m * 60 - s) * 1000;
}

/** Campanhas autorizadas a continuar durante a noite (até 8h BRT). */
const sleepModeOverrides = new Map<string, number>();

/** Campanhas que já receberam aviso neste período noturno. */
const sleepModeNotified = new Map<string, string>();

export function hasSleepModeOverride(campaignId: string | undefined): boolean {
    if (!campaignId) return false;
    const exp = sleepModeOverrides.get(campaignId);
    if (!exp) return false;
    if (Date.now() > exp) {
        sleepModeOverrides.delete(campaignId);
        return false;
    }
    return true;
}

export function grantSleepModeOverride(campaignId: string): void {
    const until = Date.now() + Math.max(msUntilBrazil8am(), 60_000);
    sleepModeOverrides.set(campaignId, until);
}

export function revokeSleepModeOverride(campaignId: string): void {
    sleepModeOverrides.delete(campaignId);
}

/** Retorna true se deve emitir aviso ao tenant (uma vez por campanha por noite). */
export function markSleepModeNotified(campaignId: string): boolean {
    const key = brazilNightPeriodKey();
    const prev = sleepModeNotified.get(campaignId);
    if (prev === key) return false;
    sleepModeNotified.set(campaignId, key);
    return true;
}

/** Limpa avisos antigos quando o dia muda (chamado periodicamente). */
export function pruneSleepModeNotified(): void {
    const currentKey = brazilNightPeriodKey();
    for (const [id, key] of sleepModeNotified.entries()) {
        if (key !== currentKey) sleepModeNotified.delete(id);
    }
}
