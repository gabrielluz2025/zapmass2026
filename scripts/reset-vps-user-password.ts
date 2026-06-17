/**
 * Redefine senha de owner VPS (zapmass.users).
 *
 * Uso na VPS (container demo ou main):
 *   RESET_EMAIL=dono@mail.com RESET_PASS=MinhaSenha123 npx tsx scripts/reset-vps-user-password.ts
 *   npx tsx scripts/reset-vps-user-password.ts dono@mail.com MinhaSenha123
 */
import dotenv from 'dotenv';
import { findUserByEmail, updateUserPassword } from '../server/auth/userRepository.js';
import { closeZapmassPool } from '../server/db/postgres.js';

dotenv.config();

async function main(): Promise<void> {
  const email = (process.env.RESET_EMAIL || process.argv[2] || '').trim();
  const pass = process.env.RESET_PASS || process.argv[3] || '';

  if (!email.includes('@') || !pass) {
    console.error('Uso: RESET_EMAIL=dono@mail.com RESET_PASS=MinhaSenha123 npx tsx scripts/reset-vps-user-password.ts');
    process.exit(2);
  }
  if (pass.length < 8) {
    console.error('A senha deve ter no mínimo 8 caracteres.');
    process.exit(2);
  }

  const user = await findUserByEmail(email);
  if (!user) {
    console.error('Utilizador não encontrado:', email);
    process.exit(1);
  }

  await updateUserPassword(user.id, pass);
  console.log('Senha definida para', user.email);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => closeZapmassPool());
