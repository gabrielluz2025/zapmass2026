import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut as firebaseSignOut,
  signInWithCustomToken,
  User,
  UserCredential,
  type AuthProvider
} from 'firebase/auth';
import toast from 'react-hot-toast';
import { auth, appleProvider, facebookProvider, googleProvider } from '../services/firebase';
import { trackLoginSuccess } from '../utils/marketingEvents';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithFacebook: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  /** Login de funcionário (token emitido pelo servidor após validar e-mail do gestor + usuário + senha). */
  signInWithStaffCustomToken: (customToken: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  signInWithGoogle: async () => {},
  signInWithFacebook: async () => {},
  signInWithApple: async () => {},
  signInWithStaffCustomToken: async () => {},
  signOut: async () => {}
});

// Mapeia codigos de erro do Firebase para mensagens amigaveis em pt-BR.
const mapAuthErrorMessage = (err: any): string => {
  const code: string = err?.code || '';
  switch (code) {
    case 'auth/popup-blocked':
      return 'Seu navegador bloqueou o popup de login. Vamos redirecionar na mesma página…';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Login cancelado.';
    case 'auth/network-request-failed':
      return 'Sem conexao com a internet. Verifique sua rede e tente novamente.';
    case 'auth/too-many-requests':
      return 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.';
    case 'auth/user-disabled':
      return 'Esta conta foi desabilitada. Fale com o suporte.';
    case 'auth/unauthorized-domain':
      return 'Dominio nao autorizado. Peca ao admin para adicionar este dominio no Firebase.';
    case 'auth/operation-not-allowed':
      return 'Este provedor de login nao esta ativo no Firebase. No Console: Authentication → Sign-in method — ative o provedor (Facebook: App ID e segredo da Meta; copie a URL de redirecionamento OAuth do assistente para developers.facebook.com).';
    case 'auth/operation-not-supported-in-this-environment':
    case 'auth/web-storage-unsupported':
      return 'Seu navegador nao suporta este login. Ative cookies e tente novamente.';
    case 'auth/invalid-custom-token':
    case 'auth/custom-token-mismatch':
      return 'Token de acesso inválido ou expirado. Tente entrar de novo.';
    case 'auth/account-exists-with-different-credential':
      return 'Este e-mail já está ligado a outro método de login. Use o mesmo botão (Google, Apple ou Facebook) que usou na primeira vez.';
    default:
      return err?.message || 'Falha ao entrar. Tente novamente.';
  }
};

const trackLoginSuccessFromCredential = (res: UserCredential) => {
  const pid = res.providerId || res.user?.providerData?.[0]?.providerId || '';
  if (pid === 'facebook.com') trackLoginSuccess('facebook');
  else if (pid === 'apple.com') trackLoginSuccess('apple');
  else trackLoginSuccess('google');
};

async function signInWithProviderPopupOrRedirect(
  provider: AuthProvider,
  opts: { redirectToastId: string; redirectMessage: string }
): Promise<void> {
  try {
    await signInWithPopup(auth, provider);
  } catch (err: any) {
    const code = err?.code || '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      return;
    }
    if (
      code === 'auth/popup-blocked' ||
      code === 'auth/operation-not-supported-in-this-environment' ||
      code === 'auth/web-storage-unsupported'
    ) {
      try {
        toast.loading(opts.redirectMessage, { id: opts.redirectToastId, duration: 3000 });
        await signInWithRedirect(auth, provider);
        return;
      } catch (redirectErr: any) {
        console.error('[AuthContext] signInWithRedirect:', redirectErr);
        toast.error(mapAuthErrorMessage(redirectErr));
        return;
      }
    }
    throw err;
  }
}

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Finaliza login via redirect (fallback quando o popup foi bloqueado).
    getRedirectResult(auth)
      .then((res) => {
        if (res?.user) {
          trackLoginSuccessFromCredential(res);
          toast.success('Login realizado com sucesso.');
        }
      })
      .catch((err) => {
        const code = err?.code || '';
        if (code && code !== 'auth/no-auth-event') {
          console.error('[AuthContext] getRedirectResult:', err);
          toast.error(mapAuthErrorMessage(err));
        }
      });

    const unsub = onAuthStateChanged(auth, (fbUser) => {
      setUser(fbUser);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const signInWithGoogle = async () => {
    try {
      await signInWithProviderPopupOrRedirect(googleProvider, {
        redirectToastId: 'google-redirect',
        redirectMessage: 'Redirecionando para o Google...'
      });
      if (!auth.currentUser) return;
      trackLoginSuccess('google');
      toast.success('Login realizado com sucesso.');
    } catch (err: any) {
      console.error('[AuthContext] signInWithGoogle:', err);
      toast.error(mapAuthErrorMessage(err));
    }
  };

  const signInWithFacebook = async () => {
    try {
      await signInWithProviderPopupOrRedirect(facebookProvider, {
        redirectToastId: 'facebook-redirect',
        redirectMessage: 'Redirecionando para o Facebook...'
      });
      if (!auth.currentUser) return;
      trackLoginSuccess('facebook');
      toast.success('Login realizado com sucesso.');
    } catch (err: any) {
      console.error('[AuthContext] signInWithFacebook:', err);
      toast.error(mapAuthErrorMessage(err));
    }
  };

  const signInWithApple = async () => {
    try {
      await signInWithProviderPopupOrRedirect(appleProvider, {
        redirectToastId: 'apple-redirect',
        redirectMessage: 'Redirecionando para a Apple...'
      });
      if (!auth.currentUser) return;
      trackLoginSuccess('apple');
      toast.success('Login realizado com sucesso.');
    } catch (err: any) {
      console.error('[AuthContext] signInWithApple:', err);
      toast.error(mapAuthErrorMessage(err));
    }
  };

  const signInWithStaffCustomToken = async (customToken: string) => {
    const t = typeof customToken === 'string' ? customToken.trim() : '';
    if (!t) {
      toast.error('Token de sessão em falta.');
      return;
    }
    try {
      await signInWithCustomToken(auth, t);
      trackLoginSuccess('staff');
      toast.success('Acesso de funcionário ativado.');
    } catch (err: unknown) {
      console.error('[AuthContext] signInWithStaffCustomToken:', err);
      toast.error(mapAuthErrorMessage(err));
      throw err;
    }
  };

  const signOut = async () => {
    try {
      await firebaseSignOut(auth);
      toast.success('Voce saiu da conta.');
    } catch (err: any) {
      console.error('[AuthContext] signOut:', err);
      toast.error(err?.message || 'Falha ao sair.');
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        signInWithGoogle,
        signInWithFacebook,
        signInWithApple,
        signInWithStaffCustomToken,
        signOut
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
