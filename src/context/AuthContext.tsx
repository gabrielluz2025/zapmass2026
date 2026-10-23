import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import toast from 'react-hot-toast';
import type { SessionUser } from '../types/sessionUser';
import { trackLoginSuccess } from '../utils/marketingEvents';
import {
  clearVpsSession,
  getVpsAuthUser,
  type VpsAuthUser,
  vpsFetchMe,
  vpsLogin,
  vpsLogout,
  vpsRegister,
  vpsStaffLogin,
  vpsRefreshAccessToken,
  bindCrossTabLogoutSync,
  vpsStartGoogleLogin
} from '../services/vpsAuth';
import { vpsUserToSessionUser } from '../utils/vpsSessionUser';
import { clearBootstrapCache } from '../utils/bootstrapSessionCache';

interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithFacebook: () => Promise<void>;
  signInWithEmailPassword: (email: string, password: string) => Promise<void>;
  signUpWithEmailPassword: (email: string, password: string) => Promise<void>;
  signInWithStaffCustomToken: (customToken: string) => Promise<void>;
  signInWithStaffCredentials: (
    managerEmail: string,
    loginName: string,
    password: string
  ) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  /** Atualiza o estado local após PATCH /api/auth/profile (sem nova ida ao servidor). */
  syncVpsUser: (user: VpsAuthUser) => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  signInWithGoogle: async () => {},
  signInWithFacebook: async () => {},
  signInWithEmailPassword: async () => {},
  signUpWithEmailPassword: async () => {},
  signInWithStaffCustomToken: async () => {},
  signInWithStaffCredentials: async () => {},
  signOut: async () => {},
  refreshProfile: async () => {},
  syncVpsUser: () => {}
});

const socialUnavailable =
  'Entre com e-mail e senha. Login social não está disponível nesta instalação.';

const googleLoginErrorMessages: Record<string, string> = {
  cancelled: 'Login com Google cancelado.',
  email_unverified: 'O Google não confirmou seu e-mail. Use outra conta ou entre com senha.',
  disabled_account: 'Esta conta está desativada. Contacte o suporte.',
  link_conflict: 'Esta conta Google já está ligada a outro utilizador.',
  state: 'Sessão OAuth expirada. Tente entrar com Google novamente.',
  disabled: 'Login com Google não está ativo nesta instalação.',
  postgres: 'Serviço temporariamente indisponível. Tente mais tarde.',
  failed: 'Não foi possível entrar com Google. Tente de novo ou use e-mail e senha.'
};

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    bindCrossTabLogoutSync();
    const boot = async () => {
      try {
        const cached = getVpsAuthUser();
        if (cached) {
          setUser(vpsUserToSessionUser(cached));
          setLoading(false);
          void vpsRefreshAccessToken()
            .then((token) => {
              if (!token) return;
              const v = getVpsAuthUser();
              if (v) setUser(vpsUserToSessionUser(v));
            })
            .catch(() => {});
          return;
        }
        await vpsRefreshAccessToken();
        const v = getVpsAuthUser();
        setUser(v ? vpsUserToSessionUser(v) : null);
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    };
    void boot();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const err = params.get('google_error');
    if (params.get('google_login') === 'error' && err) {
      toast.error(googleLoginErrorMessages[err] || googleLoginErrorMessages.failed);
      params.delete('google_login');
      params.delete('google_error');
      const qs = params.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`);
      return;
    }
    if (params.get('google_login') !== '1') return;

    const finish = async () => {
      try {
        const token = await vpsRefreshAccessToken();
        if (!token) {
          toast.error('Não foi possível concluir o login com Google. Tente novamente.');
          return;
        }
        const v = getVpsAuthUser();
        setUser(v ? vpsUserToSessionUser(v) : null);
        trackLoginSuccess('google');
        toast.success('Login com Google realizado com sucesso.');
      } catch {
        toast.error(googleLoginErrorMessages.failed);
      } finally {
        params.delete('google_login');
        const qs = params.toString();
        window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`);
      }
    };
    void finish();
  }, []);

  const signInWithGoogle = async () => {
    try {
      vpsStartGoogleLogin(window.location.href);
    } catch {
      toast.error(socialUnavailable);
    }
  };

  const signInWithFacebook = async () => {
    toast.error(socialUnavailable);
  };

  const signInWithEmailPassword = async (email: string, password: string) => {
    try {
      const v = await vpsLogin(email, password);
      setUser(vpsUserToSessionUser(v));
      trackLoginSuccess('email');
      toast.success('Login realizado com sucesso.');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Falha ao entrar.');
      throw err;
    }
  };

  const signUpWithEmailPassword = async (email: string, password: string) => {
    try {
      const v = await vpsRegister(email, password);
      setUser(vpsUserToSessionUser(v));
      trackLoginSuccess('email');
      toast.success('Conta criada com sucesso.');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Falha ao criar conta.');
      throw err;
    }
  };

  const signInWithStaffCredentials = async (
    managerEmail: string,
    loginName: string,
    password: string
  ) => {
    try {
      const v = await vpsStaffLogin(managerEmail, loginName, password);
      setUser(vpsUserToSessionUser(v));
      trackLoginSuccess('staff');
      toast.success('Acesso de funcionário ativado.');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível entrar.');
      throw err;
    }
  };

  const signInWithStaffCustomToken = async (_customToken: string) => {
    toast.error('Login por token legado não está disponível. Use usuário e senha.');
  };

  const refreshProfile = async () => {
    const v = await vpsFetchMe();
    setUser(vpsUserToSessionUser(v));
  };

  const syncVpsUser = (v: VpsAuthUser) => {
    setUser(vpsUserToSessionUser(v));
  };

  const signOut = async () => {
    setUser(null);
    try {
      await vpsLogout();
    } catch (err: unknown) {
      clearVpsSession();
      toast.error(err instanceof Error ? err.message : 'Falha ao sair.');
    } finally {
      clearBootstrapCache();
      window.location.replace('/');
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        signInWithGoogle,
        signInWithFacebook,
        signInWithEmailPassword,
        signUpWithEmailPassword,
        signInWithStaffCustomToken,
        signInWithStaffCredentials,
        signOut,
        refreshProfile,
        syncVpsUser
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
