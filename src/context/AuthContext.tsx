import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  getAdditionalUserInfo,
  updateProfile,
  signOut as firebaseSignOut,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  FacebookAuthProvider,
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
  signInWithEmailPassword: (email: string, password: string) => Promise<void>;
  signUpWithEmailPassword: (email: string, password: string) => Promise<void>;
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
  signInWithEmailPassword: async () => {},
  signUpWithEmailPassword: async () => {},
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
    case 'auth/invalid-email':
      return 'E-mail inválido. Verifique o endereço.';
    case 'auth/missing-password':
    case 'auth/wrong-password':
      return 'Senha incorreta. Tente de novo.';
    case 'auth/user-not-found':
      return 'Não há conta com este e-mail. Crie uma em «Primeira vez» ou verifique o endereço.';
    case 'auth/email-already-in-use':
      return 'Este e-mail já está registado. Use «Já tenho conta» para entrar.';
    case 'auth/weak-password':
      return 'Senha fraca. Use pelo menos 6 caracteres (recomendamos 8 ou mais).';
    case 'auth/invalid-credential': {
      const msg = String(err?.message || '');
      if (
        msg.includes('Invalid+Scopes') ||
        msg.includes('Invalid Scopes') ||
        msg.includes('error_code=100')
      ) {
        return 'O Facebook recusou uma permissão (muitas vezes «email»). Na app Meta: Casos de uso → Login com Facebook → ative as permissões «email» e «public_profile». Depois, recarregue o site com Ctrl+Shift+R (ou teste em janela anónima) para não usar JavaScript antigo em cache.';
      }
      return msg || 'Falha ao entrar. Tente novamente.';
    }
    default: {
      const msg = String(err?.message || '');
      if (
        msg.includes('Invalid+Scopes') ||
        msg.includes('Invalid Scopes') ||
        msg.includes('error_code=100')
      ) {
        return 'O Facebook recusou uma permissão (muitas vezes «email»). Na app Meta: Casos de uso → Login com Facebook → ative «email» e «public_profile». Recarregue com Ctrl+Shift+R ou teste em janela anónima.';
      }
      return msg || 'Falha ao entrar. Tente novamente.';
    }
  }
};

const trackLoginSuccessFromCredential = (res: UserCredential) => {
  const pid = res.providerId || res.user?.providerData?.[0]?.providerId || '';
  if (pid === 'facebook.com') trackLoginSuccess('facebook');
  else if (pid === 'apple.com') trackLoginSuccess('apple');
  else trackLoginSuccess('google');
};

/** URL direta no CDN (fbcdn); evita graph.facebook.com/.../picture (muitas vezes só silhueta). */
async function fetchFacebookProfilePictureUrl(accessToken: string | null | undefined): Promise<string | null> {
  if (!accessToken) return null;
  try {
    const params = new URLSearchParams({
      fields: 'picture.type(large){url,is_silhouette}',
      access_token: accessToken
    });
    const r = await fetch(`https://graph.facebook.com/v18.0/me?${params.toString()}`);
    if (!r.ok) return null;
    const j = (await r.json()) as {
      picture?: { data?: { url?: string; is_silhouette?: boolean } };
    };
    const d = j?.picture?.data;
    if (!d?.url || d.is_silhouette) return null;
    return d.url;
  } catch {
    return null;
  }
}

function isGraphPicturePlaceholderUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.includes('graph.facebook.com') && url.includes('/picture');
}

/** Firebase muitas vezes deixa photoURL vazio ou genérico no Facebook; preenchemos com URL real do Graph. */
async function hydrateFacebookProfilePhotoIfNeeded(res: UserCredential): Promise<void> {
  const u = res.user;
  if (!u.providerData.some((p) => p.providerId === 'facebook.com')) return;

  const oauth = FacebookAuthProvider.credentialFromResult(res);
  let url: string | null = await fetchFacebookProfilePictureUrl(oauth?.accessToken ?? null);

  if (!url) {
    try {
      const info = getAdditionalUserInfo(res);
      const pic = info?.profile && (info.profile as { picture?: unknown }).picture;
      if (typeof pic === 'string') url = pic;
      else if (pic && typeof pic === 'object' && pic !== null && 'data' in pic) {
        const d = (pic as { data?: { url?: string; is_silhouette?: boolean } }).data;
        if (d?.url && !d?.is_silhouette) url = d.url;
      }
    } catch {
      /* ignore */
    }
  }

  if (url && u.photoURL !== url) {
    try {
      await updateProfile(u, { photoURL: url });
    } catch (e) {
      console.warn('[AuthContext] updateProfile photoURL (Facebook):', e);
    }
    return;
  }

  if (!url && isGraphPicturePlaceholderUrl(u.photoURL ?? null)) {
    try {
      await updateProfile(u, { photoURL: null });
    } catch {
      /* ignore */
    }
  }
}

/** Evita repetir limpeza de photoURL placeholder na mesma sessão. */
const facebookGraphPlaceholderCleared = new Set<string>();

async function signInWithProviderPopupOrRedirect(
  provider: AuthProvider,
  opts: { redirectToastId: string; redirectMessage: string }
): Promise<UserCredential | null> {
  try {
    return await signInWithPopup(auth, provider);
  } catch (err: any) {
    const code = err?.code || '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      return null;
    }
    if (
      code === 'auth/popup-blocked' ||
      code === 'auth/operation-not-supported-in-this-environment' ||
      code === 'auth/web-storage-unsupported'
    ) {
      try {
        toast.loading(opts.redirectMessage, { id: opts.redirectToastId, duration: 3000 });
        await signInWithRedirect(auth, provider);
        return null;
      } catch (redirectErr: any) {
        console.error('[AuthContext] signInWithRedirect:', redirectErr);
        toast.error(mapAuthErrorMessage(redirectErr));
        return null;
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
      .then(async (res) => {
        if (res?.user) {
          trackLoginSuccessFromCredential(res);
          await hydrateFacebookProfilePhotoIfNeeded(res);
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
      if (fbUser && fbUser.providerData.some((p) => p.providerId === 'facebook.com')) {
        if (
          isGraphPicturePlaceholderUrl(fbUser.photoURL) &&
          !facebookGraphPlaceholderCleared.has(fbUser.uid)
        ) {
          facebookGraphPlaceholderCleared.add(fbUser.uid);
          void updateProfile(fbUser, { photoURL: null }).catch(() => {
            facebookGraphPlaceholderCleared.delete(fbUser.uid);
          });
        }
      }
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
      const cred = await signInWithProviderPopupOrRedirect(facebookProvider, {
        redirectToastId: 'facebook-redirect',
        redirectMessage: 'Redirecionando para o Facebook...'
      });
      if (!auth.currentUser) return;
      if (cred) await hydrateFacebookProfilePhotoIfNeeded(cred);
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

  const signInWithEmailPassword = async (email: string, password: string) => {
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      trackLoginSuccess('email');
      toast.success('Login realizado com sucesso.');
    } catch (err: unknown) {
      console.error('[AuthContext] signInWithEmailPassword:', err);
      toast.error(mapAuthErrorMessage(err));
      throw err;
    }
  };

  const signUpWithEmailPassword = async (email: string, password: string) => {
    try {
      await createUserWithEmailAndPassword(auth, email.trim(), password);
      trackLoginSuccess('email');
      toast.success('Conta criada com sucesso.');
    } catch (err: unknown) {
      console.error('[AuthContext] signUpWithEmailPassword:', err);
      toast.error(mapAuthErrorMessage(err));
      throw err;
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
        signInWithEmailPassword,
        signUpWithEmailPassword,
        signInWithStaffCustomToken,
        signOut
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
