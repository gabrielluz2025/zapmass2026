import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  Clock,
  Database,
  Loader2,
  Lock,
  LogIn,
  Mail,
  MessageCircle,
  MessageSquare,
  Send,
  ShieldCheck,
  Smartphone,
  Sparkles,
  TrendingUp,
  Users,
  UserPlus,
  Wifi,
  X,
  Zap
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { auth } from '../services/firebase';
import { useVpsAuth } from '../services/vpsAuth';
import { useLandingDocumentMeta } from '../hooks/useLandingDocumentMeta';
import { useAppConfig } from '../context/AppConfigContext';
import { resolveLandingTrialCopy } from '../utils/landingTrialResolved';
import { trackLandingEvent } from '../utils/marketingEvents';
import { apiUrl } from '../utils/apiBase';
import { formatTrialHoursLabel } from '../utils/trialCopy';
import { resolveEmailAuthStep, resolveEmailAuthStepVps } from '../utils/emailAuthFlow';
import { clearTrialSessionFlags, landingCtaStartsTrial, setTrialSessionForManager } from '../utils/trialSession';
import {
  WHATSAPP_META_CLOUD_OVERVIEW,
  WHATSAPP_META_POLICY,
  WHATSAPP_RISK_BULLETS,
  WHATSAPP_RISK_SHORT
} from '../constants/whatsappLegal';
import {
  CHANNEL_TIER_PRICES_ANNUAL,
  CHANNEL_TIER_PRICES_MONTHLY,
  brl
} from '../constants/channelTierPricing';
import {
  computeAnnualSavingsPercent,
  fetchServerBillingPrices,
  roundMoneyBRL,
  type ServerBillingPrices
} from '../utils/marketingPrices';

/* ── Dark tokens (hardcoded so the landing is always dark, regardless of theme) ── */
const D = {
  bg:       '#030812',
  bg2:      '#060d1c',
  card:     'rgba(255,255,255,0.036)',
  cardHov:  'rgba(255,255,255,0.056)',
  border:   'rgba(255,255,255,0.08)',
  borderMd: 'rgba(255,255,255,0.12)',
  text1:    '#f1f5f9',
  text2:    '#94a3b8',
  text3:    '#475569',
  green:    '#10b981',
  greenLt:  '#34d399',
  greenGlow:'rgba(16,185,129,0.35)',
  indigo:   '#6366f1',
  indigoLt: '#818cf8',
  indigoGlow:'rgba(99,102,241,0.3)',
  amber:    '#f59e0b',
} as const;

/* ─────────────────────────────────────────────────────
   QUICK AUTH PANEL — step-based modal (social-first)
───────────────────────────────────────────────────── */
type QAPStep = 'main' | 'pw-in' | 'pw-up' | 'staff';

const GoogleSVG: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
);
const FacebookSVG: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    <path fill="#fff" d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
  </svg>
);
const QuickAuthPanel: React.FC<{ onClose: () => void; trialLabel: string; startTrialAfterLogin: boolean }> = ({
  onClose,
  trialLabel,
  startTrialAfterLogin
}) => {
  const { signInWithGoogle, signInWithFacebook, signInWithEmailPassword, signUpWithEmailPassword, signInWithStaffCustomToken, signInWithStaffCredentials } = useAuth();
  const vpsAuth = useVpsAuth();

  const [step, setStep]       = useState<QAPStep>('main');
  const [busy, setBusy]       = useState(false);
  const [email, setEmail]     = useState('');
  const [password, setPass]   = useState('');
  const [confirm, setConfirm] = useState('');
  // staff
  const [manEmail, setManEmail]   = useState('');
  const [staffUser, setStaffUser] = useState('');
  const [staffPass, setStaffPass] = useState('');

  const passRef    = useRef<HTMLInputElement>(null);
  const emailRef   = useRef<HTMLInputElement>(null);

  const goBack = () => { setStep('main'); setPass(''); setConfirm(''); };

  const goToPasswordStep = (kind: 'sign-in' | 'sign-up') => {
    setStep(kind === 'sign-in' ? 'pw-in' : 'pw-up');
    setPass('');
    setConfirm('');
    setTimeout(() => passRef.current?.focus(), 80);
  };

  const goToSignIn = () => {
    const trimmed = email.trim();
    if (!trimmed.includes('@')) {
      toast.error('Informe seu e-mail acima primeiro.');
      emailRef.current?.focus();
      return;
    }
    goToPasswordStep('sign-in');
  };

  const handleEmailContinue = async () => {
    const trimmed = email.trim();
    if (!trimmed.includes('@')) { toast.error('Informe um e-mail válido'); return; }
    setBusy(true);
    try {
      const stepKind = vpsAuth
        ? await resolveEmailAuthStepVps(trimmed)
        : await resolveEmailAuthStep(auth, trimmed);
      goToPasswordStep(stepKind);
    } finally {
      setBusy(false);
    }
  };

  const handleSignIn = async () => {
    if (!password) { toast.error('Informe a senha'); return; }
    setBusy(true);
    try {
      clearTrialSessionFlags();
      await signInWithEmailPassword(email.trim(), password);
    } finally { setBusy(false); }
  };

  const handleSignUp = async () => {
    if (!password || !confirm) { toast.error('Preencha a senha e a confirmação'); return; }
    if (password !== confirm) { toast.error('As senhas não coincidem'); return; }
    if (password.length < 8) { toast.error('Senha deve ter ao menos 8 caracteres'); return; }
    setBusy(true);
    try {
      if (startTrialAfterLogin) setTrialSessionForManager('trial');
      await signUpWithEmailPassword(email.trim(), password);
    } finally { setBusy(false); }
  };

  const handleOAuth = async (p: 'google' | 'facebook') => {
    setBusy(true);
    try {
      if (startTrialAfterLogin) setTrialSessionForManager('trial');
      if (p === 'google') await signInWithGoogle();
      else await signInWithFacebook();
    } finally { setBusy(false); }
  };

  const handleStaff = async () => {
    const me = manEmail.trim().toLowerCase();
    const slug = staffUser.trim();
    if (!me.includes('@')) { toast.error('Informe o e-mail do responsável'); return; }
    if (slug.length < 3)   { toast.error('Nome de usuário deve ter ao menos 3 caracteres'); return; }
    if (staffPass.length < 8) { toast.error('Senha deve ter ao menos 8 caracteres'); return; }
    setBusy(true);
    try {
      clearTrialSessionFlags();
      if (vpsAuth) {
        await signInWithStaffCredentials(me, slug, staffPass);
        return;
      }
      const r = await fetch(apiUrl('/api/workspace/staff/sign-in'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managerEmail: me, loginName: slug, password: staffPass })
      });
      const data = (await r.json()) as { ok?: boolean; error?: string; customToken?: string };
      if (!data?.ok || typeof data.customToken !== 'string') {
        toast.error(typeof data?.error === 'string' ? data.error : 'Não foi possível entrar.'); return;
      }
      await signInWithStaffCustomToken(data.customToken);
    } finally { setBusy(false); }
  };

  /* ── shared styles ── */
  const inp: React.CSSProperties = {
    width: '100%', padding: '12px 14px', borderRadius: 10, fontSize: 14,
    background: 'rgba(255,255,255,0.06)', border: `1px solid ${D.border}`,
    color: D.text1, outline: 'none', transition: 'border-color 0.15s',
    boxSizing: 'border-box'
  };
  const oauthBtn = (bg: string, shadow?: string): React.CSSProperties => ({
    width: '100%', padding: '12px 16px', borderRadius: 12, border: 'none',
    cursor: busy ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 14,
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
    background: bg, color: '#fff', transition: 'opacity 0.15s, transform 0.12s',
    boxShadow: shadow, opacity: busy ? 0.6 : 1
  });
  const primaryBtn: React.CSSProperties = {
    width: '100%', padding: '13px 16px', borderRadius: 12, border: 'none',
    cursor: busy ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 14.5,
    background: `linear-gradient(135deg, #0f766e, #10b981)`,
    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
    gap: 8, transition: 'opacity 0.15s, transform 0.12s',
    boxShadow: '0 6px 20px rgba(16,185,129,0.3)', opacity: busy ? 0.6 : 1
  };
  const divider = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0' }}>
      <div style={{ flex: 1, height: 1, background: D.border }} />
      <span style={{ fontSize: 11.5, color: D.text3, fontWeight: 500 }}>ou use seu e-mail</span>
      <div style={{ flex: 1, height: 1, background: D.border }} />
    </div>
  );

  /* ── email chip shown in pw-in / pw-up ── */
  const emailChip = (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 12px', borderRadius: 8,
      background: 'rgba(255,255,255,0.05)', border: `1px solid ${D.border}`,
      marginBottom: 16
    }}>
      <Mail size={14} style={{ color: D.text3, flexShrink: 0 }} />
      <span style={{ fontSize: 13, color: D.text2, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</span>
      <button type="button" onClick={goBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: D.greenLt, fontSize: 12, fontWeight: 600, padding: 0 }}>
        Trocar
      </button>
    </div>
  );

  const panel: React.CSSProperties = {
    background: '#0b1629',
    border: `1px solid ${D.border}`,
    borderRadius: 18,
    padding: '28px 24px 20px',
    display: 'flex', flexDirection: 'column', gap: 12
  };

  /* ═══════════════ RENDER ═══════════════ */
  return (
    <div style={panel}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 2 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8,
              background: `linear-gradient(135deg, ${D.green}, #059669)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <Zap size={14} color="#fff" fill="#fff" />
            </div>
            <span style={{ fontSize: 15, fontWeight: 800, color: D.text1 }}>ZapMass</span>
          </div>
          {step === 'main' && (
            <h2 style={{ fontSize: 20, fontWeight: 900, color: D.text1, letterSpacing: '-0.03em', margin: 0 }}>
              Entrar ou criar conta
            </h2>
          )}
          {step === 'pw-in' && (
            <h2 style={{ fontSize: 20, fontWeight: 900, color: D.text1, letterSpacing: '-0.03em', margin: 0 }}>
              Bem-vindo de volta!
            </h2>
          )}
          {step === 'pw-up' && (
            <h2 style={{ fontSize: 20, fontWeight: 900, color: D.text1, letterSpacing: '-0.03em', margin: 0 }}>
              Criar sua conta
            </h2>
          )}
          {step === 'staff' && (
            <h2 style={{ fontSize: 20, fontWeight: 900, color: D.text1, letterSpacing: '-0.03em', margin: 0 }}>
              Entrar como funcionário
            </h2>
          )}
        </div>
        <button
          type="button" onClick={onClose} aria-label="Fechar"
          style={{
            background: 'rgba(255,255,255,0.06)', border: `1px solid ${D.border}`,
            borderRadius: '50%', width: 30, height: 30, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: D.text2, flexShrink: 0
          }}
        >
          <X size={14} />
        </button>
      </div>

      {/* ── STEP: MAIN ── */}
      {step === 'main' && (
        <>
          <p style={{ fontSize: 13, color: D.text2, margin: 0 }}>
            {trialLabel} grátis · sem cartão · sem instalação
          </p>

          {/* Social buttons (só modo Firebase legado) */}
          {!vpsAuth && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
              <button type="button" disabled={busy} onClick={() => void handleOAuth('google')}
                style={{ ...oauthBtn('#fff', '0 2px 8px rgba(0,0,0,0.18)'), color: '#1f1f1f' }}>
                <GoogleSVG size={18} />
                Continuar com Google
              </button>
              <button type="button" disabled={busy} onClick={() => void handleOAuth('facebook')}
                style={oauthBtn('#1877F2', '0 4px 14px rgba(24,119,242,0.3)')}>
                <FacebookSVG size={18} />
                Continuar com Facebook
              </button>
            </div>
          )}

          {!vpsAuth && divider}

          {vpsAuth && (
            <p style={{ fontSize: 12.5, color: D.text2, margin: '4px 0 0' }}>
              Informe seu e-mail. Se já tiver conta, pedimos só a senha; se for novo, criamos com teste grátis.
            </p>
          )}

          {/* Email field */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              ref={emailRef}
              type="email" autoComplete="email" placeholder="voce@email.com"
              value={email} onChange={e => setEmail(e.target.value)}
              disabled={busy}
              onKeyDown={e => { if (e.key === 'Enter') void handleEmailContinue(); }}
              style={inp}
            />
            <button type="button" disabled={busy} onClick={() => void handleEmailContinue()} style={primaryBtn}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <><Mail size={15} />Continuar com e-mail<ArrowRight size={15} /></>}
            </button>
            {vpsAuth && (
              <button
                type="button"
                disabled={busy}
                onClick={goToSignIn}
                style={{
                  width: '100%',
                  padding: '11px 14px',
                  borderRadius: 12,
                  border: `1px solid ${D.border}`,
                  background: 'rgba(255,255,255,0.04)',
                  color: D.text2,
                  fontSize: 13.5,
                  fontWeight: 600,
                  cursor: busy ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8
                }}
              >
                <LogIn size={15} />
                Já tenho conta — entrar com senha
              </button>
            )}
          </div>

          {/* Funcionário link */}
          <div style={{ textAlign: 'center', paddingTop: 4 }}>
            <button type="button" onClick={() => setStep('staff')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12.5, color: D.text3, padding: 0 }}
              onMouseEnter={e => (e.currentTarget.style.color = D.text2)}
              onMouseLeave={e => (e.currentTarget.style.color = D.text3)}
            >
              <Users size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              Sou funcionário (acesso criado pelo gestor)
            </button>
          </div>
        </>
      )}

      {/* ── STEP: SIGN IN ── */}
      {step === 'pw-in' && (
        <>
          {emailChip}
          <p style={{ fontSize: 13, color: D.text2, margin: '0 0 4px' }}>
            Encontramos sua conta. Informe a senha para entrar.
          </p>
          <input
            ref={passRef} type="password" autoComplete="current-password"
            placeholder="Sua senha" value={password} onChange={e => setPass(e.target.value)}
            disabled={busy} style={inp}
            onKeyDown={e => { if (e.key === 'Enter') void handleSignIn(); }}
          />
          <button type="button" disabled={busy} onClick={() => void handleSignIn()} style={primaryBtn}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <><Lock size={15} />Entrar</>}
          </button>
          <button type="button" onClick={goBack}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12.5, color: D.text3, display: 'flex', alignItems: 'center', gap: 4, padding: 0, margin: '0 auto' }}>
            <ArrowLeft size={13} /> Usar outro e-mail
          </button>
        </>
      )}

      {/* ── STEP: SIGN UP ── */}
      {step === 'pw-up' && (
        <>
          {emailChip}
          {(startTrialAfterLogin || !vpsAuth) && (
            <div style={{
              padding: '7px 12px', borderRadius: 8, marginBottom: 4,
              background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)',
              fontSize: 12.5, color: D.greenLt, display: 'flex', alignItems: 'center', gap: 6
            }}>
              <Sparkles size={13} />
              Conta nova · {trialLabel} grátis incluído, sem cartão!
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              ref={passRef} type="password" autoComplete="new-password"
              placeholder="Crie uma senha (mín. 8 caracteres)" value={password}
              onChange={e => setPass(e.target.value)} disabled={busy} style={inp}
              onKeyDown={e => { if (e.key === 'Enter') void handleSignUp(); }}
            />
            <input
              type="password" autoComplete="new-password"
              placeholder="Confirme a senha" value={confirm}
              onChange={e => setConfirm(e.target.value)} disabled={busy} style={inp}
              onKeyDown={e => { if (e.key === 'Enter') void handleSignUp(); }}
            />
          </div>
          <button type="button" disabled={busy} onClick={() => void handleSignUp()} style={primaryBtn}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : (
              <>
                <UserPlus size={15} />
                {startTrialAfterLogin ? 'Criar conta grátis' : 'Criar conta'}
              </>
            )}
          </button>
          {vpsAuth && (
            <button type="button" onClick={goToSignIn}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12.5, color: D.greenLt, display: 'flex', alignItems: 'center', gap: 4, padding: 0, margin: '0 auto' }}>
              <LogIn size={13} /> Já tenho conta — entrar
            </button>
          )}
          <button type="button" onClick={goBack}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12.5, color: D.text3, display: 'flex', alignItems: 'center', gap: 4, padding: 0, margin: '0 auto' }}>
            <ArrowLeft size={13} /> Usar outro e-mail
          </button>
        </>
      )}

      {/* ── STEP: STAFF ── */}
      {step === 'staff' && (
        <>
          <p style={{ fontSize: 13, color: D.text2, margin: '0 0 4px' }}>
            Use o login criado pelo seu gestor no painel ZapMass.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              type="email" autoComplete="off"
              placeholder="E-mail do responsável (gestor)" value={manEmail}
              onChange={e => setManEmail(e.target.value)} disabled={busy} style={inp}
            />
            <input
              type="text" autoComplete="off"
              placeholder="Seu nome de usuário" value={staffUser}
              onChange={e => setStaffUser(e.target.value)} disabled={busy} style={inp}
            />
            <input
              type="password" autoComplete="current-password"
              placeholder="Sua senha" value={staffPass}
              onChange={e => setStaffPass(e.target.value)} disabled={busy} style={inp}
              onKeyDown={e => { if (e.key === 'Enter') void handleStaff(); }}
            />
          </div>
          <button type="button" disabled={busy} onClick={() => void handleStaff()} style={primaryBtn}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <><LogIn size={15} />Entrar como funcionário</>}
          </button>
          <button type="button" onClick={() => setStep('main')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12.5, color: D.text3, display: 'flex', alignItems: 'center', gap: 4, padding: 0, margin: '0 auto' }}>
            <ArrowLeft size={13} /> Não sou funcionário
          </button>
        </>
      )}

      {/* footer */}
      <p style={{ fontSize: 10.5, textAlign: 'center', color: 'rgba(255,255,255,0.3)', margin: '4px 0 0', lineHeight: 1.5 }}>
        Ao continuar você aceita as políticas do ZapMass
      </p>
    </div>
  );
};

/* ── Mini dashboard mockup shown in the hero ── */
const DashboardMockup: React.FC = () => {
  const campaigns = [
    { name: 'Promo Maio',   pct: 84, done: true,  sent: '1.240', color: D.green  },
    { name: 'Lista VIP',    pct: 52, done: false,  sent: '763',   color: D.indigo },
    { name: 'Reativação',   pct: 29, done: false,  sent: '421',   color: D.amber  },
  ];
  return (
    <div className="relative w-full select-none pointer-events-none" style={{ maxWidth: 520 }}>
      {/* Glow halo behind the window */}
      <div
        aria-hidden
        style={{
          position: 'absolute', inset: '-40px',
          background: `radial-gradient(ellipse at 60% 40%, ${D.greenGlow} 0%, transparent 65%), radial-gradient(ellipse at 20% 80%, ${D.indigoGlow} 0%, transparent 60%)`,
          filter: 'blur(40px)', zIndex: 0, pointerEvents: 'none'
        }}
      />

      {/* Browser window */}
      <div
        className="relative z-[1] overflow-hidden"
        style={{
          background: '#080f20',
          border: `1px solid ${D.borderMd}`,
          borderRadius: 18,
          boxShadow: '0 50px 100px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.06)'
        }}
      >
        {/* Title bar */}
        <div style={{
          background: 'rgba(255,255,255,0.025)',
          borderBottom: `1px solid ${D.border}`,
          padding: '10px 14px',
          display: 'flex', alignItems: 'center', gap: 10
        }}>
          <div style={{ display: 'flex', gap: 5 }}>
            {['#ff5f57','#febc2e','#28c840'].map(c => (
              <div key={c} style={{ width: 9, height: 9, borderRadius: '50%', background: c }} />
            ))}
          </div>
          <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
            <span style={{
              background: 'rgba(255,255,255,0.05)', borderRadius: 6,
              padding: '3px 14px', fontSize: 11, color: 'rgba(255,255,255,0.35)', fontFamily: 'monospace'
            }}>
              app.zap-mass.com
            </span>
          </div>
          <div style={{ width: 55 }} />
        </div>

        {/* App body: sidebar + main */}
        <div style={{ display: 'flex', height: 308 }}>
          {/* Sidebar */}
          <div style={{
            width: 50, background: '#050d1e',
            borderRight: `1px solid ${D.border}`,
            padding: '12px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14
          }}>
            <div style={{
              width: 30, height: 30, borderRadius: 8,
              background: `linear-gradient(135deg, ${D.green}, #059669)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `0 4px 12px ${D.greenGlow}`
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="white"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
            </div>
            {[
              { active: true, color: D.green },
              { active: false, color: 'rgba(255,255,255,0.2)' },
              { active: false, color: 'rgba(255,255,255,0.2)' },
              { active: false, color: 'rgba(255,255,255,0.2)' },
            ].map((item, i) => (
              <div key={i} style={{
                width: 30, height: 30, borderRadius: 7,
                background: item.active ? 'rgba(16,185,129,0.14)' : 'transparent',
                border: item.active ? `1px solid rgba(16,185,129,0.28)` : '1px solid transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 3
              }}>
                <div style={{ width: 12, height: 1.5, borderRadius: 1, background: item.color }} />
                <div style={{ width: 8, height: 1.5, borderRadius: 1, background: item.color, opacity: 0.6 }} />
              </div>
            ))}
          </div>

          {/* Main content */}
          <div style={{ flex: 1, padding: '14px 14px', display: 'flex', flexDirection: 'column', gap: 10, overflow: 'hidden' }}>
            {/* Top row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: D.text1, letterSpacing: '-0.01em' }}>Campanhas</div>
                <div style={{ fontSize: 9.5, color: D.text3, marginTop: 2 }}>3 ativas · maio 2026</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(16,185,129,0.1)', border: `1px solid rgba(16,185,129,0.22)`, borderRadius: 20, padding: '3px 9px' }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: D.green, boxShadow: `0 0 5px ${D.green}` }} />
                <span style={{ fontSize: 9, color: D.greenLt, fontWeight: 600 }}>3 canais online</span>
              </div>
            </div>

            {/* Stat cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
              {[
                { label: 'Enviados', value: '2.424', color: D.green },
                { label: 'Entregues', value: '98%',  color: D.indigoLt },
                { label: 'Respostas', value: '187',  color: D.amber },
              ].map(s => (
                <div key={s.label} style={{
                  background: 'rgba(255,255,255,0.04)', border: `1px solid ${D.border}`, borderRadius: 8, padding: '8px 9px'
                }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: s.color, letterSpacing: '-0.025em', lineHeight: 1 }}>{s.value}</div>
                  <div style={{ fontSize: 9, color: D.text3, marginTop: 3 }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Campaign list */}
            <div>
              <div style={{ fontSize: 9, color: D.text3, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
                Em andamento
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {campaigns.map(c => (
                  <div key={c.name} style={{
                    background: 'rgba(255,255,255,0.03)', border: `1px solid ${D.border}`, borderRadius: 8, padding: '7px 10px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                      <span style={{ fontSize: 11, color: '#cbd5e1', fontWeight: 600 }}>{c.name}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ fontSize: 10, color: c.color, fontWeight: 700 }}>{c.pct}%</span>
                        <div style={{
                          fontSize: 8.5, padding: '2px 6px', borderRadius: 4, fontWeight: 600,
                          background: c.done ? 'rgba(16,185,129,0.12)' : 'rgba(99,102,241,0.12)',
                          color: c.done ? D.greenLt : D.indigoLt
                        }}>
                          {c.done ? 'Concluída' : 'Ativa'}
                        </div>
                      </div>
                    </div>
                    <div style={{ height: 3.5, borderRadius: 2, background: 'rgba(255,255,255,0.07)' }}>
                      <div style={{
                        height: '100%', borderRadius: 2, width: `${c.pct}%`,
                        background: c.color, boxShadow: `0 0 6px ${c.color}60`, transition: 'width 1s ease'
                      }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Floating badge – delivery */}
      <div style={{
        position: 'absolute', bottom: 18, left: -22, zIndex: 10,
        background: 'rgba(16,185,129,0.13)', backdropFilter: 'blur(12px)',
        border: `1px solid rgba(16,185,129,0.32)`, borderRadius: 12,
        padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 7,
        boxShadow: '0 8px 28px rgba(0,0,0,0.35)'
      }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: D.green, boxShadow: `0 0 8px ${D.green}` }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: D.greenLt }}>98% taxa de entrega</span>
      </div>

      {/* Floating badge – messages */}
      <div style={{
        position: 'absolute', top: 48, right: -20, zIndex: 10,
        background: 'rgba(99,102,241,0.13)', backdropFilter: 'blur(12px)',
        border: `1px solid rgba(99,102,241,0.32)`, borderRadius: 12,
        padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8,
        boxShadow: '0 8px 28px rgba(0,0,0,0.35)'
      }}>
        <MessageSquare size={14} style={{ color: D.indigoLt, flexShrink: 0 }} />
        <div>
          <div style={{ fontSize: 12, fontWeight: 800, color: D.indigoLt, letterSpacing: '-0.02em' }}>2.424</div>
          <div style={{ fontSize: 9, color: D.text3, marginTop: 1 }}>msgs hoje</div>
        </div>
      </div>
    </div>
  );
};

/* ── Main export ── */
export const PreLoginLanding: React.FC = () => {
  useLandingDocumentMeta();
  const { config } = useAppConfig();
  const { title: trialTitle, body: trialBody } = resolveLandingTrialCopy(config);
  const trialLabel = formatTrialHoursLabel(config.trialHours);

  const [authOpen, setAuthOpen] = useState(false);
  const [authStartTrial, setAuthStartTrial] = useState(true);

  const openAuth = useCallback((ctaId: string) => {
    trackLandingEvent('landing_cta_click', { cta_id: ctaId });
    setAuthStartTrial(landingCtaStartsTrial(ctaId));
    setAuthOpen(true);
  }, []);

  useEffect(() => {
    const FAQ_ID = 'faq-whatsapp-lgpd';
    const openIfHash = () => {
      if (window.location.hash !== `#${FAQ_ID}`) return;
      const el = document.getElementById(FAQ_ID);
      if (el instanceof HTMLDetailsElement) el.open = true;
    };
    openIfHash();
    window.addEventListener('hashchange', openIfHash);
    return () => window.removeEventListener('hashchange', openIfHash);
  }, []);

  useEffect(() => {
    if (!authOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAuthOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [authOpen]);

  return (
    <div style={{ background: D.bg, minHeight: '100vh', overflowX: 'hidden', position: 'relative' }}>

      {/* ── Background ambient glows ── */}
      <div aria-hidden style={{
        position: 'absolute', top: -200, left: -200,
        width: 700, height: 700, borderRadius: '50%', pointerEvents: 'none',
        background: 'radial-gradient(circle at 30% 30%, rgba(16,185,129,0.18), transparent 60%)',
        filter: 'blur(80px)', animation: 'blobDrift 18s ease-in-out infinite'
      }} />
      <div aria-hidden style={{
        position: 'absolute', top: '5%', right: -250,
        width: 800, height: 800, borderRadius: '50%', pointerEvents: 'none',
        background: 'radial-gradient(circle at 60% 40%, rgba(99,102,241,0.14), transparent 60%)',
        filter: 'blur(90px)', animation: 'blobDrift 24s ease-in-out infinite reverse'
      }} />
      <div aria-hidden style={{
        position: 'absolute', bottom: '20%', left: '10%',
        width: 600, height: 600, borderRadius: '50%', pointerEvents: 'none',
        background: 'radial-gradient(circle at 50% 50%, rgba(16,185,129,0.08), transparent 60%)',
        filter: 'blur(70px)', animation: 'blobDrift 20s ease-in-out infinite 5s'
      }} />
      {/* Dot grid */}
      <div aria-hidden style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.28,
        backgroundImage: `radial-gradient(circle, rgba(255,255,255,0.12) 1px, transparent 1px)`,
        backgroundSize: '32px 32px',
        maskImage: 'radial-gradient(ellipse at 50% 0%, black 30%, transparent 80%)',
        WebkitMaskImage: 'radial-gradient(ellipse at 50% 0%, black 30%, transparent 80%)'
      }} />

      {/* ══════════════════════════════════
          HEADER
      ══════════════════════════════════ */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 30,
        background: 'rgba(3,8,18,0.82)', backdropFilter: 'blur(16px)',
        borderBottom: `1px solid ${D.border}`
      }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 60 }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: `linear-gradient(135deg, ${D.green} 0%, #059669 100%)`,
              boxShadow: `0 6px 20px ${D.greenGlow}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
            }}>
              <Zap size={18} color="white" fill="white" />
            </div>
            <div>
              <p style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-0.02em', color: D.text1, lineHeight: 1.1 }}>ZapMass</p>
              <p style={{ fontSize: 10, fontWeight: 600, color: D.green, lineHeight: 1 }}>WhatsApp CRM</p>
            </div>
          </div>

          {/* Nav */}
          <nav style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {[
              { label: 'Recursos', href: '#recursos' },
              { label: 'Planos', href: '#planos' },
              { label: 'FAQ', href: '#faq' },
            ].map(l => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => trackLandingEvent('landing_cta_click', { cta_id: `header_${l.label.toLowerCase()}` })}
                className="hidden sm:inline-flex"
                style={{
                  fontSize: 13, fontWeight: 600, color: D.text2, padding: '6px 12px',
                  borderRadius: 20, textDecoration: 'none', transition: 'color 0.15s'
                }}
              >
                {l.label}
              </a>
            ))}
            <div style={{ width: 1, height: 20, background: D.border, margin: '0 6px' }} className="hidden sm:block" />
            <button
              type="button"
              onClick={() => openAuth('header_signin')}
              style={{
                fontSize: 13, fontWeight: 600, color: D.text1,
                padding: '7px 16px', borderRadius: 20, border: `1px solid ${D.border}`,
                background: 'transparent', cursor: 'pointer', transition: 'border-color 0.15s'
              }}
            >
              Entrar
            </button>
            <button
              type="button"
              onClick={() => openAuth('header_signup')}
              style={{
                fontSize: 13, fontWeight: 700, color: '#fff',
                padding: '7px 18px', borderRadius: 20,
                background: `linear-gradient(135deg, ${D.green} 0%, #059669 100%)`,
                boxShadow: `0 6px 18px ${D.greenGlow}`,
                border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 6
              }}
            >
              Inscrever-se
              <ArrowRight size={13} />
            </button>
          </nav>
        </div>
      </header>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px' }}>

        {/* ══════════════════════════════════
            HERO
        ══════════════════════════════════ */}
        <section style={{ paddingTop: 72, paddingBottom: 80, display: 'grid', gridTemplateColumns: '1fr', gap: 48 }}
          className="lg:grid-cols-[1fr_520px] lg:items-center">

          {/* Left column */}
          <div className="animate-fade-in-up" style={{ animationDelay: '40ms' }}>
            {/* Badge */}
            <div
              className="badge-shimmer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '6px 14px', borderRadius: 20, marginBottom: 24,
                border: `1px solid rgba(16,185,129,0.3)`
              }}
            >
              <span className="relative flex" style={{ width: 7, height: 7 }}>
                <span className="absolute inline-flex h-full w-full rounded-full pulse-dot" style={{ background: D.green }} />
                <span className="relative inline-flex rounded-full" style={{ width: 7, height: 7, background: D.green }} />
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: D.green }}>
                WhatsApp CRM · Operação profissional
              </span>
            </div>

            {/* Headline */}
            <h1 style={{
              fontSize: 'clamp(2.2rem, 5vw, 3.5rem)',
              fontWeight: 900, lineHeight: 1.03, letterSpacing: '-0.035em',
              color: D.text1, marginBottom: 20
            }}>
              O CRM de WhatsApp{' '}
              <span style={{
                background: `linear-gradient(135deg, ${D.greenLt} 0%, ${D.green} 50%, #059669 100%)`,
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                backgroundClip: 'text'
              }}>
                que transforma
              </span>
              <br />
              disparos em vendas.
            </h1>

            {/* Subtitle */}
            <p style={{ fontSize: 'clamp(15px, 2vw, 17px)', lineHeight: 1.65, color: D.text2, maxWidth: 500, marginBottom: 32 }}>
              Campanhas, base de contatos, atendimento e métricas — tudo em um painel que roda na nuvem 24/7.{' '}
              <span style={{ color: D.text1, fontWeight: 600 }}>Comece grátis: {trialLabel} sem cartão.</span>
            </p>

            {/* CTA row */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 36 }}>
              <button
                type="button"
                onClick={() => openAuth('hero_primary')}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  padding: '14px 28px', borderRadius: 14,
                  background: `linear-gradient(135deg, #10b981 0%, #059669 50%, #047857 100%)`,
                  boxShadow: `0 16px 36px ${D.greenGlow}`,
                  fontSize: 15, fontWeight: 700, color: '#fff', border: 'none', cursor: 'pointer',
                  transition: 'transform 0.15s, box-shadow 0.15s'
                }}
                className="hover:scale-[1.02] active:scale-[0.98]"
              >
                Começar grátis agora
                <ArrowRight size={17} />
              </button>
              <a
                href="#planos"
                onClick={() => trackLandingEvent('landing_cta_click', { cta_id: 'hero_plans' })}
                style={{
                  display: 'inline-flex', alignItems: 'center', padding: '14px 24px', borderRadius: 14,
                  border: `1px solid ${D.border}`, background: D.card,
                  fontSize: 14, fontWeight: 600, color: D.text2, textDecoration: 'none',
                  transition: 'border-color 0.15s, color 0.15s'
                }}
              >
                Ver planos e valores
              </a>
            </div>

            {/* Trust strip */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {[
                { icon: <Sparkles size={13} />, text: `${trialLabel} grátis`, sub: 'sem cartão' },
                { icon: <Wifi size={13} />,     text: '24/7 na nuvem', sub: 'sem PC ligado' },
                { icon: <ShieldCheck size={13} />, text: 'Dados isolados', sub: 'por conta' },
                { icon: <Database size={13} />, text: 'Pix −5%', sub: 'no pagamento' },
              ].map(chip => (
                <div
                  key={chip.text}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 14px', borderRadius: 10,
                    background: D.card, border: `1px solid ${D.border}`
                  }}
                >
                  <span style={{ color: D.green }}>{chip.icon}</span>
                  <div>
                    <p style={{ fontSize: 12, fontWeight: 700, color: D.text1, lineHeight: 1.1 }}>{chip.text}</p>
                    <p style={{ fontSize: 10, color: D.text3, lineHeight: 1.1 }}>{chip.sub}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right column – dashboard mockup */}
          <div
            className="hidden lg:flex justify-end animate-fade-in-up"
            style={{ animationDelay: '180ms' }}
          >
            <DashboardMockup />
          </div>
        </section>

        {/* ══════════════════════════════════
            METRICS STRIP
        ══════════════════════════════════ */}
        <section
          style={{
            display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 1,
            background: D.border, borderRadius: 16, overflow: 'hidden',
            border: `1px solid ${D.border}`, marginBottom: 80
          }}
          className="sm:grid-cols-4 animate-fade-in-up"
        >
          {[
            { value: '50M+',  label: 'Mensagens processadas', icon: <Send size={16} /> },
            { value: '98%',   label: 'Taxa de entrega média', icon: <TrendingUp size={16} /> },
            { value: '5 min', label: 'Para o primeiro disparo', icon: <Clock size={16} /> },
            { value: '24/7',  label: 'Operação em nuvem', icon: <Wifi size={16} /> },
          ].map(m => (
            <div
              key={m.label}
              style={{
                background: D.bg2, padding: '24px 20px',
                display: 'flex', alignItems: 'center', gap: 14
              }}
            >
              <div style={{
                width: 42, height: 42, borderRadius: 11, flexShrink: 0,
                background: 'rgba(16,185,129,0.1)', border: `1px solid rgba(16,185,129,0.2)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: D.green
              }}>
                {m.icon}
              </div>
              <div>
                <p style={{ fontSize: 22, fontWeight: 900, color: D.text1, letterSpacing: '-0.03em', lineHeight: 1 }}>{m.value}</p>
                <p style={{ fontSize: 11.5, color: D.text3, marginTop: 3, lineHeight: 1.2 }}>{m.label}</p>
              </div>
            </div>
          ))}
        </section>

        {/* ══════════════════════════════════
            FEATURES
        ══════════════════════════════════ */}
        <section id="recursos" style={{ marginBottom: 80, scrollMarginTop: 80 }} className="animate-fade-in-up">
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 11, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase',
              color: D.indigo, marginBottom: 12, padding: '4px 12px',
              background: 'rgba(99,102,241,0.1)', borderRadius: 20, border: `1px solid rgba(99,102,241,0.2)`
            }}>
              Recursos
            </div>
            <h2 style={{ fontSize: 'clamp(1.8rem, 3.5vw, 2.6rem)', fontWeight: 900, color: D.text1, letterSpacing: '-0.03em', lineHeight: 1.1, marginBottom: 12 }}>
              Tudo que a sua operação precisa
            </h2>
            <p style={{ fontSize: 16, color: D.text2, maxWidth: 500, margin: '0 auto' }}>
              De campanhas a atendimento, o ZapMass reúne as ferramentas certas num único lugar.
            </p>
          </div>

          <div style={{ display: 'grid', gap: 12 }} className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: <Send size={20} />,
                title: 'Campanhas com cadência',
                body: 'Defina limites de envio por canal, pausas automáticas e intervalos para proteger seus chips.',
                accent: D.green, accentBg: 'rgba(16,185,129,0.1)', accentBorder: 'rgba(16,185,129,0.2)'
              },
              {
                icon: <Database size={20} />,
                title: 'Base de contatos completa',
                body: 'Importe CSV, crie listas segmentadas, adicione etiquetas e filtre sua base do jeito que precisar.',
                accent: D.indigo, accentBg: 'rgba(99,102,241,0.1)', accentBorder: 'rgba(99,102,241,0.2)'
              },
              {
                icon: <MessageCircle size={20} />,
                title: 'Atendimento em equipe',
                body: 'Conversas centralizadas com contexto, atribuição por operador e histórico completo.',
                accent: '#06b6d4', accentBg: 'rgba(6,182,212,0.1)', accentBorder: 'rgba(6,182,212,0.2)'
              },
              {
                icon: <BarChart3 size={20} />,
                title: 'Métricas em tempo real',
                body: 'Acompanhe taxa de entrega, resposta e engajamento por campanha e por canal.',
                accent: D.amber, accentBg: 'rgba(245,158,11,0.1)', accentBorder: 'rgba(245,158,11,0.2)'
              },
              {
                icon: <Smartphone size={20} />,
                title: 'Multi-WhatsApp',
                body: 'Conecte até 5 chips no mesmo painel. Cada canal com seu limite, seu horário, suas campanhas.',
                accent: D.green, accentBg: 'rgba(16,185,129,0.1)', accentBorder: 'rgba(16,185,129,0.2)'
              },
              {
                icon: <Users size={20} />,
                title: 'Gestão de equipe',
                body: 'Crie usuários para seus atendentes. O gestor define acesso, revoga e acompanha tudo no painel.',
                accent: D.indigo, accentBg: 'rgba(99,102,241,0.1)', accentBorder: 'rgba(99,102,241,0.2)'
              },
            ].map(f => (
              <div
                key={f.title}
                style={{
                  background: D.card, border: `1px solid ${D.border}`, borderRadius: 16,
                  padding: '24px 22px', transition: 'border-color 0.2s, transform 0.2s, box-shadow 0.2s'
                }}
                className="hover:-translate-y-0.5 hover:border-white/[0.14] hover:shadow-xl"
              >
                <div style={{
                  width: 44, height: 44, borderRadius: 12, marginBottom: 16,
                  background: f.accentBg, border: `1px solid ${f.accentBorder}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: f.accent
                }}>
                  {f.icon}
                </div>
                <p style={{ fontSize: 15, fontWeight: 700, color: D.text1, marginBottom: 8, letterSpacing: '-0.01em' }}>{f.title}</p>
                <p style={{ fontSize: 13.5, color: D.text2, lineHeight: 1.6 }}>{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ══════════════════════════════════
            HOW IT WORKS
        ══════════════════════════════════ */}
        <section id="como-funciona" style={{ marginBottom: 80, scrollMarginTop: 80 }} className="animate-fade-in-up">
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <h2 style={{ fontSize: 'clamp(1.8rem, 3.5vw, 2.5rem)', fontWeight: 900, color: D.text1, letterSpacing: '-0.03em', lineHeight: 1.1, marginBottom: 12 }}>
              Do cadastro ao 1º disparo em 5 minutos
            </h2>
            <p style={{ fontSize: 15, color: D.text2 }}>
              Sem instalação, sem servidor próprio. Abre no navegador e já começa.
            </p>
          </div>

          <div style={{ display: 'grid', gap: 16 }} className="grid-cols-1 sm:grid-cols-3 lg:timeline-line">
            {[
              { n: 1, title: 'Conecte seu chip', text: 'Escaneie o QR Code e habilite seu primeiro canal WhatsApp em segundos.' },
              { n: 2, title: 'Importe seus contatos', text: 'Suba um CSV, crie listas e etiquete sua base para campanhas segmentadas.' },
              { n: 3, title: 'Lance e acompanhe', text: 'Monte a mensagem, dispare e veja as métricas de entrega em tempo real.' },
            ].map(s => (
              <div
                key={s.n}
                style={{
                  background: D.card, border: `1px solid ${D.border}`, borderRadius: 18,
                  padding: '28px 24px', position: 'relative',
                  transition: 'border-color 0.2s, transform 0.2s, box-shadow 0.2s'
                }}
                className="hover:-translate-y-0.5 hover:shadow-lg"
              >
                <div style={{
                  width: 48, height: 48, borderRadius: 14, marginBottom: 20,
                  background: `linear-gradient(135deg, ${D.green} 0%, #059669 100%)`,
                  boxShadow: `0 8px 24px ${D.greenGlow}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 18, fontWeight: 900, color: '#fff'
                }}>
                  {s.n}
                </div>
                <p style={{ fontSize: 16, fontWeight: 700, color: D.text1, marginBottom: 8, letterSpacing: '-0.01em' }}>{s.title}</p>
                <p style={{ fontSize: 13.5, color: D.text2, lineHeight: 1.65 }}>{s.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ══════════════════════════════════
            PLANS
        ══════════════════════════════════ */}
        <section id="planos" style={{ marginBottom: 80, scrollMarginTop: 80 }} className="animate-fade-in-up">
          <LandingPlanCards onPickPlan={(id) => openAuth(id)} />

          <div
            style={{
              maxWidth: 760, margin: '32px auto 0',
              background: D.card, border: `1px solid ${D.border}`, borderRadius: 16,
              padding: '20px 24px'
            }}
          >
            <p style={{ fontSize: 13, fontWeight: 700, color: D.text1, marginBottom: 12 }}>Em todos os planos</p>
            <ul style={{ display: 'grid', gap: '8px 32px', color: D.text2, fontSize: 13 }} className="sm:grid-cols-2">
              {[
                'Pagamento via Mercado Pago (Pix −5%, cartão ou débito)',
                'Cancelamento em poucos cliques em «Minha assinatura»',
                'Acesso liberado na hora após confirmação do pagamento',
                'Plano anual com prioridade no suporte',
              ].map(t => (
                <li key={t} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <CheckCircle2 size={15} style={{ color: D.green, marginTop: 2, flexShrink: 0 }} />
                  {t}
                </li>
              ))}
            </ul>
          </div>

          <p style={{ textAlign: 'center', fontSize: 12, color: D.text3, marginTop: 20 }}>
            Valores carregados do servidor — idênticos ao checkout Mercado Pago. Sem taxas escondidas.
          </p>
        </section>

        {/* ══════════════════════════════════
            FAQ
        ══════════════════════════════════ */}
        <section id="faq" style={{ marginBottom: 80, scrollMarginTop: 80 }} className="animate-fade-in-up">
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <h2 style={{ fontSize: 'clamp(1.8rem, 3.5vw, 2.5rem)', fontWeight: 900, color: D.text1, letterSpacing: '-0.03em', marginBottom: 10 }}>
              Perguntas frequentes
            </h2>
            <p style={{ fontSize: 15, color: D.text2 }}>Tudo que você precisa saber antes de começar.</p>
          </div>

          <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <FaqItem q="Como o ZapMass reduz risco de bloqueio?" a="Aplicamos limites por canal, pausas automáticas e cadência inteligente. Isso reduz risco operacional, mas não existe garantia de zero bloqueio — boas práticas de envio continuam essenciais." />
            <FaqItem
              id="faq-whatsapp-lgpd"
              q="WhatsApp (Meta), LGPD e API oficial — qual é minha responsabilidade?"
              a={<>
                <p style={{ marginBottom: 10 }}>{WHATSAPP_RISK_SHORT}</p>
                <ul style={{ paddingLeft: 16, marginBottom: 10 }}>
                  {WHATSAPP_RISK_BULLETS.map(t => <li key={t} style={{ marginBottom: 6 }}>{t}</li>)}
                </ul>
                <p style={{ fontSize: 12.5, color: D.text3, marginBottom: 8 }}>
                  Documentação oficial da Meta:{' '}
                  <a href={WHATSAPP_META_POLICY} target="_blank" rel="noopener noreferrer" style={{ color: D.green, fontWeight: 600 }}>Políticas do WhatsApp</a>
                  {' · '}
                  <a href={WHATSAPP_META_CLOUD_OVERVIEW} target="_blank" rel="noopener noreferrer" style={{ color: D.green, fontWeight: 600 }}>Visão geral da API</a>.
                </p>
                <p style={{ fontSize: 12.5, color: D.text3 }}>
                  No painel: <strong style={{ color: D.text2 }}>Configurações → WhatsApp / LGPD</strong>.
                </p>
              </>}
            />
            <FaqItem q="Com quantos canais posso começar?" a="Você escolhe entre 1 e 5 canais no checkout. Se precisar crescer, upgrade pró-rata disponível a qualquer momento." />
            <FaqItem q="Como funciona cancelamento e renovação?" a="Tudo gerenciado em 'Minha assinatura'. Cancele quando quiser; acesso segue ativo até o fim do período pago." />
            <FaqItem q="Preciso pagar para testar?" a={`Não. O teste grátis de ${trialLabel} libera o sistema completo sem cartão. Se não contratar, apenas os envios ficam bloqueados.`} />
            <FaqItem q="Meus dados e os dados dos clientes ficam seguros?" a="Sim. Cada conta opera com dados isolados, autenticação via Google/Facebook para o gestor e usuário+senha para a equipe, sempre sobre HTTPS." />
            <FaqItem q="Preciso deixar o computador ligado para disparar?" a="Não. A operação roda na nuvem 24/7. Feche o navegador e volte depois para acompanhar." />
          </div>
        </section>

        {/* ══════════════════════════════════
            FINAL CTA
        ══════════════════════════════════ */}
        <section style={{ marginBottom: 60 }} className="animate-fade-in-up">
          <div style={{
            position: 'relative', overflow: 'hidden', borderRadius: 24, padding: '56px 40px',
            textAlign: 'center',
            background: `linear-gradient(135deg, #042e1e 0%, #063d28 35%, #065f3c 70%, #047857 100%)`,
            border: `1px solid rgba(16,185,129,0.25)`,
            boxShadow: `0 24px 64px rgba(16,185,129,0.22)`
          }}>
            <div aria-hidden style={{
              position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.35,
              backgroundImage: 'radial-gradient(circle at 20% 30%, rgba(255,255,255,0.22), transparent 45%), radial-gradient(circle at 80% 70%, rgba(255,255,255,0.15), transparent 50%)'
            }} />
            {/* Dot grid overlay */}
            <div aria-hidden style={{
              position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.12,
              backgroundImage: `radial-gradient(circle, rgba(255,255,255,0.5) 1px, transparent 1px)`,
              backgroundSize: '28px 28px'
            }} />
            <div style={{ position: 'relative', zIndex: 1 }}>
              <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)', marginBottom: 12 }}>
                Comece agora mesmo
              </p>
              <h2 style={{ fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', fontWeight: 900, color: '#fff', letterSpacing: '-0.03em', lineHeight: 1.08, marginBottom: 14 }}>
                Pronto para vender mais<br />no WhatsApp?
              </h2>
              <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.78)', marginBottom: 32, maxWidth: 460, margin: '0 auto 32px' }}>
                {trialLabel} grátis, sem cartão, com acesso completo. Configure em 5 minutos.
              </p>
              <button
                type="button"
                onClick={() => openAuth('final_cta')}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  padding: '14px 32px', borderRadius: 14, cursor: 'pointer',
                  background: '#fff', color: '#047857', border: 'none',
                  fontSize: 15, fontWeight: 800, letterSpacing: '-0.01em',
                  boxShadow: '0 10px 28px rgba(0,0,0,0.25)',
                  transition: 'transform 0.15s, box-shadow 0.15s'
                }}
                className="hover:scale-[1.02] active:scale-[0.98]"
              >
                Começar grátis
                <ArrowRight size={17} />
              </button>
            </div>
          </div>
        </section>

        {/* ══════════════════════════════════
            FOOTER
        ══════════════════════════════════ */}
        <footer style={{
          paddingTop: 28, paddingBottom: 28, marginTop: 8,
          borderTop: `1px solid ${D.border}`,
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 26, height: 26, borderRadius: 7,
              background: `linear-gradient(135deg, ${D.green}, #059669)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <Zap size={13} color="white" fill="white" />
            </div>
            <span style={{ fontSize: 12, color: D.text3 }}>© {new Date().getFullYear()} ZapMass — Disparos com organização</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: D.green, boxShadow: `0 0 6px ${D.green}` }} />
            <span style={{ fontSize: 11.5, color: D.text3 }}>Plataforma operando</span>
          </div>
        </footer>
      </div>

      {/* ══════════════════════════════════
          AUTH MODAL
      ══════════════════════════════════ */}
      {authOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Acesso ao painel"
          style={{
            position: 'fixed', inset: 0, zIndex: 50,
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            padding: '20px 12px', overflowY: 'auto'
          }}
          className="sm:items-center"
        >
          {/* Backdrop */}
          <div
            aria-hidden
            onClick={() => setAuthOpen(false)}
            style={{ position: 'absolute', inset: 0, background: 'rgba(2,5,14,0.78)', backdropFilter: 'blur(8px)' }}
            className="animate-fade-in-up"
          />

          {/* Modal card */}
          <div
            className="relative z-10 w-full animate-fade-in-up"
            style={{ maxWidth: 430, animationDuration: '220ms' }}
          >
              <QuickAuthPanel
                onClose={() => setAuthOpen(false)}
                trialLabel={trialLabel}
                startTrialAfterLogin={authStartTrial}
              />
          </div>
        </div>
      ) : null}
    </div>
  );
};

/* ─────────────────────────────────────── */
const CHANNEL_TIERS = [1, 2, 3, 4, 5] as const;

function tierMoney(n: (typeof CHANNEL_TIERS)[number], server: ServerBillingPrices | null) {
  const row = server?.channelTiers?.[String(n)];
  return {
    monthly: row?.monthly ?? CHANNEL_TIER_PRICES_MONTHLY[n],
    annual:  row?.annual  ?? CHANNEL_TIER_PRICES_ANNUAL[n]
  };
}
function maxAnnualSavingsPct(server: ServerBillingPrices | null): number | null {
  let best: number | null = null;
  for (const n of CHANNEL_TIERS) {
    const { monthly, annual } = tierMoney(n, server);
    const p = computeAnnualSavingsPercent(monthly, annual);
    if (p != null && (best === null || p > best)) best = p;
  }
  return best;
}

const LandingPlanCards: React.FC<{ onPickPlan: (ctaId: string) => void }> = ({ onPickPlan }) => {
  const [server, setServer] = useState<ServerBillingPrices | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'done'>('loading');
  const [cycle, setCycle] = useState<'monthly' | 'annual'>('monthly');

  useEffect(() => {
    let alive = true;
    fetchServerBillingPrices()
      .then(p => { if (alive) setServer(p); })
      .finally(() => { if (alive) setLoadState('done'); });
    return () => { alive = false; };
  }, []);

  const pixPct = Math.round((server?.pixDiscountPct ?? 0.05) * 100);
  const fromCheckout = server?.channelTiers != null;
  const savingsPct = maxAnnualSavingsPct(server);

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, marginBottom: 32 }} className="md:flex-row md:items-end md:justify-between">
        <div>
          <div style={{
            display: 'inline-flex', alignItems: 'center',
            fontSize: 11, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase',
            color: D.green, marginBottom: 10, padding: '4px 12px',
            background: 'rgba(16,185,129,0.1)', borderRadius: 20, border: `1px solid rgba(16,185,129,0.2)`
          }}>
            Planos
          </div>
          <h2 style={{ fontSize: 'clamp(1.8rem, 3vw, 2.4rem)', fontWeight: 900, color: D.text1, letterSpacing: '-0.03em', lineHeight: 1.1, marginBottom: 8 }}>
            Escolha seu plano
          </h2>
          <p style={{ fontSize: 15, color: D.text2, maxWidth: 460 }}>
            Quanto mais canais, menor o custo por canal.{' '}
            <span style={{ color: D.text1 }}>Valores iguais ao checkout.</span>
          </p>
        </div>

        {/* Cycle toggle */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 4, padding: 4,
          background: D.card, border: `1px solid ${D.border}`, borderRadius: 24, alignSelf: 'flex-start'
        }}>
          {(['monthly', 'annual'] as const).map(c => (
            <button
              key={c}
              type="button"
              onClick={() => { setCycle(c); trackLandingEvent('landing_plan_cycle', { cycle: c }); }}
              style={{
                padding: '8px 18px', borderRadius: 20, border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: 700, transition: 'all 0.2s',
                background: cycle === c ? D.green : 'transparent',
                color: cycle === c ? '#fff' : D.text3,
                boxShadow: cycle === c ? `0 4px 14px ${D.greenGlow}` : 'none',
                display: 'flex', alignItems: 'center', gap: 7
              }}
              aria-pressed={cycle === c}
            >
              {c === 'monthly' ? 'Mensal' : 'Anual'}
              {c === 'annual' && savingsPct != null ? (
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
                  background: cycle === 'annual' ? 'rgba(255,255,255,0.25)' : `rgba(16,185,129,0.2)`,
                  color: cycle === 'annual' ? '#fff' : D.green
                }}>
                  −{savingsPct}%
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {/* Plan cards */}
      <div
        className="flex lg:grid overflow-x-auto pb-4 lg:pb-0 snap-x snap-mandatory lg:snap-none -mx-6 px-6 sm:-mx-0 sm:px-0"
        style={{ gap: 12, gridTemplateColumns: 'repeat(5,1fr)', scrollbarWidth: 'thin', paddingTop: 18 }}
      >
        {loadState === 'loading'
          ? CHANNEL_TIERS.map(n => (
              <div key={n}
                className="min-w-[260px] lg:min-w-0 snap-center shrink-0 animate-pulse rounded-2xl"
                style={{ height: 320, background: D.card, border: `1px solid ${D.border}` }}
                aria-hidden
              />
            ))
          : CHANNEL_TIERS.map(n => {
              const { monthly, annual } = tierMoney(n, server);
              const total = cycle === 'monthly' ? monthly : annual;
              const perChannel = roundMoneyBRL(total / n);
              const equivMonthly = cycle === 'annual' ? roundMoneyBRL(annual / 12) : null;
              const isPopular  = n === 3;
              const isStarter  = n === 2;
              const isHighlight = isPopular || isStarter;

              return (
                <article
                  key={n}
                  className={`min-w-[260px] lg:min-w-0 snap-center shrink-0 rounded-2xl p-5 flex flex-col transition-all hover:-translate-y-0.5 hover:shadow-xl ${isPopular ? 'plan-halo-emerald' : ''}`}
                  style={{
                    background: isHighlight
                      ? `linear-gradient(180deg, rgba(16,185,129,0.07) 0%, ${D.card} 100%)`
                      : D.card,
                    border: `1px solid ${isPopular ? 'rgba(16,185,129,0.4)' : isStarter ? 'rgba(99,102,241,0.35)' : D.border}`,
                    position: 'relative',
                    boxShadow: isHighlight ? '0 16px 48px rgba(0,0,0,0.3)' : undefined
                  }}
                >
                  {isStarter && (
                    <span style={{
                      position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)',
                      fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                      padding: '3px 10px', borderRadius: 20, color: '#fff', whiteSpace: 'nowrap',
                      background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
                      boxShadow: '0 4px 14px rgba(99,102,241,0.4)'
                    }}>Indicado</span>
                  )}
                  {isPopular && (
                    <span style={{
                      position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)',
                      fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                      padding: '3px 10px', borderRadius: 20, color: '#fff', whiteSpace: 'nowrap',
                      background: `linear-gradient(135deg, ${D.green}, #059669)`,
                      boxShadow: `0 4px 14px ${D.greenGlow}`
                    }}>Mais popular</span>
                  )}

                  <p style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.16em', color: D.text3, marginBottom: 12, marginTop: 4 }}>
                    {n === 1 ? '1 canal' : `${n} canais`}
                  </p>

                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 4 }}>
                    <span style={{ fontSize: 30, fontWeight: 900, color: D.text1, letterSpacing: '-0.04em', lineHeight: 1 }}>{brl(total)}</span>
                    <span style={{ fontSize: 12, color: D.text3 }}>{cycle === 'monthly' ? '/mês' : '/ano'}</span>
                  </div>
                  <p style={{ fontSize: 11.5, color: D.green, minHeight: 36, marginBottom: 14, lineHeight: 1.4 }}>
                    {equivMonthly != null ? `≈ ${brl(equivMonthly)}/mês` : 'Cancele quando quiser'}
                  </p>

                  <ul style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, color: D.text2, fontSize: 12.5 }}>
                    <li style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
                      <CheckCircle2 size={14} style={{ color: D.green, marginTop: 2, flexShrink: 0 }} />
                      <span><strong style={{ color: D.text1 }}>{brl(perChannel)}</strong> {cycle === 'monthly' ? 'por canal/mês' : 'por canal/ano'}</span>
                    </li>
                    <li style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
                      <CheckCircle2 size={14} style={{ color: D.green, marginTop: 2, flexShrink: 0 }} />
                      Campanhas e métricas
                    </li>
                    {n >= 2 && (
                      <li style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
                        <CheckCircle2 size={14} style={{ color: D.green, marginTop: 2, flexShrink: 0 }} />
                        {n} números WhatsApp
                      </li>
                    )}
                  </ul>

                  <button
                    type="button"
                    onClick={() => onPickPlan(`plan_card_${n}_${cycle}`)}
                    style={{
                      marginTop: 20, width: '100%', padding: '11px 16px',
                      borderRadius: 12, cursor: 'pointer', fontWeight: 700, fontSize: 13,
                      transition: 'all 0.2s',
                      background: isHighlight ? `linear-gradient(135deg, ${D.green}, #059669)` : 'rgba(16,185,129,0.1)',
                      color: isHighlight ? '#fff' : D.green,
                      border: isHighlight ? 'none' : `1px solid rgba(16,185,129,0.25)`,
                      boxShadow: isHighlight ? `0 8px 22px ${D.greenGlow}` : 'none'
                    }}
                    className="hover:brightness-110 active:scale-[0.98]"
                  >
                    Começar com {n === 1 ? '1 canal' : `${n} canais`}
                  </button>
                </article>
              );
            })
        }
      </div>

      <p style={{
        marginTop: 20, padding: '10px 16px', borderRadius: 12, textAlign: 'center',
        fontSize: 11, color: D.text3, background: D.card, border: `1px solid ${D.border}`
      }}>
        Desconto Pix ({pixPct}%) no pagamento quando disponível · upgrade pró-rata no meio do ciclo
        {fromCheckout ? ' · valores alinhados ao checkout' : ''}
      </p>
    </div>
  );
};

const FaqItem: React.FC<{ q: string; a: React.ReactNode; id?: string }> = ({ q, a, id }) => (
  <details
    id={id}
    className="group rounded-2xl overflow-hidden transition-colors scroll-mt-24"
    style={{ background: D.card, border: `1px solid ${D.border}` }}
  >
    <summary
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '16px 18px', cursor: 'pointer', listStyle: 'none', userSelect: 'none', color: D.text1 }}
      className="hover:bg-white/[0.025]"
    >
      <span style={{ fontSize: 14, fontWeight: 700 }}>{q}</span>
      <ChevronDown size={16} style={{ color: D.text3, flexShrink: 0, transition: 'transform 0.2s' }} className="group-open:rotate-180" />
    </summary>
    <div style={{ padding: '0 18px 18px', fontSize: 13.5, lineHeight: 1.7, color: D.text2, borderTop: `1px solid ${D.border}` }}>
      <div style={{ paddingTop: 14 }}>{a}</div>
    </div>
  </details>
);
