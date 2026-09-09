const { test } = require('node:test');
const assert = require('node:assert');
const { Cloro } = require('../cloro-calc.js');

const d = (s) => new Date(s + 'T00:00:00Z');

test('lunesInicio devuelve el lunes de la semana que contiene el 1/8', () => {
  // 1/8/2025 cae viernes -> el lunes de esa semana es el 28/7
  assert.strictEqual(Cloro.lunesInicio(d('2025-08-01')).toISOString().slice(0, 10), '2025-07-28');
  // 1/8/2024 cae jueves -> 29/7
  assert.strictEqual(Cloro.lunesInicio(d('2024-08-01')).toISOString().slice(0, 10), '2024-07-29');
  // 1/8/2027 cae domingo: el lunes de SU semana es el 26/7, no el 2/8
  assert.strictEqual(Cloro.lunesInicio(d('2027-08-01')).toISOString().slice(0, 10), '2027-07-26');
});

test('un lunes es su propio lunes de inicio', () => {
  assert.strictEqual(Cloro.lunesInicio(d('2026-08-03')).toISOString().slice(0, 10), '2026-08-03');
});

test('la semana 1 es la del arranque', () => {
  assert.strictEqual(Cloro.semanaDe(d('2025-08-01'), d('2025-08-01')), 1);
  assert.strictEqual(Cloro.semanaDe(d('2025-07-28'), d('2025-08-01')), 1);
  assert.strictEqual(Cloro.semanaDe(d('2025-08-03'), d('2025-08-01')), 1);
  assert.strictEqual(Cloro.semanaDe(d('2025-08-04'), d('2025-08-01')), 2);
});

test('el pico de 2025-26 cae en la semana 23', () => {
  // verificado contra los .xls: la semana del 29/12/2025 al 4/1/2026
  assert.strictEqual(Cloro.semanaDe(d('2025-12-29'), d('2025-08-01')), 23);
  assert.strictEqual(Cloro.semanaDe(d('2026-01-04'), d('2025-08-01')), 23);
});

test('una fecha anterior al arranque da semana menor a 1', () => {
  assert.ok(Cloro.semanaDe(d('2025-07-20'), d('2025-08-01')) < 1);
});

test('semanasDeTemporada cubre hasta el ultimo dia', () => {
  // 28/7/2025 .. 31/3/2026 son 36 semanas empezadas
  assert.strictEqual(Cloro.semanasDeTemporada(d('2025-08-01'), d('2026-03-31')), 36);
});

// ─── Suavizado y crecimiento ─────────────────────────────────────────

test('suavizar con ventana 1 no toca nada', () => {
  assert.deepStrictEqual(Cloro.suavizar([1, 2, 3], 1), [1, 2, 3]);
});

test('suavizar promedia centrado y trunca en los bordes', () => {
  // [10,20,30,40,50] con ventana 3:
  //   borde: (10+20)/2=15 ; centro: (10+20+30)/3=20 ; ... ; borde: (40+50)/2=45
  assert.deepStrictEqual(Cloro.suavizar([10, 20, 30, 40, 50], 3), [15, 20, 30, 40, 45]);
});

test('suavizar aplasta el pico aislado, que es para lo que existe', () => {
  // el camion mayorista de una sola semana no debe predecir otro camion
  const r = Cloro.suavizar([0, 0, 100, 0, 0], 5);
  assert.strictEqual(r[2], 20);
});

test('suavizar no cambia el total cuando la ventana entra entera', () => {
  const r = Cloro.suavizar([10, 10, 10, 10, 10], 3);
  assert.deepStrictEqual(r, [10, 10, 10, 10, 10]);
});

test('crecimiento automatico compara el mismo tramo de las dos temporadas', () => {
  const r = Cloro.crecimiento({
    actual:   [100, 100, 100, 100],
    anterior: [80, 80, 80, 80, 80, 80],
    previa:   null,
    semanasCerradas: 4
  });
  assert.strictEqual(r.modo, 'auto');
  assert.ok(Math.abs(r.pct - 0.25) < 1e-9);
});

test('con menos de 4 semanas cerradas usa la temporada completa anterior', () => {
  const r = Cloro.crecimiento({
    actual:   [100, 100],
    anterior: [50, 50, 50, 50],     // total 200
    previa:   [40, 40, 40, 40],     // total 160  -> 200/160-1 = 0.25
    semanasCerradas: 2
  });
  assert.strictEqual(r.modo, 'temporada-completa');
  assert.ok(Math.abs(r.pct - 0.25) < 1e-9);
});

test('sin nada con que comparar el crecimiento es cero y lo dice', () => {
  const r = Cloro.crecimiento({ actual: [10], anterior: [], previa: null, semanasCerradas: 1 });
  assert.strictEqual(r.modo, 'sin-datos');
  assert.strictEqual(r.pct, 0);
});

test('un producto que el anio pasado no existia no divide por cero', () => {
  const r = Cloro.crecimiento({
    actual:   [100, 100, 100, 100],
    anterior: [0, 0, 0, 0],
    previa:   null,
    semanasCerradas: 4
  });
  assert.strictEqual(r.modo, 'sin-datos');
  assert.strictEqual(r.pct, 0);
});

// El caso real que rompio la temporada 2026-27: arrancada, 6 semanas
// cerradas y las ventas todavia sin importar. El cociente daba -100% y
// multiplicaba TODA la prevision por cero.
test('una temporada arrancada y sin ventas importadas no da -100%', () => {
  const r = Cloro.crecimiento({
    actual:   [0, 0, 0, 0, 0, 0],
    anterior: [80, 80, 80, 80, 80, 80, 80, 80],
    previa:   [80, 80, 80, 80, 80, 80, 80, 80],
    hayActual: false,
    semanasCerradas: 6
  });
  assert.notStrictEqual(r.modo, 'auto');
  assert.strictEqual(r.sinVentas, true);
  assert.ok(r.pct > -1);
});

test('sin ventas importadas y sin nada que heredar el crecimiento es cero', () => {
  const r = Cloro.crecimiento({
    actual:   [0, 0, 0, 0, 0, 0],
    anterior: [80, 80, 80, 80, 80, 80],
    previa:   null,
    hayActual: false,
    semanasCerradas: 6
  });
  assert.strictEqual(r.modo, 'sin-datos');
  assert.strictEqual(r.pct, 0);
});

// La otra cara: un cero CARGADO es una afirmacion, no una ausencia. Mismo
// criterio que el stock inicial, donde se mira si la fila existe.
test('con ventas cargadas en cero el -100% si es un dato', () => {
  const r = Cloro.crecimiento({
    actual:   [0, 0, 0, 0],
    anterior: [80, 80, 80, 80],
    previa:   null,
    hayActual: true,
    semanasCerradas: 4
  });
  assert.strictEqual(r.modo, 'auto');
  assert.strictEqual(r.pct, -1);
});

test('un crecimiento de -100% deja la prevision entera en cero', () => {
  // por que el -100% no puede entrar por descuido: no encoge la prevision,
  // la anula.
  const r = Cloro.prever({ anterior: [50, 60, 70], ventana: 1, crecimientoPct: -1, semanas: 3 });
  assert.deepStrictEqual(r, [0, 0, 0]);
});

// ─── Prevision, stock, sugerido y materia prima ──────────────────────

test('prever aplica el crecimiento sobre el historico suavizado', () => {
  const r = Cloro.prever({ anterior: [10, 10, 10, 10], ventana: 1, crecimientoPct: 0.2, semanas: 4 });
  assert.deepStrictEqual(r.map((x) => Math.round(x * 100) / 100), [12, 12, 12, 12]);
});

test('prever devuelve exactamente `semanas` valores y rellena con cero', () => {
  const r = Cloro.prever({ anterior: [10, 10], ventana: 1, crecimientoPct: 0, semanas: 4 });
  assert.strictEqual(r.length, 4);
  assert.strictEqual(r[3], 0);
});

test('prever suaviza antes de crecer, no despues', () => {
  // el pico de 100 en una sola semana se reparte; ninguna semana debe quedar en 120
  const r = Cloro.prever({ anterior: [0, 0, 100, 0, 0], ventana: 5, crecimientoPct: 0.2, semanas: 5 });
  assert.ok(r[2] < 30);
});

test('el stock proyectado usa ventas reales en lo cerrado y prevision en lo que viene', () => {
  const r = Cloro.proyectarStock({
    stockInicial: 100,
    ventas:    [30, 30, 0, 0],   // semanas 3 y 4 todavia no pasaron
    envasado:  [0, 50, 0, 0],
    prevision: [99, 99, 20, 20], // en lo cerrado no se debe mirar
    semanasCerradas: 2
  });
  // s1: 100 + 0 - 30 = 70 ; s2: 70 + 50 - 30 = 90
  // s3: 90 - 20 = 70       ; s4: 70 - 20 = 50
  assert.deepStrictEqual(r, [70, 90, 70, 50]);
});

test('el stock proyectado puede quedar negativo y no se recorta', () => {
  // un stock negativo es la senal de que falta envasar: taparlo en cero
  // esconderia justamente lo que el modulo viene a avisar
  const r = Cloro.proyectarStock({
    stockInicial: 10, ventas: [30], envasado: [0], prevision: [0], semanasCerradas: 1
  });
  assert.strictEqual(r[0], -20);
});

test('sugerido = demanda del horizonte + colchon - stock, redondeado al lote', () => {
  const p = new Array(20).fill(100);
  // demanda 8 sem = 800 ; colchon = 2 * (800/8) = 200 ; bruto = 1000 - 300 = 700
  assert.strictEqual(Cloro.sugerido({
    prevision: p, desdeSemana: 1, horizonte: 8, semanasSeguridad: 2, stockHoy: 300, lote: 1
  }), 700);
  assert.strictEqual(Cloro.sugerido({
    prevision: p, desdeSemana: 1, horizonte: 8, semanasSeguridad: 2, stockHoy: 300, lote: 250
  }), 750);
});

test('sugerido nunca es negativo', () => {
  const p = new Array(20).fill(10);
  assert.strictEqual(Cloro.sugerido({
    prevision: p, desdeSemana: 1, horizonte: 8, semanasSeguridad: 2, stockHoy: 99999, lote: 1
  }), 0);
});

test('sugerido arranca en desdeSemana y no en la semana 1', () => {
  const p = [1000, 1000, 10, 10, 10, 10];
  // desde la semana 3, horizonte 4 -> 10+10+10+10 = 40, sin colchon, sin stock
  assert.strictEqual(Cloro.sugerido({
    prevision: p, desdeSemana: 3, horizonte: 4, semanasSeguridad: 0, stockHoy: 0, lote: 1
  }), 40);
});

test('bajaRotacion marca los cuatro productos que no admiten prevision semanal', () => {
  // Cloro Granulado x 25 Kg: 31 unidades en 35 semanas -> 0,9 por semana
  const granulado25 = new Array(35).fill(0); granulado25[0] = 31;
  assert.strictEqual(Cloro.bajaRotacion(granulado25, 10), true);
  // el siguiente producto hacia arriba promedia 32 u/semana
  assert.strictEqual(Cloro.bajaRotacion(new Array(35).fill(32), 10), false);
});

test('kgMateria suma por materia prima', () => {
  const productos = [
    { id: 1, materia_id: 7, kg_mp_por_unidad: 1 },
    { id: 2, materia_id: 7, kg_mp_por_unidad: 0.9 },
    { id: 3, materia_id: 8, kg_mp_por_unidad: 2 }
  ];
  const r = Cloro.kgMateria(productos, { 1: 100, 2: 100, 3: 50 });
  // materia 7: 100*1 + 100*0.9 = 100 + 90 = 190 ; materia 8: 50*2 = 100
  assert.ok(Math.abs(r.porMateria[7] - 190) < 1e-9);
  assert.ok(Math.abs(r.porMateria[8] - 100) < 1e-9);
  assert.deepStrictEqual(r.sinAsignar, []);
});

test('los kg son el teorico puro, sin ningun recargo', () => {
  // Hubo un merma_pct que multiplicaba este numero. Se saco de la base y
  // del calculo; si alguna fila vieja lo trae igual, se ignora.
  const r = Cloro.kgMateria([{ id: 1, materia_id: 7, kg_mp_por_unidad: 2, merma_pct: 50 }], { 1: 10 });
  assert.strictEqual(r.porMateria[7], 20);
});

test('un producto sin materia prima no suma en ningun lado y se lista', () => {
  const productos = [
    { id: 1, materia_id: null, kg_mp_por_unidad: 1 },
    { id: 2, materia_id: 7,    kg_mp_por_unidad: 1 }
  ];
  const r = Cloro.kgMateria(productos, { 1: 500, 2: 10 });
  assert.deepStrictEqual(r.sinAsignar, [1]);
  assert.strictEqual(r.porMateria[7], 10);
  assert.strictEqual(Object.keys(r.porMateria).length, 1);
});

test('un producto sin kg por unidad cuenta como sin asignar', () => {
  const r = Cloro.kgMateria([{ id: 1, materia_id: 7, kg_mp_por_unidad: 0 }], { 1: 500 });
  assert.deepStrictEqual(r.sinAsignar, [1]);
});

// ─── La semana a la que corresponde el conteo del stock ──────────────

test('proyectarStock sin semanaBase se comporta igual que siempre', () => {
  // La compatibilidad no es un detalle: la tabla, el grafico y las fichas
  // llaman a esto sin el parametro nuevo.
  const r = Cloro.proyectarStock({
    stockInicial: 100, ventas: [30, 30, 0, 0], envasado: [0, 50, 0, 0],
    prevision: [99, 99, 20, 20], semanasCerradas: 2
  });
  assert.deepStrictEqual(r, [70, 90, 70, 50]);
});

test('proyectarStock: antes de la semana del conteo no inventa un stock', () => {
  // Si contamos en septiembre, que habia en agosto no lo sabemos. Un cero
  // ahi se leeria como "estaba vacio", que es una afirmacion que nadie hizo.
  const r = Cloro.proyectarStock({
    stockInicial: 100, ventas: [10, 10, 10, 10], envasado: [0, 0, 0, 0],
    prevision: [5, 5, 5, 5], semanasCerradas: 4, semanaBase: 3
  });
  assert.strictEqual(r[0], null);
  assert.strictEqual(r[1], null);
  assert.strictEqual(r[2], 90);   // 100 - 10
  assert.strictEqual(r[3], 80);   // 90 - 10
});

test('proyectarStock: el conteo del 8/9 no vuelve a restar lo vendido en agosto', () => {
  // El caso real que motivo esto. Cloro Granulado x 4 Kg: se contaron 11
  // unidades en la semana 7, con 16 vendidas en las semanas 1 a 6.
  const ventas    = [0, 3, 4, 2, 3, 4, 0];
  const prevision = [0, 0, 0, 0, 0, 0, 5];
  const args = { stockInicial: 11, ventas, envasado: [0, 0, 0, 0, 0, 0, 0],
                 prevision, semanasCerradas: 6 };
  // Sin la semana del conteo: 11 - 16 - 5 = -10, y el modulo grita
  // "FALTA ENVASAR" sobre un stock que en realidad esta bien.
  assert.strictEqual(Cloro.proyectarStock(args)[6], -10);
  // Con ella: el conteo es el saldo de apertura de la semana 7.
  const conBase = Cloro.proyectarStock(Object.assign({}, args, { semanaBase: 7 }));
  assert.strictEqual(conBase[6], 6);   // 11 - 5
  assert.strictEqual(conBase[5], null);
});

test('proyectarStock: una semanaBase de 1 es lo mismo que no ponerla', () => {
  const args = { stockInicial: 50, ventas: [10], envasado: [0], prevision: [0], semanasCerradas: 1 };
  assert.deepStrictEqual(Cloro.proyectarStock(Object.assign({}, args, { semanaBase: 1 })),
                         Cloro.proyectarStock(args));
});

// ─── El plan de envasado semana a semana ─────────────────────────────

test('planEnvasado: la primera semana del plan ES el sugerido parado ahi', () => {
  // Es la garantia de que no hay una segunda respuesta a "cuanto envasar".
  const prevision = new Array(20).fill(100);
  const plan = Cloro.planEnvasado({
    prevision, stockInicial: 0, ventas: [], envasado: [],
    semanasCerradas: 0, desdeSemana: 1, semanas: 20,
    horizonte: 8, semanasSeguridad: 2, lote: 1
  });
  const solo = Cloro.sugerido({ prevision, desdeSemana: 1, horizonte: 8,
                                semanasSeguridad: 2, stockHoy: 0, lote: 1 });
  assert.strictEqual(plan[0], solo);
});

test('planEnvasado: envasa el horizonte y despues solo repone', () => {
  // sem 1: demanda 8x100=800 + colchon 2x100=200 - stock 0 = 1000
  // sem 2: ya hay 900 en stock -> 1000 - 900 = 100, y se estabiliza ahi
  const plan = Cloro.planEnvasado({
    prevision: new Array(20).fill(100), stockInicial: 0, ventas: [], envasado: [],
    semanasCerradas: 0, desdeSemana: 1, semanas: 20,
    horizonte: 8, semanasSeguridad: 2, lote: 1
  });
  assert.strictEqual(plan[0], 1000);
  assert.strictEqual(plan[1], 100);
  assert.strictEqual(plan[2], 100);
});

test('planEnvasado: las semanas ya pasadas van en cero', () => {
  const plan = Cloro.planEnvasado({
    prevision: new Array(10).fill(100), stockInicial: 0, ventas: [], envasado: [],
    semanasCerradas: 2, desdeSemana: 3, semanas: 10,
    horizonte: 4, semanasSeguridad: 0, lote: 1
  });
  assert.strictEqual(plan[0], 0);
  assert.strictEqual(plan[1], 0);
  assert.ok(plan[2] > 0);
});

test('planEnvasado: redondea al lote y por eso la semana siguiente no pide nada', () => {
  // sem 1: bruto 1000, lote 300 -> 1200. Queda stock 1100, mas que los
  // 1000 que pide la semana 2, asi que no hay que envasar.
  const plan = Cloro.planEnvasado({
    prevision: new Array(20).fill(100), stockInicial: 0, ventas: [], envasado: [],
    semanasCerradas: 0, desdeSemana: 1, semanas: 20,
    horizonte: 8, semanasSeguridad: 2, lote: 300
  });
  assert.strictEqual(plan[0], 1200);
  assert.strictEqual(plan[1], 0);
});

test('planEnvasado: una orden de envasado ya cargada evita pedirla de nuevo', () => {
  // La orden real de 1000 en la semana 1 cubre exactamente lo que haria falta.
  const envasado = new Array(20).fill(0); envasado[0] = 1000;
  const plan = Cloro.planEnvasado({
    prevision: new Array(20).fill(100), stockInicial: 0, ventas: [], envasado,
    semanasCerradas: 0, desdeSemana: 1, semanas: 20,
    horizonte: 8, semanasSeguridad: 2, lote: 1
  });
  assert.strictEqual(plan[0], 0);
});

test('planEnvasado: sin nada que vender no hay nada que envasar', () => {
  const plan = Cloro.planEnvasado({
    prevision: new Array(10).fill(0), stockInicial: 0, ventas: [], envasado: [],
    semanasCerradas: 0, desdeSemana: 1, semanas: 10,
    horizonte: 8, semanasSeguridad: 2, lote: 1
  });
  assert.deepStrictEqual(plan, new Array(10).fill(0));
});

test('planEnvasado: arranca del conteo cuando el stock es de esa misma semana', () => {
  // semanaBase 3 = el conteo es de la semana 3, asi que el plan que
  // arranca en la 3 parte de esas 500 unidades y no de un null.
  const plan = Cloro.planEnvasado({
    prevision: new Array(10).fill(100), stockInicial: 500,
    ventas: new Array(10).fill(100), envasado: [],
    semanasCerradas: 2, semanaBase: 3, desdeSemana: 3, semanas: 10,
    horizonte: 4, semanasSeguridad: 0, lote: 1
  });
  // demanda de las semanas 3..6 = 400, stock 500 -> no hay que envasar
  assert.strictEqual(plan[2], 0);
});

// ─── kg de materia prima por semana y cobertura ──────────────────────

test('kgSemanal suma por materia, semana a semana', () => {
  const productos = [
    { id: 1, materia_id: 7, kg_mp_por_unidad: 2 },
    { id: 2, materia_id: 7, kg_mp_por_unidad: 0.5 },
    { id: 3, materia_id: 8, kg_mp_por_unidad: 1 }
  ];
  const r = Cloro.kgSemanal(productos, { 1: [10, 20], 2: [100, 0], 3: [5, 5] });
  // materia 7 -> sem1: 10*2 + 100*0.5 = 70 ; sem2: 20*2 + 0 = 40
  assert.deepStrictEqual(r.porMateria[7], [70, 40]);
  assert.deepStrictEqual(r.porMateria[8], [5, 5]);
  assert.deepStrictEqual(r.sinAsignar, []);
});

test('kgSemanal aplica la misma regla que kgMateria para lo que no se puede calcular', () => {
  const productos = [
    { id: 1, materia_id: null, kg_mp_por_unidad: 3 },
    { id: 2, materia_id: 7,    kg_mp_por_unidad: 0 },
    { id: 3, materia_id: 7,    kg_mp_por_unidad: 1 }
  ];
  const r = Cloro.kgSemanal(productos, { 1: [10], 2: [10], 3: [10] });
  assert.deepStrictEqual(r.sinAsignar, [1, 2]);
  assert.deepStrictEqual(r.porMateria[7], [10]);
});

test('kgSemanal y kgMateria dan el mismo total', () => {
  // La serie semanal sumada tiene que dar lo mismo que la cuenta de una
  // sola vez sobre el total de unidades. Si se separan, la tabla y el
  // grafico empiezan a decir cosas distintas.
  const productos = [{ id: 1, materia_id: 7, kg_mp_por_unidad: 2 }];
  const serie = Cloro.kgSemanal(productos, { 1: [3, 4, 5] }).porMateria[7];
  const total = serie.reduce((a, x) => a + x, 0);
  assert.strictEqual(total, Cloro.kgMateria(productos, { 1: 12 }).porMateria[7]);
});

test('cobertura: el stock que alcanza para toda la temporada lo dice', () => {
  const r = Cloro.cobertura({ kgSemana: [10, 10, 10], stock: 1000, desdeSemana: 1 });
  assert.strictEqual(r.alcanza, true);
  assert.strictEqual(r.semanas, 3);
  assert.strictEqual(r.hastaSemana, 3);
});

test('cobertura: se corta en la semana en que el acumulado pasa el stock', () => {
  // 100 + 100 = 200 entra en 250 ; +100 = 300 no entra
  const r = Cloro.cobertura({ kgSemana: [100, 100, 100, 100], stock: 250, desdeSemana: 1 });
  assert.strictEqual(r.alcanza, false);
  assert.strictEqual(r.semanas, 2);
  assert.strictEqual(r.hastaSemana, 2);
  assert.strictEqual(r.kgTotal, 200);
});

test('cobertura: una semana que no se cubre entera no cuenta', () => {
  // Con 100 kg y una semana que pide 150 la respuesta es CERO semanas.
  // Media semana de cloro no envasa nada.
  const r = Cloro.cobertura({ kgSemana: [150], stock: 100, desdeSemana: 1 });
  assert.strictEqual(r.semanas, 0);
  assert.strictEqual(r.hastaSemana, null);
  assert.strictEqual(r.alcanza, false);
});

test('cobertura: sin stock no hay cobertura', () => {
  const r = Cloro.cobertura({ kgSemana: [1, 1], stock: 0, desdeSemana: 1 });
  assert.strictEqual(r.semanas, 0);
  assert.strictEqual(r.alcanza, false);
});

test('cobertura: sin consumo, el stock cero alcanza igual', () => {
  // No es un caso de laboratorio: es una materia cuyos productos no se
  // envasan en lo que queda de temporada.
  const r = Cloro.cobertura({ kgSemana: [0, 0], stock: 0, desdeSemana: 1 });
  assert.strictEqual(r.alcanza, true);
  assert.strictEqual(r.semanas, 2);
});

test('cobertura: arranca en desdeSemana y no en la semana 1', () => {
  const r = Cloro.cobertura({ kgSemana: [9999, 100, 100], stock: 250, desdeSemana: 2 });
  assert.strictEqual(r.alcanza, true);
  assert.strictEqual(r.semanas, 2);
});
