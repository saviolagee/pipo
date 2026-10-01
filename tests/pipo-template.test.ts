import { describe, expect, it } from 'vitest';
import { evaluate, references, render, renderJson, renderText, TemplateError } from '../src/shared/template';

const ctx = {
  entrada: { leads: [{ email: 'a@x.com' }, { email: 'b@x.com' }] },
  passos: { puxar: { saida: { leads: [{ email: 'a@x.com', nome: 'Ana' }], total: 1 } }, vazio: { saida: [] } },
  segredo: { TOKEN: 'abc123' },
  pipo: { nome: 'Prospector' },
};

describe('templates do plano', () => {
  it('valor cru quando o texto é um único {{…}}', () => {
    expect(render('{{passos.puxar.saida.leads}}', ctx)).toEqual([{ email: 'a@x.com', nome: 'Ana' }]);
    expect(render('{{passos.puxar.saida.total}}', ctx)).toBe(1);
    expect(render('{{entrada.leads | length}}', ctx)).toBe(2);
    expect(render('{{entrada.leads[1].email}}', ctx)).toBe('b@x.com');
  });
  it('interpola texto e filtros', () => {
    expect(renderText('Oi {{passos.puxar.saida.leads | first}}!', ctx)).toBe('Oi {"email":"a@x.com","nome":"Ana"}!');
    expect(renderText('{{pipo.nome | upper}} enviou {{passos.puxar.saida.total}}', ctx)).toBe('PROSPECTOR enviou 1');
    expect(renderText('{{nada.aqui | default:zero}}', ctx)).toBe('zero');
  });
  it('segredos só onde permitido', () => {
    expect(() => render('Bearer {{segredo.TOKEN}}', ctx)).toThrow(TemplateError);
    expect(render('Bearer {{segredo.TOKEN}}', ctx, { allowSecrets: true })).toBe('Bearer abc123');
  });
  it('JSON com templates', () => {
    expect(renderJson('{"to": "{{entrada.leads[0].email}}", "n": "{{entrada.leads | length}}", "fixo": 3}', ctx)).toEqual({ to: 'a@x.com', n: 2, fixo: 3 });
    expect(renderJson('{"lista": {{entrada.leads | json}}}', ctx)).toEqual({ lista: ctx.entrada.leads });
  });
  it('condições do branch', () => {
    expect(evaluate('{{passos.vazio.saida | length}} == 0', ctx)).toBe(true);
    expect(evaluate('{{passos.puxar.saida.total}} > 0', ctx)).toBe(true);
    expect(evaluate('{{pipo.nome}} == Prospector', ctx)).toBe(true);
    expect(evaluate('{{pipo.nome}} != "Prospector"', ctx)).toBe(false);
    expect(evaluate('{{passos.vazio.saida}}', ctx)).toBe(false);
  });
  it('lista referências', () => {
    expect(references('a {{passos.x.saida | length}} b {{segredo.K}}')).toEqual(['passos.x.saida', 'segredo.K']);
  });
});
