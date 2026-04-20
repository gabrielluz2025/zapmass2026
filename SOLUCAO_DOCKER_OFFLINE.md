# 🔧 Solução: Docker Desktop Offline

## ❌ **ERRO:**
```
failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine
```

## 🎯 **CAUSA:**
Docker Desktop não está rodando.

---

## ✅ **SOLUÇÕES (escolha uma):**

---

## 🚀 **SOLUÇÃO 1: Iniciar Docker Desktop** (Recomendado)

### **Passo 1: Abrir Docker Desktop**

1. Procure no menu Iniciar: "Docker Desktop"
2. Clique para abrir
3. Aguarde aparecer o ícone na bandeja (system tray)
4. Quando o ícone ficar verde/estável, Docker está pronto

**Tempo:** 30-60 segundos

### **Passo 2: Testar Docker**

```powershell
docker --version
docker ps
```

Se não der erro, está funcionando!

### **Passo 3: Executar novamente**

```powershell
INICIAR_ZAPMASS_v2.3.0.bat
# Escolha opção [1] Docker
```

---

## 🛠️ **SOLUÇÃO 2: Evolution API Manual (SEM Docker)**

### **Opção A: Clone do GitHub**

```powershell
# 1. Clone o repositório
git clone https://github.com/EvolutionAPI/evolution-api.git
cd evolution-api

# 2. Instale dependências
npm install

# 3. Copie configuração
cp dev-env.yml .env

# 4. Edite .env com Notepad:
notepad .env

# Adicione/modifique:
AUTHENTICATION_API_KEY=zapmass-secure-key-2026
SERVER_PORT=8080
LOG_LEVEL=INFO

# 5. Inicie o servidor
npm run start:dev
```

### **Opção B: NPM Global** (Mais Simples)

```powershell
# 1. Instalar globalmente
npm install -g evolution-api

# 2. Criar arquivo de configuração
mkdir evolution-config
cd evolution-config

# 3. Criar .env
echo AUTHENTICATION_API_KEY=zapmass-secure-key-2026 > .env
echo SERVER_PORT=8080 >> .env

# 4. Iniciar
evolution-api start
```

**⚠️ Nota:** Pode não funcionar se o pacote não estiver publicado como CLI global.

---

## 📱 **SOLUÇÃO 3: Usar Evolution API Online** (Temporário)

Use uma instância pública da Evolution API (apenas para testes):

### **Modificar ZapMass para usar API remota:**

**Arquivo:** `server/evolutionConfig.ts`

```typescript
export const evolutionConfig = {
    // Trocar:
    apiUrl: process.env.EVOLUTION_API_URL || 'http://localhost:8080',
    
    // Para (exemplo - não use em produção):
    apiUrl: process.env.EVOLUTION_API_URL || 'https://api.evolution-demo.com',
    
    // ...resto do código
};
```

**⚠️ NÃO RECOMENDADO PARA PRODUÇÃO!**

---

## 🔄 **SOLUÇÃO 4: Voltar para whatsapp-web.js** (Fallback)

Se nada funcionar, você pode voltar temporariamente:

```typescript
// server/server.ts, linha 9:
// Trocar:
import * as waService from './evolutionService.js';

// Para:
import * as waService from './whatsappService.js';
```

Depois:
```powershell
npm run dev
```

**Taxa de sucesso:** 60-70% (com markedUnread)

---

## 🎯 **RECOMENDAÇÃO:**

**Para seu caso:**

1. ✅ **Tente SOLUÇÃO 1** (Iniciar Docker Desktop)
   - Mais simples
   - Apenas aguardar Docker iniciar
   - 2 minutos de espera

2. ✅ **Se Docker não funcionar, use SOLUÇÃO 2A** (Clone GitHub)
   - Mais confiável
   - Você tem controle total
   - 10 minutos de setup

3. ⚠️ **Evite SOLUÇÃO 3** (API Online)
   - Inseguro
   - Apenas para testes rápidos

4. ❌ **SOLUÇÃO 4 é último recurso**
   - Volta para erro markedUnread
   - 60-70% de taxa de sucesso

---

## 📝 **GUIA PASSO A PASSO (SOLUÇÃO 2A - Recomendado)**

```powershell
# ==========================================
# INSTALAÇÃO MANUAL DA EVOLUTION API
# ==========================================

# 1. Abra um NOVO terminal PowerShell

# 2. Vá para uma pasta de trabalho
cd C:\

# 3. Clone o repositório
git clone https://github.com/EvolutionAPI/evolution-api.git

# 4. Entre na pasta
cd evolution-api

# 5. Instale dependências (pode demorar 2-3 minutos)
npm install

# 6. Copie configuração
Copy-Item dev-env.yml .env

# 7. Edite .env
notepad .env

# No Notepad, adicione no FINAL do arquivo:
# AUTHENTICATION_API_KEY=zapmass-secure-key-2026
# SERVER_PORT=8080
# LOG_LEVEL=INFO

# Salve e feche

# 8. Inicie o servidor
npm run start:dev

# Aguarde aparecer:
# "Server started on port 8080"

# 9. Em OUTRO terminal, inicie o ZapMass:
cd "C:\Users\xgame\OneDrive\Desktop\zapmass-sender novo"
npm run dev
```

---

## ✅ **VERIFICAR SE ESTÁ FUNCIONANDO:**

Abra no navegador:
```
http://localhost:8080/manager
```

Se aparecer uma interface, está funcionando!

---

## 🆘 **AINDA COM PROBLEMAS?**

Me diga:
1. Qual solução você tentou?
2. Qual foi o erro exato?
3. Docker Desktop está instalado?

---

**Escolha SOLUÇÃO 1 ou SOLUÇÃO 2A e me avise!**
