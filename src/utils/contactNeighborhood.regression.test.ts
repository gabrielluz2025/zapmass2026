import { describe, expect, it } from 'vitest';
import { normalizeContactAddressFields } from './contactAddressNormalize';
import { matchCityOfficialNeighborhood } from '../../shared/officialNeighborhoods';

/**
 * Regressão: bairro real (Fortaleza, Água Verde) com cidade já preenchida (Blumenau)
 * estava virando "Jardim Blumenau" — o nome da cidade era usado como bairro e casava
 * por substring ("blumenau" ⊂ "jardimblumenau"). Não pode acontecer.
 */
describe('regressão bairro Blumenau (não corromper)', () => {
  it('city=Blumenau + bairro=Fortaleza mantém Fortaleza', () => {
    const r = normalizeContactAddressFields({
      city: 'Blumenau',
      state: 'SC',
      neighborhood: 'Fortaleza',
      phone: '5547999999999'
    });
    expect(r.city).toBe('Blumenau');
    expect(r.neighborhood).toBe('Fortaleza');
  });

  it('city=Blumenau + bairro=Água Verde mantém Água Verde', () => {
    const r = normalizeContactAddressFields({
      city: 'Blumenau',
      state: 'SC',
      neighborhood: 'Água Verde',
      phone: '5547999999999'
    });
    expect(r.city).toBe('Blumenau');
    expect(r.neighborhood).toBe('Água Verde');
  });

  it('o nome da cidade não é tratado como bairro oficial', () => {
    expect(matchCityOfficialNeighborhood('Blumenau', 'SC', 'Blumenau')).toBeNull();
  });

  it('bairro no campo cidade (city=Fortaleza) ainda resolve cidade=Blumenau', () => {
    const r = normalizeContactAddressFields({
      city: 'Fortaleza',
      state: 'SC',
      phone: '5547999999999'
    });
    expect(r.city).toBe('Blumenau');
    expect(r.neighborhood).toBe('Fortaleza');
  });

  it('Blumenau/SC + DDD 47 + bairro homônimo (Boa Vista) NÃO vira Curitiba/PR', () => {
    const r = normalizeContactAddressFields({
      city: 'Blumenau',
      state: 'SC',
      neighborhood: 'Boa Vista',
      phone: '5547999990000'
    });
    expect(r.city).toBe('Blumenau');
    expect(r.state).toBe('SC');
  });

  it('Blumenau/SC + DDD 47 + Bom Retiro NÃO vira Curitiba/PR', () => {
    const r = normalizeContactAddressFields({
      city: 'Blumenau',
      state: 'SC',
      neighborhood: 'Bom Retiro',
      phone: '5547999990000'
    });
    expect(r.city).toBe('Blumenau');
    expect(r.state).toBe('SC');
  });

  it('bairro só de Curitiba + DDD 41 ainda resolve Curitiba/PR', () => {
    const r = normalizeContactAddressFields({
      city: 'Batel',
      phone: '5541999990000'
    });
    expect(r.city).toBe('Curitiba');
    expect(r.state).toBe('PR');
  });
});
