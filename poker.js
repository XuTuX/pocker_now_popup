/* =========================================================================
 * PokerNow Hand Alert - poker.js
 * -------------------------------------------------------------------------
 * 카드 요소 파싱 · 핸드 정규화("AKs") · 족보 계산만 담당한다.
 * 게임 상태나 설정에 의존하지 않는 순수 로직이라 따로 떼어냈다.
 * content.js 가 PNHACards 에서 꺼내 쓴다.
 * ========================================================================= */

(() => {
  'use strict';
  const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  const RANK_ORDER = Object.fromEntries(RANKS.map((r, i) => [r, i]));

  function looksLikeCard(el) {
    if (!el || el.nodeType !== 1) return false;
    const cls = (el.className || '').toString().toLowerCase();
    return !(cls.includes('back') || cls.includes('hidden') || cls.includes('folded'));
  }

  // 카드 요소 하나 → { rank, suit } (실패 시 null)
  function parseCardElement(element) {
    if (!element) return null;

    // 1) 컨테이너 클래스 토큰이 가장 안정적: card-s-<rank> + card-<suit>
    const byClass = parseFromClassTokens(element);
    if (byClass) return byClass;

    // 2) .value / .suit 자식 span (<span class="value">A</span><span class="suit">s</span>)
    if (element.querySelector) {
      const valueEl = element.querySelector('.value');
      const suitEl = element.querySelector('.suit:not(.sub-suit)') || element.querySelector('.suit');
      if (valueEl && suitEl) {
        const r = normalizeRank(valueEl.textContent);
        const s = normalizeSuit(suitEl.textContent);
        if (r && s) return { rank: r, suit: s };
      }
    }

    // 3) 표시 텍스트 백업 (예: "A♠")
    return fromText(element.textContent);
  }

  // 컨테이너 클래스에서 파싱: card-s-2 → 2, card-s-14 → A / card-c,h,d,s → 무늬
  function parseFromClassTokens(element) {
    const nodes = [];
    if (element.className) nodes.push(element);
    const cont = element.closest && element.closest('.card-container');
    if (cont && cont !== element) nodes.push(cont);
    for (const node of nodes) {
      const cls = (node.className || '').toString();
      const rankM = cls.match(/\bcard-s-(\d{1,2})\b/);
      const suitM = cls.match(/\bcard-([chsd])(?![\w-])/);
      if (rankM && suitM) {
        const r = rankNumToRank(rankM[1]);
        const s = normalizeSuit(suitM[1]);
        if (r && s) return { rank: r, suit: s };
      }
    }
    return null;
  }

  const rankNumToRank = (n) =>
    ({ 2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'T',11:'J',12:'Q',13:'K',14:'A' })[parseInt(n, 10)] || null;

  function normalizeRank(raw) {
    if (!raw) return null;
    let v = raw.toString().trim().toUpperCase();
    if (v === '10') v = 'T';
    return RANK_ORDER.hasOwnProperty(v) ? v : null;
  }

  function normalizeSuit(raw) {
    if (!raw) return null;
    const v = raw.toString().trim().toLowerCase();
    if (v[0] === 's' || v.includes('♠')) return 's';
    if (v[0] === 'h' || v.includes('♥')) return 'h';
    if (v[0] === 'd' || v.includes('♦')) return 'd';
    if (v[0] === 'c' || v.includes('♣')) return 'c';
    return null;
  }

  // "A♠", "10♥" 같은 텍스트 → { rank, suit }
  function fromText(text) {
    const t = (text || '').replace(/\s+/g, '');
    const m = t.match(/(10|[2-9TJQKA])([shdc♠♥♦♣])/i);
    if (!m) return null;
    const r = normalizeRank(m[1]);
    const s = normalizeSuit(m[2]);
    return (r && s) ? { rank: r, suit: s } : null;
  }

  // 두 카드 → "AA" / "AKs" / "AKo" (높은 랭크 앞)
  function normalizeHand(a, b) {
    if (!a || !b) return null;
    let hi = a, lo = b;
    if (RANK_ORDER[a.rank] < RANK_ORDER[b.rank]) { hi = b; lo = a; }
    if (hi.rank === lo.rank) return hi.rank + lo.rank;
    return hi.rank + lo.rank + (hi.suit === lo.suit ? 's' : 'o');
  }

  const prettyCard = (c) => c.rank + ({ s: '♠', h: '♥', d: '♦', c: '♣' }[c.suit] || c.suit);

  // 랭크 문자('2'~'A') → 숫자(2~14) / 숫자 → 문자
  const RANK_NUM = (r) => RANK_ORDER[r] + 2;
  const NUM_RANK = (n) => ({ 14:'A',13:'K',12:'Q',11:'J',10:'T' }[n] || String(n));

  // 요소 목록 → 앞면 카드 { rank, suit } 배열 (같은 카드 중복 제거)
  function parseCardList(nodeList) {
    const seen = new Set(), out = [];
    for (const el of nodeList) {
      if (!looksLikeCard(el)) continue;
      const c = parseCardElement(el);
      if (!c) continue;
      const k = c.rank + c.suit;
      if (seen.has(k)) continue;   // 카드-컨테이너/카드 중복 & 물리적 중복 방지
      seen.add(k); out.push(c);
    }
    return out;
  }

  // 카드 배열(숫자 랭크) → 최고 족보 { cat, high, kick }
  //   cat: 8 스트플 · 7 포카드 · 6 풀하우스 · 5 플러시 · 4 스트레이트
  //        3 트리플 · 2 투페어 · 1 원페어 · 0 하이카드
  function evalMade(cards) {
    const rc = {}, sc = {};
    for (const c of cards) { rc[c.r] = (rc[c.r] || 0) + 1; (sc[c.s] = sc[c.s] || []).push(c.r); }
    const ranks = cards.map((c) => c.r);

    const straightHigh = (arr) => {
      const set = new Set(arr);
      if (set.has(14)) set.add(1); // A-2-3-4-5(휠)
      const s = [...set].sort((a, b) => b - a);
      let run = 1;
      for (let i = 0; i < s.length - 1; i++) {
        if (s[i] - 1 === s[i + 1]) { run++; if (run >= 5) return s[i - 3]; }
        else run = 1;
      }
      return 0;
    };

    let flushSuit = null;
    for (const s in sc) if (sc[s].length >= 5) flushSuit = s;
    if (flushSuit) { const h = straightHigh(sc[flushSuit]); if (h) return { cat: 8, high: h }; }

    const byN = (n) => Object.keys(rc).map(Number).filter((r) => rc[r] === n).sort((a, b) => b - a);
    const quads = byN(4), trips = byN(3), pairs = byN(2);
    const uniq = [...new Set(ranks)].sort((a, b) => b - a);

    if (quads.length) return { cat: 7, high: quads[0], kick: uniq.find((r) => r !== quads[0]) || 0 };
    if (trips.length && (pairs.length || trips.length >= 2))
      return { cat: 6, high: trips[0], kick: trips.length >= 2 ? trips[1] : pairs[0] };
    if (flushSuit) return { cat: 5, high: sc[flushSuit].slice().sort((a, b) => b - a)[0] };
    const st = straightHigh(ranks);
    if (st) return { cat: 4, high: st };
    if (trips.length) return { cat: 3, high: trips[0] };
    if (pairs.length >= 2) return { cat: 2, high: pairs[0], kick: pairs[1] };
    if (pairs.length === 1) return { cat: 1, high: pairs[0], kick: uniq.find((r) => r !== pairs[0]) || 0 };
    return { cat: 0, high: uniq[0], kick: uniq[1] || 0 };
  }

  const MADE_NAMES = {
    8: '스트레이트 플러시', 7: '포카드', 6: '풀하우스', 5: '플러시',
    4: '스트레이트', 3: '트리플', 2: '투페어', 1: '원페어', 0: '하이카드'
  };

  // 홀카드 2장 + 보드 → 사람이 읽을 족보 { name, klass, usesHole }
  function describeMade(c1, c2, board) {
    const toN = (c) => ({ r: RANK_NUM(c.rank), s: c.suit });
    const all = [c1, c2, ...board].map(toN);
    const m = evalMade(all);
    const b = evalMade(board.map(toN)); // 보드만으로도 같은 족보면 = "보드 플레이"

    let name = MADE_NAMES[m.cat];
    if (m.cat === 8 && m.high === 14) name = '로열 플러시';
    const hi = NUM_RANK(m.high), kk = NUM_RANK(m.kick);
    if (m.cat === 2) name += ' ' + hi + '·' + kk;        // 투페어 K·9
    else if (m.cat === 6) name += ' ' + hi + '/' + kk;   // 풀하우스 K/9
    else if (m.cat === 4 || m.cat === 8) name += ' ' + hi + ' high';
    else name += ' ' + hi;                                // 원페어 K, 트리플 8, 하이카드 A …

    const sameTuple = m.cat === b.cat && m.high === b.high && (m.kick || 0) === (b.kick || 0);
    const klass = m.cat >= 4 ? 'made-strong' : m.cat >= 1 ? 'made-mid' : 'made-weak';
    return { name, klass, usesHole: !sameTuple };
  }

  /* =========================================================================
   * GTO 근사용: 핸드 레인지 확장 & 몬테카를로 에퀴티
   * -------------------------------------------------------------------------
   *  - expandHandRange : "A2s+", "TT+", "KQo" 같은 차트 표기 → 콤보 배열
   *  - equityVsRange   : 내 홀카드 vs 상대 레인지(콤보 배열) 승률(에퀴티) 계산
   *   (+ 관례: "A2s+" = 같은 탑카드, 키커가 2~K 까지. "TT+" = TT~AA)
   * ========================================================================= */

  const SUITS = ['s', 'h', 'd', 'c'];
  const RANKS_NUM = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

  // 숫자 랭크 카드 → "As" 형태 키
  const numKey = (r, s) => NUM_RANK(r) + s;
  const cardNum = (c) => ({ r: RANK_NUM(c.rank), s: c.suit });

  // 페어 한 벌(6콤보) 추가
  function pushPairs(out, rankNum) {
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) out.push({ r1: rankNum, s1: SUITS[i], r2: rankNum, s2: SUITS[j] });
  }

  // "XYs+"/"XYo+" 처럼 "+"가 붙은 그룹 하나 → 콤보 배열 (탑카드 고정, 키커 lo~hi-1)
  function expandPlusGroup(r1, r2, suited) {
    const hi = Math.max(r1, r2), lo = Math.min(r1, r2);
    const out = [];
    if (suited) {
      for (let k = lo; k <= hi - 1; k++) for (const s of SUITS) out.push({ r1: hi, s1: s, r2: k, s2: s });
    } else {
      for (let k = lo; k <= hi - 1; k++) {
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (i !== j) out.push({ r1: hi, s1: SUITS[i], r2: k, s2: SUITS[j] });
      }
    }
    return out;
  }

  // "AA, AKs, AKo, TT+, A2s+, KQo" 형식 문자열 → 콤보 배열
  function expandHandRange(groups) {
    const list = Array.isArray(groups) ? groups : [groups];
    const out = [];
    for (const g of list) {
      for (const part of String(g).split(',')) {
        const p = part.trim().replace(/\s+/g, '');
        if (!p) continue;
        // 페어 플러스: 22+ → 22..AA
        const pairPlus = p.match(/^([2-9TJQKA])\1\+$/);
        if (pairPlus) {
          for (let r = RANK_NUM(pairPlus[1]); r <= 14; r++) pushPairs(out, r);
          continue;
        }
        // 단순 페어: AA, KK, 88 …
        const exactPair = p.match(/^([2-9TJQKA])\1$/);
        if (exactPair) {
          pushPairs(out, RANK_NUM(exactPair[1]));
          continue;
        }
        const plus = p.match(/^([2-9TJQKA])([2-9TJQKA])([so])\+$/);
        if (plus) {
          out.push(...expandPlusGroup(RANK_NUM(plus[1]), RANK_NUM(plus[2]), plus[3] === 's'));
          continue;
        }
        const exact = p.match(/^([2-9TJQKA])([2-9TJQKA])([so])$/);
        if (exact) {
          const a = RANK_NUM(exact[1]), b = RANK_NUM(exact[2]);
          out.push(...expandPlusGroup(a, b, exact[3] === 's'));
          continue;
        }
        // 인식 못 하는 표기 → 조용히 무시 (차트에 오타가 있어도 크래시 방지)
      }
    }
    return out;
  }

  // 족보 비교: >0 이면 a 가 이김, 0 이면 비김
  function rankCompare(a, b) {
    if (a.cat !== b.cat) return a.cat - b.cat;
    if (a.high !== b.high) return a.high - b.high;
    return (a.kick || 0) - (b.kick || 0);
  }

  // 몬테카를로 에퀴티.
  //   heroCards : 내 홀카드 [{rank,suit}] 2장
  //   boardCards: 보드 0~4장 (플롭 이후엔 3장 이상)
  //   comboList : 상대 레인지 콤보 배열 (expandHandRange 결과)
  //   iterations: 시뮬레이션 횟수 (기본 1200)
  // → { win, tie, equity }  equity = (win + tie*0.5) / iterations
  function equityVsRange(heroCards, boardCards, comboList, iterations) {
    iterations = iterations || 1200;
    const heroNum = heroCards.map(cardNum);
    const boardNum = boardCards.map(cardNum);
    const dead = new Set();
    for (const c of [...heroNum, ...boardNum]) dead.add(numKey(c.r, c.s));

    // 내 카드/보드와 겹치지 않는 상대 콤보만 남긴다
    const pool = comboList.filter((c) => !dead.has(numKey(c.r1, c.s1)) && !dead.has(numKey(c.r2, c.s2)));
    if (!pool.length) return { win: 0, tie: 0, equity: 0 };

    const deck = [];
    for (const r of RANKS_NUM) for (const s of SUITS) if (!dead.has(numKey(r, s))) deck.push({ r, s });
    const need = 5 - boardNum.length;

    let win = 0, tie = 0;
    for (let i = 0; i < iterations; i++) {
      const v = pool[(Math.random() * pool.length) | 0];
      const work = deck.slice();
      // 상대 카드를 덱에서 제거한 뒤 남은 보드 카드를 뽑는다
      for (const card of [{ r: v.r1, s: v.s1 }, { r: v.r2, s: v.s2 }]) {
        for (let j = 0; j < work.length; j++) {
          if (work[j].r === card.r && work[j].s === card.s) { work.splice(j, 1); break; }
        }
      }
      const drawn = [];
      for (let n = 0; n < need; n++) {
        const idx = (Math.random() * work.length) | 0;
        drawn.push(work[idx]); work.splice(idx, 1);
      }
      const heroAll = [...heroNum, ...boardNum, ...drawn];
      const villainAll = [{ r: v.r1, s: v.s1 }, { r: v.r2, s: v.s2 }, ...boardNum, ...drawn];
      const cmp = rankCompare(evalMade(heroAll), evalMade(villainAll));
      if (cmp > 0) win++; else if (cmp === 0) tie++;
    }
    return { win, tie, equity: (win + tie * 0.5) / iterations };
  }

  window.PNHACards = {
    RANKS, RANK_ORDER, looksLikeCard, parseCardElement, normalizeRank, normalizeSuit,
    fromText, normalizeHand, prettyCard, RANK_NUM, NUM_RANK, parseCardList,
    evalMade, MADE_NAMES, describeMade,
    SUITS, RANKS_NUM, numKey, cardNum, expandHandRange, rankCompare, equityVsRange
  };
})();
