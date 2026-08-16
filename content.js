/* =========================================================================
 * PokerNow Hand Alert - content.js
 * -------------------------------------------------------------------------
 * PokerNow 게임 페이지에서 실행되어:
 *   1) 내 홀카드 2장을 감지하고 "AA", "AKs" 처럼 정규화한다.
 *   2) 화면 위 오버레이(HUD)에 현재 패 / 프리미엄 여부 / 내 차례 / 콜 정보를
 *      항상 표시한다. (⧉ 버튼으로 다른 창 위에 뜨는 PiP 창으로 뺄 수 있음)
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

  // 블라인드 표시(콜 → BB 환산용)
  const BLIND_SELECTORS = ['.blind-value', '.blind-value-ctn'];

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

  // 빅블라인드 = 블라인드 표기 중 가장 큰 숫자
  function getBigBlind() {
    for (const sel of BLIND_SELECTORS) {
      const ctn = document.querySelector(sel);
      if (!ctn) continue;
      const nums = Array.from(ctn.querySelectorAll('.normal-value, .chips-value'))
        .map((el) => firstNumber(el.textContent)).filter((n) => n > 0);
      if (nums.length) return Math.max.apply(null, nums);
      const n = firstNumber(ctn.textContent);
      if (n) return n;
    }
    return null;
  }

  // 내 차례 액션 정보: { canCheck, callAmount, callBB }
  function getActionInfo() {
    const bb = getBigBlind();
    const callBtn = document.querySelector('.action-buttons .call, .action-button.call');
    const checkBtn = document.querySelector('.action-buttons .check, .action-button.check');
    const callAmount = (callBtn && !callBtn.disabled) ? firstNumber(callBtn.textContent) : null;
    return {
      canCheck: !!(checkBtn && !checkBtn.disabled),
      callAmount,
      callBB: (callAmount != null && bb) ? callAmount / bb : null
    };
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

    // 폴드했으면 카드 지움 (예약 상태도 초기화)
    if (isHeroFolded()) {
      lastRawKey = null; preFoldArmed = false;
      renderOverlay({ hasCards: false, folded: true, myTurn: false, foldArmed: false, action: null });
      return;
    }

    const myTurn = isMyTurn();
    if (myTurn) preFoldArmed = false; // 내 차례엔 즉시 폴드(예약 개념 없음)
    const action = myTurn ? getActionInfo() : null;
    const els = findHoleCardElements();

    if (els.length !== 2) {
      lastRawKey = null; preFoldArmed = false;
      renderOverlay({ hasCards: false, myTurn, foldArmed: false, action });
      return;
    }

    const c1 = parseCardElement(els[0]);
    const c2 = parseCardElement(els[1]);
    const hand = normalizeHand(c1, c2);
    if (!hand) { renderOverlay({ hasCards: false, myTurn, foldArmed: false, action }); return; }

    const allowed = settings.hands.includes(hand);
    const key = [prettyCard(c1), prettyCard(c2)].sort().join('|');
    const isNewHand = key !== lastRawKey;
    if (isNewHand) preFoldArmed = false;

    const foldArmed = !myTurn && (preFoldArmed || isFoldArmedInDom());

    // 보드가 깔렸으면(플롭 이후) 현재 완성된 족보 계산
    const holeKeys = new Set([c1.rank + c1.suit, c2.rank + c2.suit]);
    const board = readBoardCards(holeKeys);
    const made = board.length >= 3 ? describeMade(c1, c2, board) : null;
    const boardPretty = board.map(prettyCard);

    renderOverlay({
      hasCards: true, pretty1: prettyCard(c1), pretty2: prettyCard(c2),
      hand, allowed, myTurn, foldArmed, action, made, boardPretty
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
    #${OVERLAY_ID}{position:fixed;top:80px;right:16px;z-index:2147483647;width:190px;
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
    #${OVERLAY_ID} .pnha-turn{margin-top:8px;font-size:12px;font-weight:700;color:#9aa0b4;}
    #${OVERLAY_ID}.my-turn .pnha-turn{color:#1e1f26;background:#f0a531;border-radius:8px;padding:3px;}
    #${OVERLAY_ID} .pnha-call{margin-top:7px;font-size:13px;font-weight:800;color:#e8e8ee;display:none;}
    #${OVERLAY_ID}.my-turn .pnha-call{display:block;}
    #${OVERLAY_ID} .pnha-call .bb{color:#7ee787;}
    #${OVERLAY_ID} .pnha-call .chk{color:#58a6ff;}
    #${OVERLAY_ID} .pnha-fold{margin-top:8px;width:100%;padding:9px;border:none;border-radius:8px;
      background:#b3242f;color:#fff;font-weight:800;font-size:14px;cursor:pointer;}
    #${OVERLAY_ID} .pnha-fold:hover{background:#d0303c;}
    #${OVERLAY_ID} .pnha-fold.armed{background:#3a3d4d;color:#cfd2e0;box-shadow:none;}
    #${OVERLAY_ID} .pnha-fold.armed:hover{background:#474a5c;}
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
        <div class="pnha-turn">대기중</div>
        <div class="pnha-call"></div>
        <button class="pnha-fold" type="button">Fold</button>
        <div class="pnha-foldmsg"></div>
      </div>`;
    doc.body.appendChild(box);

    const q = (s) => box.querySelector(s);
    const els = {
      box, cards: q('.pnha-cards'), made: q('.pnha-made'), board: q('.pnha-board'),
      turn: q('.pnha-turn'), call: q('.pnha-call'), fold: q('.pnha-fold'),
      foldmsg: q('.pnha-foldmsg'), min: q('.pnha-min'), pop: q('.pnha-pop'), head: q('.pnha-head')
    };

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
    const { box, cards, made, board, turn, call } = overlayEls;

    if (!state.hasCards) {
      cards.className = 'pnha-cards empty';
      cards.textContent = state.folded ? '폴드' : '대기중';
      made.textContent = ''; made.className = 'pnha-made';
      board.textContent = ''; board.style.display = 'none';
      box.classList.remove('premium');
    } else {
      cards.className = 'pnha-cards';
      cards.innerHTML = colorCard(state.pretty1) + ' ' + colorCard(state.pretty2);
      box.classList.toggle('premium', !!state.allowed);

      // 족보 줄: 플롭 이후엔 완성 족보, 프리플롭엔 핸드코드(AKo 등)
      if (state.made) {
        made.className = 'pnha-made ' + state.made.klass;
        made.textContent = state.made.name + (state.made.usesHole ? '' : ' (보드)');
      } else {
        made.className = 'pnha-made pnha-code';
        made.textContent = state.hand;
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
    turn.textContent = state.myTurn ? '진행중' : '대기중';

    const a = state.action;
    if (state.myTurn && a && a.canCheck && !a.callAmount) {
      call.innerHTML = '<span class="chk">체크 가능</span>';
    } else if (state.myTurn && a && a.callAmount != null) {
      const bb = a.callBB != null ? ' · <span class="bb">' + fmtBB(a.callBB) + ' BB</span>' : '';
      call.innerHTML = '콜 ' + a.callAmount + bb;
    } else {
      call.textContent = '';
    }

    // Fold 버튼: 내 차례=즉시(빨강) / 미리폴드 예약=회색
    const fold = overlayEls.fold;
    fold.style.display = (state.hasCards || state.myTurn) ? 'block' : 'none';
    if (state.myTurn) {
      fold.textContent = 'Fold';
      fold.classList.remove('armed');
    } else if (state.foldArmed) {
      fold.textContent = '폴드 예약됨';
      fold.classList.add('armed');
    } else {
      fold.textContent = '미리 폴드';
      fold.classList.remove('armed');
    }
  }

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
