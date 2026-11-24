// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 transpason
// このプログラムはフリーソフトウェアです。GNU一般公衆利用許諾書(GPL)バージョン3または
// それ以降のバージョンの条件で再配布・改変できます。無保証です。詳細は LICENSE を参照。
// ねつとすがた: ゲーム本体(ステージの進行・入力・Canvas 描画)
(function () {
  'use strict';

  const TH = window.Thermo;
  const $ = (id) => document.getElementById(id);

  const STORE_KEY = 'netsu_sugata_v1';
  const RUN_SECONDS = 9;      // 実験アニメーション1回の長さ(秒、早送りなし)
  const FAST = 4;             // 早送りの倍率
  const N_PARTICLES = 40;     // 粒子の数(8列 × 5段)
  const COLS = 8, ROWS = 5;
  const STATE_COLOR = { solid: '#3b82f6', liquid: '#10b981', gas: '#f97316' };
  // 混合物のステージは粒子を物質で色分けする。状態の色(青・緑・橙)とかぶらない色にし、
  // 色の見分けがつきにくい人のためにエタノールは中に白い点を描いて形でも区別する
  const MIX_COLOR = { water: '#7c3aed', ethanol: '#db2777' };

  const el = {
    hudStage: $('hud-stage'), hudSteps: $('hud-steps'),
    lab: $('lab-canvas'), graph: $('graph'), choices: $('choices'), panel: $('panel'), prompt: $('prompt'),
    title: $('overlay-title'), select: $('overlay-select'), zukan: $('overlay-zukan'),
    stageGrid: $('stage-grid'), starTotal: $('star-total'),
    zukanCanvas: $('zukan-canvas'), zukanTemp: $('zukan-temp'), zukanTempVal: $('zukan-temp-val'),
  };

  // ---------- 保存(☆と図鑑) ----------
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      return { stars: d.stars || {}, zukan: d.zukan || {} };
    } catch (e) { return { stars: {}, zukan: {} }; }
  }
  const save = load();
  function persist() { try { localStorage.setItem(STORE_KEY, JSON.stringify(save)); } catch (e) { /* 保存できなくても遊べる */ } }

  // ---------- ステージの状態 ----------
  let S = null;

  function sampleAt(curve, t) {
    const dt = curve[1].t - curve[0].t;
    const i = Math.max(0, Math.min(curve.length - 1, Math.round(t / dt)));
    return curve[i];
  }

  function subOf(stage) { return TH.SUBSTANCES[stage.spec.sub]; }

  function substanceLabel(stage) {
    if (stage.id === 9) return 'なぞの固体X';
    if (stage.id === 10) return 'なぞの液体Y';
    return subOf(stage).name;
  }

  function stepsOf(stage) {
    return stage.mystery
      ? [['intro', 'お題'], ['run', '実験'], ['read', '読み取り'], ['identify', '正体当て'], ['quiz', 'ふりかえり'], ['result', '結果']]
      : [['intro', 'お題'], ['predict', '予想'], ['run', '実験'], ['read', '読み取り'], ['quiz', 'ふりかえり'], ['result', '結果']];
  }

  function startStage(idx) {
    const stage = TH.STAGES[idx];
    const curve = TH.simulate(stage.spec);
    const pls = TH.plateaus(curve);
    const choices = stage.mystery ? null : TH.shuffle(TH.choiceCurves(stage));
    const refStage = stage.ref ? TH.STAGES.find((s) => s.id === stage.ref) : null;
    const ref = refStage ? TH.simulate(refStage.spec) : null;
    const all = [curve].concat(choices ? choices.map((c) => c.curve) : [], ref ? [ref] : []);
    S = {
      idx, stage, curve, pls, choices, ref, refStage,
      range: TH.tempRange(all),
      tMax: Math.max(stage.spec.tEnd, ref ? ref[ref.length - 1].t : 0),
      step: 'intro', picked: -1,
      simT: 0, speed: 1, runDone: false, viewT: null,
      results: [false, false, false],
      read: { plateau: null, kind: null, T: null, done: false, ok: false, msg: '', judge: null, answerText: '' },
      identify: null,
      quizOrder: TH.shuffle([0, 1, 2]), quizPick: -1,
    };
    initParticles();
    hideOverlays();
    setStep('intro');
  }

  function setStep(step) {
    S.step = step;
    el.choices.hidden = step !== 'predict';
    if (step === 'predict') buildChoices();
    renderHud();
    renderPanel();
  }

  function renderHud() {
    const st = S.stage;
    el.hudStage.textContent = (st.mystery || st.bonus ? '' : 'ステージ' + st.id + ' ') + st.title;
    el.hudSteps.innerHTML = stepsOf(st).map(([k, name]) => (k === S.step ? '<b>' + name + '</b>' : name)).join(' › ');
  }

  // ---------- 下のパネル ----------
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function starHtml(n) { return '★'.repeat(n) + '<span class="off">' + '★'.repeat(3 - n) + '</span>'; }
  const LETTERS = ['A', 'B', 'C', 'D'];
  const KIND_NAME = { melt: '融点', boil: '沸点' };

  function renderPanel() {
    const st = S.stage;
    let h = '';
    switch (S.step) {
      case 'intro':
        h = '<p class="task">' + esc(st.text) + '</p>' +
          (st.mystery ? '<p class="hint">今回は予想はなし。実験の結果から融点・沸点を読み取って、正体を当てよう。</p>' : '') +
          '<div class="row"><button class="btn" data-act="' + (st.mystery ? 'run' : 'predict') + '">' +
          (st.mystery ? '実験スタート' : '予想する') + '</button></div>';
        break;
      case 'predict':
        h = '<p class="task">温度はどう変わる? 4つのグラフから選ぼう。</p>' +
          (S.ref ? '<p class="hint">薄い線はステージ' + S.refStage.id + 'の結果。</p>' : '') +
          '<div class="row"><button class="btn" data-act="run"' + (S.picked < 0 ? ' disabled' : '') + '>' +
          (S.picked < 0 ? 'グラフを選んでね' : LETTERS[S.picked] + ' で実験スタート') + '</button>' +
          '<button class="btn secondary" data-act="intro">お題を見る</button></div>';
        break;
      case 'run':
        if (!S.runDone) {
          h = '<p class="task">実験中…(左の粒子のようすにも注目)</p>' +
            '<div class="row"><button class="btn secondary" data-act="ff">' + (S.speed > 1 ? '早送り中' : '早送り ▶▶') + '</button></div>';
        } else {
          let msg = '';
          if (!st.mystery) {
            const c = S.choices[S.picked];
            msg = c.correct
              ? '<p><span class="ok">予想どおり!</span> 選んだグラフ ' + LETTERS[S.picked] + ' は正解。</p>'
              : '<p><span class="ng">予想とちがった。</span> 選んだ ' + LETTERS[S.picked] + ' は「' + esc(c.label) + '」というグラフ。点線と赤線をくらべてみよう。</p>';
          }
          h = msg + '<p class="task">実験終了。グラフをタップすると、その時間の粒子のようすが見られるよ。</p>' +
            '<div class="row"><button class="btn" data-act="toRead">融点・沸点を読み取る</button>' +
            '<button class="btn secondary" data-act="replay">もう一度見る</button></div>';
        }
        break;
      case 'read':
        h = renderRead();
        break;
      case 'identify':
        h = renderIdentify();
        break;
      case 'quiz':
        h = renderQuiz();
        break;
      case 'result':
        h = renderResult();
        break;
    }
    el.panel.innerHTML = h;
    el.panel.scrollTop = 0;
    // 問題文(.task)は下のパネルではなく画面上部の帯に出す(下だと気づきにくいため)。
    // 問題文がない段階(結果など)ではお題を出しておく。
    const stepName = (stepsOf(st).find(([k]) => k === S.step) || [, ''])[1];
    el.prompt.innerHTML = '<span class="badge">' + stepName + '</span>';
    const tasks = el.panel.querySelectorAll('.task');
    if (tasks.length) tasks.forEach((t) => el.prompt.appendChild(t));
    else el.prompt.insertAdjacentHTML('beforeend', '<p class="task">' + esc(st.text) + '</p>');
    if (S.step === 'result' && st.realRatio) drawRatio($('ratio-canvas'));
  }

  function renderRead() {
    const r = S.read;
    const st = S.stage;
    if (r.done) {
      const all = S.pls.length ? S.pls.map((p) => KIND_NAME[p.kind] + ' ' + p.T + '℃').join('、') : '';
      let msg;
      if (r.ok) {
        msg = '<span class="ok">正解!</span> あなたの答え: ' + esc(r.answerText) + '。' +
          (S.pls.length ? 'このグラフの平らな部分は ' + all + '(グラフに表示)。' : 'このグラフには、はっきり平らな部分はありません。');
      } else {
        msg = '<span class="ng">ざんねん。</span> あなたの答え: ' + esc(r.answerText) + '。' + readingWhy(r.judge);
      }
      return '<p>' + msg + '</p>' +
        '<div class="row"><button class="btn" data-act="' + (st.mystery ? 'toIdentify' : 'toQuiz') + '">次へ</button></div>';
    }
    const what = st.read === 'melt' ? '融点' : st.read === 'boil' ? '沸点' : '融点か沸点';
    // 平らな部分がないステージでも同じ文にする(答えのヒントにならないように)
    let h = '<p class="task">グラフの<b>平らな部分</b>をタップして、' + what + 'を読み取ろう(見つからなければ「平らな部分はない」)。</p>';
    // ※平らな部分を選んだあとに「ない」と答え直したいときは、グラフの平らでないところをタップすると選択が外れる
    if (r.msg) h += '<p class="note">' + r.msg + '</p>';
    if (r.plateau) {
      h += '<div class="row">これは: ' +
        ['melt', 'boil'].map((k) => '<button class="btn toggle' + (r.kind === k ? ' on' : '') + '" data-act="kind" data-arg="' + k + '">' + (r.kind === k ? '✓ ' : '') + KIND_NAME[k] + '</button>').join('') +
        '</div><div class="row">温度: ' +
        '<button class="btn small secondary" data-act="temp" data-arg="-10">−10</button>' +
        '<button class="btn small secondary" data-act="temp" data-arg="-1">−1</button>' +
        '<span class="temp-val">' + r.T + '℃</span>' +
        '<button class="btn small secondary" data-act="temp" data-arg="1">+1</button>' +
        '<button class="btn small secondary" data-act="temp" data-arg="10">+10</button></div>' +
        // 何を答えるのかをボタンに書いて、押す前に確かめられるようにする
        '<div class="row"><button class="btn" data-act="answerRead"' + (r.kind ? '' : ' disabled') + '>' +
        (r.kind ? '「' + KIND_NAME[r.kind] + ' ' + r.T + '℃」で答える' : '融点か沸点かを選んでね') + '</button></div>';
    } else {
      // 平らな部分を選んだあとは出さない(「答える」の近くにあると押しまちがえやすい)
      h += '<div class="row"><button class="btn secondary small" data-act="none">平らな部分はない</button></div>';
    }
    return h;
  }

  // 読み取りがちがったときの理由(何がちがったかを具体的に)
  const KIND_ACTION = { melt: '固体と液体が入れかわっている(とけている・こおっている)', boil: '液体が気体になっている(沸騰している)' };
  function readingWhy(j) {
    const t = j.target;
    switch (j.reason) {
      case 'noPlateau':
        return 'このグラフは、沸騰が始まっても温度が少しずつ上がり続けていて、はっきり平らな部分はありません。';
      case 'hasPlateau':
        return 'このグラフには平らな部分があります。' + KIND_NAME[t.kind] + 'は ' + t.T + '℃ です(グラフに表示)。';
      case 'kind':
        return 'このグラフで' + (S.stage.read === 'any' ? 'その種類の' : '読み取る') + '平らな部分は、' + KIND_ACTION[t.kind] + 'ところなので「' +
          KIND_NAME[t.kind] + '」。正しくは ' + KIND_NAME[t.kind] + ' ' + t.T + '℃ です(グラフに表示)。';
      case 'temp':
        return '「' + KIND_NAME[t.kind] + '」は合っているけれど、温度がずれています。目盛りを読むと ' + t.T + '℃ です(グラフに表示)。';
      default:
        return '';
    }
  }

  function renderIdentify() {
    const st = S.stage;
    const id = S.identify;
    let h = '<p class="task">' + substanceLabel(st) + ' の正体は? 測った' + KIND_NAME[st.read] + '(' + S.pls[0].T + '℃)とくらべよう。</p><div class="cards">';
    for (const c of TH.CARDS) {
      let cls = 'btn toggle card answer';
      if (id) {
        if (c.name === st.answer) cls += ' correct';
        else if (c.name === id) cls += ' wrong';
      }
      h += '<button class="' + cls + '" data-act="card" data-arg="' + esc(c.name) + '"' + (id ? ' disabled' : '') + '>' +
        esc(c.name) + '<small>融点 ' + c.mp + '℃ / 沸点 ' + c.bp + '℃</small></button>';
    }
    h += '</div>';
    if (id) {
      h += '<p>' + (id === st.answer ? '<span class="ok">正解!</span> ' : '<span class="ng">ざんねん。</span> ') + esc(st.learn) + '</p>' +
        '<div class="row"><button class="btn" data-act="toQuiz">次へ</button></div>';
    }
    return h;
  }

  function renderQuiz() {
    const q = S.stage.quiz;
    let h = '<p class="task">' + esc(q.q) + '</p>';
    for (const i of S.quizOrder) {
      let cls = 'btn toggle answer';
      if (S.quizPick >= 0) {
        if (i === 0) cls += ' correct';
        else if (i === S.quizPick) cls += ' wrong';
      }
      h += '<button class="' + cls + '" data-act="quiz" data-arg="' + i + '"' + (S.quizPick >= 0 ? ' disabled' : '') + '>' + esc(q.a[i]) + '</button>';
    }
    if (S.quizPick >= 0) {
      h += '<p>' + (S.quizPick === 0 ? '<span class="ok">正解!</span> ' : '<span class="ng">ざんねん。</span> ') + esc(q.why) + '</p>' +
        '<div class="row"><button class="btn" data-act="toResult">結果を見る</button></div>';
    }
    return h;
  }

  function renderResult() {
    const st = S.stage;
    const n = TH.stars(S.results);
    const labels = st.mystery ? ['読み取り', '正体当て', 'ふりかえり'] : ['予想', '読み取り', 'ふりかえり'];
    let h = '<div class="row"><span class="stars">' + starHtml(n) + '</span> ' +
      labels.map((l, i) => (S.results[i] ? '<span class="ok">○</span>' : '<span class="ng">×</span>') + l).join(' ') + '</div>' +
      '<p class="learn">' + esc(st.learn) + '</p>';
    if (st.realRatio) {
      h += '<p class="note">じつは、水を全部水蒸気にするには、氷をとかすときの<b>約7倍</b>の熱が必要。' +
        'このゲームでは見やすくするため短くしているけれど、本当のグラフでは100℃の平らな部分はもっと長いよ(下の青い線)。</p>' +
        '<canvas id="ratio-canvas"></canvas>';
    }
    const recorded = zukanNewText();
    if (recorded) h += '<p class="hint">図鑑に記録: ' + esc(recorded) + '</p>';
    const hasNext = S.idx + 1 < TH.STAGES.length;
    h += '<div class="row">' +
      (hasNext ? '<button class="btn" data-act="next">次のステージへ</button>' : '<button class="btn" data-act="zukan">図鑑を見る</button>') +
      '<button class="btn secondary" data-act="retry">もう一度</button>' +
      '<button class="btn secondary" data-act="select">ステージを選ぶ</button></div>';
    return h;
  }

  // 結果画面に入ったとき: ☆と図鑑を保存
  function finishStage() {
    const st = S.stage;
    const n = TH.stars(S.results);
    save.stars[st.id] = Math.max(save.stars[st.id] || 0, n);
    const key = st.spec.sub;
    const z = save.zukan[key] || {};
    S.newRecords = [];
    if (subOf(st).mixture) {
      if (!z.none) S.newRecords.push('混合物は決まった沸点がない');
      z.none = true;
    }
    for (const p of S.pls) {
      const f = p.kind === 'melt' ? 'mp' : 'bp';
      if (z[f] === undefined) S.newRecords.push(subOf(st).name + 'の' + KIND_NAME[p.kind] + ' ' + p.T + '℃');
      z[f] = p.T;
    }
    save.zukan[key] = z;
    persist();
  }
  function zukanNewText() { return (S.newRecords || []).join('、'); }

  // ---------- 操作 ----------
  el.panel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    act(b.dataset.act, b.dataset.arg);
  });

  function act(name, arg) {
    const r = S && S.read;
    switch (name) {
      case 'predict': setStep('predict'); break;
      case 'intro': setStep('intro'); break;
      case 'run':
        if (!S.stage.mystery) {
          if (S.picked < 0) return;
          S.results[0] = S.choices[S.picked].correct;
        }
        S.simT = 0; S.speed = 1; S.runDone = false; S.viewT = null;
        setStep('run');
        break;
      case 'replay': S.simT = 0; S.speed = 1; S.runDone = false; S.viewT = null; renderPanel(); break;
      case 'ff': S.speed = FAST; renderPanel(); break;
      case 'toRead': setStep('read'); break;
      case 'kind': r.kind = arg; renderPanel(); break;
      case 'temp': r.T += Number(arg); renderPanel(); break;
      case 'none':
        r.done = true;
        r.judge = TH.judgeReading(S.stage, S.pls, { none: true });
        r.ok = r.judge.ok; r.answerText = '平らな部分はない';
        recordRead();
        break;
      case 'answerRead':
        r.done = true;
        r.judge = TH.judgeReading(S.stage, S.pls, { plateau: r.plateau, kind: r.kind, T: r.T });
        r.ok = r.judge.ok; r.answerText = KIND_NAME[r.kind] + ' ' + r.T + '℃';
        recordRead();
        break;
      case 'toIdentify': setStep('identify'); break;
      case 'card':
        S.identify = arg;
        S.results[1] = arg === S.stage.answer;
        renderPanel();
        break;
      case 'toQuiz': S.viewT = null; setStep('quiz'); break;
      case 'quiz':
        S.quizPick = Number(arg);
        S.results[2] = S.quizPick === 0;
        renderPanel();
        break;
      case 'toResult': finishStage(); setStep('result'); break;
      case 'next': startStage(S.idx + 1); break;
      case 'retry': startStage(S.idx); break;
      case 'select': openSelect(); break;
      case 'zukan': openZukan(); break;
    }
  }

  function recordRead() {
    // 応用ステージでは読み取りが☆1、ほかは☆2
    S.results[S.stage.mystery ? 0 : 1] = S.read.ok;
    renderPanel();
  }

  // ---------- 4択 ----------
  function buildChoices() {
    el.choices.innerHTML = S.choices.map((c, i) =>
      '<button class="choice' + (i === S.picked ? ' selected' : '') + '" data-i="' + i + '"><span class="letter">' + LETTERS[i] + '</span><canvas></canvas></button>').join('');
  }
  el.choices.addEventListener('click', (e) => {
    const b = e.target.closest('.choice');
    if (!b) return;
    S.picked = Number(b.dataset.i);
    el.choices.querySelectorAll('.choice').forEach((x, i) => x.classList.toggle('selected', i === S.picked));
    renderPanel();
  });

  // ---------- グラフのタップ(読み取り・ようすを見る) ----------
  let graphLayout = null;
  el.graph.addEventListener('pointerdown', (e) => {
    if (!S || !graphLayout) return;
    const canTap = (S.step === 'run' && S.runDone) || ['read', 'identify', 'quiz', 'result'].includes(S.step);
    if (!canTap) return;
    const rect = el.graph.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const L = graphLayout;
    const t = Math.max(0, Math.min(S.stage.spec.tEnd, L.toT(x)));
    const T = L.toTemp(y);
    S.viewT = t;
    if (S.step !== 'read' || S.read.done) return;
    const r = S.read;
    const tol = (S.range.hi - S.range.lo) * 0.08;
    const pl = S.pls.find((p) => t >= p.t0 - 0.2 && t <= p.t1 + 0.2 && Math.abs(T - p.T) < tol);
    if (pl) {
      if (r.plateau !== pl) {
        r.plateau = pl; r.kind = null;
        // 初めの温度は答えから離れた切りのよい値にする(答えが見えてしまわないように)
        let start = Math.round((S.range.lo + S.range.hi) / 2 / 10) * 10;
        if (Math.abs(start - pl.T) < 10) start += 20;
        r.T = start;
      }
      r.msg = '';
    } else {
      r.plateau = null; r.kind = null;
      r.msg = S.pls.length
        ? 'そこは平らな部分ではないよ。線が横にまっすぐになっているところを探そう。'
        : 'そこは平らな部分ではないよ。横にまっすぐなところはあるかな?';
    }
    renderPanel();
  });

  // ---------- 粒子 ----------
  let particles = [];
  // 状態が変わる順番(rank)。熱はビーカーの底や横の壁から出入りするので、固体のかたまりの底・横の外側から変わる。
  //   加熱: 外側の粒子から先にとける(同じ外側なら、火に近い下の段が先)。rank が小さいほど先に液体になる。
  //   冷却: 冷たい容器の壁に近い外側から先に固体になる。固体になるのは rank が大きい粒子からなので、外側の rank を大きくする。
  function meltOrder(cooling) {
    const cells = [];
    for (let i = 0; i < N_PARTICLES; i++) {
      const row = Math.floor(i / COLS), col = i % COLS;           // row 0 = いちばん下の段
      // 底と横の壁からの近さ(0 = 壁ぎわ)。上の面は空気に触れているだけなので数えない
      const ring = Math.min(col, COLS - 1 - col, row);
      const jitter = ((i * 37) % 11) / 11 * 0.9;                   // 同じ外側の中で、少しばらばらに変わるように
      const key = cooling ? -(ring * 10 + jitter) : ring * 10 + row * 0.5 + jitter;
      cells.push({ i, row, col, key });
    }
    cells.sort((a, b) => a.key - b.key);
    cells.forEach((c, rank) => { c.rank = rank; });
    return cells.sort((a, b) => a.i - b.i);
  }

  function initParticles() {
    particles = [];
    const cooling = S && S.stage.spec.power < 0;
    for (const c of meltOrder(cooling)) {
      const hu = 0.5 + (c.col - (COLS - 1) / 2) * 0.085;
      const hv = 0.05 + c.row * 0.068; // 固体はすき間なく並ぶ(ビーカーは幅:高さ = 4:5)
      particles.push({ i: c.i, rank: c.rank, hu, hv, u: hu, v: hv, vu: 0, vv: 0, state: 'solid' });
    }
    if (S) {
      const s0 = S.curve[0];
      for (const p of particles) {
        p.state = targetState(p.rank, s0);
        if (p.state !== 'solid') { p.u = 0.1 + Math.random() * 0.8; p.v = 0.05 + Math.random() * 0.3; }
      }
    }
  }

  function targetState(rank, smp) {
    const i = rank;
    const nLiquid = Math.round(smp.melt * N_PARTICLES);
    const nGas = Math.round(smp.boil * N_PARTICLES);
    if (i < nGas) return 'gas';
    if (i < nLiquid) return 'liquid';
    return 'solid';
  }

  // heat01: その状態の中での温かさ(0..1)。大きいほど激しく動く
  function updateParticles(smp, dt, aspect) {
    const sub = subOf(S.stage);
    const k = Math.min(3, dt * 60);
    const heat = (lo, hi) => Math.max(0, Math.min(1, (smp.T - lo) / (hi - lo)));
    const mp = sub.mixture ? -100 : sub.mp, bp = sub.mixture ? 80 : sub.bp;
    for (const p of particles) {
      const want = targetState(p.rank, smp);
      if (want !== p.state) {
        if (want === 'gas') { const a = Math.random() * Math.PI * 2; p.vu = Math.cos(a) * 0.012; p.vv = Math.abs(Math.sin(a)) * 0.012 + 0.004; }
        p.state = want;
      }
      if (p.state === 'solid') {
        const amp = 0.003 + 0.007 * heat(mp - 40, mp);
        p.u += (p.hu - p.u) * 0.25 * k + (Math.random() - 0.5) * amp;
        p.v += (p.hv - p.v) * 0.25 * k + (Math.random() - 0.5) * amp * aspect;
      } else if (p.state === 'liquid') {
        const vmax = 0.003 + 0.004 * heat(mp, bp);
        p.vu += (Math.random() - 0.5) * 0.002 * k;
        p.vv += (Math.random() - 0.5) * 0.002 * k - 0.0002 * k;
        const sp = Math.hypot(p.vu, p.vv);
        if (sp > vmax) { p.vu *= vmax / sp; p.vv *= vmax / sp; }
        p.u += p.vu * k; p.v += p.vv * k;
        bounce(p, 0.06, 0.94, 0.03, 0.47);
      } else {
        const sp = 0.012 + 0.006 * heat(bp, bp + 50);
        const cur = Math.hypot(p.vu, p.vv) || 1;
        p.vu *= sp / cur; p.vv *= sp / cur;
        p.u += p.vu * k; p.v += p.vv * k;
        bounce(p, 0.06, 0.94, 0.03, 0.96);
      }
    }
    // 液体どうしは重ならないように軽く押し合う(くっついたまま動き回る感じ)
    const minD = 0.075;
    for (let a = 0; a < particles.length; a++) {
      const p = particles[a];
      if (p.state === 'solid') continue;
      for (let b = 0; b < particles.length; b++) {
        if (a === b) continue;
        const q = particles[b];
        const du = p.u - q.u, dv = (p.v - q.v) / aspect;
        const d = Math.hypot(du, dv);
        if (d > 0 && d < minD) {
          const push = (minD - d) * 0.3;
          p.u += (du / d) * push; p.v += (dv / d) * push * aspect;
        }
      }
      if (p.state === 'liquid') bounce(p, 0.06, 0.94, 0.03, 0.47);
    }
  }

  function bounce(p, u0, u1, v0, v1) {
    if (p.u < u0) { p.u = u0; p.vu = Math.abs(p.vu); }
    if (p.u > u1) { p.u = u1; p.vu = -Math.abs(p.vu); }
    if (p.v < v0) { p.v = v0; p.vv = Math.abs(p.vv); }
    if (p.v > v1) { p.v = v1; p.vv = -Math.abs(p.vv); }
  }

  // ---------- 描画 ----------
  // キャンバスの文字の倍率。style.css の --fs(画面が広いと2、狭いと1.4)を上限に、
  // キャンバスが小さいときは文字がはみ出さないように小さくする。
  let K = 1;
  function cssScale(elm) { return parseFloat(getComputedStyle(elm || document.documentElement).getPropertyValue('--fs')) || 2; }
  let CSS_FS = cssScale();
  window.addEventListener('resize', () => { CSS_FS = cssScale(); });
  // maxFs: 上限の倍率(省略時はページ全体の --fs。図鑑のように画面ごとに --fs を変えている場合はその値を渡す)
  function setScale(w, h, per, maxFs) { K = Math.max(1, Math.min(maxFs || CSS_FS, Math.min(w, h) / (per || 230))); return K; }
  function F(px, bold) { return (bold ? 'bold ' : '') + Math.round(px * K) + 'px sans-serif'; }
  function fit(canvas) {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w: r.width, h: r.height };
  }

  function currentSample() {
    if (S.step === 'intro' || S.step === 'predict') return S.curve[0];
    if (S.step === 'run' && !S.runDone) return sampleAt(S.curve, S.simT);
    if (S.viewT !== null) return sampleAt(S.curve, S.viewT);
    return S.curve[S.curve.length - 1];
  }

  const BUBBLE = {
    melting: '熱は、固体を液体に変えるのに使われ中!温度は上がらない',
    freezing: '熱を出しながら、液体が固体に変わり中!温度は下がらない',
    boiling: '熱は、液体を気体に変えるのに使われ中!温度は上がらない',
  };

  function drawLab(dt) {
    const { ctx, w, h } = fit(el.lab);
    ctx.clearRect(0, 0, w, h);
    const st = S.stage;
    const sub = subOf(st);
    const smp = currentSample();
    setScale(w, h, 170);
    const L1 = 6 + 15 * K, L2 = L1 + 19 * K; // 上の2行の文字の位置
    const legendY = h - 8 * K;                // 下の凡例の文字の位置
    const mix = sub.mixture;
    // 凡例が1行に入りきらないときは、説明を凡例の上の行に出す(その分ビーカーを上げる)
    ctx.font = F(12);
    const legendItems = mix ? ['水', 'エタノール'] : ['固体', '液体', '気体'];
    const legendW = legendItems.reduce((a, n) => a + 10 * K + 18 + ctx.measureText(n).width, 10);
    const note = mix ? '薄い粒 = 気体になった粒子' : '粒子の数は変わらない(質量は同じ)';
    const noteOwnLine = legendW + ctx.measureText(note).width > w - 6;
    const legendTop = legendY - 14 * K - (noteOwnLine ? 20 * K : 0);

    // ビーカーの大きさ(幅:高さ = 4:5)
    const top = L2 + 14 * K, bottom = legendTop - 18;
    let bh = Math.max(60, bottom - top);
    let bw = bh * 0.8;
    const maxW = w * 0.45;
    if (bw > maxW) { bw = maxW; bh = bw / 0.8; }
    const bx = w * 0.36 - bw / 2; // 右側に温度計と温度の数字を置くので左寄せ
    const by = bottom - bh;
    const aspect = bw / bh;

    if (dt > 0) updateParticles(smp, dt, aspect);

    // 加熱・冷却の装置
    const heater = st.heater;
    if (heater === 'bath' || heater === 'cooler') {
      const ox = bx - bw * 0.18, ow = bw * 1.36, oy = by + bh * 0.35, oh = bh * 0.7;
      ctx.fillStyle = heater === 'bath' ? '#dbeafe' : '#e0f2fe';
      ctx.fillRect(ox, oy, ow, oh);
      ctx.strokeStyle = '#64748b'; ctx.lineWidth = 1.5;
      ctx.strokeRect(ox, oy, ow, oh);
      // 装置の名前は外側の容器の左に書く(中に書くとビーカーや粒子と重なる)。入りきらなければ縦に並べる
      ctx.fillStyle = '#475569'; ctx.font = F(12); ctx.textAlign = 'right';
      const lbl = heater === 'bath' ? ['湯せん', '(お湯)'] : ['氷+', '食塩'];
      const lw = Math.max(...lbl.map((t) => ctx.measureText(t).width));
      if (ox - 6 >= lw) lbl.forEach((t, i) => ctx.fillText(t, ox - 4, oy + 16 * K + i * 16 * K));
      ctx.textAlign = 'left';
      if (heater === 'cooler') {
        ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.strokeStyle = '#94a3b8';
        for (let i = 0; i < 6; i++) {
          const cx = i % 2 ? ox + 6 + (i % 3) * 3 : ox + ow - 22 - (i % 3) * 3;
          const cy = oy + 10 + Math.floor(i / 2) * (oh / 4);
          ctx.fillRect(cx, cy, 14, 14); ctx.strokeRect(cx, cy, 14, 14);
        }
      } else {
        drawFlame(ctx, bx + bw / 2, oy + oh + 4, bw * 0.25, smp);
      }
    } else {
      drawFlame(ctx, bx + bw / 2, by + bh + 6, heater === 'burner-strong' ? bw * 0.5 : bw * 0.3, smp);
    }

    // ビーカー
    ctx.fillStyle = '#f8fbff';
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = '#475569'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(bx, by - 6); ctx.lineTo(bx, by + bh); ctx.lineTo(bx + bw, by + bh); ctx.lineTo(bx + bw, by - 6); ctx.stroke();

    // 粒子
    const rad = Math.max(3, bw * 0.034);
    for (const p of particles) {
      const x = bx + p.u * bw, y = by + bh - p.v * bh;
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2);
      const isEthanol = mix && p.i % 2 === 0;
      ctx.fillStyle = mix ? (isEthanol ? MIX_COLOR.ethanol : MIX_COLOR.water) : STATE_COLOR[p.state];
      ctx.globalAlpha = mix && p.state === 'gas' ? 0.4 : 1; // 混合物は色を物質で分けるので、気体は薄くして区別する
      ctx.fill();
      if (isEthanol) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, rad * 0.38, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; ctx.stroke();
    }

    // 温度計
    const tx = bx + bw + Math.max(14, bw * 0.12), tTop = by - 20, tBot = by + bh - 4;
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#64748b'; ctx.lineWidth = 1.5;
    roundRect(ctx, tx - 5, tTop, 10, tBot - tTop, 5); ctx.fill(); ctx.stroke();
    const frac = Math.max(0, Math.min(1, (smp.T - S.range.lo) / (S.range.hi - S.range.lo)));
    const colTop = tBot - frac * (tBot - tTop - 6);
    ctx.fillStyle = '#ef4444'; ctx.fillRect(tx - 2.5, colTop, 5, tBot - colTop);
    ctx.beginPath(); ctx.arc(tx, tBot + 4, 8, 0, Math.PI * 2); ctx.fill();
    ctx.font = F(20, true); ctx.textAlign = 'left'; ctx.fillStyle = '#dc2626';
    const tText = smp.T.toFixed(1) + '℃';
    ctx.fillText(tText, Math.min(tx + 12, w - ctx.measureText(tText).width - 4), Math.max(tTop + 16 * K, colTop + 6 * K));

    // 文字の情報
    ctx.textAlign = 'left'; ctx.fillStyle = '#1f2937'; ctx.font = F(15, true);
    ctx.fillText(substanceLabel(st) + '  質量 ' + st.spec.mass + 'g', 10, L1);
    ctx.font = F(14); ctx.fillStyle = '#475569';
    const tNow = S.step === 'run' && !S.runDone ? S.simT : (S.viewT !== null ? S.viewT : (S.step === 'intro' || S.step === 'predict' ? 0 : st.spec.tEnd));
    ctx.fillText('時間 ' + tNow.toFixed(1) + ' 分   状態: ' + (TH.PHASE_NAME[smp.phase] || ''), 10, L2);

    // 状態の凡例
    ctx.font = F(12);
    let lx = 10;
    const dotY = legendY - 4 * K, dotR = 5 * K;
    if (mix) {
      for (const [c, n, dot] of [[MIX_COLOR.water, '水', false], [MIX_COLOR.ethanol, 'エタノール', true]]) {
        ctx.fillStyle = c; ctx.beginPath(); ctx.arc(lx + dotR, dotY, dotR, 0, Math.PI * 2); ctx.fill();
        if (dot) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(lx + dotR, dotY, dotR * 0.4, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = '#475569'; ctx.fillText(n, lx + dotR * 2 + 4, legendY); lx += dotR * 2 + 4 + ctx.measureText(n).width + 14;
      }
    } else {
      for (const [k, n] of [['solid', '固体'], ['liquid', '液体'], ['gas', '気体']]) {
        ctx.fillStyle = STATE_COLOR[k]; ctx.beginPath(); ctx.arc(lx + dotR, dotY, dotR, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#475569'; ctx.fillText(n, lx + dotR * 2 + 4, legendY); lx += dotR * 2 + 4 + ctx.measureText(n).width + 14;
      }
    }
    ctx.fillStyle = '#6b7280';
    if (!noteOwnLine) ctx.fillText(note, lx, legendY);
    else ctx.fillText(note, 10, legendY - 20 * K);

    // 吹き出し(状態変化中)
    const showBubble = (S.step === 'run' && !S.runDone) || S.viewT !== null;
    let bubble = showBubble ? BUBBLE[smp.phase] : null;
    if (bubble && mix) bubble = '沸騰しているのに、温度が少しずつ上がっていく…';
    if (bubble) {
      ctx.font = F(13, true);
      const lh = 18 * K; // 行の高さ
      const lines = wrapText(ctx, bubble, Math.min(w - 20, 260 * K));
      const bwid = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
      const bx2 = Math.max(6, Math.min(w - bwid - 6, bx + bw / 2 - bwid / 2)), by2 = L2 + 8;
      ctx.fillStyle = '#fef3c7'; ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 1.5;
      roundRect(ctx, bx2, by2, bwid, lines.length * lh + 10, 8); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#92400e'; ctx.textAlign = 'left';
      lines.forEach((l, i) => ctx.fillText(l, bx2 + 8, by2 + 4 + lh * 0.8 + i * lh));
    }
  }

  function drawFlame(ctx, cx, y, size, smp) {
    const cooling = S.stage.spec.power < 0;
    if (cooling) return;
    const flick = 1 + Math.sin(performance.now() / 90) * 0.06;
    ctx.fillStyle = 'rgba(249,115,22,0.85)';
    ctx.beginPath();
    ctx.moveTo(cx - size / 2, y + size * 0.15);
    ctx.quadraticCurveTo(cx, y - size * 0.9 * flick, cx + size / 2, y + size * 0.15);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(59,130,246,0.7)';
    ctx.beginPath();
    ctx.moveTo(cx - size / 4, y + size * 0.15);
    ctx.quadraticCurveTo(cx, y - size * 0.4 * flick, cx + size / 4, y + size * 0.15);
    ctx.closePath(); ctx.fill();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function wrapText(ctx, text, maxW) {
    const lines = [];
    let cur = '';
    for (const ch of text) {
      if (ctx.measureText(cur + ch).width > maxW) { lines.push(cur); cur = ch; } else cur += ch;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  // グラフを描く。返り値は座標変換(タップ位置 → 時間・温度)
  function drawChart(ctx, w, h, o) {
    const small = !!o.small;
    setScale(w, h, small ? 140 : 230);
    const fs = Math.round((small ? 10 : 13) * K);
    const ml = (small ? 30 : 50) * K, mr = small ? 8 : 16, mt = (small ? 24 : 28) * K, mb = (small ? 18 : 34) * K;
    const x0 = ml, x1 = w - mr, y0 = mt, y1 = h - mb;
    const { lo, hi } = o.range;
    let step = o.range.step;
    if (small && (hi - lo) / step > 6) step *= 2; // 本編のグラフは融点・沸点を読むので間引かない
    const tx = (t) => x0 + (t / o.tMax) * (x1 - x0);
    const ty = (T) => y1 - ((T - lo) / (hi - lo)) * (y1 - y0);

    ctx.clearRect(0, 0, w, h);
    ctx.font = fs + 'px sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let T = Math.ceil(lo / step) * step; T <= hi + 1e-9; T += step) {
      ctx.strokeStyle = T === 0 ? '#94a3b8' : '#e5e7eb'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x0, ty(T)); ctx.lineTo(x1, ty(T)); ctx.stroke();
      ctx.fillStyle = '#475569'; ctx.fillText(String(T), x0 - 4 * K, ty(T));
    }
    const ts = TH.niceStep(o.tMax, small ? 4 : Math.round(8 / K * 1.5));
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let t = 0; t <= o.tMax + 1e-9; t += ts) {
      ctx.strokeStyle = '#334155';
      ctx.beginPath(); ctx.moveTo(tx(t), y1); ctx.lineTo(tx(t), y1 + 4); ctx.stroke();
      ctx.fillStyle = '#475569'; ctx.fillText(String(t), tx(t), y1 + 5 * K);
    }
    ctx.strokeStyle = '#334155'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x0, y0 - 6); ctx.lineTo(x0, y1); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#475569';
    ctx.textAlign = small ? 'right' : 'left';
    ctx.fillText('温度[℃]', small ? x1 : 6, (small ? 14 : 16) * K);
    if (!small) { ctx.textAlign = 'right'; ctx.fillText('時間[分]', x1, y1 + 30 * K); }

    for (const b of o.bands || []) {
      ctx.fillStyle = b.color;
      ctx.fillRect(tx(b.t0) - 3, ty(b.T) - 9 * K, tx(b.t1) - tx(b.t0) + 6, 18 * K);
      if (b.label) {
        ctx.fillStyle = '#92400e'; ctx.font = 'bold ' + fs + 'px sans-serif'; ctx.textAlign = 'center';
        const yl = ty(b.T) - 13 * K < y0 + 4 ? ty(b.T) + 24 * K : ty(b.T) - 13 * K;
        ctx.fillText(b.label, (tx(b.t0) + tx(b.t1)) / 2, yl);
        ctx.font = fs + 'px sans-serif';
      }
    }

    for (const c of o.curves) {
      ctx.save();
      ctx.beginPath();
      let started = false;
      for (const p of c.pts) {
        if (c.upto !== undefined && p.t > c.upto) break;
        const X = tx(p.t), Y = ty(p.T);
        if (!started) { ctx.moveTo(X, Y); started = true; } else ctx.lineTo(X, Y);
      }
      ctx.strokeStyle = c.color; ctx.lineWidth = c.width || 3; ctx.globalAlpha = c.alpha || 1;
      ctx.lineJoin = 'round';
      if (c.dash) ctx.setLineDash(c.dash);
      ctx.stroke();
      ctx.restore();
    }

    if (o.viewT !== undefined && o.viewT !== null) {
      ctx.strokeStyle = 'rgba(37,99,235,0.6)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(tx(o.viewT), y0); ctx.lineTo(tx(o.viewT), y1); ctx.stroke();
      ctx.setLineDash([]);
    }

    if (o.legend) { // 上の余白に1行で右寄せ(グラフの線やラベルと重ならないように)
      ctx.textAlign = 'right';
      // 「温度[℃]」と重ならない幅に入るまで文字を小さくする
      const room = x1 - (small ? 0 : 6 + ctx.measureText('温度[℃]').width + 12);
      let px = 12 * K;
      const widthAt = (sz) => { ctx.font = Math.round(sz) + 'px sans-serif'; return o.legend.reduce((a, l) => a + ctx.measureText(l.text).width + 14, -14); };
      while (px > 9 && widthAt(px) > room) px -= 1;
      let x = x1;
      for (const l of o.legend.slice().reverse()) {
        ctx.fillStyle = l.color; ctx.fillText(l.text, x, mt - 10 * K);
        x -= ctx.measureText(l.text).width + 14;
      }
    }

    return {
      tx, ty,
      toT: (x) => ((x - x0) / (x1 - x0)) * o.tMax,
      toTemp: (y) => lo + ((y1 - y) / (y1 - y0)) * (hi - lo),
    };
  }

  function drawMainGraph() {
    const { ctx, w, h } = fit(el.graph);
    const curves = [];
    const legend = [];
    if (S.ref) {
      curves.push({ pts: S.ref, color: '#94a3b8', width: 3, alpha: 0.45 });
      legend.push({ color: '#94a3b8', text: '薄い線 = ステージ' + S.refStage.id });
    }
    const after = S.step !== 'intro' && S.step !== 'predict';
    if (after && S.choices && S.picked >= 0) {
      curves.push({ pts: S.choices[S.picked].curve, color: '#64748b', width: 2.5, dash: [7, 6] });
      legend.push({ color: '#64748b', text: '点線 = あなたの予想' });
    }
    if (after) {
      curves.push({ pts: S.curve, color: '#ef4444', width: 3.5, upto: S.step === 'run' && !S.runDone ? S.simT : undefined });
      legend.push({ color: '#ef4444', text: '赤線 = 実験結果' });
    }
    const bands = [];
    if (S.step === 'read' && !S.read.done && S.read.plateau) {
      const p = S.read.plateau;
      bands.push({ t0: p.t0, t1: p.t1, T: p.T, color: 'rgba(37,99,235,0.18)' });
    }
    const revealed = (S.step === 'read' && S.read.done) || ['identify', 'quiz', 'result'].includes(S.step);
    if (revealed) {
      for (const p of S.pls) bands.push({ t0: p.t0, t1: p.t1, T: p.T, color: 'rgba(245,158,11,0.25)', label: KIND_NAME[p.kind] + ' ' + p.T + '℃' });
    }
    graphLayout = el.graph._layout = drawChart(ctx, w, h, { // _layout はブラウザでの動作確認用
      range: S.range, tMax: S.tMax, curves, bands, legend,
      viewT: S.step === 'run' && !S.runDone ? null : S.viewT,
    });
  }

  function drawChoices() {
    el.choices.querySelectorAll('.choice').forEach((b, i) => {
      const cv = b.querySelector('canvas');
      const { ctx, w, h } = fit(cv);
      const curves = [];
      if (S.ref) curves.push({ pts: S.ref, color: '#94a3b8', width: 2.5, alpha: 0.45 });
      curves.push({ pts: S.choices[i].curve, color: '#ef4444', width: 3 });
      drawChart(ctx, w, h, { small: true, range: S.range, tMax: S.tMax, curves });
    });
  }

  // ステージ3のふりかえり: 見やすくしたグラフと実際の比率のグラフ
  function drawRatio(cv) {
    if (!cv) return;
    const spec = S.stage.spec;
    const tEnd = 58; // 実際の比率でも、まだ沸騰が続いている時間まで
    const game = TH.simulate(Object.assign({}, spec, { tEnd: spec.tEnd }));
    const real = TH.simulate(Object.assign({}, spec, { tEnd, over: { lv: TH.SUBSTANCES.water.lvReal } }));
    const { ctx, w, h } = fit(cv);
    drawChart(ctx, w, h, {
      range: { lo: -40, hi: 120, step: 40 }, tMax: tEnd,
      curves: [{ pts: real, color: '#2563eb', width: 3 }, { pts: game, color: '#ef4444', width: 3 }],
      legend: [{ color: '#ef4444', text: 'ゲームのグラフ' }, { color: '#2563eb', text: '本当の比率(沸騰が約45分続く)' }],
    });
  }

  // ---------- 図鑑 ----------
  const ZUKAN_ORDER = ['water', 'ethanol', 'methanol', 'palmitic', 'naphthalene', 'mixture'];
  function drawZukan() {
    const { ctx, w, h } = fit(el.zukanCanvas);
    ctx.clearRect(0, 0, w, h);
    const T0 = -40, T1 = 140;
    setScale(w, h, 160, cssScale(el.zukan));
    const nameW = Math.min(150 * K, w * 0.28), stateW = 54 * K;
    const x0 = nameW, x1 = w - stateW;
    const tx = (T) => x0 + ((T - T0) / (T1 - T0)) * (x1 - x0);
    const rowH = (h - 14 - 30 * K) / ZUKAN_ORDER.length;
    const cur = Number(el.zukanTemp.value);
    ctx.font = F(12); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const tickStep = (x1 - x0) / 9 < ctx.measureText('-40℃').width + 6 ? 40 : 20; // 文字が重なるなら間引く
    for (let T = T0; T <= T1; T += tickStep) {
      ctx.strokeStyle = T === 0 ? '#94a3b8' : '#e5e7eb';
      ctx.beginPath(); ctx.moveTo(tx(T), 6); ctx.lineTo(tx(T), h - 24 * K); ctx.stroke();
      ctx.fillStyle = '#475569'; ctx.fillText(T + '℃', tx(T), h - 8 * K);
    }
    ZUKAN_ORDER.forEach((key, i) => {
      const sub = TH.SUBSTANCES[key];
      const z = save.zukan[key];
      const yc = 14 + rowH * i + rowH / 2;
      ctx.textAlign = 'left'; ctx.font = F(14, true);
      ctx.fillStyle = z ? '#1f2937' : '#9ca3af';
      ctx.fillText(z ? (key === 'mixture' ? '混合物' : sub.name) : '???', 4, yc + 5 * K);
      const bh = Math.min(22 * K, rowH * 0.45);
      if (!z) {
        ctx.fillStyle = '#f1f5f9'; ctx.fillRect(x0, yc - bh / 2, x1 - x0, bh);
        ctx.fillStyle = '#9ca3af'; ctx.font = F(12); ctx.textAlign = 'center';
        ctx.fillText('まだ測っていない', (x0 + x1) / 2, yc + 4 * K);
        return;
      }
      if (z.none) {
        const g = ctx.createLinearGradient(tx(70), 0, tx(100), 0);
        g.addColorStop(0, '#10b981'); g.addColorStop(1, '#f97316');
        ctx.fillStyle = '#10b981'; ctx.fillRect(x0, yc - bh / 2, tx(70) - x0, bh);
        ctx.fillStyle = g; ctx.fillRect(tx(70), yc - bh / 2, tx(100) - tx(70), bh);
        ctx.fillStyle = '#f97316'; ctx.fillRect(tx(100), yc - bh / 2, x1 - tx(100), bh);
        ctx.fillStyle = '#1f2937'; ctx.font = F(12); ctx.textAlign = 'center';
        ctx.fillText('決まった沸点がない', tx(85), yc - bh / 2 - 3);
        ctx.textAlign = 'left'; ctx.font = F(13, true); ctx.fillText(cur < 78 ? '液体' : cur > 100 ? '気体' : '沸騰中', x1 + 8, yc + 5 * K);
        return;
      }
      const mp = z.mp, bp = z.bp;
      const seg = (a, b, color, alpha) => {
        const xa = tx(Math.max(T0, a)), xb = tx(Math.min(T1, b));
        if (xb <= xa) return;
        ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.fillRect(xa, yc - bh / 2, xb - xa, bh); ctx.globalAlpha = 1;
      };
      if (mp !== undefined && bp !== undefined) {
        seg(T0, mp, STATE_COLOR.solid, 1); seg(mp, bp, STATE_COLOR.liquid, 1); seg(bp, T1, STATE_COLOR.gas, 1);
      } else if (mp !== undefined) {
        seg(T0, mp, STATE_COLOR.solid, 1); seg(mp, T1, STATE_COLOR.liquid, 0.35);
      } else {
        seg(T0, bp, STATE_COLOR.liquid, 0.35); seg(bp, T1, STATE_COLOR.gas, 1);
      }
      ctx.font = F(12, true); ctx.textAlign = 'center'; ctx.fillStyle = '#1f2937';
      if (mp !== undefined && mp >= T0 && mp <= T1) ctx.fillText('融点' + mp, tx(mp), yc - bh / 2 - 3);
      if (bp !== undefined && bp >= T0 && bp <= T1) ctx.fillText('沸点' + bp, tx(bp), yc - bh / 2 - 3);
      if (mp === undefined) { ctx.fillStyle = '#6b7280'; ctx.fillText('融点 ?', tx(T0) + 24 * K, yc + 4 * K); }
      if (bp === undefined) { ctx.fillStyle = '#6b7280'; ctx.fillText('沸点 ?', tx(T1) - 24 * K, yc + 4 * K); }
      // スライダーの温度での状態
      let s;
      if (mp !== undefined && cur === mp) s = 'とける';
      else if (bp !== undefined && cur === bp) s = '沸騰';
      else if (mp !== undefined && cur < mp) s = '固体';
      else if (bp !== undefined && cur > bp) s = '気体';
      else if (mp !== undefined && bp !== undefined) s = '液体';
      else s = '液体?'; // 片方がまだわからない
      ctx.textAlign = 'left'; ctx.font = F(13, true); ctx.fillStyle = '#1f2937';
      ctx.fillText(s, x1 + 8, yc + 5 * K);
    });
    ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(tx(cur), 4); ctx.lineTo(tx(cur), h - 24 * K); ctx.stroke();
  }

  // ---------- 重ねる画面 ----------
  function hideOverlays() { el.title.hidden = true; el.select.hidden = true; el.zukan.hidden = true; }

  function openSelect() {
    hideOverlays();
    let total = 0;
    el.stageGrid.innerHTML = TH.STAGES.map((st, i) => {
      const n = save.stars[st.id] || 0;
      total += n;
      const num = st.mystery ? '応用' : st.bonus ? 'おまけ' : 'ステージ' + st.id;
      const name = st.title.replace(/^(応用[AB]|おまけ) /, '');
      return '<button class="stage-btn' + (st.mystery || st.bonus ? ' extra' : '') + '" data-i="' + i + '">' +
        '<span class="num">' + num + '</span><span class="name">' + esc(name) + '</span><span class="st">' + starHtml(n) + '</span></button>';
    }).join('');
    el.starTotal.textContent = '★ ' + total + ' / ' + TH.STAGES.length * 3;
    el.select.hidden = false;
  }
  el.stageGrid.addEventListener('click', (e) => {
    const b = e.target.closest('.stage-btn');
    if (b) startStage(Number(b.dataset.i));
  });

  function openZukan() { hideOverlays(); el.zukan.hidden = false; requestAnimationFrame(drawZukan); }
  el.zukanTemp.addEventListener('input', () => { el.zukanTempVal.textContent = el.zukanTemp.value + '℃'; drawZukan(); });

  $('btn-start').addEventListener('click', () => {
    const first = TH.STAGES.findIndex((st) => !save.stars[st.id]);
    startStage(first < 0 ? 0 : first);
  });
  $('btn-title-select').addEventListener('click', openSelect);
  $('btn-select').addEventListener('click', openSelect);
  $('btn-zukan').addEventListener('click', openZukan);
  $('btn-select-close').addEventListener('click', () => { if (S) hideOverlays(); else { hideOverlays(); el.title.hidden = false; } });
  $('btn-zukan-close').addEventListener('click', () => { if (S) hideOverlays(); else { hideOverlays(); el.title.hidden = false; } });
  window.addEventListener('resize', () => { if (!el.zukan.hidden) drawZukan(); if (S && S.step === 'result' && S.stage.realRatio) drawRatio($('ratio-canvas')); });

  // ---------- ループ ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (S) {
      if (S.step === 'run' && !S.runDone) {
        S.simT += dt * (S.stage.spec.tEnd / RUN_SECONDS) * S.speed;
        if (S.simT >= S.stage.spec.tEnd) { S.simT = S.stage.spec.tEnd; S.runDone = true; renderPanel(); }
      }
      drawLab(dt);
      drawMainGraph();
      if (S.step === 'predict') drawChoices();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
