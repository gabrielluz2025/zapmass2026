interface ValidationResult {
  isValid: boolean;
  normalized?: string;
  error?: string;
  suggestions?: string[];
}

export const validatePhoneNumber = (phone: string): ValidationResult => {
  // Limpar número
  let cleaned = phone.replace(/\D/g, '');
  
  // Verificar se está vazio
  if (!cleaned) {
    return { isValid: false, error: 'Número vazio' };
  }
  
  // Adicionar DDI Brasil se não tiver
  if (!cleaned.startsWith('55') && cleaned.length >= 10) {
    cleaned = `55${cleaned}`;
  }
  
  // Verificar comprimento mínimo
  if (cleaned.length < 12) {
    return { 
      isValid: false, 
      error: 'Número muito curto',
      suggestions: [cleaned.length === 11 ? `55${cleaned}` : null].filter(Boolean)
    };
  }
  
  // Verificar DDI
  if (!cleaned.startsWith('55')) {
    return { 
      isValid: false, 
      error: 'Apenas números brasileiros (DDI 55) são suportados',
      suggestions: [`55${cleaned}`]
    };
  }
  
  // Verificar DDD
  const ddd = cleaned.substring(2, 4);
  const validDDDs = [
    '11', '12', '13', '14', '15', '16', '17', '18', '19',
    '21', '22', '24', '27', '28',
    '31', '32', '33', '34', '35', '37', '38',
    '41', '42', '43', '44', '45', '46',
    '47', '48', '49',
    '51', '53', '54', '55',
    '61', '62', '63', '64', '65', '66', '67', '68', '69',
    '71', '73', '74', '75', '77', '79',
    '81', '82', '83', '84', '85', '86', '87', '88', '89',
    '91', '92', '93', '94', '95', '96', '97', '98', '99'
  ];
  
  if (!validDDDs.includes(ddd)) {
    return { 
      isValid: false, 
      error: `DDD ${ddd} inválido`,
      suggestions: validDDDs.slice(0, 3).map(d => cleaned.replace(ddd, d))
    };
  }
  
  // Verificar prefixo (não começa com 0, 1, 2, 3, 4, 5)
  const prefixo = cleaned.substring(4, 5);
  if (['0', '1', '2', '3', '4', '5'].includes(prefixo)) {
    return { 
      isValid: false, 
      error: 'Prefixo celular inválido (não pode começar com 0,1,2,3,4,5)'
    };
  }
  
  return { 
    isValid: true, 
    normalized: cleaned 
  };
};

export const validateBatchNumbers = (numbers: string[]): {
  valid: string[];
  invalid: { phone: string; error: string; suggestions?: string[] }[];
  total: number;
  successRate: number;
} => {
  const valid: string[] = [];
  const invalid: { phone: string; error: string; suggestions?: string[] }[] = [];
  
  numbers.forEach(phone => {
    const result = validatePhoneNumber(phone);
    if (result.isValid && result.normalized) {
      valid.push(result.normalized);
    } else {
      invalid.push({
        phone,
        error: result.error || 'Erro desconhecido',
        suggestions: result.suggestions
      });
    }
  });
  
  return {
    valid,
    invalid,
    total: numbers.length,
    successRate: (valid.length / numbers.length) * 100
  };
};
