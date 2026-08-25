# Tutorial: Proteção automática de chips (anti-banimento)

Guia completo sobre **como o ZapMass evita banimentos e suspensões automaticamente**, sem exigir ação manual do usuário.

---

## 1. O problema: chips caem “sem disparo”

O WhatsApp monitora padrões de automação. Mesmo sem campanha manual, o backend pode gerar stress:

| Fonte | Comportamento | Risco |
|-------|---------------|-------|
| Sync da inbox | Até 120 conversas × 200 mensagens ao conectar | **Alto** |
| syncFullHistory | Baixa histórico completo do celular na Evolution | **Alto** |
| Jornada de nutrição | Envios a cada 30 segundos | **Alto** |
| Auto-aquecimento | Mensagens periódicas entre chips | **Alto** |
| Auto-reconnect agressivo | Várias tentativas rápidas após queda | **Médio–Alto** |
| Múltiplos chips sync juntos | Stress simultâneo na API | **Médio** |

Ban confirmado no sistema: webhook `CONNECTION_UPDATE` com `401` / `loggedOut` → quarentena 24h no chip.

---

## 2. Solução: proteção automática (padrão)

### Camadas de proteção

| Camada | Quando | Efeito |
|--------|--------|--------|
| **Idle (sem campanha)** | Automático | Chips quietos: sync leve, sem jornada/aquecimento |
| **Campanha ativa** | Durante disparo | Monitora risco e **pode pausar/desacelerar** a campanha |
| **Por chip** | Ban/quarentena | Failover para outro chip; se todos caírem, pausa campanha |
| **Retomada** | A cada 60s | Retoma campanha quando chips/locks permitem |

### Proteção durante campanhas (novo)

O sistema **não ignora** campanhas em risco. Ações automáticas:

| Situação | Ação | Retomada |
|----------|------|----------|
| **Ban recente** (lock 48h) | Pausa campanha | Automática após cooldown |
| **Instabilidade** (3 quedas/30 min) + chips OK | Desacelera +90s/msg | Contínua |
| **Instabilidade** + nenhum chip OK | Pausa campanha | Quando lock expirar |
| **Todos chips offline/quarentena** | Pausa campanha | ~30 min ou horário agendado |
| **1 chip banido no pool** | Failover nos outros | Campanha continua |
| **≥60% falhas** (20 envios) | Pausa campanha | Manual ou automática* |

\*Jobs agendados para **outro dia** mantêm o horário original no BullMQ — pausar não recria a fila.

### Horários ao retomar

- Contatos agendados para **futuro** → disparam no horário planejado
- Contatos **prontos** na pausa → disparam logo ao retomar (pode haver pequeno pico)
- Cronograma diário (manhã/tarde/dias) → **preservado**

---

## 3. Reforço automático após incidentes

### Após banimento (401 / loggedOut)

- Lock de **48 horas** no workspace
- Sync **mínimo** (8 conv × 15 msgs)
- Auto-reconnect: **2 tentativas**, intervalo até 10 minutos

### Após 3 quedas em 30 minutos (“reconnect storm”)

- Lock de **6 horas**
- Sync mínimo + reconnect lento

Esses locks são **automáticos** — não exigem configuração.

---

## 4. Políticas disponíveis

| Política | Comportamento |
|----------|---------------|
| **Automático** (padrão) | Protege sem campanha; pausa com campanha |
| **Sempre protegido** | Sempre quieto — campanhas podem não enviar |
| **Desligado** | Sem proteção — só para uso avançado |

Alterar em: **Conexões → Proteção automática de chips → Política**

---

## 5. O que você NÃO precisa fazer

- Não precisa clicar “ativar” todo dia
- Não precisa desligar jornada manualmente entre campanhas (a proteção bloqueia os envios)
- Não precisa parar aquecimento manualmente (é parado automaticamente)

---

## 6. O que ainda depende de você

- **Campanhas em execução** — a proteção pausa para permitir envios; pause campanhas que não deveriam estar rodando
- **Respostas manuais e bot de suporte** — continuam (são respostas a mensagens recebidas, risco menor)
- **Reconectar muitos chips de uma vez** após deploy — evite se possível

---

## 7. Variáveis de ambiente na VPS (opcional, camada extra)

```env
# Política padrão para novos tenants (auto | always | off)
ZAPMASS_CHIP_PROTECTION_DEFAULT=auto

# Sync global mais conservador (complementa a proteção automática)
EVOLUTION_SYNC_FULL_HISTORY=0
WA_FULL_INBOX_SYNC=0
EVOLUTION_SYNC_MSG_PREFETCH=50
EVOLUTION_SYNC_SPARSE_CONV_LIMIT=15
WA_FULL_SYNC_COOLDOWN_HOURS=168
```

---

## 8. Boas práticas anti-banimento (conhecimento aprofundado)

### Volume e ritmo
- Delays entre mensagens: mínimo 15–45s em campanhas
- Limite diário por chip: respeite aquecimento em chips novos
- Evite mesmo texto para milhares de contatos (use spintax)

### Qualidade da base
- Valide WhatsApp antes de campanhar (`Corrigir base → Validar WhatsApp`)
- Remova opt-outs e números inválidos
- Leads frios + mensagem genérica = denúncia = ban

### Sessão e infra
- Um chip = um celular/sessão estável (evite conflito multi-device)
- Proxy consistente por chip (não trocar IP toda hora)
- Após deploy, não force sync completo em todos os chips

### Comportamento suspeito para o WhatsApp
- Envio em massa fora de horário comercial
- Links encurtados suspeitos em massa
- Mídia pesada para listas frias
- Mensagens idênticas em rajada

### O que o ZapMass faz por você
- Idle = quieto automaticamente
- Ban = cooldown 48h automático
- Instabilidade = proteção reforçada 6h
- Sync escalonado e leve quando protegido

---

## 9. Arquivos técnicos

| Arquivo | Função |
|---------|--------|
| `shared/chipProtection.ts` | Políticas e perfis de sync |
| `server/chipProtectionService.ts` | Lógica automática, locks, snapshot |
| `server/campaignGradualResume.ts` | Gradual resume anti-spike |
| `server/chipCircuitBreaker.ts` | Circuit breaker Redis ZSET |
| `server/chipTrustScore.ts` | Trust score tiers + delay dinâmico |
| `server/inboundAutomationGuard.ts` | Throttle inbound pós-ban |
| `server/chipProtectionScheduler.ts` | Verificação a cada 60s |
| `server/evolutionService.ts` | Reconnect, sync, dispatch integrado |
| `src/components/connections/ChipProtectionPanel.tsx` | UI de status |

---

## 10. Resumo em uma frase

**Deixe a política em “Automático”** — o ZapMass mantém chips quietos quando você não está disparando, reforça após ban/queda, e libera sozinho quando você inicia uma campanha.
