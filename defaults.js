/* =========================================================================
 * PokerNow Hand Alert - defaults.js
 * -------------------------------------------------------------------------
 * 기본 설정과 랭크 목록을 한 곳에서만 정의한다.
 * content.js / popup.js / options.js 가 모두 여기(PNHA)를 본다.
 * ※ 기본값을 바꾸려면 이 파일만 고치면 된다.
 * ========================================================================= */

var PNHA = (() => {
  'use strict';

  // 낮은 랭크 → 높은 랭크. (매트릭스는 이걸 뒤집어 A 부터 쓴다)
  const RANKS_LOW_FIRST = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

  const PREMIUM_DEFAULT = ['AA', 'KK', 'QQ', 'JJ', 'AKs', 'AKo'];

  // 새 설정을 추가할 땐 여기에만 넣으면 세 화면이 같이 따라온다.
  const DEFAULT_SETTINGS = {
    enabled: true,
    soundEnabled: true,
    hands: PREMIUM_DEFAULT,
    // ↓ 자동 폴드 (지정한 핸드가 아니면 내 차례에 알아서 폴드) — 기본은 꺼짐
    autoFold: false,        // 켜야만 동작한다
    autoMode: 'prefold',    // 'prefold' = 카드 받자마자 미리 폴드 예약 (기본)
                            // 'turn'    = 내 차례가 오면 N초 뒤에 폴드
    autoFoldDelay: 1,       // 'turn' 모드에서 기다리는 초 (예약 실패 시 폴백에도 사용)
    autoCheckFree: true,    // 더 낼 돈이 0 BB 면 폴드 대신 체크 (공짜니까)
    autoPreflopOnly: true,  // 프리플롭에서만 자동 (플롭 이후는 내가 직접)
    // ↓ GTO 자동 콜/폴드 (autoFold 위에서 동작. 프리미엄 목록 대신 GTO 차트 사용)
    gtoMode: false,         // 켜면 GTO 판단으로 콜/체크/폴드(선택: 레이즈) 자동 실행
    gtoStreet: 'all',       // 'preflop' = 프리플롭만 / 'all' = 포스트플롭(에퀴티 근사)까지
    gtoAggro: 'manual',     // 'manual' = 레이즈는 직접(권장만 표시) / 'auto' = 레이즈도 자동
    gtoSimIter: 10000       // 몬테카를로 에퀴티 반복 횟수 (기본 1만, 높을수록 정확, 느려짐)
  };

  // 항상 새 객체로 준다 (기본값 원본이 오염되지 않도록 hands 배열도 복사)
  const defaults = () => Object.assign({}, DEFAULT_SETTINGS, { hands: [...PREMIUM_DEFAULT] });

  // 저장된 설정 + 기본값 병합. 저장본이 비었거나 깨져 있어도 항상 온전한 설정이 나온다.
  const merge = (saved) => {
    const s = Object.assign(defaults(), saved || {});
    if (!Array.isArray(s.hands)) s.hands = [...PREMIUM_DEFAULT];
    return s;
  };

  return { RANKS_LOW_FIRST, PREMIUM_DEFAULT, DEFAULT_SETTINGS, defaults, merge };
})();
