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

  // poker.js 가 먼저 로드되어 window.PNHACards 를 만든다.
  // 만약 실패해도 이 파일이 로드 시점에 throw 하지 않도록 방어한다.
  // (content script 중간 파일이 죽으면 뒤따르는 content.js 주입이 중단될 수 있다)
  const P = window.PNHACards || {};
  const {
    expandHandRange, equityVsRange, RANK_NUM, NUM_RANK
  } = P;
  if (!window.PNHACards) console.error('[PokerAlert] gto.js: window.PNHACards 없음 — poker.js 로드 실패?');

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

  /* ===== 큰 사이즈(3벳·올인) 전용 레인지 =================================
   * 사이즈가 커지면 ① 상대 레인지는 좁아지고 ② 내가 콜하려면 더 좋은 패가 필요하다.
   * 위의 RANGES 는 "2.5~4BB 오픈에 직면" 을 가정한 표라서, 그것보다 큰 돈을
   * 요구받았을 때 그대로 쓰면 안 된다. (예전엔 3BB 오픈이든 100BB 올인이든
   * 같은 표로 22 를 콜했다) 인원수와 상관없이 이 공용 레인지를 쓴다.
   * ===================================================================== */
  const BIG = {
    // 3벳 사이즈(≈7~12BB)에 직면했을 때
    CALL_VS_3BET: 'TT+, AJs+, KQs, AQo+',
    FOURBET:      'QQ+, AKs, AKo, A5s',
    // 상대가 올인/초대형 베팅으로 밀어넣을 만한 레인지 (그 금액이 깊을수록 좁다)
    SHOVE_SHORT: '22+, A2s+, K7s+, Q9s+, J9s+, T9s, A7o+, K9o+, QTo+, JTo',  // ~15BB
    SHOVE_MID:   '55+, A7s+, K9s+, QTs+, JTs, ATo+, KJo+',                    // 15~35BB
    SHOVE_DEEP:  '99+, AJs+, KQs, AQo+',                                      // 35BB~
    // 포스트플롭에서 상대가 크게 걸었을 때의 레인지
    POT_BET: '22+, A2s+, KTs+, QTs+, JTs, T9s, 98s, ATo+, KJo+',
    OVERBET: 'TT+, AJs+, KQs, AQo+'
  };

  // 상대가 밀어넣은 금액(BB) → 그 사이즈로 올인할 만한 레인지
  const shoveRangeFor = (facedBB) =>
    facedBB <= 15 ? BIG.SHOVE_SHORT : (facedBB <= 35 ? BIG.SHOVE_MID : BIG.SHOVE_DEEP);

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

  /* ===== 레이즈 사이즈 =====================================================
   * PokerNow 입력창은 "raise to"(이번 스트리트에 낼 총액) 를 받는다.
   * 그래서 여기서 내는 숫자도 전부 "총액(BB)" 이다.
   *   오픈      : 2.5BB + 림퍼 1명당 1BB
   *   BB 아이솔 : 4BB   + 림퍼 1명당 1BB
   *   3벳       : 상대 총액 × 3 (내가 SB/BB 면 ×4) + 죽은 돈
   *   포스트플롭: 벳 = 팟의 60% / 레이즈 = 상대 총액 × 3
   * 스택의 75% 를 넘게 들어가면 어차피 커밋이라 그냥 올인한다.
   * ======================================================================= */

  const roundHalfBB = (x) => Math.round(x * 2) / 2;

  // to = 내가 만들고 싶은 총액(BB), top = 지금 맞춰야 하는 총액(BB)
  function clampSize(ctx, to, top) {
    const mine = ctx.myBetBB || 0;
    const allIn = (ctx.stackBB != null ? ctx.stackBB : Infinity) + mine; // 올인 상한
    let v = Math.max(to, top > 0 ? top * 2 : 1);   // 최소 레이즈(상대 총액의 2배) 보장
    if (v >= allIn * 0.75) v = allIn;              // 75% 넘으면 그냥 올인
    return Math.min(roundHalfBB(v), allIn);
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

    // 레이즈 사이즈 재료: 맞춰야 하는 총액 / 죽은 돈(림퍼) / 내 포지션
    const faced = toCall + (ctx.myBetBB || 0);   // 맞추려면 이번 스트리트에 총 얼마를 내야 하나
    const top = Math.max(faced, 1);
    const dead = Math.max(0, ctx.limpers || 0);
    const oop = (pos === 'SB' || pos === 'BB');
    const sizeOf = (kind) => clampSize(ctx,
      kind === 'open' ? 2.5 + dead
      : kind === 'iso' ? 4 + dead
      : top * (oop ? 4 : 3) + dead, top);

    // BB 옵션 (더 낼 돈 0 = 공짜)
    if (pos === 'BB' && toCall <= 0.01) {
      if (ctx.aggroAuto && inRange(h, R.BB_ISO)) return { action: 'raise', reason: 'BB 아이솔', sizeBB: sizeOf('iso') };
      return { action: 'check', reason: 'BB 옵션' };
    }

    /* ── 사이즈 게이트 ────────────────────────────────────────────────
     * 아래 차트(VS_RAISE_*, BB_*)는 전부 "2.5~4BB 오픈" 을 가정한 표다.
     * 그것보다 큰 돈을 요구받았으면 표를 그대로 쓰면 안 된다. */
    if (toCall >= 0.01) {
      // 올인이거나 / 12BB 이상이거나 / 내 스택의 35% 이상을 요구받으면
      // 표가 아니라 "에퀴티 vs 팟 오즈" 로 판단한다 (프리플롭 올인 계산).
      const commit = (ctx.stackBB != null && ctx.stackBB > 0) ? toCall / ctx.stackBB : null;
      const huge = !!ctx.villainAllIn || faced >= 12 || (commit != null && commit >= 0.35);

      if (huge) {
        // 내가 프리미엄이고 상대가 올인이 아니면 되받아친다 (보통 올인 사이즈가 나온다)
        if (inRange(h, BIG.FOURBET) && !ctx.villainAllIn) {
          return ctx.aggroAuto
            ? { action: 'raise', reason: '4벳', sizeBB: clampSize(ctx, faced * 2.4, faced), confident: false }
            : { action: 'wait', reason: '레이즈 권장', sizeBB: clampSize(ctx, faced * 2.4, faced), confident: false };
        }
        if (ctx.potBB == null || ctx.potBB <= 0) return { action: 'wait', reason: '팟 크기 모름' };
        const vRange = shoveRangeFor(faced);
        const eq = equityCached(ctx.c1, ctx.c2, [], vRange, ctx.iterations).equity;
        // 멀티웨이일수록 콜 기준을 올린다 (헤즈업 에퀴티 가정 보정)
        const vCount = Math.max(1, ctx.villains != null ? ctx.villains : (ctx.tableSize || 1) - 1);
        const required = Math.min(0.95, (toCall / (ctx.potBB + toCall)) * (1 + 0.12 * Math.max(0, vCount - 1)));
        const label = ctx.villainAllIn ? '올인' : '큰 베팅';
        return (eq - required >= 0.04)
          ? { action: 'call', reason: label + ' · 에퀴티 충분', equity: eq, required, confident: false }
          : { action: 'fold', reason: label + ' · 에퀴티 부족', equity: eq, required, confident: true };
      }

      // 3벳 사이즈(4.5BB 초과 ~ 12BB): 오픈용 표 대신 좁은 표를 쓴다
      if (faced > 4.5) {
        if (inRange(h, BIG.FOURBET)) {
          return ctx.aggroAuto
            ? { action: 'raise', reason: '4벳', sizeBB: sizeOf('3bet'), confident: false }
            : { action: 'wait', reason: '레이즈 권장', sizeBB: sizeOf('3bet'), confident: false };
        }
        if (inRange(h, BIG.CALL_VS_3BET)) return { action: 'call', reason: '3벳에 콜' };
        return { action: 'fold', reason: '3벳 · 폴드', confident: true };
      }
    }

    // BB 처리: 여기부터는 "평범한 오픈에 직면" 이다
    if (pos === 'BB') {
      if (inRange(h, R.BB_3BET)) {
        return ctx.aggroAuto
          ? { action: 'raise', reason: 'BB 3벳', sizeBB: sizeOf('3bet'), confident: false }
          : { action: 'wait', reason: '레이즈 권장', sizeBB: sizeOf('3bet'), confident: false };
      }
      if (inRange(h, R.BB_CALL)) return { action: 'call', reason: '콜' };
      return { action: 'fold', reason: '폴드', confident: true };
    }

    // 감지 초기(베팅 아직 안 렌더) — 결정 보류
    if (toCall < 0.01) return { action: 'wait', reason: '베팅 대기' };

    // 레이즈 없음 (림프만) — 열린 레인지 기준
    if (toCall <= 1.01) {
      if (inRange(h, R.RFI[pos] || '')) {
        if (ctx.aggroAuto && pos !== 'BB') {
          return { action: 'raise', reason: dead ? '아이솔' : '오픈', sizeBB: sizeOf(dead ? 'iso' : 'open') };
        }
        return { action: 'call', reason: '림프 콜' };
      }
      return { action: 'fold', reason: '림프 폴드', confident: true };
    }

    // 오픈 레이즈에 직면
    if (inRange(h, R.VS_RAISE_3BET[pos] || '')) {
      return ctx.aggroAuto
        ? { action: 'raise', reason: '3벳', sizeBB: sizeOf('3bet'), confident: false }
        : { action: 'wait', reason: '레이즈 권장', sizeBB: sizeOf('3bet'), confident: false };
    }
    if (inRange(h, R.VS_RAISE_CALL[pos] || '')) return { action: 'call', reason: '콜' };
    return { action: 'fold', reason: '폴드', confident: true };
  }

  /* ===== 포스트플롭 결정 (에퀴티 vs 팟 오즈) ============================= */

  let eqCache = null; // { key, t, e }
  // 상대 레인지 문자열을 그대로 받는다 — 같은 보드라도 상대가 건 사이즈에 따라
  // 레인지가 달라지므로 캐시 키에도 레인지가 들어가야 한다.
  function equityCached(c1, c2, board, rangeStr, iterations) {
    const key = rangeStr + '|' +
      [c1.rank + c1.suit, c2.rank + c2.suit].sort().join('|') +
      '#' + board.map((c) => c.rank + c.suit).sort().join('');
    const now = Date.now();
    if (eqCache && eqCache.key === key && now - eqCache.t < 4000) return eqCache.e;
    const e = equityVsRange([c1, c2], board, buildRange(rangeStr).combos, iterations);
    eqCache = { key, t: now, e };
    return e;
  }

  // 상대가 이번 스트리트에 건 돈이 팟 대비 얼마나 큰지로 상대 레인지를 좁힌다.
  //   ~55% 팟 → 평소 레인지 / 55~100% → 좁게 / 100%↑·올인 → 아주 좁게
  function villainRangeFor(ctx, R) {
    const pot = ctx.potBB || 0, bet = ctx.toCallBB || 0;
    if (!pot || !bet) return R.VILLAIN;
    if (ctx.villainAllIn || bet / pot >= 1) return BIG.OVERBET;
    if (bet / pot >= 0.55) return BIG.POT_BET;
    return R.VILLAIN;
  }

  const VALUE_BET_EQ = 0.68;   // 아무도 안 걸었을 때 밸류 벳을 넣는 에퀴티
  const VALUE_RAISE_EQ = 0.72; // 상대 베팅에 레이즈로 올리는 에퀴티

  function postflopAction(ctx) {
    if (ctx.toCallBB == null) return { action: 'wait', reason: '콜 금액 모름' };
    const boardOk = ctx.board && ctx.board.length >= 3 && ctx.potBB != null && ctx.potBB > 0;

    // 아무도 안 걸었다 → 보통은 공짜 체크. 단 에퀴티가 아주 좋고 레이즈=자동이면 밸류 벳.
    if (ctx.toCallBB <= 0.01) {
      if (ctx.aggroAuto && boardOk) {
        const RR = RANGES[tierFor(ctx.tableSize)] || RANGES.six;
        const e = equityCached(ctx.c1, ctx.c2, ctx.board, RR.VILLAIN, ctx.iterations);
        if (e.equity >= VALUE_BET_EQ) {
          return { action: 'raise', reason: '밸류 벳', equity: e.equity,
                   sizeBB: clampSize(ctx, ctx.potBB * 0.6, 0) };
        }
      }
      return { action: 'check', reason: '무료 체크' };
    }
    if (!boardOk) {
      if (!ctx.board || ctx.board.length < 3) return { action: 'wait', reason: '보드 부족' };
      return { action: 'wait', reason: '팟 크기 모름' };
    }

    const R = RANGES[tierFor(ctx.tableSize)] || RANGES.six;
    const vRange = villainRangeFor(ctx, R);          // 사이즈가 크면 상대 레인지도 좁다
    const eq = equityCached(ctx.c1, ctx.c2, ctx.board, vRange, ctx.iterations);
    // 멀티웨이 보정: 헤즈업 1명 가정 에퀴티를 여러 상대에게 그대로 쓰면 콜을 너무 자주 한다.
    // 상대 수가 많을수록 필요 에퀴티를 끌어올린다.
    const vCount = Math.max(1, ctx.villains != null ? ctx.villains : 1);
    const required = Math.min(0.95, (ctx.toCallBB / (ctx.potBB + ctx.toCallBB)) * (1 + 0.12 * Math.max(0, vCount - 1)));
    const CALL_MARGIN = 0.04;  // 이 정도 에퀴티 여유가 있어야 콜
    const FOLD_MARGIN = 0.02;  // 이보다 크게 부족하면 폴드
    const gap = eq.equity - required;

    let action, reason, sizeBB = null;
    if (gap >= CALL_MARGIN) {
      // 상대가 이미 올인이면 올릴 곳이 없다 — 콜만 가능
      if (ctx.aggroAuto && !ctx.villainAllIn && eq.equity >= VALUE_RAISE_EQ) {
        // 상대 총액의 3배로 올린다 (레이즈=자동일 때만)
        const top = ctx.toCallBB + (ctx.myBetBB || 0);
        action = 'raise'; reason = '밸류 레이즈'; sizeBB = clampSize(ctx, top * 3, top);
      } else { action = 'call'; reason = '에퀴티 충분'; }
    }
    else if (gap <= -FOLD_MARGIN) { action = 'fold'; reason = '에퀴티 부족'; }
    else { action = 'fold'; reason = '경계 · 폴드'; } // 애매하면 폴드 (안전)
    return {
      action, reason, sizeBB,
      equity: eq.equity, required,
      confident: action === 'fold' && Math.abs(gap) > 0.08
    };
  }

  /* ===== 진입점 ========================================================== */

  // ctx: { c1, c2, hand, position, board, street(보드 장수),
  //        toCallBB, potBB, stackBB, myBetBB(이번 스트리트 내 베팅),
  //        limpers(프리플롭 림퍼 수), villainAllIn(상대 올인 여부),
  //        tableSize(이번 핸드 인원수),
  //        aggroAuto, streetMode('preflop'|'all'), iterations }
  // 반환: { action, reason, sizeBB(레이즈일 때 "총 얼마까지" · BB), equity, required }
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
