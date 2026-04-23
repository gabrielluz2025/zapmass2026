/**
 * Emissao automatica de NFS-e (Nota Fiscal de Servico eletronica) via NFE.io.
 *
 * Docs: https://nfe.io/docs/nota-fiscal-servico/visao-geral/
 *
 * Config por env (todos obrigatorios para emitir; se ausentes, apenas loga e retorna null):
 *   NFE_IO_API_KEY       - chave API do NFE.io
 *   NFE_IO_COMPANY_ID    - id da empresa/emissor cadastrada no NFE.io
 *   NFE_IO_SERVICE_CODE  - codigo municipal do servico prestado (varia por prefeitura).
 *                          Exemplos comuns para SaaS: SP = "01.07", RJ = "01.02".
 *                          Consulta o teu contador para o codigo correto.
 *
 * Pre-requisitos do lado do vendedor (off-the-app):
 *   1. CNPJ ativo com inscricao municipal.
 *   2. Regime Simples Nacional (anexo III para SaaS e comum).
 *   3. Certificado digital A1 do CNPJ carregado no NFE.io.
 *   4. Empresa cadastrada no dashboard do NFE.io com os CNAEs correctos.
 *
 * Enquanto nao houver CNPJ nem credenciais NFE.io, este modulo fica desativado.
 * O codigo ja esta preparado: quando o utilizador adicionar as envs, activa.
 */

interface IssueInvoiceParams {
  /** UID Firebase para rastreio. */
  uid: string;
  /** Descricao do servico (ex.: "Assinatura ZapMass Pro - Mensal"). */
  description: string;
  /** Valor total em R$ (numero; ex.: 199.90). */
  amount: number;
  /** Referencia externa para ligar com o pagamento MP. */
  externalId: string;
  /** Dados do tomador (cliente que paga). */
  borrower: {
    email: string;
    name: string;
    /** CPF (11 digitos) ou CNPJ (14 digitos) - apenas numeros. */
    federalTaxNumber: string;
    address?: {
      country?: string;
      postalCode?: string;
      street?: string;
      number?: string;
      district?: string;
      city?: { code?: string; name?: string };
      state?: string;
    };
  };
}

export interface IssueInvoiceResult {
  id: string;
  status: string;
  /** URL publica do PDF da NFS-e emitida. */
  pdfUrl?: string;
  /** URL publica do XML. */
  xmlUrl?: string;
}

/** True quando o servico esta configurado e pronto para emitir NFS-e. */
export function isNfeEnabled(): boolean {
  return Boolean(
    process.env.NFE_IO_API_KEY?.trim() &&
      process.env.NFE_IO_COMPANY_ID?.trim() &&
      process.env.NFE_IO_SERVICE_CODE?.trim()
  );
}

/**
 * Emite uma NFS-e no NFE.io. Se o servico nao estiver configurado, retorna null.
 * A emissao e assincrona: o NFE.io retorna o id e status "Processing" e dispara
 * um webhook quando a nota e aprovada pela prefeitura (geralmente < 1 min, pode
 * demorar mais em prefeituras lentas). O PDF fica disponivel em `pdfUrl` apos
 * aprovacao.
 *
 * Nao lancamos erro em falha - apenas logamos e devolvemos null para nao
 * quebrar o fluxo de ativacao da assinatura.
 */
export async function issueInvoice(params: IssueInvoiceParams): Promise<IssueInvoiceResult | null> {
  if (!isNfeEnabled()) {
    console.log('[NFEService] NFE.io desativado - NFS-e nao emitida para uid', params.uid);
    return null;
  }

  const apiKey = process.env.NFE_IO_API_KEY!.trim();
  const companyId = process.env.NFE_IO_COMPANY_ID!.trim();
  const serviceCode = process.env.NFE_IO_SERVICE_CODE!.trim();

  /** Aliquotas default - sobrescreve via env se o regime mudar. Simples Nacional anexo III = ISS varia por municipio. */
  const issRate = parseFloat(process.env.NFE_IO_ISS_RATE || '2.0'); // %

  const body = {
    cityServiceCode: serviceCode,
    description: params.description,
    servicesAmount: params.amount,
    issRate,
    borrower: {
      email: params.borrower.email,
      name: params.borrower.name,
      federalTaxNumber: params.borrower.federalTaxNumber.replace(/\D/g, ''),
      address: params.borrower.address
    },
    additionalInformation: `Referencia: ${params.externalId} | uid: ${params.uid}`
  };

  try {
    const res = await fetch(`https://api.nfe.io/v1/companies/${companyId}/serviceinvoices`, {
      method: 'POST',
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const text = await res.text();
      console.error('[NFEService] NFE.io retornou', res.status, text);
      return null;
    }
    const data = (await res.json()) as Record<string, unknown>;
    const id = String(data.id || '');
    const status = String(data.status || 'Processing');
    const pdfUrl = typeof data.pdfUrl === 'string' ? data.pdfUrl : undefined;
    const xmlUrl = typeof data.xmlUrl === 'string' ? data.xmlUrl : undefined;
    console.log('[NFEService] NFS-e iniciada', id, status, 'para uid', params.uid);
    return { id, status, pdfUrl, xmlUrl };
  } catch (e) {
    console.error('[NFEService] Erro ao emitir NFS-e:', e);
    return null;
  }
}
