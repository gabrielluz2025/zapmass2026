import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import {
  getAuth,
  GoogleAuthProvider,
  FacebookAuthProvider,
  OAuthProvider,
  setPersistence,
  browserLocalPersistence
} from 'firebase/auth';

const firebaseConfig = {
  apiKey: 'AIzaSyAa-a8MMECStZgKxxELeLSJT7JpJOKMJZw',
  authDomain: 'zapflow25.firebaseapp.com',
  projectId: 'zapflow25',
  storageBucket: 'zapflow25.firebasestorage.app',
  messagingSenderId: '182084372862',
  appId: '1:182084372862:web:ade0016971a298d21e8b2f'
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);

export const auth = getAuth(app);
// Persistencia local (mantem logado apos refresh/fechar a aba)
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn('[Firebase Auth] Falha ao aplicar persistencia local:', err?.message || err);
});

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

/** Habilitar Facebook e Apple no Firebase Console → Authentication → Sign-in method. */
export const facebookProvider = new FacebookAuthProvider();
facebookProvider.addScope('email');
facebookProvider.addScope('public_profile');

export const appleProvider = new OAuthProvider('apple.com');
appleProvider.addScope('email');
appleProvider.addScope('name');
