# Guia: Emissão automática de Nota Fiscal

Este documento explica como ativar:

1. **Email de confirmação** após pagamento (Resend) — ativa hoje.
2. **NFS-e automática** emitida pela prefeitura (NFE.io) — ativa quando tiveres CNPJ.

---

## Parte 1 — Email de confirmação (Resend)

O ZapMass já tem o código pronto. Basta configurar.

### 1. Criar conta Resend

- Ir a <https://resend.com> → **Sign up** (Google/GitHub, grátis).
- Plano gratuito: **3.000 emails/mês** (mais do que suficiente para começar).

### 2. Obter a API Key

- Dashboard → **API Keys** → **Create API Key**.
- Nome: `zapmass-production` · Permissions: `Sending access` · Domain: `All Domains`.
- Copia a chave `re_xxxxxxxxxxxxx...` (só aparece uma vez).

### 3. Configurar domínio (opcional mas recomendado)

Se vais enviar de `no-reply@zap-mass.com`:

- Dashboard Resend → **Domains** → **Add Domain** → `zap-mass.com`.
- Aparecem 3 registos DNS (TXT SPF, TXT DKIM, TXT DMARC).
- Copiar e colar no painel do teu provedor de DNS (Cloudflare/Registro.br/etc.).
- Clicar **Verify DNS** (demora 5-30 min).

Sem domínio próprio? Podes testar com `onboarding@resend.dev` (só envia para o email da tua conta Resend — útil para dev, inútil em produção).

### 4. Adicionar no VPS

```bash
cd /opt/zapmass

# Editar .env
nano .env
```

Adicionar no final:

```env
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
EMAIL_FROM=ZapMass <no-reply@zap-mass.com>
EMAIL_REPLY_TO=suporte@zap-mass.com
```

Se estás a usar domínio de teste:

```env
EMAIL_FROM=ZapMass <onboarding@resend.dev>
```

### 5. Reiniciar containers

```bash
docker compose up -d --force-recreate
docker compose logs zapmass --tail 30 | grep -i resend
```

Deve aparecer: nada (bom) ou nenhum warning sobre `RESEND_API_KEY ausente`.

### 6. Testar

- Faz uma compra real (Pix é mais rápido de confirmar).
- Confirma que o email chega à inbox do pagador.
- Se não chegar, verifica pastas "Spam" / "Promoções".

---

## Parte 2 — NFS-e automática (NFE.io)

### Pré-requisitos (off-the-app)

Sem estes, **não é possível** emitir NFS-e em Brasil:

- [ ] **CNPJ ativo** (ME no Simples Nacional).
- [ ] **Inscrição municipal** na prefeitura do CNPJ.
- [ ] **Certificado digital A1 CNPJ** (comprar em Certisign, Serasa, Soluti, AC Safeweb — ~R$180/ano).
- [ ] **Conta NFE.io** com a empresa cadastrada + certificado carregado.
- [ ] **Código municipal do serviço** (o contador sabe; exemplos: SP "01.07" para "Análise e desenvolvimento de sistemas").

### Abrir o CNPJ rapidamente

Se ainda não tens CNPJ, usa um contador online 100% digital:

- **Contabilizei** — <https://www.contabilizei.com.br> · mensalidade R$79/mês · abertura ~5 dias
- **Agilize** — <https://agilize.com.br> · mensalidade R$89/mês · abertura rápida
- **Ponto Tech** — <https://www.pontotel.com.br> · voltado para SaaS

Diz ao contador:

> "Quero abrir uma ME no Simples Nacional, Anexo III, CNAE principal 6203-1/00 (desenvolvimento de software não-customizado). Vou faturar entre R$10k e R$40k/mês vendendo um SaaS chamado ZapMass. Preciso de inscrição municipal para emitir NFS-e."

Ele cuida de tudo, incluindo:

- Registro na Junta Comercial
- CNPJ na Receita Federal
- Inscrição municipal na prefeitura
- Alvará (se aplicável)
- DAS mensal (~6% sobre faturamento até R$180k/ano)

### 1. Configurar NFE.io

Depois de CNPJ ativo:

1. **Criar conta** em <https://nfe.io>.
2. **Adicionar empresa** → preencher dados do CNPJ (alguns puxam automático pela Receita).
3. **Upload do certificado digital A1** (.pfx) + senha.
4. **Ativar emissão na cidade** — NFE.io tem que "falar" com a prefeitura do teu município. Algumas já vêm integradas, outras requerem passos extra (ele avisa no painel).
5. Copiar o **Company ID** (uuid) — aparece na URL do dashboard da empresa.
6. **API Keys** → **Criar nova** → copiar a chave.

### 2. Descobrir o código municipal do serviço

Pergunta ao teu contador: *"Qual o código municipal do CNAE 6203 para emissão de NFS-e?"*

Exemplos:

| Cidade | Código | Descrição |
|---|---|---|
| São Paulo (SP) | `01.07` ou `01.05` | Análise e desenvolvimento de sistemas / Licenciamento de software |
| Rio de Janeiro (RJ) | `01.02` | Programação de computadores |
| Curitiba (PR) | `1.05` | Licenciamento de software |
| Belo Horizonte (MG) | `010500188` | Licenciamento de software |

### 3. Adicionar no VPS

```bash
cd /opt/zapmass
nano .env
```

Adicionar:

```env
NFE_IO_API_KEY=chave-obtida-no-nfe-io
NFE_IO_COMPANY_ID=uuid-da-empresa-no-nfe-io
NFE_IO_SERVICE_CODE=01.07
NFE_IO_ISS_RATE=2.0
```

### 4. Reiniciar

```bash
docker compose up -d --force-recreate
docker compose logs zapmass --tail 20 | grep -i nfe
```

Deve sumir o log *"NFE.io desativado"*.

### 5. Como funciona depois de ativo

```
Cliente compra → MP aprova pagamento
    ↓
Webhook /api/webhooks/mercadopago
    ↓
Extende assinatura no Firestore
    ↓
Chama NFE.io API com dados do payer (nome, email, CPF — vêm do MP)
    ↓
NFE.io envia para a prefeitura
    ↓
Prefeitura aprova em 1-5 minutos
    ↓
NFE.io envia email com PDF da NFS-e ao cliente
    ↓
ZapMass guarda URL do PDF na "Minha assinatura" do cliente
```

O cliente:

- Recebe **2 emails**: 1 do ZapMass (confirmação) + 1 do NFE.io (nota fiscal com PDF).
- Consegue baixar o PDF em **Minha assinatura → Nota fiscal → Baixar PDF**.

### 6. Custos estimados

| Item | Valor |
|---|---|
| Certificado A1 CNPJ | ~R$180/ano (~R$15/mês) |
| Contador (ME Simples) | R$79-400/mês |
| NFE.io — emissão | R$0,25 por nota |
| Imposto Simples Nacional | 6% sobre faturamento (até R$180k/ano) |

**Exemplo** com 100 vendas/mês a R$199,90 (R$19.990/mês):

- Imposto Simples: ~R$1.200/mês
- Contador: R$150/mês
- Certificado: R$15/mês
- NFE.io: R$25/mês (100 notas)
- **Total**: ~R$1.390/mês
- **Como PF (sem CNPJ)**: pagarias até R$5.500/mês só de IRPF.
- **Economia**: ~R$4.100/mês.

### 7. Troubleshooting

**"NFS-e fica em Processing e não avança"** → Prefeitura lenta ou código municipal errado. Abre ticket na NFE.io ou confirma o código com contador.

**"Erro: CPF inválido"** → O MP retorna o CPF do pagador no campo `payer.identification.number`. Se o cliente não preencher CPF no checkout, a nota não é emitida. O checkout do MP geralmente pede CPF automaticamente.

**"NFS-e rejeitada pela prefeitura"** → Pode ser:
- Código municipal errado → pergunta ao contador.
- Inscrição municipal pendente → confirma no portal da prefeitura.
- Certificado expirado → renova A1 (anual).

---

## Resumo

| Fase | O que fazer | Tempo |
|---|---|---|
| **Agora** | Configurar Resend + email de confirmação | 20 min |
| **Esta semana** | Contactar contador, iniciar abertura da ME | 1 contacto |
| **Em ~10 dias** | CNPJ ativo + certificado A1 + NFE.io | Aguardar |
| **Depois** | Adicionar envs NFE_IO_*, reiniciar | 5 min |

O código já está todo pronto — quando quiseres ativar, só é editar `.env`.
