import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut as firebaseSignOut,
  signInWithCustomToken,
  User
} from 'firebase/auth';
import toast from 'react-hot-toast';
import { auth, googleProvider } from '../services/firebase';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  /** Login de funcionário (token emitido pelo servidor após validar e-mail do gestor + usuário + senha). */
  signInWithStaffCustomToken: (customToken: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  signInWithGoogle: async () => {},
  signInWithStaffCustomToken: async () => {},
  signOut: async () => {}
});

// Mapeia codigos de erro do Firebase para mensagens amigaveis em pt-BR.
const mapAuthErrorMessage = (err: any): string => {
  const code: string = err?.code || '';
  switch (code) {
    case 'auth/popup-blocked':
      return 'Seu navegador bloqueou o popup de login. Vamos redirecionar para o Google...';
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
    case 'auth/operation-not-supported-in-this-environment':
    case 'auth/web-storage-unsupported':
      return 'Seu navegador nao suporta este login. Ative cookies e tente novamente.';
    case 'auth/invalid-custom-token':
    case 'auth/custom-token-mismatch':
      return 'Token de acesso inválido ou expirado. Tente entrar de novo.';
    default:
      return err?.message || 'Falha ao entrar com Google.';
  }
};

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Finaliza login via redirect (fallback quando o popup foi bloqueado).
    getRedirectResult(auth)
      .then((res) => {
        if (res?.user) {
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
      await signInWithPopup(auth, googleProvider);
      toast.success('Login realizado com sucesso.');
    } catch (err: any) {
      const code = err?.code || '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        return;
      }
      // Popup bloqueado pelo navegador / bloqueador de anuncios / iframe sem permissao
      // => cai automaticamente para fluxo de redirect (mesma aba).
      if (
        code === 'auth/popup-blocked' ||
        code === 'auth/operation-not-supported-in-this-environment' ||
        code === 'auth/web-storage-unsupported'
      ) {
        try {
          toast.loading('Redirecionando para o Google...', { id: 'google-redirect', duration: 3000 });
          await signInWithRedirect(auth, googleProvider);
          return;
        } catch (redirectErr: any) {
          console.error('[AuthContext] signInWithRedirect fallback:', redirectErr);
          toast.error(mapAuthErrorMessage(redirectErr));
          return;
        }
      }
      console.error('[AuthContext] signInWithGoogle:', err);
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
    <AuthContext.Provider value={{ user, loading, signInWithGoogle, signInWithStaffCustomToken, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
