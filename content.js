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
 * ⚠️ 자동 폴드는 "기본 꺼짐" 이며, 설정에서 켰을 때만 동작한다.
 *    켜면 지정한 핸드가 아닐 때 PokerNow 의 "미리 폴드(사전 액션)" 를 대신
 *    눌러둔다. 내가 취소하지 않으면 내 차례가 왔을 때 PokerNow 가 폴드한다.
 *    (취소: 오버레이의 취소 버튼 / 폴드 예약 버튼 토글 / 팝업 스위치 끄기)
 *    꺼져 있으면 폴드는 오버레이 버튼 / F 키 / 팝업 버튼으로만 실행된다.
 * ========================================================================= */

(() => {
  'use strict';

  // 카드 파싱 · 족보 계산은 poker.js 에 있다 (여기서는 이름만 꺼내 쓴다).
  if (!window.PNHACards) console.error('[PokerAlert] content.js: window.PNHACards 없음 — poker.js 로드 실패?');
  const P = window.PNHACards || {};
  const {
    looksLikeCard, parseCardElement, normalizeHand, prettyCard, parseCardList, describeMade
  } = P;

  /* ===== 설정: DEBUG & 셀렉터 (감지가 안 되면 여기만 고치면 됨) ============ */

  // 평소엔 조용히. 콘솔에서 localStorage['pnha-debug']='1' 후 새로고침하면 로그가 켜진다.
  const DEBUG = (() => { try { return localStorage.getItem('pnha-debug') === '1'; } catch (e) { return false; } })();
  const log = (...a) => { if (DEBUG) console.log('[PokerAlert]', ...a); };

  // 내 자리(hero) 컨테이너 후보
  const HERO_CONTAINER_SELECTORS = ['.table-player.you-player', '.you-player', '.hero-player', '[class*="you-player"]'];

  // 카드 요소 후보 (PokerNow: .table-player-cards > .card-container > ... > .card)
  const CARD_SELECTORS = [
    '.table-player-cards .card-container',
    '.table-player-cards .card',
    '.card-container',
    '.card',
    '.playing-card',
    '[class*="card-s-"]'
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


  /* ===== 상태 & 설정 ====================================================== */

  let settings = PNHA.defaults();
  let lastRawKey = null;     // 마지막 감지 카드 키 (새 핸드 판별)
  let preFoldArmed = false;  // 내가 "미리 폴드"를 예약했는지 (취소 가능)
  // 자동 폴드 상태.
  //   key       : 지금 예약된 스트리트 키 (핸드+보드장수)
  //   doneKey   : 이미 자동 실행한 스트리트 키 (같은 스트리트 두 번 방지)
  //   armedKey  : "미리 폴드" 를 눌러둔 스트리트 키 (한 스트리트에 한 번만 시도)
  //   armedHow  : 'fold' | 'checkfold' (무슨 사전 액션을 눌렀는지 — 표시용)
  //   armedEl   : 그때 누른 버튼 (취소는 같은 버튼을 다시 눌러야 풀린다)
  //   cancelKey : 사용자가 직접 개입한 핸드 키 (그 핸드는 끝까지 자동 안 함)
  let autoAct = { timer: null, dueAt: 0, plan: null, key: null, doneKey: null,
                  armedKey: null, armedHow: null, armedEl: null,
                  tryKey: null, tries: 0,   // 사전 액션 버튼이 아직 안 떴을 때 재시도용
                  cancelKey: null, msg: '', msgUntil: 0 };
  let audioCtx = null;

  // 확장을 재로드하면 이 스크립트는 죽은 채 페이지에 남는다.
  // 걸어둔 반복 타이머를 전부 회수할 수 있게 한 곳에 모아둔다.
  const intervals = [];
  const every = (ms, fn) => { intervals.push(setInterval(fn, ms)); };

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

  // 확장 컨텍스트 생존 확인 (확장 재로드 후 옛 스크립트의 chrome.* 에러 방지)
  const extensionAlive = () => {
    try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch (e) { return false; }
  };
  const safe = (fn) => { if (extensionAlive()) { try { fn(); } catch (e) { /* ignore */ } } };

  function loadSettings() {
    chrome.storage.local.get('settings', (data) => {
      settings = PNHA.merge(data && data.settings);
      log('설정 로드:', settings);
    });
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) settings = PNHA.merge(changes.settings.newValue);
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


  /* ===== 보드(커뮤니티 카드) 읽기 & 족보 계산 ============================ */



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
    // 2) 폴백: 자리(.table-player) 밖에 있는 앞면 카드 = 보드 (컨테이너 클래스 무관)
    //    ★ 자리 안의 카드를 반드시 빼야 한다 — 쇼다운에서 상대 카드가 열리면
    //      그게 3~5장 범위에 걸려 엉뚱한 족보가 나온다.
    const loose = Array.from(document.querySelectorAll('.card-container, .card'))
      .filter((el) => !el.closest('.table-player'));
    const all = parseCardList(loose).filter((c) => !holeKeys.has(c.rank + c.suit));
    if (all.length >= 3 && all.length <= 5) return all;
    return []; // 프리플롭이거나 감지 실패
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
    // 액션 버튼 컨테이너 안에서만 찾는다.
    // (페이지 전체를 훑으면 채팅·핸드로그의 "fold" 텍스트까지 걸리고, 매 감지마다
    //  수백 개 요소를 검사하게 된다.)
    for (const sel of ACTION_ROOT_SELECTORS) {
      const root = document.querySelector(sel);
      if (!root) continue;
      for (const b of root.querySelectorAll('button, .action-button, [role="button"]')) {
        if (!(b.textContent || '').trim().toLowerCase().includes('fold')) continue;
        const cls = ' ' + (b.className || '').toString().toLowerCase() + ' ';
        if (FOLD_ARMED_RE.test(cls) || b.getAttribute('aria-pressed') === 'true') return true;
      }
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
      const v = (betEl && isVisible(betEl)) ? chipsIn(betEl) : null; // 안 보이는 베팅은 없는 것

      if (v == null) continue;              // 베팅 없음 또는 "check"
      if (v > top) top = v;
      if (hero && seat === hero) mine = v;
    }
    return { mine, top };
  }

  // 팟(총 금액) 표시 후보 — PokerNow 는 테이블 중앙에 팟을 보여준다.
  // ★ 자리 베팅(.table-player-bet-value) 은 스트리트마다 리셋되므로
  //   포스트플롭 팟 오즈엔 반드시 이 중앙 팟 값을 써야 한다.
  const POT_SELECTORS = [
    '.pot-value .normal-value',
    '.pot .normal-value',
    '.pot-value',
    '.pot-ctn .normal-value',
    '.pot-value-ctn .normal-value'
  ];
  // 이번 스트리트의 총 팟 (원래 칩 단위). 중앙 팟 표시 우선, 없으면 전 좌석 베팅 합.
  function readPot() {
    for (const sel of POT_SELECTORS) {
      const el = document.querySelector(sel);
      const v = el ? chipsIn(el) : null;
      if (v != null && v > 0) return v;
    }
    let sum = 0, found = false;
    for (const seat of document.querySelectorAll('.table-player')) {
      const betEl = seat.querySelector(BET_SELECTOR);
      const v = (betEl && isVisible(betEl)) ? chipsIn(betEl) : null;
      if (v != null && v > 0) { sum += v; found = true; }
    }
    if (!found) {
      const { sb, bb } = getBlinds();
      if (sb && bb) return sb + bb;
    }
    return sum;
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

  // 레이즈/베트 버튼 찾기 (PokerNow: .raise/.bet, 텍스트 "Raise"/"Bet"/"레이즈")
  function findRaiseButton() {
    const roots = ACTION_ROOT_SELECTORS.map((s) => document.querySelector(s)).filter(Boolean);
    roots.push(document);
    const clsRe = /\b(raise|bet|all-in|allin)\b/;
    for (const root of roots) {
      const btns = Array.from(root.querySelectorAll('button, .action-button, [role="button"]'));
      for (const el of btns) {
        if (clsRe.test((el.className || '').toString().toLowerCase()) && isClickable(el)) return el;
      }
      for (const el of btns) {
        const t = (el.textContent || '').trim().toLowerCase();
        if (/(raise|레이즈|bet|베팅|올\s*인)/.test(t) && isClickable(el)) return el;
      }
    }
    return null;
  }

  function clickRaiseButton() {
    const btn = findRaiseButton();
    if (!btn) return false;
    btn.click();
    return true;
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
      map.set(pos, (betEl && isVisible(betEl)) ? chipsIn(betEl) : null);
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

  // 지금 더 내야 하는 돈(BB). 0 이면 체크로 넘어갈 수 있다는 뜻.
  // (HUD 표시와 자동 폴드 판단이 같은 값을 쓰도록 여기 한 곳에서만 계산한다)
  const toCallBBOf = (a) =>
    !a ? null : (a.toCallBB != null ? a.toCallBB : (a.canCheck ? 0 : null));

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

  // 팝업이 보여줄 "현재 핸드". 값이 실제로 바뀔 때만 storage 에 쓴다.
  // (예전엔 매 감지마다 ts 를 새로 붙여 초당 1~2회 디스크 쓰기 + storage.onChanged
  //  브로드캐스트가 일어났다. 팝업은 어차피 바뀔 때만 다시 그리면 된다.)
  let lastPublished = null;
  function publishCurrentHand(cur) {
    const sig = cur ? [cur.pretty, cur.hand, cur.allowed, cur.myTurn, cur.made].join('|') : '';
    if (sig === lastPublished) return;
    lastPublished = sig;
    safe(() => chrome.storage.local.set({
      currentHand: cur ? Object.assign({ ts: Date.now() }, cur) : null
    }));
  }

  // 상태 진단 (디버그 켜짐 여부와 무관하게, 상태가 바뀔 때만 1줄씩 콘솔에 남긴다)
  let lastDiag = '';
  const diagOnce = (label) => {
    if (label !== lastDiag) { lastDiag = label; console.log('[PokerAlert] 상태:', label); }
  };

  // 감지 중 예외가 나도 무한 루프가 멈추지 않도록 한 겹 감싼다. (에러는 콘솔에 기록)
  function detectMyHand() {
    try { detectMyHandInner(); }
    catch (e) { console.error('[PokerAlert] 감지 오류:', e && e.stack ? e.stack : e); }
  }
  function detectMyHandInner() {
    if (!extensionAlive()) { shutdown(); return; }
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
      diagOnce('폴드/죽음');
      lastRawKey = null; preFoldArmed = false; goIdle(); syncTurnTimer(false); cancelAutoAct();
      publishCurrentHand(null);
      renderOverlay({ hasCards: false, folded: true, myTurn: false, foldArmed: false, action: null,
        stackBB, turnName, position: heroPositionName(updateHandSeats()) });
      return;
    }

    const myTurn = isMyTurn();
    if (myTurn) preFoldArmed = false; // 내 차례엔 즉시 폴드(예약 개념 없음)
    syncTurnTimer(myTurn);
    const action = (myTurn || settings.gtoMode) ? getActionInfo(stack) : null;
    const els = findHoleCardElements();

    if (els.length !== 2) {
      const hero = heroSeat();
      diagOnce(hero ? ('대기중 · 내 자리는 찾음, 카드 ' + els.length + '장') : '대기중 · 내 자리(.you-player) 를 못 찾음');
      lastRawKey = null; preFoldArmed = false; goIdle(); cancelAutoAct();
      publishCurrentHand(null);
      renderOverlay({ hasCards: false, myTurn, foldArmed: false, action, stackBB, turnName, position: null });
      return;
    }

    const c1 = parseCardElement(els[0]);
    const c2 = parseCardElement(els[1]);
    const hand = normalizeHand(c1, c2);
    if (!hand) { renderOverlay({ hasCards: false, myTurn, foldArmed: false, action, stackBB, turnName }); return; }
    diagOnce('카드 감지: ' + hand);

    const allowed = settings.hands.includes(hand);
    const key = [prettyCard(c1), prettyCard(c2)].sort().join('|');
    const isNewHand = key !== lastRawKey;
    // 새 핸드 시작: 블라인드를 내기 전 스택(직전 대기중 스택)을 기준점으로 잡는다
    if (isNewHand) {
      preFoldArmed = false;
      cancelAutoAct();
      autoAct.doneKey = null; autoAct.cancelKey = null;
      autoAct.armedKey = null; autoAct.armedHow = null; autoAct.armedEl = null;
      autoAct.tryKey = null; autoAct.tries = 0;
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

    // GTO 판단 (HUD 권장 표시 + 자동 실행용)
    let gto = null;
    if (settings.gtoMode && hand && window.PNHAGTO) {
      const potBB = (bb && stack != null) ? readPot() / bb : null;
      gto = window.PNHAGTO.decide({
        c1, c2, hand, position, board,
        toCallBB: toCallBBOf(action),
        potBB,
        stackBB,
        tableSize: seats.length,
        street: board.length,
        aggroAuto: settings.gtoAggro === 'auto',
        streetMode: settings.gtoStreet,
        iterations: Number(settings.gtoSimIter) || 1500
      });
    }

    // 자동 폴드 판단 (설정에서 켰을 때만 예약된다)
    maybeAutoAct({ myTurn, allowed, action, boardLen: board.length, key, hand, gto });

    renderOverlay({
      hasCards: true, pretty1: prettyCard(c1), pretty2: prettyCard(c2),
      hand, allowed, myTurn, foldArmed, action, made, boardPretty, stackBB, paidBB,
      turnName, position, gto
    });

    publishCurrentHand({
      pretty: prettyCard(c1) + ' ' + prettyCard(c2),
      hand, allowed, myTurn, made: made ? made.name : null
    });

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
    /* GTO 권장 줄 */
    #${OVERLAY_ID} .pnha-gto{display:none;margin-top:6px;font-size:12px;font-weight:800;
      border-radius:7px;padding:4px 6px;background:#12241a;color:#7ee787;}
    #${OVERLAY_ID} .pnha-gto.fold{background:#2a1c1e;color:#ff5c72;}
    #${OVERLAY_ID} .pnha-gto.check{background:#141f2e;color:#79b8ff;}
    #${OVERLAY_ID} .pnha-gto.raise{background:#2a2410;color:#f0d24b;}
    #${OVERLAY_ID} .pnha-gto.wait{background:#282a36;color:#9aa0b4;}
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
    /* 자동 폴드: 헤더 토글(🤖) + 실행 대기 줄 */
    #${OVERLAY_ID} .pnha-auto-toggle{color:#5a5d70;margin-left:auto;}
    #${OVERLAY_ID} .pnha-auto-toggle ~ .pnha-pop{margin-left:0;}
    #${OVERLAY_ID}.auto-on .pnha-auto-toggle{color:#7ee787;}
    #${OVERLAY_ID} .pnha-auto{display:none;margin-top:6px;align-items:center;gap:6px;
      background:#3a2c12;border:1px solid #7a5a17;border-radius:7px;padding:4px 6px;}
    #${OVERLAY_ID} .pnha-auto.on{display:flex;}
    #${OVERLAY_ID} .pnha-auto span{flex:1;text-align:left;font-size:11px;font-weight:800;color:#f0a531;}
    #${OVERLAY_ID} .pnha-auto button{border:none;border-radius:6px;background:#5a5d70;color:#fff;
      font-size:11px;font-weight:800;padding:3px 8px;cursor:pointer;}
    #${OVERLAY_ID} .pnha-auto button:hover{background:#6d7189;}
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
    const autoBtn = '<span class="pnha-btn pnha-auto-toggle" title="자동 폴드 켜기/끄기">🤖</span>';
    const headBtns = inPip ? autoBtn
      : autoBtn +
        '<span class="pnha-btn pnha-pop" title="다른 창 위에 띄우기">⧉</span>' +
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
        <div class="pnha-gto"></div>
        <div class="pnha-turn">
          <div class="pnha-bar"><i></i></div>
          <div class="pnha-turntext">대기중</div>
        </div>
        <div class="pnha-actions">
          <button class="pnha-call" type="button">콜</button>
          <button class="pnha-check" type="button">체크</button>
          <button class="pnha-fold" type="button">폴드</button>
        </div>
        <div class="pnha-auto"><span></span><button type="button">취소</button></div>
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
      gto: q('.pnha-gto'),
      foldmsg: q('.pnha-foldmsg'), min: q('.pnha-min'), pop: q('.pnha-pop'), head: q('.pnha-head'),
      autoBox: q('.pnha-auto'), autoTxt: q('.pnha-auto span'),
      autoCancel: q('.pnha-auto button'), autoToggle: q('.pnha-auto-toggle')
    };

    // 🤖 헤더 버튼: 자동 폴드 ON/OFF (팝업 설정과 같은 값을 쓴다)
    els.autoToggle.addEventListener('click', () => {
      const on = !settings.autoFold;
      settings = Object.assign({}, settings, { autoFold: on });
      safe(() => chrome.storage.local.set({ settings }));
      if (on) { autoAct.cancelKey = null; autoAct.armedKey = null; autoAct.armedHow = null; autoAct.armedEl = null; }
      else cancelAutoForHand('');
      flash(els, on ? '자동 폴드 ON' : '자동 폴드 OFF');
      detectMyHand();
    });

    // 대기 중 취소 → 이번 핸드는 자동으로 누르지 않는다
    els.autoCancel.addEventListener('click', () => { cancelAutoForHand('🤖 이번 핸드 취소함'); });

    els.call.addEventListener('click', () => {
      if (!lastState.myTurn) { flash(els, '내 차례 아님'); return; }
      flash(els, clickFound('call') ? '✓ 콜' : '콜 버튼 없음');
      detectMyHand();
    });

    els.check.addEventListener('click', () => {
      if (!lastState.myTurn) { flash(els, '내 차례 아님'); return; }
      flash(els, clickFound('check') ? '✓ 체크' : '체크 버튼 없음');
      detectMyHand();
    });

    els.fold.addEventListener('click', () => {
      const r = performFold();
      if (!r.ok) { flash(els, '폴드 버튼 없음 (내 차례 아님)'); return; }
      flash(els, r.myTurn ? '✓ 폴드' : (r.armed ? '✓ 폴드 예약함' : '✓ 예약 취소'));
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
    // 안내는 패널 안에서 한다 (게임 화면에 모달을 띄우지 않는다)
    if (!('documentPictureInPicture' in window)) {
      if (overlayEls) flash(overlayEls, '팝아웃 미지원 (Chrome 116+)');
      log('documentPictureInPicture 미지원');
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
    box.classList.toggle('auto-on', !!settings.autoFold);
    paintAuto();

    // 내 포지션 / 지금 누구 차례
    overlayEls.mPos.textContent = state.position || '—';
    overlayEls.mTurn.textContent = state.turnName || '—';
    overlayEls.mTurnBox.classList.toggle('mine', state.turnName === '나');

    // 스탯 3칸 (칩 금액은 안 쓰고 전부 BB 로 환산해서 보여준다)
    const a = state.action;
    const bbText = (v) => (v == null ? '—' : fmtBB(v) + ' BB');
    // 체크만 하면 되는 상황이면 더 낼 돈은 0 BB
    const toCallBB = state.myTurn ? toCallBBOf(a) : null;
    overlayEls.sStack.textContent = bbText(state.stackBB);
    overlayEls.sPaid.textContent = bbText(state.paidBB);
    overlayEls.sToCall.textContent = state.myTurn ? bbText(toCallBB) : '—';
    overlayEls.sToCallBox.classList.toggle('hot', !!toCallBB);

    // GTO 권장 표시 (내 차례가 아니어도 항상 보여준다)
    const gtoEl = overlayEls.gto;
    if (settings.gtoMode && state.gto && state.gto.action) {
      gtoEl.style.display = 'block';
      gtoEl.className = 'pnha-gto ' + state.gto.action;
      const actLabel = { fold: '폴드', call: '콜', check: '체크', raise: '레이즈' }[state.gto.action] || '';
      if (state.gto.action === 'wait') {
        gtoEl.textContent = 'GTO: ' + (state.gto.reason || '직접 실행');
      } else {
        const eq = state.gto.equity != null ? Math.round(state.gto.equity * 100) + '%' : '';
        const req = state.gto.required != null ? Math.round(state.gto.required * 100) + '%' : '';
        gtoEl.textContent = 'GTO: ' + actLabel + (eq ? '  (' + eq + ' vs ' + req + ')' : '');
      }
      gtoEl.title = state.gto.reason || '';
    } else {
      gtoEl.style.display = 'none';
    }

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
  every(200, paintTimer);

  // 자동 폴드 대기 줄: 남은 시간 카운트다운 / 실행 결과 메시지
  function paintAuto() {
    if (!overlayEls || !overlayEls.autoBox) return;
    const { autoBox, autoTxt, autoCancel } = overlayEls;
    if (autoAct.timer) {
      const left = Math.max(0, autoAct.dueAt - Date.now()) / 1000;
      autoBox.classList.add('on');
      autoCancel.style.display = '';
      const planLabel = { check: '자동 체크', call: '자동 콜', raise: '자동 레이즈', fold: '자동 폴드' }[autoAct.plan] || '자동 액션';
      autoTxt.textContent = '🤖 ' + planLabel + ' ' + left.toFixed(1) + '초';
    } else if (settings.autoFold && isArmed() && !lastState.folded) {
      // 예약해둔 상태는 내 차례가 올 때까지 계속 보여준다 (언제든 취소 가능)
      autoBox.classList.add('on');
      autoCancel.style.display = '';
      autoTxt.textContent = '🤖 ' + (autoAct.armedHow === 'checkfold' ? '체크/폴드 예약됨' : '폴드 예약됨') +
        ' · 취소 안 하면 폴드';
    } else if (autoAct.msg && Date.now() < autoAct.msgUntil) {
      autoBox.classList.add('on');
      autoCancel.style.display = 'none';
      autoTxt.textContent = autoAct.msg;
    } else {
      autoBox.classList.remove('on');
    }
  }
  // 카운트다운이 도는 동안만 촘촘히(0.1초), 평소엔 느슨하게(0.6초) 갱신한다.
  // (0.1초마다 계속 도는 건 자동 폴드 예약 확인까지 끌고 들어와서 낭비였다)
  let autoTickTimer = null;
  (function autoTick() {
    paintAuto();
    autoTickTimer = setTimeout(autoTick, autoAct.timer ? 100 : 600);
  })();

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
      if (!audioCtx) audioCtx = new AudioContext();
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

  // Fold 버튼 "찾기" (누르지는 않는다 — 자동 예약 취소에 버튼 참조가 필요해서 분리)
  function findFoldButton() {
    for (const sel of FOLD_BUTTON_SELECTORS) {
      let btn = null;
      try { btn = document.querySelector(sel); } catch (e) {}
      if (btn && isClickable(btn)) return btn;
    }
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], .action-button'));
    // 정확히 "Fold" → 사전 액션 "...fold..." 순으로 시도
    for (const el of candidates) {
      const t = (el.textContent || '').trim().toLowerCase();
      if ((t === 'fold' || t === '폴드') && isClickable(el)) return el;
    }
    for (const el of candidates) {
      const t = (el.textContent || '').trim().toLowerCase();
      if (t.includes('fold') && isClickable(el)) return el;
    }
    return null;
  }

  function clickFoldButton() {
    const btn = findFoldButton();
    if (!btn) {
      log('Fold 버튼을 찾지 못함 (내 차례가 아니거나 셀렉터 확인 필요)');
      return false;
    }
    btn.click();
    return true;
  }

  /* 사용자가 요청한 폴드는 전부 이 함수를 지나간다 (오버레이 버튼 / F 키 / 팝업).
   * 내 차례면 즉시 폴드, 아니면 PokerNow 의 "미리 폴드" 예약 ↔ 취소 토글이므로
   * 한 곳에서 preFoldArmed 를 갱신해야 HUD 표시가 어긋나지 않는다.
   * (예전엔 오버레이 버튼만 이 상태를 갱신해서, F 키로 예약하면 패널은 계속
   *  "미리 폴드" 라고 표시됐다.) */
  function performFold() {
    const myTurn = isMyTurn();
    const wasArmed = !myTurn && (preFoldArmed || isFoldArmedInDom());
    if (!clickFoldButton()) return { ok: false, myTurn, armed: preFoldArmed };

    preFoldArmed = myTurn ? false : !wasArmed;
    if (!myTurn && !preFoldArmed) {
      // 사용자가 예약을 직접 풀었다 → 자동 폴드도 이번 핸드는 손대지 않는다
      autoAct.armedKey = null; autoAct.armedHow = null; autoAct.armedEl = null;
      autoAct.cancelKey = lastRawKey;
    }
    return { ok: true, myTurn, armed: preFoldArmed };
  }

  // 콜 / 체크 버튼 클릭 (사용자가 오버레이 버튼을 눌렀을 때만 호출됨)
  // 패널에 버튼을 띄울 때와 똑같은 findActionButton 을 쓰므로, 보이면 반드시 눌린다.
  function clickFound(kind) {
    const btn = findActionButton(kind);
    if (!btn) return false;
    btn.click();
    return true;
  }

  // 화면에 자리를 차지하고 있는지. 레이아웃만 보므로 자리마다 도는 곳에서 써도 싸다.
  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0;
  }

  // 실제로 누를 수 있는 버튼인지 (보이고 + disabled 아님 + display/visibility 확인)
  function isClickable(el) {
    if (!el || el.disabled || !isVisible(el)) return false;
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
      const r = performFold();
      if (!r.ok) return;
      e.preventDefault();
      if (overlayEls) flash(overlayEls, r.myTurn ? '✓ 폴드' : (r.armed ? '✓ 폴드 예약함' : '✓ 예약 취소'));
      detectMyHand();                     // 패널 표시를 바로 맞춘다
    }, true);
  }

  /* ===== 자동 폴드 (settings.autoFold 를 켰을 때만) ======================
   * 기본 방식('prefold'): 카드를 받자마자 PokerNow 의 "미리 폴드(사전 액션)"
   *   버튼을 대신 눌러둔다. 내가 취소하지 않으면 내 차례가 왔을 때 PokerNow 가
   *   알아서 폴드한다. 예약해두는 것뿐이라 취소할 시간이 넉넉하다.
   * 보조 방식('turn'): 내 차례가 됐을 때 N초 기다렸다가 폴드 버튼을 누른다.
   *   (prefold 모드에서도 예약이 안 먹었으면 이 방식으로 폴백한다.)
   *
   * 공통 규칙:
   *   - 내 홀카드가 "지정한 핸드" 면 아무것도 하지 않는다 (내가 직접 플레이).
   *   - autoCheckFree 면 "Check/Fold" 사전 액션을 우선 눌러 공짜 체크를 살린다.
   *   - autoPreflopOnly 면 플롭 이후에는 손대지 않는다.
   *   - 한 스트리트에 예약 1번 / 실행 1번.
   *   - 취소하면 그 핸드는 끝까지 자동으로 누르지 않는다.
   * ===================================================================== */

  // 스트리트 식별자: 같은 핸드라도 프리플롭/플롭/턴/리버를 따로 센다
  const streetKey = (handKey, boardLen) => handKey + '#' + boardLen;

  // 예약된 타이머만 지운다 (사전 액션 예약은 건드리지 않는다)
  function cancelAutoAct() {
    if (autoAct.timer) clearTimeout(autoAct.timer);
    autoAct.timer = null; autoAct.key = null; autoAct.dueAt = 0; autoAct.plan = null;
  }

  const setAutoMsg = (msg, ms) => { autoAct.msg = msg; autoAct.msgUntil = Date.now() + (ms || 2000); };

  // 지금 "미리 폴드" 가 걸려 있는지 (우리가 걸었든 사용자가 걸었든)
  const isArmed = () => !!autoAct.armedKey && (preFoldArmed || isFoldArmedInDom());

  // 대기 중인 타이머만 취소 (사용자가 페이지를 직접 조작했을 때)
  function abortAutoTimer(msg) {
    if (!autoAct.timer) return;
    cancelAutoAct();
    autoAct.cancelKey = lastRawKey;   // 이번 핸드는 사용자가 직접 하기로 함
    setAutoMsg(msg || '자동 폴드 취소됨', 1600);
    paintAuto();
  }

  // 취소 버튼: 예약을 풀고, 이번 핸드는 다시 예약하지 않는다
  function cancelAutoForHand(msg) {
    const wasArmed = isArmed();
    cancelAutoAct();
    if (wasArmed && !isMyTurn()) {
      // 사전 액션은 토글 — 예약할 때 누른 "그 버튼" 을 다시 눌러야 풀린다
      const el = autoAct.armedEl;
      if (el && document.contains(el) && isClickable(el)) el.click();
      else clickFoldButton();
      preFoldArmed = false;
    }
    autoAct.armedKey = null; autoAct.armedHow = null; autoAct.armedEl = null;
    autoAct.cancelKey = lastRawKey;
    setAutoMsg(msg || '자동 폴드 취소함', 2000);
    paintAuto();
  }

  // 사전 액션 걸기: 공짜 체크를 살리려면 "Check/Fold" 를, 없으면 "Fold" 를 누른다.
  // 나중에 취소할 수 있도록 실제로 누른 버튼을 함께 돌려준다.
  function armPreFold() {
    if (settings.autoCheckFree) {
      const cands = document.querySelectorAll('button, [role="button"], .action-button');
      for (const el of cands) {
        const t = (el.textContent || '').trim().toLowerCase().replace(/\s+/g, '');
        if (/(check\/?fold|체크\/?폴드)/.test(t) && isClickable(el)) {
          el.click();
          return { how: 'checkfold', el };
        }
      }
    }
    const fold = findFoldButton();
    if (!fold) return null;
    fold.click();
    return { how: 'fold', el: fold };
  }

  function maybeAutoAct(ctx) {
    if (!settings.autoFold) { cancelAutoAct(); return; }
    if (settings.gtoMode) { maybeAutoGto(ctx); return; }  // GTO 경로
    if (ctx.allowed) { cancelAutoAct(); return; }                    // 지정 핸드 → 내가 직접
    if (settings.autoPreflopOnly && ctx.boardLen >= 3) { cancelAutoAct(); return; }
    if (autoAct.cancelKey === ctx.key) { cancelAutoAct(); return; }  // 사용자가 취소한 핸드

    const sk = streetKey(ctx.key, ctx.boardLen);

    // ① 아직 내 차례가 아님 → "미리 폴드" 를 눌러둔다 (기본 방식)
    if (!ctx.myTurn) {
      if (settings.autoMode === 'turn') { cancelAutoAct(); return; }
      if (autoAct.armedKey === sk) return;          // 이 스트리트엔 이미 시도함
      if (autoAct.tryKey !== sk) { autoAct.tryKey = sk; autoAct.tries = 0; }

      const armed = armPreFold();
      if (armed) {
        autoAct.armedKey = sk;                      // 성공 → 이 스트리트엔 더 안 누른다
        autoAct.armedHow = armed.how;
        autoAct.armedEl = armed.el;
        preFoldArmed = true;
        setAutoMsg(armed.how === 'checkfold' ? '🤖 체크/폴드 예약함' : '🤖 폴드 예약함', 2500);
        log('사전 폴드 예약:', ctx.hand, armed.how);
        return;
      }

      // 버튼이 아직 안 떴을 수 있으니 몇 번은 다시 시도하고, 그래도 없으면 포기.
      // (포기해도 내 차례가 오면 아래 ② 폴백이 폴드한다)
      autoAct.tries += 1;
      if (autoAct.tries >= 5) {
        autoAct.armedKey = sk; autoAct.armedHow = null; autoAct.armedEl = null;
        setAutoMsg('🤖 예약 버튼 없음 · 내 차례에 폴드', 2500);
        log('사전 폴드 예약 실패 — 내 차례 폴백으로 넘김:', ctx.hand);
      }
      return;
    }

    // ② 내 차례인데 아직 안 죽었다 = 예약이 안 먹었거나 'turn' 모드
    //    → 대기시간 후 직접 폴드 (그 사이 클릭/키 입력하면 취소)
    if (autoAct.doneKey === sk) return;
    if (autoAct.timer && autoAct.key === sk) return;
    cancelAutoAct();

    const toCall = toCallBBOf(ctx.action);
    const delay = Math.max(0, Number(settings.autoFoldDelay) || 0) * 1000;
    autoAct.key = sk;
    autoAct.plan = (settings.autoCheckFree && toCall === 0) ? 'check' : 'fold';
    autoAct.dueAt = Date.now() + delay;
    autoAct.timer = setTimeout(() => { autoAct.timer = null; runAutoAct(sk); }, delay);
    log('자동', autoAct.plan, '예약:', ctx.hand, (delay / 1000) + '초 후');
    paintAuto();
  }

  /* ===== GTO 모드 (settings.gtoMode 를 켰을 때만) =======================
   * 프리플롭/포스트플롭 결정은 gto.js(window.PNHAGTO)가 내리고,
   * 여기서는 "내 차례에 N초 뒤 그대로 클릭"만 담당한다.
   * 사전 폴드 예약은 하지 않는다 — GTO 판단은 베팅이 바뀌면 계속 달라지므로,
   * 미리 폴드를 걸어두면 "콜해야 할 핸드"를 실수로 폴드할 수 있기 때문.
   * ===================================================================== */

  function maybeAutoGto(ctx) {
    if (autoAct.cancelKey === ctx.key) { cancelAutoAct(); return; }
    const sk = streetKey(ctx.key, ctx.boardLen);
    if (!ctx.myTurn) { cancelAutoAct(); return; }      // 내 차례에만 실행

    if (autoAct.doneKey === sk) return;                 // 이 스트리트는 이미 실행함
    if (autoAct.timer && autoAct.key === sk) return;    // 이미 예약됨

    const dec = ctx.gto;
    if (!dec) return;
    if (dec.action === 'wait' || (dec.action === 'raise' && settings.gtoAggro !== 'auto')) {
      // 레이즈는 사용자가 직접 (권장만 표시)
      cancelAutoAct();
      setAutoMsg('🤖 GTO: ' + (dec.reason || '직접 실행') + ' · 직접 누르세요', 2500);
      return;
    }

    cancelAutoAct();
    const delay = Math.max(0, Number(settings.autoFoldDelay) || 0) * 1000;
    autoAct.key = sk;
    autoAct.plan = dec.action;
    autoAct.dueAt = Date.now() + delay;
    autoAct.timer = setTimeout(() => { autoAct.timer = null; runAutoAct(sk); }, delay);
    log('GTO 자동', dec.action, '예약:', ctx.hand, (delay / 1000) + '초 후', dec.reason || '');
    paintAuto();
  }

  // 실행 시점의 DOM 상태로 GTO 판단을 다시 내린다 (그 사이 상황이 바뀌었을 수 있음)
  function computeGtoNow() {
    try {
      const bb = getBigBlind();
      const stack = readHeroStack();
      const els = findHoleCardElements();
      if (els.length !== 2) return null;
      const c1 = parseCardElement(els[0]);
      const c2 = parseCardElement(els[1]);
      const hand = normalizeHand(c1, c2);
      if (!hand) return null;
      const holeKeys = new Set([c1.rank + c1.suit, c2.rank + c2.suit]);
      const board = readBoardCards(holeKeys);
      const seats = updateHandSeats();
      learnSeatDir(seats, board.length);
      const position = heroPositionName(seats);
      const action = getActionInfo(stack);
      const potBB = bb ? readPot() / bb : null;
      return window.PNHAGTO.decide({
        c1, c2, hand, position, board,
        toCallBB: toCallBBOf(action),
        potBB,
        stackBB: (stack != null && bb) ? stack / bb : null,
        tableSize: seats.length,
        street: board.length,
        aggroAuto: settings.gtoAggro === 'auto',
        streetMode: settings.gtoStreet,
        iterations: Number(settings.gtoSimIter) || 1500
      });
    } catch (e) { log('GTO 재판단 오류:', e); return null; }
  }

  function runAutoAct(sk) {
    autoAct.key = null; autoAct.dueAt = 0; autoAct.plan = null;

    // 실행 직전에 조건을 처음부터 다시 확인한다 (기다리는 사이 상황이 바뀔 수 있다)
    if (!settings.enabled || !settings.autoFold) return;
    if (autoAct.cancelKey === lastRawKey) return;
    if (!isMyTurn() || isHeroFolded()) return;

    const els = findHoleCardElements();
    if (els.length !== 2) return;
    const c1 = parseCardElement(els[0]);
    const c2 = parseCardElement(els[1]);
    const hand = normalizeHand(c1, c2);
    if (!hand) return;

    let action = null, reason = '', equity = null, required = null;
    if (settings.gtoMode) {
      // GTO: 실행 시점에 다시 판단한다
      const dec = computeGtoNow();
      if (!dec) return;
      action = dec.action; reason = dec.reason || ''; equity = dec.equity; required = dec.required;
      if (action === 'wait' || (action === 'raise' && settings.gtoAggro !== 'auto')) {
        setAutoMsg('🤖 GTO: 레이즈 권장 · 직접 누르세요', 2500);
        return;
      }
    } else {
      if (settings.hands.includes(hand)) return;         // 지정 핸드면 손대지 않는다
      const toCall = toCallBBOf(getActionInfo(readHeroStack()));
      action = (settings.autoCheckFree && toCall === 0) ? 'check' : 'fold';
    }

    let ok = false;
    if (action === 'check') ok = clickFound('check');
    else if (action === 'call') ok = clickFound('call');
    else if (action === 'raise') ok = clickRaiseButton();
    else ok = clickFoldButton();

    autoAct.doneKey = sk;
    const label = { fold: '폴드', call: '콜', check: '체크', raise: '레이즈' }[action] || '액션';
    setAutoMsg(ok ? '🤖 자동 ' + label + '함' : '🤖 버튼을 못 찾음');
    log('자동 액션:', action, ok ? '성공' : '실패', hand, reason);
    detectMyHand();
  }

  // 내 차례에 카운트다운이 도는 중이라면, 페이지를 직접 조작한 순간 취소한다.
  // (예약만 걸려 있는 상태는 여기서 풀지 않는다 — 취소 버튼으로만 푼다.)
  document.addEventListener('mousedown', (e) => {
    if (!autoAct.timer) return;
    const box = document.getElementById(OVERLAY_ID);
    if (box && box.contains(e.target)) return;   // 패널 자체 조작은 취소로 보지 않음
    abortAutoTimer('내가 직접 조작 → 자동 취소');
  }, true);
  document.addEventListener('keydown', () => {
    if (autoAct.timer) abortAutoTimer('내가 직접 조작 → 자동 취소');
  }, true);

  /* ===== 팝업 메시지 & 시작 ============================================== */

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'PING_DETECT') { detectMyHand(); sendResponse({ ok: true }); }
    else if (msg && msg.type === 'MANUAL_FOLD') {
      cancelAutoAct();
      const r = performFold();            // 오버레이·F 키와 똑같은 경로 (예약 상태 공유)
      detectMyHand();
      sendResponse(r);
    }
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

  // 확장이 죽었을 때(재로드 등) 페이지에 남은 이 스크립트를 완전히 정지시킨다.
  function shutdown() {
    try { observer.disconnect(); } catch (e) { /* ignore */ }
    intervals.forEach(clearInterval);
    intervals.length = 0;
    if (autoTickTimer) { clearTimeout(autoTickTimer); autoTickTimer = null; }
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
    if (autoAct.timer) { clearTimeout(autoAct.timer); autoAct.timer = null; }
    removeOverlay();
  }

  function start() {
    let ver = '?';
    try { ver = chrome.runtime.getManifest().version; } catch (e) {}
    console.log('[PokerAlert] 시작됨 — 확장 v' + ver + ' · 자동폴드:', settings.autoFold, '· GTO:', settings.gtoMode);
    // ★ style 은 감시하지 않는다 — PokerNow 가 타이머 바의 style.width 를 쉬지 않고
    //   바꿔서, 넣어두면 콜백이 초당 수백 번 호출된다. 남은 시간은 paintTimer 가
    //   200ms 마다 직접 읽으므로 감시할 이유가 없다.
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    every(HEARTBEAT_MS, detectMyHand);   // detectMyHand 안에서 생존 확인 → 죽으면 shutdown
    log('감지 시작.');
    detectMyHand();
  }

  loadSettings();
  if (document.body) start();
  else window.addEventListener('DOMContentLoaded', start);
})();
