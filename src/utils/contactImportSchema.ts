/**
 * Schema Zod para validação de linhas na importação de contatos.
 * Centraliza regras e gera mensagens de erro padronizadas.
 */
import { z } from 'zod';

const PHONE_DIGITS_RE = /^\d{10,15}$/;
const BIRTHDAY_ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATE_RE = /^[A-Z]{2}$/;
const EMAIL_MAX = 254;

export const ContactImportRowSchema = z.object({
    name: z
        .string()
        .min(1, 'Nome ausente')
        .max(120, 'Nome muito longo (máx. 120 caracteres)')
        .refine((v) => /\S/.test(v), 'Nome não pode ser só espaços'),

    phone: z
        .string()
        .min(1, 'Telefone ausente')
        .transform((v) => v.replace(/\D/g, ''))
        .refine((v) => PHONE_DIGITS_RE.test(v), 'Telefone inválido (mín. 10 dígitos, máx. 15)'),

    email: z
        .string()
        .max(EMAIL_MAX, `E-mail muito longo (máx. ${EMAIL_MAX} caracteres)`)
        .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'E-mail inválido')
        .optional()
        .or(z.literal('')),

    birthday: z
        .string()
        .refine(
            (v) => !v || BIRTHDAY_ISO_RE.test(v),
            'Data de nascimento inválida (esperado AAAA-MM-DD)'
        )
        .optional()
        .or(z.literal('')),

    state: z
        .string()
        .refine((v) => !v || STATE_RE.test(v.toUpperCase()), 'UF inválida (use sigla de 2 letras)')
        .optional()
        .or(z.literal('')),

    tags: z.array(z.string().max(60, 'Tag muito longa (máx. 60 caracteres)')).optional(),
});

export type ContactImportRowInput = z.input<typeof ContactImportRowSchema>;
export type ContactImportRowOutput = z.output<typeof ContactImportRowSchema>;

/**
 * Valida uma linha importada.
 * Retorna `{ ok: true, data }` ou `{ ok: false, errors: string[] }`.
 */
export function validateImportRow(
    row: Record<string, unknown>
): { ok: true; data: ContactImportRowOutput } | { ok: false; errors: string[] } {
    const result = ContactImportRowSchema.safeParse(row);
    if (result.success) return { ok: true, data: result.data };
    const errors = result.error.issues.map((i) => i.message);
    return { ok: false, errors };
}
