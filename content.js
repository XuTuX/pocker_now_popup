/* =========================================================================
 * PokerNow Hand Alert - content.js
 * -------------------------------------------------------------------------
 * PokerNow 게임 페이지에서 실행되어:
 *   1) 내 홀카드 2장을 감지하고 "AA", "AKs" 처럼 정규화한다.
 *   2) 화면 위 오버레이(HUD)에 현재 패 / 프리미엄 여부 / 내 차례 남은시간 /
 *      내 스택·낸 돈·더 낼 돈(전부 BB 단위)을 항상 표시한다.
 *      (⧉ 버튼으로 다른 창 위에 뜨는 PiP 창으로 뺄 수 있음)
 *   3) 프리미엄 핸드면 알림음을 낸다.
 *
 * ⚠️ 게임 버튼을 "자동으로" 누르는 기능은 없다. 폴드는 사용자가 오버레이
 *    버튼 / F 키 / 팝업 버튼을 직접 눌렀을 때만 실행된다.
 * ========================================================================= */

(() => {
  'use strict';

  /* ===== 설정: DEBUG & 셀렉터 (감지가 안 되면 여기만 고치면 됨) ============ */

  const DEBUG = true;
  const log = (...a) => { if (DEBUG) console.log('[PokerAlert]', ...a); };

  // 내 자리(hero) 컨테이너 후보
  const HERO_CONTAINER_SELECTORS = ['.table-player.you-player', '.you-player', '.hero-player'];

  // 카드 요소 후보 (PokerNow: .table-player-cards > .card-container > ... > .card)
  const CARD_SELECTORS = [
    '.table-player-cards .card-container',
    '.table-player-cards .card',
    '.card-container',
    '.card'
  ];

  // Fold 버튼 후보
  const FOLD_BUTTON_SELECTORS = ['.action-buttons .fold', '.action-button.fold', '.game-decisions-ctn .fold'];

  // 블라인드 표시(칩 → BB 환산용)
  const BLIND_SELECTORS = ['.blind-value', '.blind-value-ctn'];

  // 실제 PokerNow DOM (game.bundle 확인):
  //   자리   : <div class="table-player table-player-N [you-player] [decision-current] [fold]">
  //   스택   : <p class="table-player-stack"><span class="chips-value"><span class="normal-value">14114
  //   베팅   : <p class="table-player-bet-value"><span class="chips-value"><span class="normal-value">600
  //            (currentBet 이 있을 때만 렌더. 체크면 class 에 check 가 붙고 텍스트는 "check")
  //   타이머 : <div class="time-to-talk"><div class="time-bank" style="width:N%"><div class="normal-time" style="width:N%">
  //   ★ chips-value 는 BB 표시 모드일 때 .bb-value(BB) 와 .normal-value(원래 칩) 를 둘 다 갖는다.
  //     그래서 칩은 항상 .normal-value 에서만 읽어야 한다.
  const STACK_SELECTOR = '.table-player-stack';
  const BET_SELECTOR = '.table-player-bet-value';
  const TIMER_SELECTOR = '.time-to-talk';

  // 액션 버튼이 들어있는 컨테이너
  const ACTION_ROOT_SELECTORS = ['.action-buttons', '.game-decisions-ctn'];

  // 액션 버튼 텍스트 (클래스로 못 찾을 때 폴백)
  const ACTION_WORDS = { call: ['call', '콜'], check: ['check', '체크'] };


  // 커뮤니티 카드(보드: 플롭/턴/리버) 컨테이너 후보
  const BOARD_SELECTORS = ['.table-cards', '.community-cards', '.board-cards', '.table-cards-ctn', '.community', '.board'];

  const FOLD_HOTKEY = 'f'; // '' 로 두면 단축키 끔

  const THROTTLE_MS = 600;   // 변경 폭주 시에도 이 간격으로는 반드시 검사
  const HEARTBEAT_MS = 1200; // 변경이 없어도 주기적으로 검사

  const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  const RANK_ORDER = Object.fromEntries(RANKS.map((r, i) => [r, i]));

  /* ===== 상태 & 설정 ====================================================== */

  let settings = defaultSettings();
  let lastRawKey = null;     // 마지막 감지 카드 키 (새 핸드 판별)
  let preFoldArmed = false;  // 내가 "미리 폴드"를 예약했는지 (취소 가능)
  let audioCtx = null;

  // 자리 번호가 도는 방향(+1/−1). 한 번 알아내면 그 테이블 내내 같다.
  //   src: 'blinds'(확실) > 'geometry'(자리 좌표로 추정). 블라인드를 보면 덮어쓴다.
  let seatDir = null, seatDirSrc = null;
  // 이번 핸드에 내가 블라인드였는지 ('SB' | 'BB' | null) — 방향을 몰라도 이건 확실하다
  let heroBlindRole = null;
  // 이번 핸드에 카드를 받은 자리 번호들 (폴드해서 카드가 사라져도 유지)
  let handSeats = new Set();

  // 이번 핸드에 낸 돈 = (핸드 시작 전 스택) − (지금 스택)
  let idleStack = null;      // 핸드와 핸드 사이(내 카드가 없을 때) 스택
  let handStartStack = null; // 이번 핸드가 시작될 때의 스택
  // 내 차례 제한시간 바.
  //  t0 = 차례 시작 시각 / r = 마지막으로 본 남은 비율
  //  aT,aR = "바가 처음 줄어든 순간"의 시각·비율 (여기부터 평균 속도를 잰다)
  let turnTimer = { active: false, t0: 0, r: 1, aT: 0, aR: 0 };

  function defaultSettings() {
    return { enabled: true, soundEnabled: true, hands: ['AA', 'KK', 'QQ', 'JJ', 'AKs', 'AKo'] };
  }

  // 확장 컨텍스트 생존 확인 (확장 재로드 후 옛 스크립트의 chrome.* 에러 방지)
  const extensionAlive = () => {
    try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch (e) { return false; }
  };
  const safe = (fn) => { if (extensionAlive()) { try { fn(); } catch (e) { /* ignore */ } } };

  function loadSettings() {
    chrome.storage.local.get('settings', (data) => {
      if (data && data.settings) settings = Object.assign(defaultSettings(), data.settings);
      log('설정 로드:', settings);
    });
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) {
      settings = Object.assign(defaultSettings(), changes.settings.newValue || {});
    }
  });

  /* ===== 카드 감지 & 정규화 =============================================== */

  // 내 홀카드 2장 요소를 찾는다. (값이 실제로 읽히는 카드만 → 상대 빈 카드 제외)
  function findHoleCardElements() {
    // hero 컨테이너 안에서 우선 탐색
    for (const containerSel of HERO_CONTAINER_SELECTORS) {
      const container = document.querySelector(containerSel);
      if (!container) continue;
      for (const cardSel of CARD_SELECTORS) {
        const cards = Array.from(container.querySelectorAll(cardSel))
          .filter(looksLikeCard)
          .filter((el) => parseCardElement(el) !== null);
        if (cards.length === 2) return cards;
      }
    }
    // 컨테이너를 못 찾으면 페이지 전체에서 읽히는 카드 2장 추정
    for (const cardSel of CARD_SELECTORS) {
      const readable = Array.from(document.querySelectorAll(cardSel))
        .filter(looksLikeCard)
        .filter((el) => parseCardElement(el) !== null);
      if (readable.length === 2) return readable;
    }
    return [];
  }

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

  /* ===== 보드(커뮤니티 카드) 읽기 & 족보 계산 ============================ */

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

  // 보드 카드(3~5장)를 읽는다. holeKeys = 내 홀카드 키 Set (보드에서 제외).
  function readBoardCards(holeKeys) {
    // 1) 명시적 보드 컨테이너 우선
    for (const sel of BOARD_SELECTORS) {
      const ctn = document.querySelector(sel);
      if (!ctn) continue;
      const cards = parseCardList(ctn.querySelectorAll('.card-container, .card'))
        .filter((c) => !holeKeys.has(c.rank + c.suit));
      if (cards.length >= 3 && cards.length <= 5) return cards;
    }
    // 2) 폴백: 페이지 전체 앞면 카드 − 내 홀카드 = 보드 (컨테이너 클래스 무관)
    const all = parseCardList(document.querySelectorAll('.card-container, .card'))
      .filter((c) => !holeKeys.has(c.rank + c.suit));
    if (all.length >= 3 && all.length <= 5) return all;
    return []; // 프리플롭이거나 감지 실패
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

  /* ===== 게임 상태 읽기: 내 차례 / 폴드 / 콜 정보 ========================= */

  // 내 액션 차례 = 내 자리에 'decision-current' 클래스가 있을 때만 (그 외엔 아님).
  function isMyTurn() {
    for (const sel of HERO_CONTAINER_SELECTORS) {
      const hero = document.querySelector(sel);
      if (hero && / decision-current /.test(' ' + (hero.className || '') + ' ')) return true;
    }
    return false;
  }

  // 사전 액션 "폴드"가 예약(활성)되어 있는지 DOM 에서 감지.
  //  ★ 예약 표시가 안 맞으면 아래 정규식(활성 클래스)을 조정하세요. ★
  const FOLD_ARMED_RE = /\b(active|selected|highlighted|pre-?selected|checked|is-active|toggled)\b/;
  function isFoldArmedInDom() {
    const btns = document.querySelectorAll('.action-button, button, [role="button"]');
    for (const b of btns) {
      if (!(b.textContent || '').trim().toLowerCase().includes('fold')) continue;
      const cls = ' ' + (b.className || '').toString().toLowerCase() + ' ';
      if (FOLD_ARMED_RE.test(cls) || b.getAttribute('aria-pressed') === 'true') return true;
    }
    return false;
  }

  // 내가 이번 핸드에서 폴드(죽음)했는지
  function isHeroFolded() {
    for (const sel of HERO_CONTAINER_SELECTORS) {
      const hero = document.querySelector(sel);
      if (!hero) continue;
      const cls = ' ' + (hero.className || '').toString().toLowerCase() + ' ';
      if (/\bfold(ed)?\b|not-in-hand|inactive|sitting-out/.test(cls)) return true;
    }
    return false;
  }

  const firstNumber = (str) => {
    const m = (str || '').toString().replace(/,/g, '').match(/\d+(?:\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  };

  // 블라인드 표기에서 숫자들을 읽는다 → { sb: 가장 작은 값, bb: 가장 큰 값 }
  function getBlinds() {
    for (const sel of BLIND_SELECTORS) {
      const ctn = document.querySelector(sel);
      if (!ctn) continue;
      const nums = Array.from(ctn.querySelectorAll('.normal-value'))
        .map((el) => firstNumber(el.textContent)).filter((n) => n > 0);
      if (nums.length) return { sb: Math.min.apply(null, nums), bb: Math.max.apply(null, nums) };
      const n = firstNumber(ctn.textContent);
      if (n) return { sb: n, bb: n };
    }
    return { sb: null, bb: null };
  }
  const getBigBlind = () => getBlinds().bb;

  // 칩 금액 읽기: 항상 .normal-value(원래 칩) 에서만. BB 표시 모드에 속지 않는다.
  function chipsIn(el) {
    if (!el) return null;
    const nv = el.querySelector('.normal-value');
    if (nv) return firstNumber(nv.textContent);
    // 올인이면 숫자 대신 "All In" 이 찍힌다
    if (/all\s*in/i.test(el.textContent || '')) return 0;
    return firstNumber(el.textContent);
  }

  const heroSeat = () => {
    for (const sel of HERO_CONTAINER_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  };

  // 화면에 보이는 내 스택. PokerNow 는 (스택 − 이번 스트리트 베팅) 을 표시한다.
  const readHeroStack = () => chipsIn((heroSeat() || document).querySelector(STACK_SELECTOR));

  // 이번 스트리트의 내 베팅 / 테이블 최고 베팅 (원래 칩 단위)
  function readBets() {
    const hero = heroSeat();
    let mine = 0, top = 0;
    for (const seat of document.querySelectorAll('.table-player')) {
      const betEl = seat.querySelector(BET_SELECTOR);
      const v = (betEl && isClickable(betEl)) ? chipsIn(betEl) : null; // 안 보이는 베팅은 없는 것

      if (v == null) continue;              // 베팅 없음 또는 "check"
      if (v > top) top = v;
      if (hero && seat === hero) mine = v;
    }
    return { mine, top };
  }

  // 콜/체크 버튼 찾기: 클래스 토큰 → 버튼 텍스트 순. (스킨·언어가 달라도 잡히도록)
  function findActionButton(kind) {
    const roots = ACTION_ROOT_SELECTORS.map((sel) => document.querySelector(sel)).filter(Boolean);
    roots.push(document);
    const clsRe = new RegExp('\\b' + kind + '\\b');
    for (const root of roots) {
      const btns = Array.from(root.querySelectorAll('button, .action-button, [role="button"]'));
      for (const el of btns) {
        if (clsRe.test((el.className || '').toString().toLowerCase()) && isClickable(el)) return el;
      }
      for (const el of btns) {
        const t = (el.textContent || '').trim().toLowerCase();
        if (ACTION_WORDS[kind].some((w) => t === w || t.startsWith(w + ' ')) && isClickable(el)) return el;
      }
    }
    return null;
  }

  /* ===== 자리 순서 · 포지션 ============================================== */

  const seatPosOf = (el) => {
    const m = /\btable-player-(\d+)\b/.exec((el && el.className) || '');
    return m ? parseInt(m[1], 10) : null;
  };

  // 딜러 버튼이 붙은 자리 번호 (.dealer-button-ctn.dealer-position-N)
  // ※ 라이브 스트래들 버튼도 같은 클래스를 쓰므로 그건 제외한다.
  function dealerSeatPos() {
    for (const el of document.querySelectorAll('.dealer-button-ctn')) {
      const cls = (el.className || '').toString();
      if (/\blive-straddle\b/.test(cls)) continue;
      const m = /\bdealer-position-(\d+)\b/.exec(cls);
      if (m) return parseInt(m[1], 10);
    }
    return null;
  }

  // 자리 번호 → 그 자리의 이번 스트리트 베팅 (없으면 null)
  function seatBetMap() {
    const map = new Map();
    for (const seat of document.querySelectorAll('.table-player')) {
      const pos = seatPosOf(seat);
      if (pos == null) continue;
      const betEl = seat.querySelector(BET_SELECTOR);
      map.set(pos, (betEl && isClickable(betEl)) ? chipsIn(betEl) : null);
    }
    return map;
  }

  // 이번 핸드에 카드를 받은 자리들을 번호순으로. (폴드로 카드가 사라져도 유지)
  function updateHandSeats() {
    for (const seat of document.querySelectorAll('.table-player')) {
      const pos = seatPosOf(seat);
      if (pos == null) continue;
      if (seat.querySelector('.table-player-cards .card-container, .table-player-cards .card')) {
        handSeats.add(pos);
      }
    }
    return Array.from(handSeats).sort((a, b) => a - b);
  }

  // (1) 자리 좌표로 방향 추정: 자리 번호가 커지는 쪽이 화면상 시계방향이면 +1.
  //     포커 액션은 시계방향으로 돌기 때문. 빈 자리까지 다 세므로 첫 핸드부터 바로 나온다.
  function seatDirFromGeometry() {
    const pts = [];
    for (const seat of document.querySelectorAll('.table-player')) {
      const pos = seatPosOf(seat);
      if (pos == null) continue;
      const r = seat.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      pts.push({ pos, x: r.left + r.width / 2, y: r.top + r.height / 2 });
    }
    if (pts.length < 3) return null;
    pts.sort((a, b) => a.pos - b.pos);
    const cx = pts.reduce((t, p) => t + p.x, 0) / pts.length;
    const cy = pts.reduce((t, p) => t + p.y, 0) / pts.length;
    let sum = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      let d = Math.atan2(b.y - cy, b.x - cx) - Math.atan2(a.y - cy, a.x - cx);
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      sum += d;
    }
    // 화면 좌표는 y 가 아래로 증가하므로 각도가 커지는 = 시계방향. 한 바퀴면 ±2π.
    if (sum > 5) return 1;
    if (sum < -5) return -1;
    return null;
  }

  // (2) 블라인드로 확정: SB 바로 다음 자리가 BB 인 쪽이 진행 방향. (프리플랍에서만)
  //     동시에 내가 SB/BB 였는지도 기록해 둔다 (방향을 몰라도 쓸 수 있는 정보).
  function learnSeatDir(seats, boardLen) {
    if (seatDirSrc !== 'blinds' && !seatDir) {
      const g = seatDirFromGeometry();
      if (g) { seatDir = g; seatDirSrc = 'geometry'; log('자리 방향(좌표 추정):', g); }
    }
    if (boardLen > 0 || seats.length < 2) return;   // 프리플랍에서만 블라인드를 믿는다

    const { sb, bb } = getBlinds();
    if (!sb || !bb || sb === bb) return;
    const bets = seatBetMap();
    let sbPos = null, bbPos = null;
    for (const pos of seats) {
      const v = bets.get(pos);
      if (v === bb) bbPos = pos;
      else if (v === sb) sbPos = pos;
    }

    const heroPos = seatPosOf(heroSeat());
    if (heroPos != null && heroBlindRole == null) {
      if (heroPos === bbPos) heroBlindRole = 'BB';
      else if (heroPos === sbPos) heroBlindRole = 'SB';
    }

    if (seatDirSrc === 'blinds' || sbPos == null || bbPos == null) return;
    const i = seats.indexOf(sbPos), n = seats.length;
    if (seats[(i + 1) % n] === bbPos) { seatDir = 1; seatDirSrc = 'blinds'; }
    else if (seats[(i - 1 + n) % n] === bbPos) { seatDir = -1; seatDirSrc = 'blinds'; }
    if (seatDirSrc === 'blinds') log('자리 방향(블라인드로 확정):', seatDir);
  }

  const POS_LABEL = { 0: 'BTN', 1: 'SB', 2: 'BB' };

  // 버튼 기준으로 내 포지션 이름 (BTN/SB/BB/UTG/HJ/CO …)
  function heroPositionName(seats) {
    const heroPos = seatPosOf(heroSeat());
    const btn = dealerSeatPos();
    const n = seats.length;
    if (heroPos == null) return null;

    // 방향을 몰라도 확실한 것부터: 버튼 자리인지 / 이번 핸드에 블라인드였는지
    if (btn != null && heroPos === btn) return n === 2 ? 'BTN/SB' : 'BTN';
    if (heroBlindRole) return heroBlindRole;

    if (btn == null || !seatDir || n < 2) return null;
    const b = seats.indexOf(btn), h = seats.indexOf(heroPos);
    if (b < 0 || h < 0) return null;

    // 버튼에서 진행 방향으로 몇 번째 자리인지 (0=BTN, 1=SB, 2=BB, …)
    const idx = ((h - b) * seatDir % n + n) % n;
    if (n === 2) return idx === 0 ? 'BTN/SB' : 'BB';   // 헤즈업은 버튼이 SB
    if (idx <= 2) return POS_LABEL[idx];

    // BB 다음부터가 UTG … CO
    const j = idx - 3, k = n - 3;
    if (k <= 2) return j === 0 ? 'UTG' : 'CO';
    if (j === k - 1) return 'CO';
    if (j === k - 2) return 'HJ';
    return 'UTG' + (j ? '+' + j : '');
  }

  // 지금 누구 차례인지 (내 차례면 '나')
  function turnPlayerName() {
    const el = document.querySelector('.table-player.decision-current');
    if (!el) return null;
    if (/\byou-player\b/.test((el.className || '').toString())) return '나';
    const name = el.querySelector('.table-player-name');
    const t = name ? name.textContent.trim() : '';
    return t || '상대';
  }

  // 내 차례 액션 정보.
  // 콜 금액은 버튼 라벨을 읽지 않는다 — BB 표시 모드면 라벨이 BB 로 찍혀서 못 믿는다.
  // 대신 (테이블 최고 베팅 − 내 베팅) 을 원래 칩 단위로 직접 계산한다.
  function getActionInfo(stack) {
    const bb = getBigBlind();
    const { mine, top } = readBets();
    let toCall = Math.max(0, top - mine);
    if (stack != null && toCall > stack) toCall = stack; // 스택보다 많이 콜할 수는 없다
    return {
      canCheck: !!findActionButton('check'),
      canCall: !!findActionButton('call'),
      toCallBB: bb ? toCall / bb : null
    };
  }

  // PokerNow 는 남은 초를 숫자로 안 보여준다. 대신 내 자리에 있는
  // <div class="time-to-talk"> 안의 바 width(%) 가 곧 남은 비율이다. 그걸 그대로 읽는다.
  // (normal-time = 기본 시간, time-bank = 타임뱅크. 둘을 합친 게 남은 전체)
  function readTurnRemainRatio() {
    const hero = heroSeat();
    const ctn = hero && hero.querySelector(TIMER_SELECTOR);
    if (!ctn) return null;
    let pct = 0, found = false;
    for (const bar of ctn.querySelectorAll('.normal-time, .time-bank')) {
      const w = parseFloat(bar.style.width);
      if (!isNaN(w)) { pct += w; found = true; }
    }
    return found ? Math.max(0, Math.min(100, pct)) / 100 : null;
  }

  // 내 차례 시작 시각을 잡아둔다. 남은 초는 바가 줄어드는 속도로 역산한다.
  function syncTurnTimer(myTurn) {
    if (!myTurn) { turnTimer.active = false; return; }
    if (turnTimer.active) return;               // 이미 이번 차례를 재는 중
    const now = Date.now();
    const r0 = readTurnRemainRatio();
    turnTimer = { active: true, t0: now, r: (r0 == null ? 1 : r0), aT: 0, aR: 0 };
  }

  const fmtBB = (x) => {
    if (x == null) return '';
    const r = Math.round(x * 10) / 10;
    return Number.isInteger(r) ? r.toString() : r.toFixed(1);
  };

  /* ===== 메인 파이프라인 ================================================== */

  function detectMyHand() {
    if (!extensionAlive()) { try { observer.disconnect(); } catch (e) {} return; }
    if (!settings.enabled) { removeOverlay(); return; }

    ensureOverlay();

    const bb = getBigBlind();
    const toBB = (chips) => (chips != null && bb) ? chips / bb : null;
    const stack = readHeroStack();
    const stackBB = toBB(stack);

    // 핸드가 끝난(=내 카드가 없는) 동안의 스택 = 다음 핸드의 "시작 스택"
    const goIdle = () => { if (stack != null) idleStack = stack; handStartStack = null; };
    const turnName = turnPlayerName();

    // 폴드했으면 카드 지움 (예약 상태도 초기화)
    if (isHeroFolded()) {
      lastRawKey = null; preFoldArmed = false; goIdle(); syncTurnTimer(false);
      renderOverlay({ hasCards: false, folded: true, myTurn: false, foldArmed: false, action: null,
        stackBB, turnName, position: heroPositionName(updateHandSeats()) });
      return;
    }

    const myTurn = isMyTurn();
    if (myTurn) preFoldArmed = false; // 내 차례엔 즉시 폴드(예약 개념 없음)
    syncTurnTimer(myTurn);
    const action = myTurn ? getActionInfo(stack) : null;
    const els = findHoleCardElements();

    if (els.length !== 2) {
      lastRawKey = null; preFoldArmed = false; goIdle();
      renderOverlay({ hasCards: false, myTurn, foldArmed: false, action, stackBB, turnName, position: null });
      return;
    }

    const c1 = parseCardElement(els[0]);
    const c2 = parseCardElement(els[1]);
    const hand = normalizeHand(c1, c2);
    if (!hand) { renderOverlay({ hasCards: false, myTurn, foldArmed: false, action, stackBB, turnName }); return; }

    const allowed = settings.hands.includes(hand);
    const key = [prettyCard(c1), prettyCard(c2)].sort().join('|');
    const isNewHand = key !== lastRawKey;
    // 새 핸드 시작: 블라인드를 내기 전 스택(직전 대기중 스택)을 기준점으로 잡는다
    if (isNewHand) {
      preFoldArmed = false;
      handStartStack = (idleStack != null) ? idleStack : stack;
      handSeats = new Set();
      heroBlindRole = null;
    }

    const foldArmed = !myTurn && (preFoldArmed || isFoldArmedInDom());

    // 보드가 깔렸으면(플롭 이후) 현재 완성된 족보 계산
    const holeKeys = new Set([c1.rank + c1.suit, c2.rank + c2.suit]);
    const board = readBoardCards(holeKeys);
    const made = board.length >= 3 ? describeMade(c1, c2, board) : null;
    const boardPretty = board.map(prettyCard);

    // 이번 핸드 참가 자리 → 자리 도는 방향 학습 → 내 포지션
    const seats = updateHandSeats();
    learnSeatDir(seats, board.length);
    const position = heroPositionName(seats);

    // 이번 핸드에 이미 낸 돈 = 시작 스택 − 지금 스택 (블라인드·앤티까지 자동 포함)
    const paidBB = (handStartStack != null && stack != null)
      ? toBB(Math.max(0, handStartStack - stack)) : null;

    renderOverlay({
      hasCards: true, pretty1: prettyCard(c1), pretty2: prettyCard(c2),
      hand, allowed, myTurn, foldArmed, action, made, boardPretty, stackBB, paidBB,
      turnName, position
    });

    safe(() => chrome.storage.local.set({
      currentHand: {
        pretty: prettyCard(c1) + ' ' + prettyCard(c2),
        hand, allowed, myTurn, made: made ? made.name : null, ts: Date.now()
      }
    }));

    if (!isNewHand) return;
    lastRawKey = key;
    log('새 핸드:', prettyCard(c1), prettyCard(c2), '→', hand, allowed ? '(프리미엄!)' : '');
    if (allowed && settings.soundEnabled) playBeep();
  }

  /* ===== 오버레이 HUD + Picture-in-Picture 팝아웃 ========================= */

  const OVERLAY_ID = 'pokernow-hand-alert-overlay';
  let overlayEls = null;
  let pipWindow = null;
  let lastState = { hasCards: false, myTurn: false };

  const PANEL_CSS = `
    #${OVERLAY_ID}{position:fixed;top:80px;right:16px;z-index:2147483647;width:212px;
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
      background:#1e1f26;color:#e8e8ee;border-radius:12px;overflow:hidden;
      box-shadow:0 8px 28px rgba(0,0,0,.5);border:1px solid #33353f;user-select:none;}
    #${OVERLAY_ID}.pip{position:static;top:auto;right:auto;width:auto;border-radius:0;box-shadow:none;border:none;height:100%;}
    #${OVERLAY_ID} .pnha-head{display:flex;align-items:center;gap:6px;padding:7px 10px;background:#282a36;
      cursor:move;font-size:12px;font-weight:700;color:#7ee787;}
    #${OVERLAY_ID}.pip .pnha-head{cursor:default;}
    #${OVERLAY_ID} .pnha-btn{cursor:pointer;color:#9aa0b4;font-size:14px;line-height:1;padding:0 3px;}
    #${OVERLAY_ID} .pnha-pop{margin-left:auto;}
    #${OVERLAY_ID} .pnha-body{padding:10px;text-align:center;}
    #${OVERLAY_ID} .pnha-cards{font-size:30px;font-weight:800;letter-spacing:3px;line-height:1.1;min-height:34px;}
    #${OVERLAY_ID} .pnha-cards.empty{font-size:14px;font-weight:600;color:#9aa0b4;letter-spacing:0;}
    #${OVERLAY_ID} .pnha-red{color:#ff5c72;}
    #${OVERLAY_ID} .pnha-code{font-size:14px;color:#9aa0b4;margin-top:2px;font-weight:700;}
    #${OVERLAY_ID} .pnha-made{margin-top:5px;font-size:15px;font-weight:800;color:#e8e8ee;}
    #${OVERLAY_ID} .pnha-made.made-strong{color:#7ee787;}
    #${OVERLAY_ID} .pnha-made.made-mid{color:#f0d24b;}
    #${OVERLAY_ID} .pnha-made.made-weak{color:#9aa0b4;}
    #${OVERLAY_ID} .pnha-board{margin-top:4px;font-size:15px;font-weight:800;letter-spacing:1px;color:#e8e8ee;}
    #${OVERLAY_ID}.premium{border-color:#2ea043;box-shadow:0 0 0 2px #2ea043,0 8px 28px rgba(0,0,0,.5);}
    /* 메타 2칸: 내 포지션 / 지금 누구 차례 */
    #${OVERLAY_ID} .pnha-meta{margin-top:8px;display:flex;gap:4px;}
    #${OVERLAY_ID} .pnha-meta .pnha-stat b{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    #${OVERLAY_ID} .pnha-m-turn.mine b{color:#f0a531;}
    /* 스탯 3칸: 내 스택 / 이번 핸드에 낸 돈 / 지금 더 내야 하는 돈 (전부 BB) */
    #${OVERLAY_ID} .pnha-stats{margin-top:8px;display:flex;gap:4px;}
    #${OVERLAY_ID} .pnha-stat{flex:1;background:#282a36;border-radius:7px;padding:4px 2px;line-height:1.15;}
    #${OVERLAY_ID} .pnha-stat b{display:block;font-size:13px;font-weight:800;color:#e8e8ee;}
    #${OVERLAY_ID} .pnha-stat i{display:block;font-size:9px;font-style:normal;font-weight:700;color:#9aa0b4;margin-top:1px;}
    #${OVERLAY_ID} .pnha-stat.hot b{color:#f0a531;}
    /* 내 차례 남은 시간 바 */
    #${OVERLAY_ID} .pnha-turn{margin-top:8px;}
    #${OVERLAY_ID} .pnha-bar{height:6px;border-radius:4px;background:#33353f;overflow:hidden;display:none;}
    #${OVERLAY_ID}.my-turn .pnha-bar{display:block;}
    #${OVERLAY_ID} .pnha-bar i{display:block;height:100%;width:100%;background:#7ee787;border-radius:4px;
      transition:width .2s linear;}
    #${OVERLAY_ID} .pnha-bar.warn i{background:#f0d24b;}
    #${OVERLAY_ID} .pnha-bar.crit i{background:#ff5c72;}
    #${OVERLAY_ID} .pnha-turntext{margin-top:3px;font-size:11px;font-weight:700;color:#9aa0b4;}
    #${OVERLAY_ID}.my-turn .pnha-turntext{color:#f0a531;}
    /* 액션 버튼: 콜 · 체크 · 폴드 (콜/체크는 가능할 때만 보임) */
    #${OVERLAY_ID} .pnha-actions{margin-top:8px;display:flex;gap:6px;}
    #${OVERLAY_ID} .pnha-actions button{flex:1;padding:8px 4px;border:none;border-radius:8px;
      color:#fff;font-weight:800;font-size:13px;line-height:1.15;cursor:pointer;}
    #${OVERLAY_ID} .pnha-fold{background:#b3242f;}
    #${OVERLAY_ID} .pnha-fold:hover{background:#d0303c;}
    #${OVERLAY_ID} .pnha-fold.armed{background:#3a3d4d;color:#cfd2e0;box-shadow:none;}
    #${OVERLAY_ID} .pnha-fold.armed:hover{background:#474a5c;}
    #${OVERLAY_ID} .pnha-call{background:#2ea043;display:none;}
    #${OVERLAY_ID} .pnha-call:hover{background:#3fb854;}
    #${OVERLAY_ID} .pnha-check{background:#1f6feb;display:none;}
    #${OVERLAY_ID} .pnha-check:hover{background:#388bfd;}
    #${OVERLAY_ID} .pnha-call .bb{display:block;font-size:11px;font-weight:700;opacity:.85;margin-top:1px;}
    #${OVERLAY_ID}.collapsed .pnha-body{display:none;}
    #${OVERLAY_ID} .pnha-foldmsg{font-size:10px;color:#9aa0b4;margin-top:5px;height:12px;}
  `;

  // 지정한 document 에 패널을 만들고 이벤트를 연결한다.
  function buildPanel(doc, inPip) {
    if (!doc.getElementById('pnha-style')) {
      const style = doc.createElement('style');
      style.id = 'pnha-style';
      style.textContent = PANEL_CSS;
      (doc.head || doc.documentElement).appendChild(style);
    }

    const box = doc.createElement('div');
    box.id = OVERLAY_ID;
    if (inPip) box.classList.add('pip');
    const headBtns = inPip ? ''
      : '<span class="pnha-btn pnha-pop" title="다른 창 위에 띄우기">⧉</span>' +
        '<span class="pnha-btn pnha-min" title="접기/펼치기">–</span>';
    box.innerHTML = `
      <div class="pnha-head"><span>♠ Hand Alert</span>${headBtns}</div>
      <div class="pnha-body">
        <div class="pnha-cards empty">대기중</div>
        <div class="pnha-made"></div>
        <div class="pnha-board"></div>
        <div class="pnha-meta">
          <span class="pnha-stat pnha-m-pos"><b>—</b><i>내 포지션</i></span>
          <span class="pnha-stat pnha-m-turn"><b>—</b><i>지금 차례</i></span>
        </div>
        <div class="pnha-stats">
          <span class="pnha-stat pnha-s-stack"><b>—</b><i>내 스택</i></span>
          <span class="pnha-stat pnha-s-paid"><b>—</b><i>낸 돈</i></span>
          <span class="pnha-stat pnha-s-tocall"><b>—</b><i>더 낼 돈</i></span>
        </div>
        <div class="pnha-turn">
          <div class="pnha-bar"><i></i></div>
          <div class="pnha-turntext">대기중</div>
        </div>
        <div class="pnha-actions">
          <button class="pnha-call" type="button">콜</button>
          <button class="pnha-check" type="button">체크</button>
          <button class="pnha-fold" type="button">폴드</button>
        </div>
        <div class="pnha-foldmsg"></div>
      </div>`;
    doc.body.appendChild(box);

    const q = (s) => box.querySelector(s);
    const els = {
      box, cards: q('.pnha-cards'), made: q('.pnha-made'), board: q('.pnha-board'),
      call: q('.pnha-call'), check: q('.pnha-check'), fold: q('.pnha-fold'),
      bar: q('.pnha-bar'), barFill: q('.pnha-bar i'), turntext: q('.pnha-turntext'),
      mPos: q('.pnha-m-pos b'), mTurn: q('.pnha-m-turn b'), mTurnBox: q('.pnha-m-turn'),
      sStack: q('.pnha-s-stack b'), sPaid: q('.pnha-s-paid b'),
      sToCall: q('.pnha-s-tocall b'), sToCallBox: q('.pnha-s-tocall'),
      foldmsg: q('.pnha-foldmsg'), min: q('.pnha-min'), pop: q('.pnha-pop'), head: q('.pnha-head')
    };

    els.call.addEventListener('click', () => {
      if (!lastState.myTurn) { flash(els, '내 차례 아님'); return; }
      flash(els, clickCallButton() ? '✓ 콜' : '콜 버튼 없음');
      detectMyHand();
    });

    els.check.addEventListener('click', () => {
      if (!lastState.myTurn) { flash(els, '내 차례 아님'); return; }
      flash(els, clickCheckButton() ? '✓ 체크' : '체크 버튼 없음');
      detectMyHand();
    });

    els.fold.addEventListener('click', () => {
      const myTurn = !!lastState.myTurn;
      const wasArmed = !!lastState.foldArmed;
      const ok = clickFoldButton();
      if (!ok) { flash(els, '폴드 버튼 없음 (내 차례 아님)'); return; }
      if (myTurn) {
        flash(els, '✓ 폴드');             // 내 차례 → 즉시 폴드
      } else {
        preFoldArmed = !wasArmed;         // 내 차례 전 → 예약 ↔ 취소 토글
        flash(els, preFoldArmed ? '✓ 폴드 예약함' : '✓ 예약 취소');
      }
      detectMyHand();                     // 버튼 라벨 즉시 갱신
    });
    if (els.min) els.min.addEventListener('click', () => {
      box.classList.toggle('collapsed');
      els.min.textContent = box.classList.contains('collapsed') ? '+' : '–';
    });
    if (els.pop) els.pop.addEventListener('click', openPiP);
    if (!inPip) makeDraggable(box, els.head);
    return els;
  }

  function ensureOverlay() {
    if (pipWindow || !document.body || document.getElementById(OVERLAY_ID)) return;
    overlayEls = buildPanel(document, false);
    renderOverlay(lastState);
  }

  function removeOverlay() {
    const box = document.getElementById(OVERLAY_ID);
    if (box) box.remove();
    if (pipWindow) { try { pipWindow.close(); } catch (e) {} pipWindow = null; }
    overlayEls = null;
  }

  // 패널을 항상-위 PiP 창으로 빼내기 (다른 창/앱 위에도 표시)
  async function openPiP() {
    if (!('documentPictureInPicture' in window)) {
      alert('이 Chrome 은 Picture-in-Picture 팝아웃을 지원하지 않습니다. Chrome 116 이상으로 업데이트하세요.');
      return;
    }
    try {
      pipWindow = await window.documentPictureInPicture.requestWindow({ width: 200, height: 250 });
      const old = document.getElementById(OVERLAY_ID);
      if (old) old.remove();
      pipWindow.document.body.style.margin = '0';
      pipWindow.document.body.style.background = '#1e1f26';
      overlayEls = buildPanel(pipWindow.document, true);
      renderOverlay(lastState);
      pipWindow.addEventListener('pagehide', () => { pipWindow = null; overlayEls = null; ensureOverlay(); });
    } catch (e) {
      log('PiP 열기 실패:', e);
      pipWindow = null;
      ensureOverlay();
    }
  }

  const colorCard = (p) =>
    '<span class="' + ((p.includes('♥') || p.includes('♦')) ? 'pnha-red' : '') + '">' + p + '</span>';

  function flash(els, text) {
    els.foldmsg.textContent = text;
    setTimeout(() => { els.foldmsg.textContent = ''; }, 1600);
  }

  function renderOverlay(state) {
    lastState = state;
    ensureOverlay();
    if (!overlayEls) return;
    const { box, cards, made, board, call, check } = overlayEls;

    if (!state.hasCards) {
      cards.className = 'pnha-cards empty';
      cards.textContent = state.folded ? '-' : '대기중';
      made.textContent = ''; made.className = 'pnha-made'; made.style.display = 'none';
      board.textContent = ''; board.style.display = 'none';
      box.classList.remove('premium');
    } else {
      cards.className = 'pnha-cards';
      cards.innerHTML = colorCard(state.pretty1) + ' ' + colorCard(state.pretty2);
      box.classList.toggle('premium', !!state.allowed);

      // 족보 줄: 플롭 이후에만 완성 족보 표시 (프리플롭 핸드코드는 카드로 충분해서 숨김)
      if (state.made) {
        made.style.display = 'block';
        made.className = 'pnha-made ' + state.made.klass;
        made.textContent = state.made.name + (state.made.usesHole ? '' : ' (보드)');
      } else {
        made.style.display = 'none';
        made.className = 'pnha-made';
        made.textContent = '';
      }

      // 보드 카드
      if (state.boardPretty && state.boardPretty.length) {
        board.style.display = 'block';
        board.innerHTML = state.boardPretty.map(colorCard).join(' ');
      } else {
        board.style.display = 'none';
      }
    }

    box.classList.toggle('my-turn', !!state.myTurn);

    // 내 포지션 / 지금 누구 차례
    overlayEls.mPos.textContent = state.position || '—';
    overlayEls.mTurn.textContent = state.turnName || '—';
    overlayEls.mTurnBox.classList.toggle('mine', state.turnName === '나');

    // 스탯 3칸 (칩 금액은 안 쓰고 전부 BB 로 환산해서 보여준다)
    const a = state.action;
    const bbText = (v) => (v == null ? '—' : fmtBB(v) + ' BB');
    // 체크만 하면 되는 상황이면 더 낼 돈은 0 BB
    const toCallBB = state.myTurn && a
      ? (a.toCallBB != null ? a.toCallBB : (a.canCheck ? 0 : null))
      : null;
    overlayEls.sStack.textContent = bbText(state.stackBB);
    overlayEls.sPaid.textContent = bbText(state.paidBB);
    overlayEls.sToCall.textContent = state.myTurn ? bbText(toCallBB) : '—';
    overlayEls.sToCallBox.classList.toggle('hot', !!toCallBB);

    paintTimer();

    // 콜 / 체크 버튼은 "더 낼 돈" 으로만 갈린다. 둘이 같이 뜨는 일은 없다.
    //   더 낼 돈 0    → 체크만
    //   더 낼 돈 > 0  → 콜만
    // (PokerNow 는 낼 게 없을 때도 call 클래스 버튼을 "Bet" 라벨로 남겨둬서 클래스는 못 믿는다)
    let showCall = false, showCheck = false;
    if (state.myTurn && a) {
      if (a.toCallBB != null) {
        showCall = a.toCallBB > 0;
        showCheck = !showCall;
      } else {
        // 빅블라인드를 못 읽어 금액을 모를 때만 페이지 버튼 상태로 판단
        showCall = a.canCall;
        showCheck = !a.canCall && a.canCheck;
      }
    }
    call.style.display = showCall ? 'block' : 'none';
    check.style.display = showCheck ? 'block' : 'none';
    call.innerHTML = '콜<span class="bb">+' +
      (a && a.toCallBB != null ? fmtBB(a.toCallBB) + ' BB' : '?') + '</span>';

    // Fold 버튼: 내 차례=즉시(빨강) / 미리폴드 예약=회색
    const fold = overlayEls.fold;
    fold.style.display = (state.hasCards || state.myTurn) ? 'block' : 'none';
    if (state.myTurn) {
      fold.textContent = '폴드';
      fold.classList.remove('armed');
    } else if (state.foldArmed) {
      fold.textContent = '폴드 예약';
      fold.classList.add('armed');
    } else {
      fold.textContent = '미리 폴드';
      fold.classList.remove('armed');
    }
  }

  // 역산한 제한시간이 흔히 쓰는 값에 가까우면 그 값으로 맞춘다.
  // (표본 오차가 남아도 "23초" 대신 정확한 초가 나오도록)
  const COMMON_TURN_LIMITS = [10, 15, 20, 25, 30, 40, 45, 60, 90, 120];
  function snapTurnLimit(sec) {
    for (const c of COMMON_TURN_LIMITS) {
      if (Math.abs(sec - c) / c <= 0.12) return c;
    }
    return sec;
  }

  // 내 차례 남은 시간 바 (0.2초마다 부드럽게 갱신)
  function paintTimer() {
    if (!overlayEls) return;
    const { bar, barFill, turntext } = overlayEls;
    if (!lastState.myTurn || !turnTimer.active) {
      barFill.style.width = '100%';
      bar.classList.remove('warn', 'crit');
      turntext.textContent = '';   // 대기중일 땐 위의 "지금 차례" 칸이 알려준다
      return;
    }
    const domRatio = readTurnRemainRatio();
    const now = Date.now();
    const elapsed = (now - turnTimer.t0) / 1000;
    let ratio, left = null;

    if (domRatio != null) {
      ratio = domRatio;
      if (domRatio > turnTimer.r + 0.004) {
        // 타임뱅크가 붙어 바가 다시 늘어남 → 기준점을 버리고 다시 잰다
        turnTimer.aT = 0; turnTimer.aR = 0;
      } else if (domRatio < turnTimer.r - 0.004 && !turnTimer.aT) {
        // 바가 처음 줄어든 순간을 기준점으로 잡는다
        turnTimer.aT = now; turnTimer.aR = domRatio;
      }
      turnTimer.r = domRatio;

      // 기준점 이후의 평균 하락 속도로 전체 제한시간을 역산
      // (테이블이 몇 초로 설정돼 있든 자동으로 맞고, 시간이 갈수록 정확해진다)
      const dt = (now - turnTimer.aT) / 1000;
      const dropped = turnTimer.aR - domRatio;
      // 처음 2초는 표본이 모자라 값이 튀므로 초 표시를 보류한다 (바는 그동안에도 정확)
      if (turnTimer.aT && dt > 2 && dropped > 0.02) left = ratio * snapTurnLimit(dt / dropped);
    } else {
      // 타이머 바 자체가 없는 테이블(제한시간 없음) → 흘러간 시간만 보여준다
      ratio = 1;
    }

    barFill.style.width = (ratio * 100).toFixed(1) + '%';
    bar.classList.toggle('warn', ratio <= 0.5 && ratio > 0.25);
    bar.classList.toggle('crit', ratio <= 0.25);
    turntext.textContent = left != null
      ? '내 차례 · ' + Math.ceil(left) + '초'
      : '내 차례 · ' + Math.floor(elapsed) + '초 경과';
  }
  setInterval(paintTimer, 200);

  // 헤더를 잡고 드래그해 위치 이동
  function makeDraggable(box, handle) {
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
    handle.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('pnha-btn')) return;
      dragging = true;
      const r = box.getBoundingClientRect();
      ox = r.left; oy = r.top; sx = e.clientX; sy = e.clientY;
      box.style.right = 'auto'; box.style.left = ox + 'px'; box.style.top = oy + 'px';
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      box.style.left = (ox + e.clientX - sx) + 'px';
      box.style.top = (oy + e.clientY - sy) + 'px';
    });
    document.addEventListener('mouseup', () => { dragging = false; });
  }

  /* ===== 알림음 (Web Audio, 별도 파일 불필요) ============================= */

  function playBeep() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const now = audioCtx.currentTime;
      [0, 0.18].forEach((offset, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = i === 0 ? 880 : 1175;
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.25, now + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.15);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.16);
      });
    } catch (e) { log('알림음 실패:', e); }
  }

  /* ===== 수동 Fold (오버레이 버튼 / F 키 / 팝업에서 호출) ================= */

  function clickFoldButton() {
    for (const sel of FOLD_BUTTON_SELECTORS) {
      let btn = null;
      try { btn = document.querySelector(sel); } catch (e) {}
      if (btn && isClickable(btn)) { btn.click(); return true; }
    }
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], .action-button'));
    // 정확히 "Fold" → 사전 액션 "...fold..." 순으로 시도
    for (const el of candidates) {
      const t = (el.textContent || '').trim().toLowerCase();
      if ((t === 'fold' || t === '폴드') && isClickable(el)) { el.click(); return true; }
    }
    for (const el of candidates) {
      const t = (el.textContent || '').trim().toLowerCase();
      if (t.includes('fold') && isClickable(el)) { el.click(); return true; }
    }
    log('Fold 버튼을 찾지 못함 (내 차례가 아니거나 셀렉터 확인 필요)');
    return false;
  }

  // 콜 / 체크 버튼 클릭 (사용자가 오버레이 버튼을 눌렀을 때만 호출됨)
  // 패널에 버튼을 띄울 때와 똑같은 findActionButton 을 쓰므로, 보이면 반드시 눌린다.
  function clickFound(kind) {
    const btn = findActionButton(kind);
    if (!btn) return false;
    btn.click();
    return true;
  }
  const clickCallButton = () => clickFound('call');
  const clickCheckButton = () => clickFound('check');

  function isClickable(el) {
    if (!el || el.disabled) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden';
  }

  const isTypingTarget = (el) => {
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
  };

  if (FOLD_HOTKEY) {
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.altKey || e.metaKey || isTypingTarget(e.target)) return;
      if ((e.key || '').toLowerCase() !== FOLD_HOTKEY.toLowerCase()) return;
      if (clickFoldButton()) e.preventDefault();
    }, true);
  }

  /* ===== 팝업 메시지 & 시작 ============================================== */

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'PING_DETECT') { detectMyHand(); sendResponse({ ok: true }); }
    else if (msg && msg.type === 'MANUAL_FOLD') { sendResponse({ ok: clickFoldButton() }); }
    return false;
  });

  // 감지 트리거: MutationObserver(throttle) + heartbeat
  // (PokerNow 는 타이머/애니메이션으로 DOM 이 계속 바뀌어서, debounce 는 굶어죽으므로 throttle 사용)
  let lastRun = 0, pendingTimer = null;
  function scheduleDetect() {
    const since = Date.now() - lastRun;
    if (since >= THROTTLE_MS) { lastRun = Date.now(); detectMyHand(); }
    else if (!pendingTimer) {
      pendingTimer = setTimeout(() => { pendingTimer = null; lastRun = Date.now(); detectMyHand(); }, THROTTLE_MS - since);
    }
  }
  const observer = new MutationObserver(scheduleDetect);

  function start() {
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });
    setInterval(() => { if (extensionAlive()) detectMyHand(); }, HEARTBEAT_MS);
    log('감지 시작.');
    detectMyHand();
  }

  loadSettings();
  if (document.body) start();
  else window.addEventListener('DOMContentLoaded', start);
})();
