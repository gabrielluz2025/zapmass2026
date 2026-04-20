# ✅ ZapMass v2.6.0 - Aquecimento Gratuito (Híbrido)

## Objetivo
Permitir envio gratuito sem serviços pagos, usando um fluxo híbrido:
1. Números já conhecidos → envio automático.
2. Números novos → entram na fila de aquecimento.

---

## Como funciona

### 1) Envio automático
Crie campanhas normalmente.  
Se o número já tem conversa anterior, o sistema envia sem intervenção.

### 2) Fila de aquecimento
Se aparecer erro **No LID for user**, o número é movido para **Aquecimento**.
Isso evita falhas repetidas e deixa o envio para depois.

### 3) Aquecer números (uma vez por número)
Use o script `AQUECER_NUMEROS.bat`:

1. Ele abre o WhatsApp Web **visível**.
2. Você pesquisa o número e abre a conversa (1 vez).
3. Volte ao sistema e clique **Marcar aquecido**.
4. O envio é reprocessado automaticamente.

---

## Fluxo recomendado

1. **Rodar envio normal** (`TESTAR_v2.4.1.bat`).
2. Ver a lista **Aquecimento** aparecer na tela de campanhas.
3. Rodar `AQUECER_NUMEROS.bat`.
4. Abrir conversas dos números pendentes.
5. Marcar como aquecido → envio automático.

---

## Dicas

- Faça aquecimento **uma única vez** por número.
- Depois disso, o sistema envia sem abrir navegador.
- Se o número não tem WhatsApp, ele continuará falhando.

---

## Arquivos úteis

- `TESTAR_v2.4.1.bat` → envio normal (headless)
- `AQUECER_NUMEROS.bat` → aquecimento (headful)

