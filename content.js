/* =========================================================================
 * PokerNow Hand Alert - content.js
 * -------------------------------------------------------------------------
 * 이 스크립트는 PokerNow 게임 페이지 안에서 실행됩니다.
 * 역할:
 *   1) 내 홀카드(2장)를 DOM 에서 찾아낸다.
 *   2) "AKs", "AA" 같은 표준 표기로 정규화한다.
 *   3) 사용자가 지정한 프리미엄 핸드에 해당하면
 *      - 알림음을 재생하고 (Web Audio 로 직접 삐- 소리 생성)
 *      - background.js 로 메시지를 보내 데스크톱 알림을 띄운다.
 *
 * ⚠️ 이 확장 프로그램은 절대로 Fold / Call / Check / Bet / Raise 버튼을
 *    누르지 않습니다. 오직 "감지 + 알림" 만 합니다. 게임 액션은 사용자가
 *    직접 합니다.
 * ========================================================================= */

(() => {
  'use strict';

  /* =======================================================================
   * [설정 구역 1] 디버그 모드
   * DEBUG 가 true 이면 콘솔(F12)에 감지 과정이 자세히 출력됩니다.
   * 카드가 감지되지 않을 때 이 로그를 보면 원인을 찾기 쉽습니다.
   * ===================================================================== */
  const DEBUG = true;

  function log(...args) {
    if (DEBUG) console.log('[PokerAlert]', ...args);
  }

  /* =======================================================================
   * [설정 구역 2] 카드 감지 셀렉터 (★ 감지가 안 되면 여기를 수정하세요 ★)
   * -----------------------------------------------------------------------
   * PokerNow 의 HTML 구조는 언제든 바뀔 수 있습니다.
   * 그래서 하나의 셀렉터에만 의존하지 않고 여러 후보를 배열로 준비합니다.
   * findHoleCardElements() 가 이 후보들을 위에서부터 순서대로 시도합니다.
   *
   * ▶ 수정 방법:
   *   1) PokerNow 게임 화면에서 F12 → Elements 탭
   *   2) 내 홀카드 요소를 우클릭 → Inspect
   *   3) 그 요소의 class / data-* / 부모 구조를 확인
   *   4) 아래 HERO_CONTAINER_SELECTORS 또는 CARD_SELECTORS 에 추가
   * ===================================================================== */

  // (A) "나(hero)"의 카드 영역을 감싸는 컨테이너 후보들.
  //     보통 내 자리에는 'you' 또는 'hero' 같은 클래스가 붙습니다.
  const HERO_CONTAINER_SELECTORS = [
    '.table-player.you-player',
    '.you-player',
    '.table-player.hero',
    '.hero-player',
    '[data-is-hero="true"]',
    '.table-player-you'
  ];

  // (B) 위 컨테이너 안에서 개별 카드 요소를 찾는 후보 셀렉터들.
  //     ▼ PokerNow 실제 구조: .table-player-cards > .card-container > ... > .card
  //       그 안에 <span class="value">A</span><span class="suit">s</span> 가 들어있음.
  const CARD_SELECTORS = [
    '.table-player-cards .card-container', // ★ PokerNow 카드 컨테이너 (클래스에 랭크/무늬)
    '.table-player-cards .card',           // 값 span 이 든 안쪽 카드
    '.card-container',
    '.card',
    '[data-card]',
    '.playing-card',
    'img.card'
  ];

  // (C) 수동 Fold 버튼용 셀렉터 후보들.
  //     팝업의 "Fold" 버튼을 누르면 아래 후보 중 하나를 찾아 클릭합니다.
  //     ★ 폴드가 안 되면 F12 로 실제 Fold 버튼을 검사해 여기에 추가하세요. ★
  //     (자동이 아니라, 사용자가 팝업 버튼을 누를 때만 동작합니다.)
  const FOLD_BUTTON_SELECTORS = [
    '.game-decisions-ctn .fold',
    'button.fold-button',
    '.action-button.fold',
    '.fold-button',
    'button[data-action="fold"]',
    '[aria-label="Fold" i]'
  ];

  // (D) 폴드 단축키. PokerNow 페이지가 포커스된 상태에서 이 키를 누르면 폴드합니다.
  //     ('' 로 두면 단축키 비활성화)
  const FOLD_HOTKEY = 'f';

  /* =======================================================================
   * [설정 구역 3] 성능 / 중복 제어
   * ===================================================================== */
  const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  const RANK_ORDER = Object.fromEntries(RANKS.map((r, i) => [r, i])); // 높낮이 비교용

  /* =======================================================================
   * [상태 변수]
   * ===================================================================== */
  let settings = defaultSettings();  // 팝업/옵션에서 저장한 설정 캐시
  let lastRawKey = null;             // 마지막으로 "감지된" 카드 (팝업 표시용)
  let audioCtx = null;               // Web Audio 컨텍스트 (알림음)

  /* =======================================================================
   * 확장 컨텍스트가 살아있는지 확인.
   * 확장을 새로고침/업데이트하면, 페이지에 남아있던 옛 content.js 는
   * "Extension context invalidated" 에러를 냅니다. 이때 모든 chrome.* 호출을
   * 멈추고 관찰도 중단합니다. (해결: PokerNow 페이지를 F5 새로고침)
   * ===================================================================== */
  function extensionAlive() {
    try {
      return !!(chrome && chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  // chrome.* 호출을 안전하게 감싸는 래퍼. 컨텍스트가 죽었으면 조용히 건너뜀.
  function safe(fn) {
    if (!extensionAlive()) return;
    try { fn(); } catch (e) { /* Extension context invalidated 등 무시 */ }
  }

  function defaultSettings() {
    return {
      enabled: true,                                     // 전체 ON/OFF
      soundEnabled: true,                                // 알림음 ON/OFF
      notificationEnabled: true,                         // 데스크톱 알림 ON/OFF
      hands: ['AA', 'KK', 'QQ', 'JJ', 'AKs', 'AKo']      // 알림 대상 핸드 목록
    };
  }

  /* =======================================================================
   * 설정 로드 & 변경 감지
   * ===================================================================== */
  function loadSettings() {
    chrome.storage.local.get('settings', (data) => {
      if (data && data.settings) {
        settings = Object.assign(defaultSettings(), data.settings);
      }
      log('설정 로드됨:', settings);
    });
  }

  // 팝업/옵션에서 설정을 바꾸면 실시간으로 반영
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) {
      settings = Object.assign(defaultSettings(), changes.settings.newValue || {});
      log('설정 변경 감지:', settings);
    }
  });

  /* =======================================================================
   * [핵심 함수 1] findHoleCardElements()
   * 내 홀카드 2장에 해당하는 DOM 요소 배열을 반환합니다.
   * 여러 전략을 순서대로 시도하고, 딱 2장이 잡히는 결과를 채택합니다.
   * ===================================================================== */
  function findHoleCardElements() {
    // 전략 1: hero 컨테이너 안에서 카드 찾기 (가장 정확)
    for (const containerSel of HERO_CONTAINER_SELECTORS) {
      const container = document.querySelector(containerSel);
      if (!container) continue;
      for (const cardSel of CARD_SELECTORS) {
        // 실제로 값이 읽히는(=내 카드) 요소만 추림. 상대의 빈 카드(<div class="card"></div>)는 제외.
        const cards = Array.from(container.querySelectorAll(cardSel))
          .filter(looksLikeCard)
          .filter((el) => parseCardElement(el) !== null);
        if (cards.length === 2) {
          log('감지 전략 1 성공:', containerSel, '>', cardSel);
          return cards;
        }
      }
    }

    // 전략 2: hero 컨테이너를 못 찾은 경우, 페이지 전체에서 카드로 보이는
    //         요소를 모아서 그 중 "가려지지 않은(내가 볼 수 있는)" 2장을 추정.
    for (const cardSel of CARD_SELECTORS) {
      const all = Array.from(document.querySelectorAll(cardSel)).filter(looksLikeCard);
      // 뒷면(back)이 아닌, 값이 실제로 읽히는 카드만
      const readable = all.filter((el) => parseCardElement(el) !== null);
      if (readable.length === 2) {
        log('감지 전략 2 성공 (전역):', cardSel);
        return readable;
      }
    }

    return [];
  }

  // 요소가 "카드처럼 보이는지" 대략 판별 (너무 큰/작은 것 제외)
  function looksLikeCard(el) {
    if (!el || el.nodeType !== 1) return false;
    // 뒷면 카드는 보통 'back' / 'hidden' 클래스가 붙음 → 제외 시도
    const cls = (el.className || '').toString().toLowerCase();
    if (cls.includes('back') || cls.includes('hidden') || cls.includes('folded')) return false;
    return true;
  }

  /* =======================================================================
   * [핵심 함수 2] parseCardElement(element)
   * 카드 하나의 DOM 요소에서 { rank, suit } 를 추출합니다.
   * rank: '2'~'9','T','J','Q','K','A'
   * suit: 's'(spade) 'h'(heart) 'd'(diamond) 'c'(club)
   * 실패 시 null 반환.
   *
   * 여러 소스를 순서대로 시도합니다:
   *   - data-card 속성        (예: "As", "Th")
   *   - class 이름            (예: "card value-A suit-spades")
   *   - aria-label            (예: "Ace of Spades")
   *   - 이미지 alt            (예: "As")
   *   - background-image URL  (예: ".../As.svg")
   *   - 텍스트 내용           (예: "A♠")
   * ===================================================================== */
  function parseCardElement(element) {
    if (!element) return null;

    // 0) ★ 가장 안정적: 카드 컨테이너 클래스 토큰으로 파싱 ★
    //    PokerNow 는 카드 컨테이너에 랭크/무늬를 클래스로 박아둠:
    //      card-s-2  → 랭크 2,  card-s-14 → 랭크 A (11=J,12=Q,13=K,14=A)
    //      card-c/card-h/card-d/card-s → 무늬(클럽/하트/다이아/스페이드)
    //    span 텍스트는 플립 애니메이션 중 잠깐 비어있을 수 있어 이게 더 안전.
    const byClass = parseFromClassTokens(element);
    if (byClass) return byClass;

    // 0-b) 자식 .value / .suit span 읽기 (백업)
    //    <div class="card"><span class="value">A</span><span class="suit">s</span></div>
    if (element.querySelector) {
      const valueEl = element.querySelector('.value');
      const suitEl = element.querySelector('.suit:not(.sub-suit)') || element.querySelector('.suit');
      if (valueEl && suitEl) {
        const r = normalizeRank((valueEl.textContent || '').trim());
        const s = normalizeSuit((suitEl.textContent || '').trim());
        if (r && s) return { rank: r, suit: s };
      }
    }

    // 1) data-card / data-value+data-suit 속성
    const dataCard = element.getAttribute && (
      element.getAttribute('data-card') ||
      element.dataset && element.dataset.card
    );
    if (dataCard) {
      const r = fromCombined(dataCard);
      if (r) return r;
    }
    const dRank = element.getAttribute && element.getAttribute('data-value');
    const dSuit = element.getAttribute && element.getAttribute('data-suit');
    if (dRank && dSuit) {
      const r = normalizeRank(dRank);
      const s = normalizeSuit(dSuit);
      if (r && s) return { rank: r, suit: s };
    }

    // 2) class 이름에서 추출 (예: "value-A", "suit-spades", "card-As")
    const cls = (element.className || '').toString();
    {
      const combined = cls.match(/card[-_ ]([2-9tjqka]{1,2}[shdc])/i);
      if (combined) {
        const r = fromCombined(combined[1]);
        if (r) return r;
      }
      const rMatch = cls.match(/(?:value|rank)[-_]([2-9tjqka]|10)/i);
      const sMatch = cls.match(/(?:suit)[-_](spades?|hearts?|diamonds?|clubs?|[shdc])/i);
      if (rMatch && sMatch) {
        const r = normalizeRank(rMatch[1]);
        const s = normalizeSuit(sMatch[1]);
        if (r && s) return { rank: r, suit: s };
      }
    }

    // 3) aria-label (예: "Ace of Spades", "Ten of Hearts")
    const aria = element.getAttribute && element.getAttribute('aria-label');
    if (aria) {
      const r = fromWords(aria);
      if (r) return r;
    }

    // 4) 이미지 alt / src
    const img = element.matches && element.matches('img') ? element
      : (element.querySelector && element.querySelector('img'));
    if (img) {
      const alt = img.getAttribute('alt');
      if (alt) {
        const r = fromCombined(alt) || fromWords(alt);
        if (r) return r;
      }
      const src = img.getAttribute('src') || '';
      const r = fromUrl(src);
      if (r) return r;
    }

    // 5) background-image URL (예: url(".../Ah.svg"))
    try {
      const bg = getComputedStyle(element).backgroundImage || '';
      const r = fromUrl(bg);
      if (r) return r;
    } catch (e) { /* ignore */ }

    // 6) 텍스트 내용 (예: "A♠", "10♥", "K c")
    const text = (element.textContent || '').trim();
    if (text) {
      const r = fromText(text);
      if (r) return r;
    }

    return null;
  }

  /* ---- rank / suit 정규화 헬퍼들 ---- */

  // 컨테이너 클래스 토큰으로 파싱: card-s-<숫자>(랭크) + card-<무늬>
  function parseFromClassTokens(element) {
    if (!element) return null;
    // element 자신 + 가장 가까운 .card-container 둘 다 확인
    const nodes = [];
    if (element.className) nodes.push(element);
    if (element.closest) {
      const cont = element.closest('.card-container');
      if (cont && cont !== element) nodes.push(cont);
    }
    for (const node of nodes) {
      const cls = (node.className || '').toString();
      const rankM = cls.match(/\bcard-s-(\d{1,2})\b/);        // 랭크: card-s-2 ~ card-s-14
      const suitM = cls.match(/\bcard-([chsd])(?![\w-])/);    // 무늬: card-c/h/d/s (뒤에 -숫자 없는 것)
      if (rankM && suitM) {
        const r = rankNumToRank(rankM[1]);
        const s = normalizeSuit(suitM[1]);
        if (r && s) return { rank: r, suit: s };
      }
    }
    return null;
  }

  // 2~14 숫자 랭크를 표준 문자로: 10→T, 11→J, 12→Q, 13→K, 14→A
  function rankNumToRank(n) {
    const map = { 2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'T',11:'J',12:'Q',13:'K',14:'A' };
    return map[parseInt(n, 10)] || null;
  }

  function normalizeRank(raw) {
    if (!raw) return null;
    let v = raw.toString().trim().toUpperCase();
    if (v === '10') v = 'T';
    if (v === '1') v = 'A'; // 혹시 Ace 를 1 로 표기하는 경우
    if (RANK_ORDER.hasOwnProperty(v)) return v;
    // 단어형 (ACE, KING...) 지원
    const words = {
      ACE: 'A', KING: 'K', QUEEN: 'Q', JACK: 'J', TEN: 'T',
      NINE: '9', EIGHT: '8', SEVEN: '7', SIX: '6', FIVE: '5',
      FOUR: '4', THREE: '3', TWO: '2'
    };
    return words[v] || null;
  }

  function normalizeSuit(raw) {
    if (!raw) return null;
    const v = raw.toString().trim().toLowerCase();
    if (v.startsWith('s') || v.includes('♠') || v === 'spade' || v === 'spades') return 's';
    if (v.startsWith('h') || v.includes('♥') || v === 'heart' || v === 'hearts') return 'h';
    if (v.startsWith('d') || v.includes('♦') || v === 'diamond' || v === 'diamonds') return 'd';
    if (v.startsWith('c') || v.includes('♣') || v === 'club' || v === 'clubs') return 'c';
    return null;
  }

  // "As", "Th", "10c" 같은 합쳐진 표기 → { rank, suit }
  function fromCombined(str) {
    if (!str) return null;
    const s = str.toString().trim();
    const m = s.match(/^\s*(10|[2-9tjqka])\s*([shdc♠♥♦♣]|spades?|hearts?|diamonds?|clubs?)\s*$/i);
    if (!m) return null;
    const r = normalizeRank(m[1]);
    const su = normalizeSuit(m[2]);
    return (r && su) ? { rank: r, suit: su } : null;
  }

  // "Ace of Spades" 같은 단어형
  function fromWords(str) {
    const s = str.toString().toLowerCase();
    const rankWord = s.match(/\b(ace|king|queen|jack|ten|nine|eight|seven|six|five|four|three|two)\b/);
    const suitWord = s.match(/\b(spades?|hearts?|diamonds?|clubs?)\b/);
    if (rankWord && suitWord) {
      const r = normalizeRank(rankWord[1]);
      const su = normalizeSuit(suitWord[1]);
      if (r && su) return { rank: r, suit: su };
    }
    return null;
  }

  // 파일 URL 에서 추출 (예: ".../cards/As.svg", ".../ace_of_spades.png")
  function fromUrl(url) {
    if (!url) return null;
    const file = url.toString().split('/').pop() || '';
    const combined = fromCombined(file.replace(/\.(svg|png|gif|jpg|jpeg|webp)("|\))?$/i, ''));
    if (combined) return combined;
    return fromWords(file.replace(/[_\-]/g, ' '));
  }

  // 표시 텍스트에서 추출 (예: "A♠", "10 ♥")
  function fromText(text) {
    const t = text.replace(/\s+/g, '');
    const m = t.match(/(10|[2-9TJQKAtjqka])([♠♥♦♣shdcSHDC])/);
    if (!m) return null;
    const r = normalizeRank(m[1]);
    const su = normalizeSuit(m[2]);
    return (r && su) ? { rank: r, suit: su } : null;
  }

  /* =======================================================================
   * [핵심 함수 3] normalizeHand(card1, card2)
   * 두 카드 {rank,suit} 를 표준 핸드 문자열로 변환.
   *   페어      → "AA", "TT"
   *   수딧      → "AKs" (높은 랭크 먼저)
   *   오프수딧  → "AKo"
   * ===================================================================== */
  function normalizeHand(card1, card2) {
    if (!card1 || !card2) return null;
    // 높은 랭크가 앞에 오도록 정렬
    let hi = card1, lo = card2;
    if (RANK_ORDER[card1.rank] < RANK_ORDER[card2.rank]) {
      hi = card2; lo = card1;
    }
    if (hi.rank === lo.rank) {
      return hi.rank + lo.rank;                 // 페어
    }
    const suited = hi.suit === lo.suit ? 's' : 'o';
    return hi.rank + lo.rank + suited;
  }

  // 카드 예쁜 표기 ("As" → "A♠") - 팝업 표시용
  function prettyCard(card) {
    const suitSymbol = { s: '♠', h: '♥', d: '♦', c: '♣' };
    return card.rank + (suitSymbol[card.suit] || card.suit);
  }

  /* =======================================================================
   * [핵심 함수 4] detectMyHand()
   * 전체 감지 파이프라인. MutationObserver 가 이 함수를 호출합니다.
   * ===================================================================== */
  function detectMyHand() {
    // 확장이 새로고침되어 컨텍스트가 죽었으면, 관찰을 멈추고 조용히 종료.
    if (!extensionAlive()) {
      try { observer.disconnect(); } catch (e) { /* ignore */ }
      return;
    }

    // 전체 OFF 이면 오버레이 숨김
    if (!settings.enabled) {
      removeOverlay();
      return;
    }

    // ★ 화면에 항상 떠있는 오버레이(HUD)를 준비 ★
    ensureOverlay();

    // 내가 폴드해서(죽어서) 이 핸드에서 빠졌으면 카드를 지운다.
    if (isHeroFolded()) {
      lastRawKey = null;
      renderOverlay({ hasCards: false, folded: true, myTurn: false, action: null });
      return;
    }

    const myTurn = isMyTurn();
    const action = myTurn ? getActionInfo() : null; // 내 차례면 콜 금액/BB 계산
    const els = findHoleCardElements();

    // 카드가 2장 안 잡히면 = 아직 딜 전이거나 폴드해서 패가 없는 상태
    if (els.length !== 2) {
      lastRawKey = null; // 다음 새 패를 확실히 새 핸드로 인식하게 초기화
      renderOverlay({ hasCards: false, myTurn: myTurn, action: action });
      return;
    }

    const c1 = parseCardElement(els[0]);
    const c2 = parseCardElement(els[1]);
    if (!c1 || !c2) {
      log('카드 요소는 찾았지만 값 파싱 실패.', els);
      renderOverlay({ hasCards: false, myTurn: myTurn, action: action });
      return;
    }

    const rawKey = [prettyCard(c1), prettyCard(c2)].sort().join('|');
    const hand = normalizeHand(c1, c2);
    if (!hand) { renderOverlay({ hasCards: false, myTurn: myTurn, action: action }); return; }

    const allowed = settings.hands.includes(hand);
    const isNewHand = rawKey !== lastRawKey;

    // 오버레이는 매번 최신 상태로 갱신 (내 차례/프리미엄 강조 포함)
    renderOverlay({
      hasCards: true,
      pretty1: prettyCard(c1),
      pretty2: prettyCard(c2),
      hand: hand,
      allowed: allowed,
      myTurn: myTurn,
      action: action
    });

    // 팝업 표시용 저장
    safe(() => chrome.storage.local.set({
      currentHand: {
        pretty: prettyCard(c1) + ' ' + prettyCard(c2),
        hand: hand, allowed: allowed, myTurn: myTurn, ts: Date.now()
      }
    }));

    if (!isNewHand) return; // 같은 패면 여기서 끝
    lastRawKey = rawKey;

    log('새 핸드:', prettyCard(c1), prettyCard(c2), '→', hand, allowed ? '(프리미엄!)' : '');

    // 프리미엄 핸드면 알림음 (오버레이가 시각 표시는 이미 함)
    if (allowed && settings.soundEnabled) {
      playBeep();
    }
  }

  /* =======================================================================
   * isMyTurn() — 지금 내 액션 차례인지 판단.
   *   PokerNow 는 내 차례일 때 hero 자리에 'decision-current' 클래스를 붙이고,
   *   하단에 Fold/Call 등 액션 버튼(.game-decisions-ctn .action-buttons)이 나타남.
   * ===================================================================== */
  function isMyTurn() {
    try {
      for (const sel of HERO_CONTAINER_SELECTORS) {
        const hero = document.querySelector(sel);
        if (hero && (hero.className || '').toString().includes('decision-current')) return true;
      }
      const actions = document.querySelector('.game-decisions-ctn .action-buttons, .action-signal');
      if (actions) return true;
    } catch (e) { /* ignore */ }
    return false;
  }

  /* =======================================================================
   * isHeroFolded() — 내가 이번 핸드에서 폴드(죽음)했는지.
   *   PokerNow 는 폴드한 자리에 'fold' 계열 클래스를 붙이거나 카드를 흐리게 함.
   *   (감지가 이상하면 아래 정규식/클래스를 조정하세요.)
   * ===================================================================== */
  function isHeroFolded() {
    try {
      for (const sel of HERO_CONTAINER_SELECTORS) {
        const hero = document.querySelector(sel);
        if (!hero) continue;
        const cls = ' ' + (hero.className || '').toString().toLowerCase() + ' ';
        // 'fold','folded','not-in-hand','inactive','sitting-out' 등
        if (/\bfold(ed)?\b|not-in-hand|inactive|sitting-out|is-folded/.test(cls)) return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  /* =======================================================================
   * [빅블라인드 / 콜 금액 읽기]  ★ 감지 안 되면 아래 셀렉터 확인 ★
   *   블라인드 표시: .blind-value 안의 숫자들 (예: 10 / 20 → BB=20)
   *   콜 버튼:       .action-button.call  (예: "Call 10" → 10)
   * ===================================================================== */
  const BLIND_SELECTORS = ['.blind-value', '.blind-value-ctn', '.game-infos .blind-value'];

  // 문자열에서 숫자만 추출 (쉼표 제거). "1,250" → 1250, "Call 10" → 10
  function firstNumber(str) {
    if (!str) return null;
    const m = str.toString().replace(/,/g, '').match(/\d+(?:\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  }

  // 빅블라인드 값 (블라인드 표기 중 가장 큰 숫자)
  function getBigBlind() {
    for (const sel of BLIND_SELECTORS) {
      const ctn = document.querySelector(sel);
      if (!ctn) continue;
      const nums = Array.from(ctn.querySelectorAll('.normal-value, .chips-value'))
        .map((el) => firstNumber(el.textContent))
        .filter((n) => n != null && n > 0);
      if (nums.length) return Math.max.apply(null, nums);
      const n = firstNumber(ctn.textContent);
      if (n) return n;
    }
    return null;
  }

  // 내 차례 액션 정보: { canCheck, callAmount, bb, callBB }
  function getActionInfo() {
    const bb = getBigBlind();
    const callBtn = document.querySelector('.action-buttons .call, .action-button.call');
    const checkBtn = document.querySelector('.action-buttons .check, .action-button.check');
    const canCheck = !!(checkBtn && !checkBtn.disabled);

    let callAmount = null;
    if (callBtn && !callBtn.disabled) {
      callAmount = firstNumber(callBtn.textContent); // "Call 10" → 10
    }
    const callBB = (callAmount != null && bb) ? callAmount / bb : null;
    return { canCheck, callAmount, bb, callBB };
  }

  // 몇 BB 인지 보기좋게: 0.5, 2, 3.5 ...
  function fmtBB(x) {
    if (x == null) return '';
    const r = Math.round(x * 10) / 10;
    return (Number.isInteger(r) ? r.toString() : r.toFixed(1));
  }

  /* =======================================================================
   * [화면 오버레이 HUD]  +  [Picture-in-Picture 팝아웃]
   * -----------------------------------------------------------------------
   * 기본은 PokerNow 화면 위에 떠있는 패널.
   * 헤더의 ⧉ 버튼을 누르면 Document Picture-in-Picture 창으로 빼내서
   * "다른 창/앱 위에도 항상 떠있게" 만들 수 있습니다. (Chrome 116+)
   * ===================================================================== */
  const OVERLAY_ID = 'pokernow-hand-alert-overlay';
  let overlayEls = null;   // 현재 활성 패널의 요소들 (인페이지 or PiP)
  let pipWindow = null;    // 열려있는 PiP 창 (없으면 null)
  let lastState = { hasCards: false, myTurn: false }; // 마지막 렌더 상태 (PiP 전환 시 재사용)

  const PANEL_CSS = `
    #${OVERLAY_ID}{position:fixed;top:80px;right:16px;z-index:2147483647;
      width:190px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
      background:#1e1f26;color:#e8e8ee;border-radius:12px;overflow:hidden;
      box-shadow:0 8px 28px rgba(0,0,0,.5);border:1px solid #33353f;user-select:none;}
    #${OVERLAY_ID}.pip{position:static;top:auto;right:auto;width:auto;border-radius:0;
      box-shadow:none;border:none;height:100%;}
    #${OVERLAY_ID} .pnha-head{display:flex;align-items:center;gap:6px;padding:7px 10px;
      background:#282a36;cursor:move;font-size:12px;font-weight:700;color:#7ee787;}
    #${OVERLAY_ID}.pip .pnha-head{cursor:default;}
    #${OVERLAY_ID} .pnha-head .pnha-btn{cursor:pointer;color:#9aa0b4;font-size:14px;
      line-height:1;padding:0 3px;}
    #${OVERLAY_ID} .pnha-head .pnha-pop{margin-left:auto;}
    #${OVERLAY_ID} .pnha-body{padding:10px;text-align:center;}
    #${OVERLAY_ID} .pnha-cards{font-size:30px;font-weight:800;letter-spacing:3px;line-height:1.1;min-height:34px;}
    #${OVERLAY_ID} .pnha-cards.empty{font-size:14px;font-weight:600;color:#9aa0b4;letter-spacing:0;}
    #${OVERLAY_ID} .pnha-red{color:#ff5c72;}
    #${OVERLAY_ID} .pnha-code{font-size:14px;color:#9aa0b4;margin-top:2px;font-weight:700;}
    #${OVERLAY_ID} .pnha-tag{display:inline-block;margin-top:6px;font-size:11px;font-weight:700;
      padding:2px 10px;border-radius:10px;background:#3a3d4d;color:#cfd2e0;}
    #${OVERLAY_ID}.premium{border-color:#2ea043;box-shadow:0 0 0 2px #2ea043,0 8px 28px rgba(0,0,0,.5);}
    #${OVERLAY_ID}.premium .pnha-tag{background:#2ea043;color:#fff;}
    #${OVERLAY_ID} .pnha-turn{margin-top:8px;font-size:12px;font-weight:700;color:#9aa0b4;}
    #${OVERLAY_ID}.my-turn .pnha-turn{color:#1e1f26;background:#f0a531;border-radius:8px;padding:3px;}
    #${OVERLAY_ID} .pnha-call{margin-top:7px;font-size:13px;font-weight:800;color:#e8e8ee;display:none;}
    #${OVERLAY_ID}.my-turn .pnha-call{display:block;}
    #${OVERLAY_ID} .pnha-call .bb{color:#7ee787;}
    #${OVERLAY_ID} .pnha-call .chk{color:#58a6ff;}
    #${OVERLAY_ID} .pnha-fold{margin-top:8px;width:100%;padding:9px;border:none;border-radius:8px;
      background:#b3242f;color:#fff;font-weight:800;font-size:14px;cursor:pointer;}
    #${OVERLAY_ID} .pnha-fold:hover{background:#d0303c;}
    #${OVERLAY_ID}.collapsed .pnha-body{display:none;}
    #${OVERLAY_ID} .pnha-foldmsg{font-size:10px;color:#9aa0b4;margin-top:5px;height:12px;}
  `;

  // 지정한 document 에 패널 DOM 을 만들고 이벤트를 연결. els 객체 반환.
  function buildPanel(doc, inPip) {
    // 스타일 주입
    if (!doc.getElementById('pnha-style')) {
      const style = doc.createElement('style');
      style.id = 'pnha-style';
      style.textContent = PANEL_CSS;
      (doc.head || doc.documentElement).appendChild(style);
    }

    const box = doc.createElement('div');
    box.id = OVERLAY_ID;
    if (inPip) box.classList.add('pip');
    // 팝아웃 버튼은 인페이지에서만 (PiP 안에서는 창을 닫으면 복귀)
    const popBtn = inPip ? '' : '<span class="pnha-btn pnha-pop" title="다른 창 위에 띄우기">⧉</span>';
    const minBtn = inPip ? '' : '<span class="pnha-btn pnha-min" title="접기/펼치기">–</span>';
    box.innerHTML = `
      <div class="pnha-head"><span>♠ Hand Alert</span>${popBtn}${minBtn}</div>
      <div class="pnha-body">
        <div class="pnha-cards empty">패 대기중…</div>
        <div class="pnha-code"></div>
        <div><span class="pnha-tag">-</span></div>
        <div class="pnha-turn">대기 중</div>
        <div class="pnha-call"></div>
        <button class="pnha-fold" type="button">✋ Fold 하기</button>
        <div class="pnha-foldmsg"></div>
      </div>`;
    doc.body.appendChild(box);

    const els = {
      doc: doc, box: box,
      cards: box.querySelector('.pnha-cards'),
      code: box.querySelector('.pnha-code'),
      tag: box.querySelector('.pnha-tag'),
      turn: box.querySelector('.pnha-turn'),
      call: box.querySelector('.pnha-call'),
      fold: box.querySelector('.pnha-fold'),
      foldmsg: box.querySelector('.pnha-foldmsg'),
      min: box.querySelector('.pnha-min'),
      pop: box.querySelector('.pnha-pop'),
      head: box.querySelector('.pnha-head')
    };

    // Fold 버튼 (PiP 안에서 눌러도 content 스크립트 컨텍스트라 원본 페이지 폴드 실행됨)
    els.fold.addEventListener('click', () => {
      const ok = clickFoldButton();
      els.foldmsg.textContent = ok ? '✓ 폴드함' : '폴드 버튼 없음(내 차례?)';
      setTimeout(() => { els.foldmsg.textContent = ''; }, 1600);
    });

    if (els.min) {
      els.min.addEventListener('click', () => {
        box.classList.toggle('collapsed');
        els.min.textContent = box.classList.contains('collapsed') ? '+' : '–';
      });
    }
    if (els.pop) {
      els.pop.addEventListener('click', openPiP);
    }
    if (!inPip) makeDraggable(box, els.head);

    return els;
  }

  // 인페이지 오버레이 보장 (PiP 활성 중이면 그쪽이 담당하므로 건너뜀)
  function ensureOverlay() {
    if (pipWindow) return;
    if (!document.body) return;
    if (document.getElementById(OVERLAY_ID)) return;
    overlayEls = buildPanel(document, false);
    renderOverlay(lastState); // 만들자마자 최신 상태 반영
  }

  function removeOverlay() {
    const box = document.getElementById(OVERLAY_ID);
    if (box) box.remove();
    if (pipWindow) { try { pipWindow.close(); } catch (e) {} pipWindow = null; }
    overlayEls = null;
  }

  /* Document Picture-in-Picture 로 패널을 빼내기 (다른 창/앱 위에 항상 표시) */
  async function openPiP() {
    if (!('documentPictureInPicture' in window)) {
      alert('이 Chrome 버전은 Picture-in-Picture 팝아웃을 지원하지 않습니다.\nChrome 을 최신으로 업데이트하세요 (116 이상).');
      return;
    }
    try {
      pipWindow = await window.documentPictureInPicture.requestWindow({ width: 200, height: 250 });
      // 인페이지 패널 제거 → PiP 안에 새로 생성
      const old = document.getElementById(OVERLAY_ID);
      if (old) old.remove();
      pipWindow.document.body.style.margin = '0';
      pipWindow.document.body.style.background = '#1e1f26';
      overlayEls = buildPanel(pipWindow.document, true);
      renderOverlay(lastState);

      // PiP 창이 닫히면 인페이지 오버레이로 복귀
      pipWindow.addEventListener('pagehide', () => {
        pipWindow = null;
        overlayEls = null;
        ensureOverlay();
      });
    } catch (e) {
      log('PiP 열기 실패:', e);
      pipWindow = null;
      ensureOverlay();
    }
  }

  function renderOverlay(state) {
    lastState = state; // 나중에 PiP 전환 시 재사용
    ensureOverlay();
    if (!overlayEls) return;
    const box = overlayEls.box;

    if (!state.hasCards) {
      // 폴드했으면(죽었으면) 카드를 지우고 "폴드" 표시, 아니면 "대기중"
      overlayEls.cards.className = 'pnha-cards empty';
      overlayEls.cards.textContent = state.folded ? '🃏 폴드함' : '패 대기중…';
      overlayEls.code.textContent = state.folded ? '다음 패 대기' : '';
      overlayEls.tag.textContent = '-';
      box.classList.remove('premium');
    } else {
      overlayEls.cards.className = 'pnha-cards';
      overlayEls.cards.innerHTML =
        colorCard(state.pretty1) + ' ' + colorCard(state.pretty2);
      overlayEls.code.textContent = state.hand;
      overlayEls.tag.textContent = state.allowed ? '★ 프리미엄' : '일반';
      box.classList.toggle('premium', !!state.allowed);
    }

    box.classList.toggle('my-turn', !!state.myTurn);
    overlayEls.turn.textContent = state.myTurn ? '🔔 내 차례!' : '대기 중';

    // 콜 정보 (내 차례일 때만 CSS 로 보임)
    const a = state.action;
    if (state.myTurn && a) {
      if (a.canCheck && !a.callAmount) {
        overlayEls.call.innerHTML = '<span class="chk">✓ 체크 가능 (콜 0)</span>';
      } else if (a.callAmount != null) {
        const bbPart = (a.callBB != null)
          ? ' · <span class="bb">' + fmtBB(a.callBB) + ' BB</span>'
          : '';
        overlayEls.call.innerHTML = '콜 ' + a.callAmount + bbPart;
      } else {
        overlayEls.call.textContent = '';
      }
    } else {
      overlayEls.call.textContent = '';
    }
  }

  // "A♥" → 빨간색 span 처리
  function colorCard(pretty) {
    const isRed = pretty.includes('♥') || pretty.includes('♦');
    return '<span class="' + (isRed ? 'pnha-red' : '') + '">' + pretty + '</span>';
  }

  // 요소를 헤더로 드래그해 옮길 수 있게
  function makeDraggable(box, handle) {
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
    handle.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('pnha-btn')) return;
      dragging = true;
      const rect = box.getBoundingClientRect();
      ox = rect.left; oy = rect.top; sx = e.clientX; sy = e.clientY;
      box.style.right = 'auto';
      box.style.left = ox + 'px';
      box.style.top = oy + 'px';
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      box.style.left = (ox + e.clientX - sx) + 'px';
      box.style.top = (oy + e.clientY - sy) + 'px';
    });
    document.addEventListener('mouseup', () => { dragging = false; });
  }

  // Web Audio 로 짧은 알림음 2번 생성 (별도 mp3 파일 불필요)
  function playBeep() {
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      const now = audioCtx.currentTime;
      [0, 0.18].forEach((offset, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = i === 0 ? 880 : 1175; // 두 음 (A5, D6)
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.25, now + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.15);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.16);
      });
    } catch (e) {
      log('알림음 재생 실패(브라우저 자동재생 정책일 수 있음):', e);
    }
  }

  /* =======================================================================
   * 감지 트리거 = MutationObserver(throttle) + 주기적 heartbeat
   * -----------------------------------------------------------------------
   * ⚠️ PokerNow 는 턴 타이머/칩 애니메이션 때문에 DOM 이 끊임없이 바뀝니다.
   *    그래서 "마지막 변경 후 N ms" 식의 debounce 를 쓰면 검사가 영영
   *    실행되지 않을 수 있습니다(변경이 계속 들어와서). 이를 피하려고:
   *      1) throttle: 변경이 와도 최대 THROTTLE_MS 에 한 번은 반드시 검사
   *      2) heartbeat: 변경이 없어도 HEARTBEAT_MS 마다 주기적으로 검사
   *    → 새 패가 오면 (다시 팝업을 열지 않아도) 자동으로 감지/알림됩니다.
   * ===================================================================== */
  const THROTTLE_MS = 600;   // 변경 폭주 시에도 이 간격으로는 반드시 실행
  const HEARTBEAT_MS = 1200; // 변경이 없어도 주기적으로 검사

  let lastRun = 0;
  let pendingTimer = null;

  function scheduleDetect() {
    const now = Date.now();
    const since = now - lastRun;
    if (since >= THROTTLE_MS) {
      lastRun = now;
      detectMyHand();
    } else if (!pendingTimer) {
      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        lastRun = Date.now();
        detectMyHand();
      }, THROTTLE_MS - since);
    }
  }

  const observer = new MutationObserver(scheduleDetect);

  function startObserving() {
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'style'] // 카드 뒤집기/딜 관련 변화만 봄
    });
    // 주기적 heartbeat (관찰이 놓쳐도 새 패를 반드시 잡음)
    setInterval(() => {
      if (!extensionAlive()) return;
      detectMyHand();
    }, HEARTBEAT_MS);

    log('감지 시작 (throttle ' + THROTTLE_MS + 'ms + heartbeat ' + HEARTBEAT_MS + 'ms).');
    detectMyHand(); // 최초 1회 즉시
  }

  /* =======================================================================
   * [수동 Fold] clickFoldButton()
   * -----------------------------------------------------------------------
   * ⚠️ 이 함수는 "자동"이 아닙니다. 사용자가 팝업의 Fold 버튼을 눌렀을 때만
   *    호출됩니다. 익스텐션이 스스로 판단해서 폴드하는 일은 절대 없습니다.
   *
   * PokerNow 페이지에서 Fold 버튼을 찾아 클릭합니다.
   *   1) FOLD_BUTTON_SELECTORS 후보를 순서대로 시도
   *   2) 못 찾으면 텍스트가 "Fold" 인 버튼을 탐색
   * 성공하면 true, 실패하면 false 를 반환합니다.
   * ===================================================================== */
  function clickFoldButton() {
    // 1) 셀렉터 후보로 찾기
    for (const sel of FOLD_BUTTON_SELECTORS) {
      let btn = null;
      try { btn = document.querySelector(sel); } catch (e) { /* 잘못된 셀렉터 무시 */ }
      if (btn && isClickable(btn)) {
        btn.click();
        log('수동 Fold 실행 (셀렉터):', sel);
        return true;
      }
    }

    // 2) 텍스트가 정확히 "Fold" 인 버튼/요소 찾기 (내 차례일 때)
    const candidates = Array.from(
      document.querySelectorAll('button, [role="button"], .action-button, .game-decisions-ctn *')
    );
    for (const el of candidates) {
      const txt = (el.textContent || '').trim().toLowerCase();
      if ((txt === 'fold' || txt === '폴드') && isClickable(el)) {
        el.click();
        log('수동 Fold 실행 (텍스트 매칭: Fold)');
        return true;
      }
    }

    // 3) 아직 내 차례 전이면 사전 액션 "Check or Fold" / "Fold" 프리버튼을 누름
    //    (내 차례가 오면 자동으로 폴드/체크되는 미리 선택 버튼)
    for (const el of candidates) {
      const txt = (el.textContent || '').trim().toLowerCase();
      if (txt.includes('fold') && isClickable(el)) {
        el.click();
        log('수동 Fold 실행 (사전 액션: "' + txt + '")');
        return true;
      }
    }

    log('Fold 버튼을 찾지 못했습니다. (내 액션 옵션이 없거나 셀렉터 확인 필요)');
    return false;
  }

  // 화면에 실제로 보이고 비활성화되지 않은 요소인지 확인
  function isClickable(el) {
    if (!el) return false;
    if (el.disabled) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return true;
  }

  /* =======================================================================
   * [폴드 단축키] PokerNow 페이지에서 'f' 키를 누르면 폴드.
   * -----------------------------------------------------------------------
   * ⚠️ 여전히 "자동"이 아닙니다. 사용자가 키를 눌렀을 때만 동작합니다.
   *    채팅 입력창 등에 타이핑 중일 때는 발동하지 않도록 예외 처리합니다.
   * ===================================================================== */
  function isTypingTarget(el) {
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  if (FOLD_HOTKEY) {
    document.addEventListener('keydown', (e) => {
      // 입력 중이거나 조합키(Ctrl/Alt/Meta)와 함께면 무시
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (isTypingTarget(e.target)) return;
      if ((e.key || '').toLowerCase() !== FOLD_HOTKEY.toLowerCase()) return;

      const ok = clickFoldButton();
      if (ok) {
        log("단축키 '" + FOLD_HOTKEY + "' 로 폴드했습니다.");
        e.preventDefault();
      }
    }, true);
  }

  /* =======================================================================
   * 팝업 메시지 처리
   *   - PING_DETECT : 지금 카드를 다시 감지
   *   - MANUAL_FOLD : (사용자가 팝업 버튼을 누름) Fold 버튼 클릭
   * ===================================================================== */
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'PING_DETECT') {
      detectMyHand();
      sendResponse({ ok: true });
    } else if (msg && msg.type === 'MANUAL_FOLD') {
      const ok = clickFoldButton();
      sendResponse({ ok });
    }
    return false;
  });

  /* =======================================================================
   * 시작
   * ===================================================================== */
  loadSettings();
  if (document.body) {
    startObserving();
  } else {
    window.addEventListener('DOMContentLoaded', startObserving);
  }
})();
