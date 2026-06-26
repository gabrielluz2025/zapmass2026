export type DddLocation = {
  lat: number;
  lng: number;
  city: string;
  state: string;
};

export const DDD_COORDINATES: Record<string, DddLocation> = {
  '11': { lat: -23.5505, lng: -46.6333, city: 'São Paulo', state: 'SP' },
  '12': { lat: -23.1791, lng: -45.8872, city: 'São José dos Campos', state: 'SP' },
  '13': { lat: -23.9608, lng: -46.3331, city: 'Santos', state: 'SP' },
  '14': { lat: -22.3145, lng: -49.0602, city: 'Bauru', state: 'SP' },
  '15': { lat: -23.5015, lng: -47.4526, city: 'Sorocaba', state: 'SP' },
  '16': { lat: -21.1775, lng: -47.8103, city: 'Ribeirão Preto', state: 'SP' },
  '17': { lat: -20.8113, lng: -49.3758, city: 'São José do Rio Preto', state: 'SP' },
  '18': { lat: -22.1256, lng: -51.3889, city: 'Presidente Prudente', state: 'SP' },
  '19': { lat: -22.9099, lng: -47.0626, city: 'Campinas', state: 'SP' },
  '21': { lat: -22.9068, lng: -43.1729, city: 'Rio de Janeiro', state: 'RJ' },
  '22': { lat: -21.7542, lng: -41.3244, city: 'Campos dos Goytacazes', state: 'RJ' },
  '24': { lat: -22.5112, lng: -43.1778, city: 'Petrópolis', state: 'RJ' },
  '27': { lat: -20.3155, lng: -40.3128, city: 'Vitória', state: 'ES' },
  '28': { lat: -20.8489, lng: -41.1128, city: 'Cachoeiro de Itapemirim', state: 'ES' },
  '31': { lat: -19.9173, lng: -43.9345, city: 'Belo Horizonte', state: 'MG' },
  '32': { lat: -21.7586, lng: -43.3438, city: 'Juiz de Fora', state: 'MG' },
  '33': { lat: -18.8524, lng: -41.9494, city: 'Governador Valadares', state: 'MG' },
  '34': { lat: -18.9186, lng: -48.2772, city: 'Uberlândia', state: 'MG' },
  '35': { lat: -21.7892, lng: -46.5622, city: 'Poços de Caldas', state: 'MG' },
  '37': { lat: -20.1434, lng: -44.8906, city: 'Divinópolis', state: 'MG' },
  '38': { lat: -16.7292, lng: -43.8617, city: 'Montes Claros', state: 'MG' },
  '41': { lat: -25.4290, lng: -49.2671, city: 'Curitiba', state: 'PR' },
  '42': { lat: -25.0950, lng: -50.1619, city: 'Ponta Grossa', state: 'PR' },
  '43': { lat: -23.3103, lng: -51.1628, city: 'Londrina', state: 'PR' },
  '44': { lat: -23.4210, lng: -51.9331, city: 'Maringá', state: 'PR' },
  '45': { lat: -24.9558, lng: -53.4553, city: 'Cascavel', state: 'PR' },
  '46': { lat: -25.1147, lng: -53.0553, city: 'Francisco Beltrão', state: 'PR' },
  '47': { lat: -26.9150, lng: -49.0656, city: 'Blumenau', state: 'SC' },
  '48': { lat: -27.5954, lng: -48.5480, city: 'Florianópolis', state: 'SC' },
  '49': { lat: -27.1004, lng: -52.6152, city: 'Chapecó', state: 'SC' },
  '51': { lat: -30.0346, lng: -51.2177, city: 'Porto Alegre', state: 'RS' },
  '53': { lat: -31.7654, lng: -52.3376, city: 'Pelotas', state: 'RS' },
  '54': { lat: -29.1681, lng: -51.1794, city: 'Caxias do Sul', state: 'RS' },
  '55': { lat: -29.6842, lng: -53.8069, city: 'Santa Maria', state: 'RS' },
  '61': { lat: -15.7942, lng: -47.8822, city: 'Brasília', state: 'DF' },
  '62': { lat: -16.6869, lng: -49.2648, city: 'Goiânia', state: 'GO' },
  '63': { lat: -10.1674, lng: -48.3277, city: 'Palmas', state: 'TO' },
  '64': { lat: -17.7855, lng: -50.9208, city: 'Rio Verde', state: 'GO' },
  '65': { lat: -15.6010, lng: -56.0974, city: 'Cuiabá', state: 'MT' },
  '66': { lat: -16.4674, lng: -54.6360, city: 'Rondonópolis', state: 'MT' },
  '67': { lat: -20.4697, lng: -54.6201, city: 'Campo Grande', state: 'MS' },
  '68': { lat: -9.9749, lng: -67.8076, city: 'Rio Branco', state: 'AC' },
  '69': { lat: -8.7619, lng: -63.9039, city: 'Porto Velho', state: 'RO' },
  '71': { lat: -12.9714, lng: -38.5014, city: 'Salvador', state: 'BA' },
  '73': { lat: -14.7935, lng: -39.0464, city: 'Ilhéus', state: 'BA' },
  '74': { lat: -9.4124, lng: -40.5096, city: 'Juazeiro', state: 'BA' },
  '75': { lat: -12.2664, lng: -38.9662, city: 'Feira de Santana', state: 'BA' },
  77: { lat: -12.1486, lng: -44.9912, city: 'Barreiras', state: 'BA' },
  79: { lat: -14.8617, lng: -40.8437, city: 'Vitória da Conquista', state: 'BA' },
  81: { lat: -9.8465, lng: -67.7944, city: 'Aracaju', state: 'SE' },
  82: { lat: -9.6658, lng: -35.7350, city: 'Maceió', state: 'AL' },
  83: { lat: -7.1195, lng: -34.8450, city: 'João Pessoa', state: 'PB' },
  84: { lat: -5.7945, lng: -35.2110, city: 'Natal', state: 'RN' },
  85: { lat: -3.7172, lng: -38.5434, city: 'Fortaleza', state: 'CE' },
  86: { lat: -5.0920, lng: -42.8038, city: 'Teresina', state: 'PI' },
  87: { lat: -8.0542, lng: -34.8813, city: 'Recife', state: 'PE' },
  88: { lat: -7.2244, lng: -39.3142, city: 'Juazeiro do Norte', state: 'CE' },
  89: { lat: -7.0772, lng: -41.4681, city: 'Picos', state: 'PI' },
  91: { lat: -1.4558, lng: -48.4902, city: 'Belém', state: 'PA' },
  92: { lat: -3.1190, lng: -60.0217, city: 'Manaus', state: 'AM' },
  93: { lat: -2.4431, lng: -54.7083, city: 'Santarém', state: 'PA' },
  94: { lat: -5.3686, lng: -49.1245, city: 'Marabá', state: 'PA' },
  95: { lat: -2.8197, lng: -60.6732, city: 'Boa Vista', state: 'RR' },
  96: { lat: 0.0349, lng: -51.0694, city: 'Macapá', state: 'AP' },
  97: { lat: -3.3547, lng: -64.7114, city: 'Tefé', state: 'AM' },
  98: { lat: -2.5307, lng: -44.3068, city: 'São Luís', state: 'MA' },
  99: { lat: -5.5264, lng: -47.4764, city: 'Imperatriz', state: 'MA' },
};

/** Extrai o DDD de um telefone brasileiro e retorna suas coordenadas e cidade correspondente. */
export function getDddCoordinates(phone: string): DddLocation | null {
  if (!phone) return null;
  // Limpa o telefone deixando apenas dígitos
  const clean = phone.replace(/\D/g, '');
  
  // O telefone brasileiro com DDI 55 tem pelo menos 10 dígitos (ex: 5511999999999 ou 551188887777)
  let ddd = '';
  if (clean.startsWith('55') && clean.length >= 12) {
    ddd = clean.slice(2, 4);
  } else if (clean.length >= 10) {
    ddd = clean.slice(0, 2);
  }
  
  if (ddd && DDD_COORDINATES[ddd]) {
    return DDD_COORDINATES[ddd]!;
  }
  
  return null;
}
