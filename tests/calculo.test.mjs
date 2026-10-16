import test from 'node:test';
import assert from 'node:assert/strict';

import { calcularColumna } from '../js/calculo.js';

test('conserva el caso rectangular de ocho barras', () => {
  const resultado = calcularColumna({
    tipo: 'rectangular',
    b: 30,
    h: 50,
    fc: 210,
    fy: 4200,
    metodo: 'cuantia',
    cuantia: 1,
    varilla: '5/8',
    recubrimiento: 4
  });

  assert.equal(resultado.ok, true);
  assert.equal(resultado.barras.n, 8);
  assert.equal(resultado.acero.asRequerido, 15);
  assert.equal(resultado.acero.asColocado, 16);
});
