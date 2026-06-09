import React, { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Camera, KeyRound, Loader2, Mail, Save, Trash2, User } from 'lucide-react';
import { Button, Card, Input } from '../ui';
import { useAuth } from '../../context/AuthContext';
import { getVpsAuthUser } from '../../services/vpsAuth';
import {
  vpsChangeEmail,
  vpsChangePassword,
  vpsUpdateProfile
} from '../../services/vpsAuth';

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    reader.readAsDataURL(file);
  });
}

export const AccountProfileEditor: React.FC = () => {
  const { user, refreshProfile } = useAuth();
  const vpsUser = getVpsAuthUser();
  const isStaff = vpsUser?.role === 'staff';

  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [savingName, setSavingName] = useState(false);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDisplayName(user?.displayName || '');
  }, [user?.displayName]);

  const initials = (user?.displayName || user?.email || 'U')
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const handleSaveName = async () => {
    const name = displayName.trim();
    if (name.length < 2) {
      toast.error('Informe um nome com pelo menos 2 caracteres.');
      return;
    }
    setSavingName(true);
    try {
      await vpsUpdateProfile({ displayName: name });
      await refreshProfile();
      toast.success('Nome atualizado.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível salvar o nome.');
    } finally {
      setSavingName(false);
    }
  };

  const handlePhotoPick = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Selecione uma imagem JPG, PNG ou WebP.');
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      toast.error('A foto deve ter no máximo 2 MB.');
      return;
    }
    setSavingPhoto(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      await vpsUpdateProfile({ photoBase64: dataUrl });
      await refreshProfile();
      toast.success('Foto atualizada.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível enviar a foto.');
    } finally {
      setSavingPhoto(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleRemovePhoto = async () => {
    setSavingPhoto(true);
    try {
      await vpsUpdateProfile({ removePhoto: true });
      await refreshProfile();
      toast.success('Foto removida.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível remover a foto.');
    } finally {
      setSavingPhoto(false);
    }
  };

  const handleChangeEmail = async () => {
    const email = newEmail.trim();
    if (!email.includes('@')) {
      toast.error('Informe um e-mail válido.');
      return;
    }
    if (!emailPassword) {
      toast.error('Confirme com a senha atual.');
      return;
    }
    setSavingEmail(true);
    try {
      await vpsChangeEmail(email, emailPassword);
      await refreshProfile();
      setNewEmail('');
      setEmailPassword('');
      toast.success('E-mail atualizado. Use o novo e-mail no próximo login.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível alterar o e-mail.');
    } finally {
      setSavingEmail(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword) {
      toast.error('Informe a senha atual.');
      return;
    }
    if (newPassword.length < 8) {
      toast.error('A nova senha deve ter no mínimo 8 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('A confirmação da nova senha não confere.');
      return;
    }
    setSavingPassword(true);
    try {
      await vpsChangePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('Senha alterada com sucesso.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível alterar a senha.');
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="relative shrink-0">
            {user?.photoURL ? (
              <img
                src={user.photoURL}
                alt=""
                className="w-20 h-20 rounded-2xl object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div
                className="w-20 h-20 rounded-2xl flex items-center justify-center text-white font-bold text-[22px]"
                style={{ background: 'linear-gradient(135deg, var(--brand-500), var(--brand-700))' }}
              >
                {initials}
              </div>
            )}
            {savingPhoto && (
              <div className="absolute inset-0 rounded-2xl flex items-center justify-center bg-black/40">
                <Loader2 className="w-6 h-6 animate-spin text-white" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-[200px] space-y-2">
            <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
              Foto de perfil
            </p>
            <p className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
              JPG, PNG ou WebP — até 2 MB.
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => void handlePhotoPick(e.target.files?.[0] || null)}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                leftIcon={<Camera className="w-3.5 h-3.5" />}
                disabled={savingPhoto}
                onClick={() => fileRef.current?.click()}
              >
                Trocar foto
              </Button>
              {user?.photoURL && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                  disabled={savingPhoto}
                  onClick={() => void handleRemovePhoto()}
                >
                  Remover
                </Button>
              )}
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          <User className="w-4 h-4" style={{ color: 'var(--text-3)' }} />
          <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
            Nome de exibição
          </p>
        </div>
        <Input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Seu nome"
          maxLength={80}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          leftIcon={savingName ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          disabled={savingName || displayName.trim() === (user?.displayName || '').trim()}
          onClick={() => void handleSaveName()}
        >
          {savingName ? 'Salvando…' : 'Salvar nome'}
        </Button>
      </Card>

      {!isStaff && (
        <Card className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4" style={{ color: 'var(--text-3)' }} />
            <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
              Trocar e-mail de login
            </p>
          </div>
          <p className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
            E-mail atual: <strong style={{ color: 'var(--text-2)' }}>{user?.email || '—'}</strong>
          </p>
          <Input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="Novo e-mail"
          />
          <Input
            type="password"
            value={emailPassword}
            onChange={(e) => setEmailPassword(e.target.value)}
            placeholder="Senha atual (confirmação)"
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={savingEmail || !newEmail.trim() || !emailPassword}
            onClick={() => void handleChangeEmail()}
          >
            {savingEmail ? 'Atualizando…' : 'Atualizar e-mail'}
          </Button>
        </Card>
      )}

      {isStaff && (
        <Card className="p-4">
          <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
            Como funcionário, o login usa o <strong>e-mail do gestor</strong>
            {vpsUser?.loginSlug ? (
              <>
                {' '}
                e o usuário <strong className="font-mono">{vpsUser.loginSlug}</strong>
              </>
            ) : null}
            . Para trocar o e-mail de acesso, peça ao gestor da conta.
          </p>
        </Card>
      )}

      <Card className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          <KeyRound className="w-4 h-4" style={{ color: 'var(--text-3)' }} />
          <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
            Trocar senha
          </p>
        </div>
        <Input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          placeholder="Senha atual"
        />
        <Input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="Nova senha (mín. 8 caracteres)"
        />
        <Input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="Confirmar nova senha"
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={
            savingPassword || !currentPassword || newPassword.length < 8 || !confirmPassword
          }
          onClick={() => void handleChangePassword()}
        >
          {savingPassword ? 'Alterando…' : 'Alterar senha'}
        </Button>
      </Card>
    </div>
  );
};
