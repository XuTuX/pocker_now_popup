/* =========================================================================
 * PokerNow Hand Alert - background.js  (Service Worker, Manifest V3)
 * -------------------------------------------------------------------------
 * 역할:
 *   1) content.js 가 "새 핸드" 메시지를 보내면 데스크톱 알림을 띄운다.
 *      → 다른 탭/창을 보고 있어도 OS 알림이라 뜬다.
 *   2) 알림에 [✋ Fold] 버튼을 달고, 누르면 PokerNow 탭의 Fold 를 대신 눌러준다.
 *      → 익스텐션이 스스로 폴드하는 게 아니라, "사용자가 알림 버튼을 누를 때"만.
 *
 * 참고: MV3 service worker 에서는 오디오를 직접 재생할 수 없어, 알림음은
 *       content.js 의 Web Audio 로 처리한다. (OS 알림 자체 소리는 별개로 남)
 * ========================================================================= */

// 열려있는 PokerNow 탭을 찾는 URL 패턴 (.club / .com 모두)
const POKERNOW_URLS = [
  '*://*.pokernow.club/*',
  '*://pokernow.club/*',
  '*://*.pokernow.com/*',
  '*://pokernow.com/*'
];

// 알림 ID 를 고정값으로 쓰면, 새 핸드 알림이 이전 알림을 자동으로 대체(중복 방지)한다.
const NOTIF_ID = 'pokernow-hand';

// 설치 시 기본 설정 저장 (없을 때만)
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get('settings', (data) => {
    if (!data || !data.settings) {
      chrome.storage.local.set({
        settings: {
          enabled: true,
          soundEnabled: true,
          notificationEnabled: true,
          hands: ['AA', 'KK', 'QQ', 'JJ', 'AKs', 'AKo']
        }
      });
    }
  });
});

// content.js → background 메시지 수신
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'NEW_HAND') {
    const premium = !!message.allowed;
    const title = premium
      ? '🔥 프리미엄 핸드! ' + message.hand
      : '🃏 새 핸드: ' + message.hand;
    const body = '받은 패: ' + (message.pretty || '') +
      '\n폴드하시겠어요? (아래 Fold 버튼)';

    // 같은 NOTIF_ID 로 만들면 이전 핸드 알림을 덮어써서 쌓이지 않는다.
    // 먼저 clear 후 create (일부 OS 에서 같은 ID 재생성이 안 뜨는 문제 방지).
    chrome.notifications.clear(NOTIF_ID, () => {
      chrome.notifications.create(NOTIF_ID, {
        type: 'basic',
        iconUrl: 'icon128.png',
        title: title,
        message: body,
        priority: 2,
        requireInteraction: true,               // 사용자가 반응할 때까지 유지
        buttons: [
          { title: '✋ Fold (폴드)' },
          { title: '유지 (닫기)' }
        ]
      }, (createdId) => {
        if (chrome.runtime.lastError) {
          console.warn('[PokerAlert:bg] 알림 생성 실패:', chrome.runtime.lastError.message);
        } else {
          console.log('[PokerAlert:bg] 알림 표시:', createdId, title);
        }
      });
    });

    sendResponse({ ok: true });
    return false;
  }

  // (구버전 호환) 프리미엄 전용 메시지
  if (message && message.type === 'GOOD_HAND') {
    chrome.notifications.create(NOTIF_ID, {
      type: 'basic',
      iconUrl: 'icon128.png',
      title: 'PokerNow Hand Alert',
      message: 'Premium hand: ' + message.hand,
      priority: 2
    });
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

// 알림 버튼 클릭 처리
//   버튼 0 = Fold → 열려있는 PokerNow 탭을 찾아 폴드 명령 전달
//   버튼 1 = 유지 → 그냥 알림만 닫음
chrome.notifications.onButtonClicked.addListener((notifId, buttonIndex) => {
  if (notifId === NOTIF_ID && buttonIndex === 0) {
    // 상태를 저장하지 않고, 클릭 시점에 탭을 새로 조회 → service worker 가
    // 잠들었다 깨어나도 안전하게 동작한다.
    chrome.tabs.query({ url: POKERNOW_URLS }, (tabs) => {
      if (tabs && tabs.length) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'MANUAL_FOLD' }, () => {
          void chrome.runtime.lastError; // content script 없으면 무시
        });
      }
    });
  }
  chrome.notifications.clear(notifId);
});

// 알림 본문 클릭 시: PokerNow 탭으로 이동시켜 준다 (편의).
chrome.notifications.onClicked.addListener((notifId) => {
  if (notifId !== NOTIF_ID) return;
  chrome.tabs.query({ url: POKERNOW_URLS }, (tabs) => {
    if (tabs && tabs.length) {
      chrome.tabs.update(tabs[0].id, { active: true });
      if (tabs[0].windowId != null) {
        chrome.windows.update(tabs[0].windowId, { focused: true });
      }
    }
  });
  chrome.notifications.clear(notifId);
});
