import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import toast from 'react-hot-toast';
import type { SessionUser } from '../types/sessionUser';
import { trackLoginSuccess } from '../utils/marketingEvents';
import {
  clearVpsSession,
  getVpsAuthUser,
  vpsLogin,
  vpsLogout,
  vpsRegister,
  vpsStaffLogin,
  vpsRefreshAccessToken
} from '../services/vpsAuth';
import { vpsUserToSessionUser } from '../utils/vpsSessionUser';

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
  signOut: async () => {}
});

const socialUnavailable =
  'Entre com e-mail e senha. Login social não está disponível nesta instalação.';

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const boot = async () => {
      let v = getVpsAuthUser();
      if (!v) {
        await vpsRefreshAccessToken();
        v = getVpsAuthUser();
      }
      setUser(v ? vpsUserToSessionUser(v) : null);
      setLoading(false);
    };
    void boot();
  }, []);

  const signInWithGoogle = async () => {
    toast.error(socialUnavailable);
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

  const signOut = async () => {
    try {
      await vpsLogout();
      setUser(null);
      toast.success('Voce saiu da conta.');
    } catch (err: unknown) {
      clearVpsSession();
      setUser(null);
      toast.error(err instanceof Error ? err.message : 'Falha ao sair.');
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
        signOut
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
