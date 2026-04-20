import { WHATSAPP_RISK_VERSION } from '../constants/whatsappLegal';

const RISK_KEY = 'zapmass.whatsapp.risk.accepted.v1';
const OFFICIAL_KEY = 'zapmass.whatsapp.official.prefs.v1';

export interface RiskAckRecord {
  uid: string;
  acceptedAt: string;
  version: string;
}

export interface WaOfficialPrefs {
  /** ID do numero na Cloud API (Graph API). */
  phoneNumberId: string;
  /** Token de acesso de curta duracao ou de sistema — trate como segredo. */
  accessToken: string;
  /** Opcional: ID da conta WhatsApp Business (WABA). */
  wabaId: string;
  /** Quando true, indica intencao de migrar/usar apenas fluxo oficial (o app ainda pode usar Web ate integrar). */
  preferOfficialOnly: boolean;
}

function parseRisk(raw: string | null): RiskAckRecord | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as RiskAckRecord;
    if (!o?.uid || !o?.acceptedAt || o.version !== WHATSAPP_RISK_VERSION) return null;
    return o;
  } catch {
    return null;
  }
}

export function getWhatsAppRiskAck(uid: string | undefined | null): RiskAckRecord | null {
  if (!uid) return null;
  try {
    return parseRisk(localStorage.getItem(RISK_KEY));
  } catch {
    return null;
  }
}

export function isWhatsAppRiskAcknowledged(uid: string | undefined | null): boolean {
  const r = getWhatsAppRiskAck(uid);
  return r != null && r.uid === uid;
}

export function saveWhatsAppRiskAck(uid: string): void {
  const rec: RiskAckRecord = {
    uid,
    acceptedAt: new Date().toISOString(),
    version: WHATSAPP_RISK_VERSION
  };
  try {
    localStorage.setItem(RISK_KEY, JSON.stringify(rec));
  } catch {
    /* ignore */
  }
}

export function clearWhatsAppRiskAck(): void {
  try {
    localStorage.removeItem(RISK_KEY);
  } catch {
    /* ignore */
  }
}

export function loadWaOfficialPrefs(): WaOfficialPrefs {
  try {
    const raw = localStorage.getItem(OFFICIAL_KEY);
    if (!raw) {
      return { phoneNumberId: '', accessToken: '', wabaId: '', preferOfficialOnly: false };
    }
    const o = JSON.parse(raw) as Partial<WaOfficialPrefs>;
    return {
      phoneNumberId: typeof o.phoneNumberId === 'string' ? o.phoneNumberId : '',
      accessToken: typeof o.accessToken === 'string' ? o.accessToken : '',
      wabaId: typeof o.wabaId === 'string' ? o.wabaId : '',
      preferOfficialOnly: o.preferOfficialOnly === true
    };
  } catch {
    return { phoneNumberId: '', accessToken: '', wabaId: '', preferOfficialOnly: false };
  }
}

export function saveWaOfficialPrefs(p: WaOfficialPrefs): void {
  try {
    localStorage.setItem(OFFICIAL_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}
