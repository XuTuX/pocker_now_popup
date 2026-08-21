/* =========================================================================
 * PokerNow Hand Alert - gto.js
 * -------------------------------------------------------------------------
 * GTO 근사 전략 — 테이블 인원수에 따라 차트를 바꿔 쓴다.
 *
 *  - 프리플롭 : (인원수 티어) × 포지션 × 핸드 → 폴드/콜/레이즈 결정표
 *    티어: full(7~9명) / six(5~6명) / short(3~4명) / hu(헤즈업 2명)
 *    자주 쓰는 GTO 차트를 근사한 것. 레이크·스택에 따라 달라지므로
 *    아래 RANGES 문자열만 고치면 된다.
 *  - 포스트플롭: 몬테카를로 에퀴티(poker.js) vs 팟 오즈 비교
 *
 * content.js 가 window.PNHAGTO 에서 꺼내 쓴다.
 * ========================================================================= */

(() => {
  'use strict';

  const {
    expandHandRange, equityVsRange, RANK_NUM, NUM_RANK
  } = window.PNHACards;

  /* ===== 인원수 티어별 프리플롭 레인지 (100BB, 노 앤티 근사) =============
   * 표기: "A2s+" = A2s..AKs / "TT+" = TT..AA / 콤마로 구분.
   * 여기 문자열을 바꾸면 그대로 반영된다. */

  const RANGES = {
    // ---------- 7~9명 (풀링) ----------
    full: {
      RFI: {
        UTG: '22+, ATs+, KTs+, QTs+, JTs, T9s, 98s, AJo+, KQo',
        HJ:  '22+, A2s+, K9s+, Q9s+, J9s+, T8s+, 98s, 87s, ATo+, KJo+, QJo',
        CO:  '22+, A2s+, K7s+, Q9s+, J9s+, T8s+, 97s+, 87s, 76s, ATo+, KTo+, QTo+, JTo',
        BTN: '22+, A2s+, K4s+, Q7s+, J8s+, T8s+, 97s+, 86s+, 76s, 65s, 54s, A2o+, K9o+, Q9o+, J9o+, T9o',
        SB:  '22+, A2s+, K5s+, Q8s+, J8s+, T8s+, 97s+, 87s, 76s, 65s, 54s, A2o+, K9o+, Q9o+, J9o+, T9o'
      },
      VS_RAISE_3BET: {
        HJ:  'QQ+, AKs, AKo, A5s, A4s',
        CO:  'QQ+, AKs, AKo, A5s, A4s, KQs',
        BTN: 'JJ+, AKs, AKo, A5s, A4s, KQs, KJs, AJo',
        SB:  'JJ+, AKs, AKo, A5s, A4s, KQs, KJs, AJo'
      },
      VS_RAISE_CALL: {
        HJ:  '99+, AQs+, AKo, AQo, KQs, QJs, JTs, T9s',
        CO:  'TT+, AQs+, AKo, AQo, KQs, KJs, QJs, JTs, T9s, AJo',
        BTN: '22+, A2s+, K8s+, Q9s+, J9s+, T8s+, 98s, 87s, 76s, 65s, 54s, ATo+, KTo+, QTo+, JTo',
        SB:  '22+, A2s+, K7s+, Q9s+, J8s+, T8s+, 97s+, 87s, 76s, 65s, 54s, ATo+, KTo+, QTo+, JTo, T9o'
      },
      BB_3BET: 'QQ+, AKs, AKo, A5s, A4s, KQs, AJo, KQo',
      BB_CALL: '22+, A2s+, K4s+, Q8s+, J8s+, T8s+, 97s+, 86s+, 76s, 65s, 54s, A2o+, K8o+, Q9o+, J9o+, T9o',
      BB_ISO: '88+, AJo+, A9s+, KQs, KTs+, QTs+, JTs, T9s',
      VILLAIN: '22+, A2s+, K9s+, Q9s+, J9s+, T8s+, 98s, 87s, ATo+, KTo+, QTo+, JTo'
    },

    // ---------- 5~6명 (6-max) ----------
    six: {
      RFI: {
        UTG: '22+, A2s+, K9s+, Q9s+, J9s+, T8s+, 97s+, 87s, 76s, 65s, ATo+, KTo+, QTo+, JTo',
        HJ:  '22+, A2s+, K7s+, Q9s+, J9s+, T8s+, 97s+, 86s+, 76s, 65s, 54s, ATo+, KTo+, QTo+, JTo, T9o',
        CO:  '22+, A2s+, K4s+, Q7s+, J8s+, T7s+, 96s+, 86s+, 75s+, 65s, 54s, A2o+, K9o+, Q9o+, J9o+, T9o',
        BTN: '22+, A2s+, K2s+, Q3s+, J6s+, T6s+, 96s+, 85s+, 74s+, 64s+, 54s, 43s, A2o+, K6o+, Q8o+, J8o+, T8o+, 98o, 87o',
        SB:  '22+, A2s+, K4s+, Q7s+, J8s+, T8s+, 97s+, 87s, 76s, 65s, 54s, A2o+, K8o+, Q9o+, J9o+, T9o, 98o'
      },
      VS_RAISE_3BET: {
        HJ:  'QQ+, AKs, AKo, A5s, A4s, KQs',
        CO:  'JJ+, AKs, AKo, A5s, A4s, KQs, KJs, AJo',
        BTN: 'QQ+, AKs, AKo, A5s, A4s, KQs, KJs, QJs, JTs, T9s, AJo, KQo',
        SB:  'QQ+, AKs, AKo, A5s, A4s, KQs, KJs, QJs, JTs, T9s, AJo, KQo'
      },
      VS_RAISE_CALL: {
        HJ:  '99+, AQs+, AKo, AQo, KQs, QJs, JTs',
        CO:  'TT+, AQs+, AKo, AQo, KQs, KJs, QJs, JTs, T9s, AJo, KQo',
        BTN: '22+, A2s+, K9s+, Q9s+, J9s+, T8s+, 98s, 87s, 76s, 65s, 54s, ATo+, KTo+, QTo+, JTo',
        SB:  '22+, A2s+, K8s+, Q9s+, J9s+, T8s+, 98s, 87s, 76s, 65s, 54s, ATo+, KTo+, QTo+, JTo, T9o'
      },
      BB_3BET: 'JJ+, AKs, AKo, A5s, A4s, KQs, KJs, AJo, KQo, T9s, 98s',
      BB_CALL: '22+, A2s+, K5s+, Q8s+, J8s+, T8s+, 97s+, 86s+, 76s, 65s, 54s, A2o+, K9o+, Q9o+, J9o+, T9o',
      BB_ISO: '99+, AQs+, AKo, AQo, KQs, AJs, KJs',
      VILLAIN: '22+, A2s+, K7s+, Q9s+, J8s+, T8s+, 97s+, 86s+, 76s, 65s, 54s, ATo+, KTo+, QTo+, JTo, T9o'
    },

    // ---------- 3~4명 (쇼트) ----------
    short: {
      RFI: {
        CO:  '22+, A2s+, K2s+, Q6s+, J8s+, T8s+, 97s+, 86s+, 76s, 65s, 54s, A2o+, K9o+, Q9o+, J9o+, T9o',
        BTN: '22+, A2s+, K2s+, Q2s+, J4s+, T6s+, 96s+, 85s+, 75s+, 64s+, 54s, 43s, A2o+, K5o+, Q8o+, J8o+, T8o+, 98o, 87o',
        SB:  '22+, A2s+, K2s+, Q3s+, J6s+, T7s+, 97s+, 86s+, 76s, 65s, 54s, 43s, A2o+, K6o+, Q8o+, J8o+, T8o+, 98o, 87o'
      },
      VS_RAISE_3BET: {
        CO:  'QQ+, AKs, AKo, A5s, A4s, KQs, KJs, QJs',
        BTN: 'JJ+, AKs, AKo, A5s, A4s, KQs, KJs, QJs, JTs, T9s, AJo, KQo',
        SB:  'JJ+, AKs, AKo, A5s, A4s, KQs, KJs, QJs, JTs, T9s, AJo, KQo'
      },
      VS_RAISE_CALL: {
        CO:  '22+, A2s+, K8s+, Q9s+, J9s+, T8s+, 98s, 87s, 76s, 65s, 54s, ATo+, KTo+, QTo+, JTo',
        BTN: '22+, A2s+, K2s+, Q6s+, J8s+, T8s+, 97s+, 86s+, 76s, 65s, 54s, A2o+, K8o+, Q9o+, J9o+, T9o',
        SB:  '22+, A2s+, K3s+, Q7s+, J8s+, T8s+, 97s+, 86s+, 76s, 65s, 54s, A2o+, K8o+, Q9o+, J9o+, T9o'
      },
      BB_3BET: 'JJ+, AKs, AKo, A5s, A4s, KQs, KJs, AJo, KQo, T9s, 98s',
      BB_CALL: '22+, A2s+, K2s+, Q4s+, J7s+, T7s+, 96s+, 85s+, 75s+, 64s+, 54s, 43s, A2o+, K6o+, Q8o+, J8o+, T8o+, 98o, 87o',
      BB_ISO: '88+, ATs+, AJo+, KQs, KTs+, QTs+, JTs, T9s',
      VILLAIN: '22+, A2s+, K4s+, Q8s+, J8s+, T8s+, 97s+, 86s+, 76s, 65s, 54s, A2o+, K8o+, Q9o+, J9o+, T9o'
    },

    // ---------- 헤즈업 (2명) ----------
    hu: {
      RFI: {
        BTN: '22+, A2s+, K2s+, Q2s+, J2s+, T3s+, 93s+, 83s+, 73s+, 63s+, 53s+, 43s, A2o+, K2o+, Q4o+, J7o+, T7o+, 97o+, 87o, 76o'
      },
      VS_RAISE_3BET: {
        BTN: 'JJ+, AKs, AKo, A5s, A4s, KQs, KJs, QJs, JTs, T9s, AJo, KQo'
      },
      VS_RAISE_CALL: {
        BTN: '22+, A2s+, K2s+, Q5s+, J8s+, T8s+, 97s+, 86s+, 76s, 65s, 54s, A2o+, K7o+, Q9o+, J9o+, T9o'
      },
      BB_3BET: 'TT+, ATs+, A5s, A4s, KQs, KJs, AJo, KQo, QJs, JTs, T9s, 98s',
      BB_CALL: '22+, A2s+, K2s+, Q2s+, J3s+, T6s+, 96s+, 85s+, 75s+, 64s+, 54s, 43s, A2o+, K2o+, Q5o+, J8o+, T8o+, 98o, 87o',
      BB_ISO: '88+, ATs+, AJo+, KQs, KTs+, QTs+, JTs, T9s',
      VILLAIN: '22+, A2s+, K2s+, Q3s+, J6s+, T7s+, 97s+, 86s+, 76s, 65s, 54s, A2o+, K6o+, Q8o+, J8o+, T8o+, 98o, 87o'
    }
  };

  /* ===== 내부 도구 ======================================================== */

  const rangeCache = {};
  // 차트 문자열 → { combos(에퀴티용), hands(핸드 문자열 Set) }
  function buildRange(str) {
    if (!rangeCache[str]) {
      const combos = expandHandRange(str);
      const hands = new Set();
      for (const c of combos) {
        const hi = Math.max(c.r1, c.r2), lo = Math.min(c.r1, c.r2);
        const h = (c.r1 === c.r2)
          ? NUM_RANK(hi) + NUM_RANK(lo)
          : NUM_RANK(hi) + NUM_RANK(lo) + (c.s1 === c.s2 ? 's' : 'o');
        hands.add(h);
      }
      rangeCache[str] = { combos, hands };
    }
    return rangeCache[str];
  }
  const inRange = (hand, str) => !!str && buildRange(str).hands.has(hand);

  // 인원수 → 차트 티어. (한 핸드에 카드를 받은 인원수 기준)
  //   n = 7~9 → full / 5~6 → six / 3~4 → short / 2 → hu / 그 외 → six 기본
  function tierFor(n) {
    if (n >= 7) return 'full';
    if (n >= 5) return 'six';
    if (n === 2) return 'hu';
    if (n >= 3) return 'short';
    return 'six';
  }

  // 포지션 정규화: UTG+1/UTG+2 등은 UTG 로, 모르는 값은 가장 타이트한 UTG 로
  function normalizePosition(pos) {
    if (!pos) return null;
    if (pos === 'BTN/SB') return 'BTN';
    const p = String(pos).replace(/\+.*$/, '');
    return (p === 'HJ' || p === 'CO' || p === 'BTN' || p === 'SB' || p === 'BB' || p === 'UTG') ? p : 'UTG';
  }

  /* ===== 프리플롭 결정 ==================================================== */

  function preflopAction(ctx) {
    const pos = normalizePosition(ctx.position);
    if (!pos) return { action: 'wait', reason: '포지션 감지 안 됨' };
    const h = ctx.hand;
    if (!h) return { action: 'wait', reason: '핸드 없음' };
    const toCall = ctx.toCallBB;
    if (toCall == null) return { action: 'wait', reason: '콜 금액 모름' };

    const R = RANGES[tierFor(ctx.tableSize)] || RANGES.six;

    // BB 처리: 더 낼 돈 0 = 옵션(무료 체크), 0 초과 = 레이즈에 직면
    if (pos === 'BB') {
      if (toCall <= 0.01) {
        if (ctx.aggroAuto && inRange(h, R.BB_ISO)) return { action: 'raise', reason: 'BB 아이솔' };
        return { action: 'check', reason: 'BB 옵션' };
      }
      if (inRange(h, R.BB_3BET)) {
        return ctx.aggroAuto
          ? { action: 'raise', reason: 'BB 3벳', confident: false }
          : { action: 'wait', reason: '레이즈 권장', confident: false };
      }
      if (inRange(h, R.BB_CALL)) return { action: 'call', reason: '콜' };
      return { action: 'fold', reason: '폴드', confident: true };
    }

    // 감지 초기(베팅 아직 안 렌더) — 결정 보류
    if (toCall < 0.01) return { action: 'wait', reason: '베팅 대기' };

    // 레이즈 없음 (림프만) — 열린 레인지 기준
    if (toCall <= 1.01) {
      if (inRange(h, R.RFI[pos] || '')) {
        if (ctx.aggroAuto && pos !== 'BB') return { action: 'raise', reason: '아이솔' };
        return { action: 'call', reason: '림프 콜' };
      }
      return { action: 'fold', reason: '림프 폴드', confident: true };
    }

    // 오픈 레이즈에 직면
    if (inRange(h, R.VS_RAISE_3BET[pos] || '')) {
      return ctx.aggroAuto
        ? { action: 'raise', reason: '3벳', confident: false }
        : { action: 'wait', reason: '레이즈 권장', confident: false };
    }
    if (inRange(h, R.VS_RAISE_CALL[pos] || '')) return { action: 'call', reason: '콜' };
    return { action: 'fold', reason: '폴드', confident: true };
  }

  /* ===== 포스트플롭 결정 (에퀴티 vs 팟 오즈) ============================= */

  let eqCache = null; // { key, t, e }
  function equityCached(c1, c2, board, tier, iterations) {
    const key = tier + '|' +
      [c1.rank + c1.suit, c2.rank + c2.suit].sort().join('|') +
      '#' + board.map((c) => c.rank + c.suit).sort().join('');
    const now = Date.now();
    if (eqCache && eqCache.key === key && now - eqCache.t < 4000) return eqCache.e;
    const R = RANGES[tier] || RANGES.six;
    const e = equityVsRange([c1, c2], board, buildRange(R.VILLAIN).combos, iterations);
    eqCache = { key, t: now, e };
    return e;
  }

  function postflopAction(ctx) {
    if (ctx.toCallBB == null) return { action: 'wait', reason: '콜 금액 모름' };
    if (ctx.toCallBB <= 0.01) return { action: 'check', reason: '무료 체크' };
    if (!ctx.board || ctx.board.length < 3) return { action: 'wait', reason: '보드 부족' };
    if (ctx.potBB == null || ctx.potBB <= 0) return { action: 'wait', reason: '팟 크기 모름' };

    const tier = tierFor(ctx.tableSize);
    const eq = equityCached(ctx.c1, ctx.c2, ctx.board, tier, ctx.iterations);
    const required = ctx.toCallBB / (ctx.potBB + ctx.toCallBB);
    const CALL_MARGIN = 0.04;  // 이 정도 에퀴티 여유가 있어야 콜
    const FOLD_MARGIN = 0.02;  // 이보다 크게 부족하면 폴드
    const gap = eq.equity - required;

    let action, reason;
    if (gap >= CALL_MARGIN) { action = 'call'; reason = '에퀴티 충분'; }
    else if (gap <= -FOLD_MARGIN) { action = 'fold'; reason = '에퀴티 부족'; }
    else { action = 'fold'; reason = '경계 · 폴드'; } // 애매하면 폴드 (안전)
    return {
      action, reason,
      equity: eq.equity, required,
      confident: action === 'fold' && Math.abs(gap) > 0.08
    };
  }

  /* ===== 진입점 ========================================================== */

  // ctx: { c1, c2, hand, position, board, street(보드 장수),
  //        toCallBB, potBB, stackBB, tableSize(이번 핸드 인원수),
  //        aggroAuto, streetMode('preflop'|'all'), iterations }
  function decide(ctx) {
    try {
      if (!ctx || !ctx.hand) return { action: 'wait', reason: '핸드 없음' };
      if ((ctx.street || 0) === 0) return preflopAction(ctx);
      if (ctx.streetMode !== 'all') return { action: 'wait', reason: '포스트플롭 자동 꺼짐' };
      return postflopAction(ctx);
    } catch (e) {
      return { action: 'wait', reason: '판단 오류' };
    }
  }

  window.PNHAGTO = { decide, buildRange, inRange, normalizePosition, tierFor };
})();

