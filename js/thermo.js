// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 transpason
// このプログラムはフリーソフトウェアです。GNU一般公衆利用許諾書(GPL)バージョン3または
// それ以降のバージョンの条件で再配布・改変できます。無保証です。詳細は LICENSE を参照。
// ねつとすがた: 加熱・冷却のシミュレーション、ステージ定義、採点(DOMに依存しない純粋な関数だけを置く)
// 単位: 温度 ℃、時間 分、熱 J、質量 g、火力 J/分。
(function (root) {
  'use strict';

  // 物質データ。cs/cl = 固体/液体の比熱 [J/(g·℃)]、lf/lv = 融解/蒸発に要する熱 [J/g]。
  // lv はグラフを見やすくするため短縮した値(lvReal が実際の値)。設計書「沸騰の平らな部分」参照。
  const SUBSTANCES = {
    water:     { name: '水',           mp: 0,    bp: 100, cs: 2.1, cl: 4.2, lf: 334, lv: 700, lvReal: 2257, color: '#3b82f6' },
    palmitic:  { name: 'パルミチン酸', mp: 63,   bp: 351, cs: 1.8, cl: 2.3, lf: 212, lv: 300, color: '#a855f7' },
    ethanol:   { name: 'エタノール',   mp: -115, bp: 78,  cs: 1.1, cl: 2.4, lf: 108, lv: 300, lvReal: 841, color: '#f59e0b' },
    naphthalene: { name: 'ナフタレン', mp: 81,   bp: 218, cs: 1.3, cl: 1.7, lf: 148, lv: 300, color: '#64748b' },
    methanol:  { name: 'メタノール',   mp: -98,  bp: 65,  cs: 1.4, cl: 2.5, lf: 99,  lv: 400, lvReal: 1100, color: '#ec4899' },
    mixture:   { name: '水とエタノールの混合物', mixture: true, cl: 3.3, lv: 400, color: '#14b8a6' },
  };

  // 応用ステージで見せる「物質カード」(教科書の表にある値)
  const CARDS = [
    { name: '水', mp: 0, bp: 100 },
    { name: 'エタノール', mp: -115, bp: 78 },
    { name: 'メタノール', mp: -98, bp: 65 },
    { name: 'パルミチン酸', mp: 63, bp: 351 },
    { name: 'ナフタレン', mp: 81, bp: 218 },
    { name: '塩化ナトリウム', mp: 801, bp: 1413 },
  ];

  const PHASE_NAME = {
    solid: '固体', melting: '固体 → 液体', freezing: '液体 → 固体',
    liquid: '液体', boiling: '液体 → 気体', gas: '気体',
  };

  // 状態と温度から「今どの段階か」を返す(物質の融点・沸点は sub の値)
  function phaseOf(sub, T, frac) {
    if (frac.melt <= 0) return 'solid';
    if (frac.melt < 1) return null; // 呼び出し側で melting/freezing を決める
    if (frac.boil <= 0) return 'liquid';
    if (frac.boil < 1) return 'boiling';
    return 'gas';
  }

  // 加熱・冷却のシミュレーション。
  // spec: { sub: SUBSTANCES のキー or 物質オブジェクト, mass, T0, power(負なら冷却), tEnd, over: 物質の上書き }
  // 返り値: [{ t, T, phase, melt(とけた割合 0..1), boil(気体になった割合 0..1) }, ...](dt 分ごと)
  function simulate(spec, dt) {
    dt = dt || 0.02;
    const base = typeof spec.sub === 'string' ? SUBSTANCES[spec.sub] : spec.sub;
    const sub = Object.assign({}, base, spec.over || {});
    if (sub.mixture) return simulateMixture(sub, spec, dt);
    const m = spec.mass;
    let T = spec.T0;
    let melt = T < sub.mp ? 0 : 1;          // とけている割合
    let boil = T < sub.bp ? 0 : 1;          // 気体になった割合
    const out = [];
    const n = Math.round(spec.tEnd / dt);
    for (let i = 0; i <= n; i++) {
      const t = i * dt;
      let phase = phaseOf(sub, T, { melt, boil });
      if (phase === null) phase = spec.power >= 0 ? 'melting' : 'freezing';
      out.push({ t, T, phase, melt, boil });
      let q = spec.power * dt; // この dt で出入りする熱
      // 熱を使い切るまで、温度変化 → 状態変化 の順に配分する
      for (let guard = 0; guard < 6 && Math.abs(q) > 1e-9; guard++) {
        if (q > 0) {
          if (melt < 1 && T < sub.mp) { // 固体を温める
            const need = (sub.mp - T) * m * sub.cs;
            if (q < need) { T += q / (m * sub.cs); q = 0; } else { T = sub.mp; q -= need; }
          } else if (melt < 1) {         // とかす(温度一定)
            const need = (1 - melt) * m * sub.lf;
            if (q < need) { melt += q / (m * sub.lf); q = 0; } else { melt = 1; q -= need; }
          } else if (boil < 1 && T < sub.bp) { // 液体を温める
            const need = (sub.bp - T) * m * sub.cl;
            if (q < need) { T += q / (m * sub.cl); q = 0; } else { T = sub.bp; q -= need; }
          } else if (boil < 1) {         // 沸騰(温度一定)
            const need = (1 - boil) * m * sub.lv;
            if (q < need) { boil += q / (m * sub.lv); q = 0; } else { boil = 1; q -= need; }
          } else {                       // 気体を温める(このゲームのステージでは起きない)
            T += q / (m * 2.0); q = 0;
          }
        } else {
          const r = -q;
          if (melt > 0 && T > sub.mp) {  // 液体を冷やす
            const need = (T - sub.mp) * m * sub.cl;
            if (r < need) { T -= r / (m * sub.cl); q = 0; } else { T = sub.mp; q = -(r - need); }
          } else if (melt > 0) {         // こおらせる(温度一定)
            const need = melt * m * sub.lf;
            if (r < need) { melt -= r / (m * sub.lf); q = 0; } else { melt = 0; q = -(r - need); }
          } else {                       // 固体を冷やす
            T -= r / (m * sub.cs); q = 0;
          }
        }
      }
    }
    return out;
  }

  // 混合物(水+エタノール)。沸騰が始まると蒸気にエタノールが多く出ていき、液の沸点がじわじわ上がる。
  // 平らな部分がはっきりできないことを見せるための定性的なモデル。
  function simulateMixture(sub, spec, dt) {
    let water = spec.mass / 2, eth = spec.mass / 2;
    let T = spec.T0;
    const tb = () => {
      const x = eth / (water + eth);   // エタノールの割合(はじめ 0.5)
      return 100 - 20 * Math.pow(x / 0.5, 0.7);
    };
    const out = [];
    const n = Math.round(spec.tEnd / dt);
    for (let i = 0; i <= n; i++) {
      const t = i * dt;
      const b = tb();
      out.push({ t, T, phase: T >= b - 1e-6 ? 'boiling' : 'liquid', melt: 1, boil: 1 - (water + eth) / spec.mass });
      let q = spec.power * dt;
      const m = water + eth;
      if (T < b) {
        const need = (b - T) * m * sub.cl;
        if (q < need) { T += q / (m * sub.cl); q = 0; } else { T = b; q -= need; }
      }
      if (q > 0) {
        const x = eth / m;
        const dm = q / sub.lv;
        const de = Math.min(eth, dm * Math.min(1, 2.2 * x)); // 蒸気はエタノールが多い
        eth -= de; water -= dm - de;
        T = Math.max(T, tb());
      }
    }
    return out;
  }

  // シミュレーション結果から平らな部分(状態変化している区間)を取り出す
  function plateaus(curve) {
    const res = [];
    let cur = null;
    for (const p of curve) {
      const kind = p.phase === 'melting' || p.phase === 'freezing' ? 'melt' : p.phase === 'boiling' ? 'boil' : null;
      if (kind && cur && cur.kind === kind && Math.abs(p.T - cur.T) < 0.01) {
        cur.t1 = p.t;
      } else {
        if (cur) res.push(cur);
        cur = kind ? { kind, t0: p.t, t1: p.t, T: p.T } : null;
      }
    }
    if (cur) res.push(cur);
    return res.filter((pl) => pl.t1 - pl.t0 > 0.2); // 混合物のように温度が動き続ける区間は残らない
  }

  // まっすぐ温度が変わるだけ(平らにならない)という勘違いのグラフ
  function linearCurve(t0, T0, tEnd, T1, dt) {
    dt = dt || 0.02;
    const out = [];
    const n = Math.round(tEnd / dt);
    for (let i = 0; i <= n; i++) out.push({ t: i * dt, T: T0 + ((T1 - T0) * i) / n });
    return out;
  }

  // だんだん温まりにくくなるだけ(カーブして近づくが止まらない)という勘違いのグラフ
  function easeCurve(T0, tEnd, T1, dt) {
    dt = dt || 0.02;
    const out = [];
    const n = Math.round(tEnd / dt);
    const k = 3 / tEnd;
    const norm = 1 - Math.exp(-k * tEnd);
    for (let i = 0; i <= n; i++) {
      const t = i * dt;
      out.push({ t, T: T0 + ((T1 - T0) * (1 - Math.exp(-k * t))) / norm });
    }
    return out;
  }

  // 平らな部分を指定した温度に置いた折れ線(混合物ステージの勘違い用)
  function stepCurve(T0, tEnd, steps, Tend, dt) {
    // steps: [{T, len}] 平らになる温度と長さ(分)。残りの時間で一定の傾きで上がる。
    dt = dt || 0.02;
    const flat = steps.reduce((a, s) => a + s.len, 0);
    const rise = (Tend - T0) / (tEnd - flat);
    const out = [];
    const n = Math.round(tEnd / dt);
    let T = T0, si = 0, inFlat = 0;
    for (let i = 0; i <= n; i++) {
      out.push({ t: i * dt, T });
      if (si < steps.length && T >= steps[si].T) {
        T = steps[si].T;
        inFlat += dt;
        if (inFlat >= steps[si].len) { si++; inFlat = 0; T += 1e-6; }
      } else {
        T += rise * dt;
      }
    }
    return out;
  }

  // ---------- ステージ ----------
  // choices: 正解(simulate(spec))以外の3つ。{ label: 勘違いの説明, over/mass/power: spec の上書き } か { kind: 'linear'|'ease'|'steps', ... }
  // read: 読み取りで答える平らな部分('melt' | 'boil' | 'any' | 'none')
  // ref: 比べるために薄く表示する前のステージ
  const STAGES = [
    {
      id: 1, title: '氷をとかす',
      text: '−20℃の氷 100g を、弱火で加熱します。温度はどう変わるでしょう?',
      spec: { sub: 'water', mass: 100, T0: -20, power: 5000, tEnd: 12 }, heater: 'burner',
      choices: [
        { kind: 'linear', label: '平らにならず、まっすぐ上がり続ける' },
        { over: { mp: 20 }, label: '20℃で平らになる' },
        { kind: 'ease', label: 'だんだんゆるやかになるだけで、止まらない' },
      ],
      read: 'melt',
      learn: '氷は0℃でとけはじめ、全部とけるまで温度は0℃のまま。この温度を水の「融点」といいます。',
      quiz: {
        q: 'グラフが0℃で平らな間、ビーカーの中はどうなっている?',
        a: ['氷と水がまざっている(とけている途中)', '全部が氷のまま', '全部が水になっている'],
        why: '0℃で平らな間は、氷がとけている途中。加えた熱は氷を水に変えるのに使われるので、温度は上がりません。',
      },
    },
    {
      id: 2, title: '水を沸騰させる',
      text: '20℃の水 100g を加熱します。沸騰しても加熱を続けると、温度はどう変わるでしょう?',
      spec: { sub: 'water', mass: 100, T0: 20, power: 5000, tEnd: 12 }, heater: 'burner',
      choices: [
        { kind: 'linear', label: '沸騰しても温度は上がり続ける', Tend: 150 },
        { over: { bp: 80 }, label: '80℃で平らになる' },
        { kind: 'ease', label: 'だんだんゆるやかになるだけ', Tend: 100 },
      ],
      read: 'boil',
      learn: '水は100℃で沸騰し、沸騰している間は温度が100℃のまま。この温度を水の「沸点」といいます。',
      quiz: {
        q: '100℃で平らな間、加えた熱は何に使われている?',
        a: ['水を水蒸気(気体)に変えること', '水の温度を上げること', 'ビーカーを温めること'],
        why: '沸騰している間は、加えた熱が液体を気体に変えるのに使われるので、温度は上がりません。',
      },
    },
    {
      id: 3, title: '氷から沸騰まで',
      text: '−20℃の氷 100g を、水が沸騰するまで加熱し続けます。温度はどう変わるでしょう?',
      spec: { sub: 'water', mass: 100, T0: -20, power: 5000, tEnd: 22 }, heater: 'burner',
      choices: [
        { kind: 'linear', label: '平らにならず、まっすぐ上がり続ける' },
        { over: { lf: 0 }, label: '平らな部分は100℃の1回だけ' },
        { over: { mp: 20, bp: 80 }, label: '20℃と80℃で平らになる' },
      ],
      read: 'any',
      learn: '平らな部分が2回。0℃(融点)でとけ、100℃(沸点)で沸騰します。その間は液体の水です。',
      realRatio: true,
      quiz: {
        q: '50℃のとき、水は固体・液体・気体のどれ?',
        a: ['液体', '固体', '気体'],
        why: '融点(0℃)より高く、沸点(100℃)より低いので液体です。',
      },
    },
    {
      id: 4, title: '氷を2倍にすると?',
      text: 'ステージ1の氷を2倍の 200g にして、同じ火力で加熱します。(薄い線はステージ1の結果)',
      spec: { sub: 'water', mass: 200, T0: -20, power: 5000, tEnd: 20 }, heater: 'burner', ref: 1,
      choices: [
        { mass: 100, label: '量を増やしても、グラフは変わらない' },
        { over: { mp: 10 }, label: '量が多いと、平らになる温度が上がる' },
        { over: { mp: -10 }, power: 10000, label: '量が多いと、平らになる温度が下がり、平らな時間は変わらない' },
      ],
      read: 'melt',
      learn: '量が2倍になると、とかすのに必要な熱も2倍。平らな部分は長くなりますが、融点は0℃のまま変わりません。',
      quiz: {
        q: '氷の量を増やすと、融点はどうなる?',
        a: ['変わらない', '高くなる', '低くなる'],
        why: '融点は物質によって決まっていて、量を変えても変わりません。変わるのは、とけ終わるまでの時間です。',
      },
    },
    {
      id: 5, title: '強火にすると?',
      text: 'ステージ1と同じ氷 100g を、強火(2倍の火力)で加熱します。(薄い線はステージ1の結果)',
      spec: { sub: 'water', mass: 100, T0: -20, power: 10000, tEnd: 6 }, heater: 'burner-strong', ref: 1,
      choices: [
        { power: 5000, label: '火を強くしても、グラフは変わらない' },
        { over: { mp: 15 }, label: '強火だと、平らになる温度が上がる' },
        { kind: 'linear', label: '強火だと、平らにならずに一気に上がる' },
      ],
      read: 'melt',
      learn: '強火にすると温度の上がり方が急になり、平らな部分も短くなります。でも融点は0℃のまま変わりません。',
      quiz: {
        q: '火を強くすると、融点はどうなる?',
        a: ['変わらない', '高くなる', '低くなる'],
        why: '火の強さを変えても融点は変わりません。変わるのは、温度の上がる速さと、とけ終わるまでの時間です。',
      },
    },
    {
      id: 6, title: '水をこおらせる',
      text: '40℃の水 100g を、氷と食塩を入れた容器で冷やし続けます。温度はどう変わるでしょう?',
      spec: { sub: 'water', mass: 100, T0: 40, power: -5000, tEnd: 11 }, heater: 'cooler',
      choices: [
        { kind: 'linear', label: '平らにならず、まっすぐ下がり続ける' },
        { over: { mp: -10 }, label: '−10℃で平らになる' },
        { kind: 'ease', label: 'だんだんゆるやかになるだけ', Tend: -20 },
      ],
      read: 'melt',
      learn: '冷やすときも0℃で平らになります。液体が固体になる温度は、融点と同じ温度です。',
      quiz: {
        q: '0℃で平らな間、ビーカーの中はどうなっている?',
        a: ['水がこおっている途中(氷と水がまざっている)', '全部が水のまま', '全部が氷になっている'],
        why: '0℃で平らな間は、水が氷に変わっている途中。全部こおるまで温度は0℃のままです。',
      },
    },
    {
      id: 7, title: 'パルミチン酸をとかす',
      text: '20℃の固体のパルミチン酸 20g を、湯せんで加熱します。温度はどう変わるでしょう?',
      spec: { sub: 'palmitic', mass: 20, T0: 20, power: 1000, tEnd: 7 }, heater: 'bath',
      choices: [
        { over: { mp: 85 }, label: '85℃で平らになる' },
        { kind: 'linear', label: '平らにならず、まっすぐ上がり続ける' },
        { over: { mp: 40 }, label: '40℃で平らになる' },
      ],
      read: 'melt',
      learn: 'パルミチン酸の融点は約63℃。物質が変わると融点も変わります。',
      quiz: {
        q: 'パルミチン酸を40℃にすると、何の状態?',
        a: ['固体', '液体', '気体'],
        why: '40℃は融点(約63℃)より低いので、固体のままです。',
      },
    },
    {
      id: 8, title: 'エタノールを沸騰させる',
      text: '20℃のエタノール 20g を、湯せんで加熱します(火を直接近づけると危険)。温度はどう変わるでしょう?',
      spec: { sub: 'ethanol', mass: 20, T0: 20, power: 1000, tEnd: 7 }, heater: 'bath',
      choices: [
        { over: { bp: 100 }, label: '水と同じ100℃で沸騰する' },
        { kind: 'linear', label: '平らにならず、まっすぐ上がり続ける', Tend: 95 },
        { over: { bp: 50 }, label: '50℃で平らになる' },
      ],
      read: 'boil',
      learn: 'エタノールの沸点は約78℃。水(100℃)より低い温度で沸騰します。',
      quiz: {
        q: '90℃のお湯の中に入れたエタノールはどうなる?',
        a: ['沸騰して気体になる', '液体のまま', 'こおって固体になる'],
        why: '90℃は沸点(約78℃)より高いので、沸騰して気体になります。',
      },
    },
    {
      id: 9, title: '応用A なぞの固体X', mystery: true,
      text: 'なぞの固体X 20g(20℃)を湯せんで加熱して、融点を調べよう。物質カードから正体を当ててね。',
      spec: { sub: 'naphthalene', mass: 20, T0: 20, power: 1000, tEnd: 5 }, heater: 'bath',
      read: 'melt', answer: 'ナフタレン',
      learn: 'Xの融点は約81℃。融点が約81℃の物質はナフタレン。融点は物質ごとに決まっているので、物質を見分ける手がかりになります。',
      quiz: {
        q: 'Xを60℃にすると、何の状態?',
        a: ['固体', '液体', '気体'],
        why: '60℃は融点(約81℃)より低いので、固体です。',
      },
    },
    {
      id: 10, title: '応用B なぞの液体Y', mystery: true,
      text: 'なぞの液体Y 20g(20℃)を湯せんで加熱して、沸点を調べよう。物質カードから正体を当ててね。',
      spec: { sub: 'methanol', mass: 20, T0: 20, power: 1000, tEnd: 6 }, heater: 'bath',
      read: 'boil', answer: 'メタノール',
      learn: 'Yの沸点は約65℃。沸点が約65℃の物質はメタノール。エタノール(78℃)とも違う温度で沸騰します。',
      quiz: {
        q: 'Yは、20℃では何の状態?',
        a: ['液体', '固体', '気体'],
        why: '融点(−98℃)より高く、沸点(65℃)より低いので液体です。',
      },
    },
    {
      id: 11, title: 'おまけ 混合物を加熱', bonus: true,
      text: '20℃の水とエタノールの混合物 20g を、湯せんではなく弱火でじっくり加熱します。温度はどう変わるでしょう?',
      spec: { sub: 'mixture', mass: 20, T0: 20, power: 1000, tEnd: 10 }, heater: 'burner',
      choices: [
        { kind: 'steps', steps: [{ T: 78, len: 3 }, { T: 100, len: 2.5 }], Tend: 100, label: '78℃と100℃で平らになる' },
        { kind: 'steps', steps: [{ T: 78, len: 6 }], Tend: 88, label: '78℃(エタノールの沸点)で平らになる' },
        { kind: 'steps', steps: [{ T: 100, len: 3 }], Tend: 100, label: '100℃(水の沸点)で平らになる' },
      ],
      read: 'none',
      learn: '混合物は、沸騰が始まってもはっきり平らにならず、温度がじわじわ上がり続けます。決まった沸点がないのは混合物の特徴です。',
      quiz: {
        q: '純粋な物質と混合物で、加熱したときのグラフの違いは?',
        a: ['純粋な物質ははっきり平らになるが、混合物はならない', 'どちらもはっきり平らになる', '混合物のほうがはっきり平らになる'],
        why: '純粋な物質は融点・沸点が決まっているので平らになりますが、混合物は決まった温度で平らになりません。',
      },
    },
  ];

  // ステージの4択を作る。返り値: [{ curve, correct, label }](並びはシャッフル前)
  function choiceCurves(stage) {
    const correct = simulate(stage.spec);
    const last = correct[correct.length - 1];
    const res = [{ curve: correct, correct: true, label: '正解' }];
    for (const c of stage.choices || []) {
      let curve;
      const Tend = c.Tend !== undefined ? c.Tend : last.T;
      if (c.kind === 'linear') curve = linearCurve(0, stage.spec.T0, stage.spec.tEnd, Tend);
      else if (c.kind === 'ease') curve = easeCurve(stage.spec.T0, stage.spec.tEnd, Tend);
      else if (c.kind === 'steps') curve = stepCurve(stage.spec.T0, stage.spec.tEnd, c.steps, Tend);
      else {
        const spec = Object.assign({}, stage.spec, {
          over: Object.assign({}, stage.spec.over || {}, c.over || {}),
        });
        if (c.mass !== undefined) spec.mass = c.mass;
        if (c.power !== undefined) spec.power = c.power;
        curve = simulate(spec);
      }
      res.push({ curve, correct: false, label: c.label });
    }
    return res;
  }

  // 配列を並べ替える(rand は 0..1 を返す関数。テスト用に差し替えられる)
  function shuffle(arr, rand) {
    rand = rand || Math.random;
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const READ_TOLERANCE = 2; // 読み取りの許容誤差(℃)

  // 読み取りの採点。answer: { none: true } か { plateau(タップした平らな部分), kind: 'melt'|'boil', T }
  // 答えた種類と温度が、グラフにある平らな部分のどれかと合えば正解(タップした部分と別でもよい。
  // 例: ステージ3で100℃の部分をタップしても「融点 0℃」は正しい答え)。
  // 返り値: { ok, reason, target }
  //   reason: 'ok' | 'hasPlateau'(平らな部分があるのに「ない」) | 'noPlateau'(混合物などで平らな部分がない)
  //           | 'kind'(その種類の平らな部分がない/ステージが求める種類とちがう) | 'temp'(温度がずれている)
  //   target: 比べた正しい平らな部分
  function judgeReading(stage, pls, answer) {
    const wanted = pls.filter((p) => stage.read === 'any' || p.kind === stage.read);
    if (stage.read === 'none' || pls.length === 0) {
      return answer.none ? { ok: true, reason: 'ok', target: null } : { ok: false, reason: 'noPlateau', target: null };
    }
    if (answer.none || !answer.kind) return { ok: false, reason: 'hasPlateau', target: wanted[0] };
    const sameKind = wanted.filter((p) => p.kind === answer.kind);
    if (sameKind.length === 0) return { ok: false, reason: 'kind', target: wanted[0] };
    const near = sameKind.reduce((a, p) => (Math.abs(p.T - answer.T) < Math.abs(a.T - answer.T) ? p : a));
    if (Math.abs(near.T - answer.T) <= READ_TOLERANCE) return { ok: true, reason: 'ok', target: near };
    return { ok: false, reason: 'temp', target: near };
  }

  function checkReading(stage, pls, answer) {
    return judgeReading(stage, pls, answer).ok;
  }

  // 温度 T でその物質は何の状態か(融点・沸点ちょうどは状態変化中)
  function stateAt(sub, T) {
    const s = typeof sub === 'string' ? SUBSTANCES[sub] : sub;
    if (T < s.mp) return 'solid';
    if (T === s.mp) return 'melting';
    if (T < s.bp) return 'liquid';
    if (T === s.bp) return 'boiling';
    return 'gas';
  }

  // グラフの目盛り幅を決める(範囲に応じて 5/10/20/50℃)
  function niceStep(range, maxTicks) {
    maxTicks = maxTicks || 8;
    for (const s of [1, 2, 5, 10, 20, 50, 100]) if (range / s <= maxTicks) return s;
    return 200;
  }

  // 曲線の集合が収まる温度軸の範囲(目盛りの切りのよい値に広げる)
  function tempRange(curves) {
    let lo = Infinity, hi = -Infinity;
    for (const c of curves) for (const p of c) { lo = Math.min(lo, p.T); hi = Math.max(hi, p.T); }
    let step = niceStep(hi - lo);
    let a = lo, b = hi;
    for (let k = 0; k < 4; k++) { // 広げたら目盛り幅が変わることがあるので、落ち着くまでくり返す
      a = Math.floor((lo - step * 0.3) / step) * step + 0; // + 0 で −0 を 0 にする
      b = Math.ceil((hi + step * 0.3) / step) * step + 0;
      const s2 = niceStep(b - a);
      if (s2 === step) break;
      step = s2;
    }
    return { lo: a, hi: b, step };
  }

  // ☆の数(各段階で正解したかどうかの真偽値3つ)
  function stars(results) {
    return results.filter(Boolean).length;
  }

  const api = {
    SUBSTANCES, CARDS, PHASE_NAME, STAGES, READ_TOLERANCE,
    simulate, plateaus, linearCurve, easeCurve, stepCurve,
    choiceCurves, shuffle, judgeReading, checkReading, stateAt, niceStep, tempRange, stars,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Thermo = api;
})(typeof window !== 'undefined' ? window : globalThis);
