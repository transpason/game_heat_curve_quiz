// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 transpason
// このプログラムはフリーソフトウェアです。GNU一般公衆利用許諾書(GPL)バージョン3または
// それ以降のバージョンの条件で再配布・改変できます。無保証です。詳細は LICENSE を参照。
// 実行: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const TH = require('../js/thermo.js');

const stage = (id) => TH.STAGES.find((s) => s.id === id);

test('氷を加熱すると0℃で平らになり、その間は温度が変わらない', () => {
  const c = TH.simulate(stage(1).spec);
  const pls = TH.plateaus(c);
  assert.equal(pls.length, 1);
  assert.equal(pls[0].kind, 'melt');
  assert.equal(pls[0].T, 0);
  for (const p of c) if (p.t > pls[0].t0 && p.t < pls[0].t1) assert.equal(p.T, 0);
  assert.equal(c[0].phase, 'solid');
  assert.equal(c[c.length - 1].phase, 'liquid');
});

test('氷から沸騰まで: 融点0℃と沸点100℃の2回平らになる', () => {
  const pls = TH.plateaus(TH.simulate(stage(3).spec));
  assert.deepEqual(pls.map((p) => [p.kind, p.T]), [['melt', 0], ['boil', 100]]);
});

test('量を2倍にすると平らな時間は2倍、融点は同じ', () => {
  const p1 = TH.plateaus(TH.simulate(stage(1).spec))[0];
  const p4 = TH.plateaus(TH.simulate(stage(4).spec))[0];
  assert.equal(p4.T, p1.T);
  assert.ok(Math.abs((p4.t1 - p4.t0) / (p1.t1 - p1.t0) - 2) < 0.02);
});

test('火力を2倍にすると平らな時間は半分、融点は同じ', () => {
  const p1 = TH.plateaus(TH.simulate(stage(1).spec))[0];
  const p5 = TH.plateaus(TH.simulate(stage(5).spec))[0];
  assert.equal(p5.T, p1.T);
  assert.ok(Math.abs((p5.t1 - p5.t0) / (p1.t1 - p1.t0) - 0.5) < 0.02);
});

test('冷やすときも0℃で平らになり、最後は固体', () => {
  const c = TH.simulate(stage(6).spec);
  const pls = TH.plateaus(c);
  assert.equal(pls.length, 1);
  assert.equal(pls[0].T, 0);
  assert.equal(c[c.length - 1].phase, 'solid');
  assert.ok(c.some((p) => p.phase === 'freezing'));
});

test('物質ごとの融点・沸点で平らになる', () => {
  const want = { 7: ['melt', 63], 8: ['boil', 78], 9: ['melt', 81], 10: ['boil', 65] };
  for (const [id, [kind, T]] of Object.entries(want)) {
    const pls = TH.plateaus(TH.simulate(stage(Number(id)).spec));
    assert.deepEqual(pls.map((p) => [p.kind, p.T]), [[kind, T]], 'ステージ' + id);
  }
});

test('混合物は平らな部分ができず、沸騰が始まっても温度が上がり続ける', () => {
  const c = TH.simulate(stage(11).spec);
  assert.equal(TH.plateaus(c).length, 0);
  const boiling = c.filter((p) => p.phase === 'boiling');
  assert.ok(boiling.length > 50);
  assert.ok(boiling[boiling.length - 1].T - boiling[0].T > 8);
});

test('どのステージでも4択の正解は1つだけで、不正解は正解と形がちがう', () => {
  for (const st of TH.STAGES.filter((s) => !s.mystery)) {
    const ch = TH.choiceCurves(st);
    assert.equal(ch.length, 4, st.title);
    assert.equal(ch.filter((c) => c.correct).length, 1, st.title);
    const ok = ch[0].curve;
    for (const c of ch.slice(1)) {
      let diff = 0;
      for (let i = 0; i < Math.min(ok.length, c.curve.length); i++) diff = Math.max(diff, Math.abs(ok[i].T - c.curve[i].T));
      assert.ok(diff > 5, st.title + ': ' + c.label);
    }
  }
});

test('読み取りの採点: 種類と温度(±2℃)が合えば正解', () => {
  const st = stage(3);
  const pls = TH.plateaus(TH.simulate(st.spec));
  const boil = pls[1];
  assert.ok(TH.checkReading(st, pls, { plateau: boil, kind: 'boil', T: 101 }));
  assert.ok(!TH.checkReading(st, pls, { plateau: boil, kind: 'boil', T: 97 }));
  assert.ok(!TH.checkReading(st, pls, { plateau: boil, kind: 'melt', T: 100 }));
  assert.ok(!TH.checkReading(st, pls, { none: true }));
  const st1 = stage(2);
  const pls1 = TH.plateaus(TH.simulate(st1.spec));
  assert.ok(TH.checkReading(st1, pls1, { plateau: pls1[0], kind: 'boil', T: 100 }));
  const mix = stage(11);
  assert.ok(TH.checkReading(mix, [], { none: true }));
});

test('融点・沸点から温度ごとの状態がわかる', () => {
  assert.equal(TH.stateAt('water', 50), 'liquid');
  assert.equal(TH.stateAt('water', -5), 'solid');
  assert.equal(TH.stateAt('water', 120), 'gas');
  assert.equal(TH.stateAt('palmitic', 40), 'solid');
  assert.equal(TH.stateAt('ethanol', 90), 'gas');
});

test('ふりかえり問題はどれも選択肢3つ、応用ステージの答えは物質カードにある', () => {
  for (const st of TH.STAGES) {
    assert.equal(st.quiz.a.length, 3, st.title);
    if (st.mystery) {
      const card = TH.CARDS.find((c) => c.name === st.answer);
      assert.ok(card, st.title);
      const pl = TH.plateaus(TH.simulate(st.spec))[0];
      assert.equal(pl.T, st.read === 'melt' ? card.mp : card.bp);
    }
  }
});

test('温度軸の範囲は全部の曲線を含み、0℃の目盛りを通る', () => {
  for (const st of TH.STAGES) {
    const curves = st.mystery ? [TH.simulate(st.spec)] : TH.choiceCurves(st).map((c) => c.curve);
    const r = TH.tempRange(curves);
    for (const c of curves) for (const p of c) assert.ok(p.T >= r.lo && p.T <= r.hi, st.title);
    assert.ok(r.lo % r.step === 0 && r.hi % r.step === 0, st.title);
  }
});

test('読み取り: タップした平らな部分と別でも、種類と温度が合えば正解(ステージ3で100℃をタップして融点0℃)', () => {
  const st = stage(3);
  const pls = TH.plateaus(TH.simulate(st.spec));
  const boil = pls.find((p) => p.kind === 'boil');
  const j = TH.judgeReading(st, pls, { plateau: boil, kind: 'melt', T: 0 });
  assert.equal(j.ok, true);
  assert.equal(j.target.kind, 'melt');
});

test('読み取り: まちがいの理由を返す', () => {
  const st1 = stage(1);
  const p1 = TH.plateaus(TH.simulate(st1.spec));
  assert.equal(TH.judgeReading(st1, p1, { plateau: p1[0], kind: 'melt', T: 10 }).reason, 'temp');
  assert.equal(TH.judgeReading(st1, p1, { plateau: p1[0], kind: 'boil', T: 0 }).reason, 'kind');
  assert.equal(TH.judgeReading(st1, p1, { none: true }).reason, 'hasPlateau');
  const st2 = stage(2); // 沸点を読むステージで「融点」と答えた
  const p2 = TH.plateaus(TH.simulate(st2.spec));
  assert.equal(TH.judgeReading(st2, p2, { plateau: p2[0], kind: 'melt', T: 0 }).reason, 'kind');
  const mix = stage(11);
  assert.equal(TH.judgeReading(mix, [], { none: true }).ok, true);
});
