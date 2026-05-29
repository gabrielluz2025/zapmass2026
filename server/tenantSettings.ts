import { getFirebaseAdmin } from './firebaseAdmin.js';
import { getFirestore } from 'firebase-admin/firestore';

export interface TenantDispatchSettings {
    minDelayMs: number;
    maxDelayMs: number;
    dailyLimit: number;
    sleepMode: boolean;
    webhookUrl: string;
    emailNotif: boolean;
    updatedAt?: string;
}

export interface TenantSettingsClientPayload {
    minDelay: number;
    maxDelay: number;
    dailyLimit: number;
    sleepMode: boolean;
    webhookUrl: string;
    emailNotif: boolean;
}

// sleepMode default false: evita que campanhas iniciadas entre 20h–8h fiquem
// presas em moveToDelayed sem nunca enviar (usuario percebia "campanha iniciada"
// sem mensagem chegar). O modo sono passa a ser opt-in via UI/Firestore.
export const DEFAULT_TENANT_DISPATCH_SETTINGS: TenantDispatchSettings = {
    minDelayMs: 15_000,
    maxDelayMs: 45_000,
    dailyLimit: 1000,
    sleepMode: false,
    webhookUrl: '',
    emailNotif: true,
};

const cache = new Map<string, TenantDispatchSettings>();

function docRef(uid: string) {
    const admin = getFirebaseAdmin();
    if (!admin) return null;
    const db = getFirestore(admin);
    return db.collection('users').doc(uid).collection('settings').doc('dispatch');
}

export function settingsToClientPayload(settings: TenantDispatchSettings): TenantSettingsClientPayload {
    return {
        minDelay: Math.round(settings.minDelayMs / 1000),
        maxDelay: Math.round(settings.maxDelayMs / 1000),
        dailyLimit: settings.dailyLimit,
        sleepMode: settings.sleepMode,
        webhookUrl: settings.webhookUrl,
        emailNotif: settings.emailNotif,
    };
}

function normalizeClientPayload(
    partial: Partial<TenantSettingsClientPayload>,
    base: TenantDispatchSettings = DEFAULT_TENANT_DISPATCH_SETTINGS
): TenantDispatchSettings {
    const next: TenantDispatchSettings = { ...base };
    if (partial.minDelay !== undefined && Number.isFinite(partial.minDelay)) {
        next.minDelayMs = Math.max(1, Number(partial.minDelay)) * 1000;
    }
    if (partial.maxDelay !== undefined && Number.isFinite(partial.maxDelay)) {
        next.maxDelayMs = Math.max(1, Number(partial.maxDelay)) * 1000;
    }
    if (next.minDelayMs > next.maxDelayMs) {
        next.maxDelayMs = next.minDelayMs;
    }
    if (partial.dailyLimit !== undefined && Number.isFinite(partial.dailyLimit)) {
        next.dailyLimit = Math.max(1, Math.floor(Number(partial.dailyLimit)));
    }
    if (partial.sleepMode !== undefined) next.sleepMode = Boolean(partial.sleepMode);
    if (partial.webhookUrl !== undefined) next.webhookUrl = String(partial.webhookUrl || '').trim();
    if (partial.emailNotif !== undefined) next.emailNotif = Boolean(partial.emailNotif);
    next.updatedAt = new Date().toISOString();
    return next;
}

function normalizeStored(raw: Record<string, unknown> | undefined): TenantDispatchSettings {
    if (!raw) return { ...DEFAULT_TENANT_DISPATCH_SETTINGS };
    const minDelayMs =
        typeof raw.minDelayMs === 'number'
            ? raw.minDelayMs
            : typeof raw.minDelay === 'number'
              ? Number(raw.minDelay) * 1000
              : DEFAULT_TENANT_DISPATCH_SETTINGS.minDelayMs;
    const maxDelayMs =
        typeof raw.maxDelayMs === 'number'
            ? raw.maxDelayMs
            : typeof raw.maxDelay === 'number'
              ? Number(raw.maxDelay) * 1000
              : DEFAULT_TENANT_DISPATCH_SETTINGS.maxDelayMs;
    return normalizeClientPayload(
        {
            minDelay: Math.round(minDelayMs / 1000),
            maxDelay: Math.round(maxDelayMs / 1000),
            dailyLimit:
                typeof raw.dailyLimit === 'number'
                    ? raw.dailyLimit
                    : DEFAULT_TENANT_DISPATCH_SETTINGS.dailyLimit,
            sleepMode:
                typeof raw.sleepMode === 'boolean'
                    ? raw.sleepMode
                    : DEFAULT_TENANT_DISPATCH_SETTINGS.sleepMode,
            webhookUrl:
                typeof raw.webhookUrl === 'string'
                    ? raw.webhookUrl
                    : DEFAULT_TENANT_DISPATCH_SETTINGS.webhookUrl,
            emailNotif:
                typeof raw.emailNotif === 'boolean'
                    ? raw.emailNotif
                    : DEFAULT_TENANT_DISPATCH_SETTINGS.emailNotif,
        },
        DEFAULT_TENANT_DISPATCH_SETTINGS
    );
}

export function getTenantDispatchSettings(uid?: string): TenantDispatchSettings {
    if (!uid) return { ...DEFAULT_TENANT_DISPATCH_SETTINGS };
    return { ...(cache.get(uid) || DEFAULT_TENANT_DISPATCH_SETTINGS) };
}

export async function loadTenantSettings(uid: string): Promise<TenantDispatchSettings> {
    if (!uid || uid === 'anonymous') {
        return { ...DEFAULT_TENANT_DISPATCH_SETTINGS };
    }
    const cached = cache.get(uid);
    if (cached) return { ...cached };

    const ref = docRef(uid);
    if (!ref) {
        const defaults = { ...DEFAULT_TENANT_DISPATCH_SETTINGS };
        cache.set(uid, defaults);
        return defaults;
    }

    try {
        const snap = await ref.get();
        const settings = normalizeStored(snap.exists ? (snap.data() as Record<string, unknown>) : undefined);
        cache.set(uid, settings);
        return { ...settings };
    } catch (error: unknown) {
        console.warn('[tenantSettings] Falha ao carregar:', (error as Error)?.message || error);
        const defaults = { ...DEFAULT_TENANT_DISPATCH_SETTINGS };
        cache.set(uid, defaults);
        return defaults;
    }
}

export async function saveTenantSettings(
    uid: string,
    partial: Partial<TenantSettingsClientPayload>
): Promise<TenantDispatchSettings> {
    if (!uid || uid === 'anonymous') {
        throw new Error('Conta inválida para salvar configurações.');
    }
    const current = await loadTenantSettings(uid);
    const next = normalizeClientPayload(partial, current);
    cache.set(uid, next);

    const ref = docRef(uid);
    if (ref) {
        try {
            await ref.set(
                {
                    minDelayMs: next.minDelayMs,
                    maxDelayMs: next.maxDelayMs,
                    dailyLimit: next.dailyLimit,
                    sleepMode: next.sleepMode,
                    webhookUrl: next.webhookUrl,
                    emailNotif: next.emailNotif,
                    updatedAt: next.updatedAt,
                },
                { merge: true }
            );
        } catch (error: unknown) {
            console.warn('[tenantSettings] Falha ao persistir:', (error as Error)?.message || error);
        }
    }
    return { ...next };
}

export function resolveCampaignDispatchSettings(
    ownerUid: string | undefined,
    delaySeconds?: number
): TenantDispatchSettings {
    const base = getTenantDispatchSettings(ownerUid);
    if (typeof delaySeconds === 'number' && Number.isFinite(delaySeconds) && delaySeconds > 0) {
        const ms = Math.max(1000, Math.floor(delaySeconds * 1000));
        return { ...base, minDelayMs: ms, maxDelayMs: ms };
    }
    return { ...base };
}
