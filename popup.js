/* PokerNow Hand Alert - popup.js
 * 팝업 UI 의 동작:
 *   - 저장된 설정 불러와서 화면에 반영
 *   - 자주 쓰는 프리미엄 핸드 목록을 체크박스로 표시
 *   - 현재 감지된 핸드 표시
 *   - Save 버튼으로 chrome.storage.local 에 저장
 */

// 팝업에 표시할 "빠른 선택용" 핸드 (자주 쓰는 프리미엄 위주).
// 더 세밀한 169개 전체 설정은 옵션 페이지(13×13 matrix)에서.
const QUICK_HANDS = [
  'AA', 'KK', 'QQ', 'JJ', 'TT',
  'AKs', 'AKo', 'AQs', 'AQo', 'AJs',
  'KQs', 'KQo', 'JTs', 'ATs'
];

const DEFAULT_SETTINGS = {
  enabled: true,
  soundEnabled: true,
  hands: ['AA', 'KK', 'QQ', 'JJ', 'AKs', 'AKo']
};

const el = (id) => document.getElementById(id);

let settings = { ...DEFAULT_SETTINGS };

/* 설정 불러오기 */
function load() {
  chrome.storage.local.get(['settings', 'currentHand'], (data) => {
    settings = Object.assign({ ...DEFAULT_SETTINGS }, data.settings || {});
    render();
    renderCurrentHand(data.currentHand);
  });
}

/* 화면 그리기 */
function render() {
  el('enabled').checked = settings.enabled;
  el('soundEnabled').checked = settings.soundEnabled;
  el('statusText').textContent = settings.enabled ? 'ON' : 'OFF';
  el('statusText').style.color = settings.enabled ? '#7ee787' : '#f85149';

  // 팝업 목록에는 QUICK_HANDS + 이미 선택된(설정에 있는) 핸드를 합쳐서 보여줌
  const shown = Array.from(new Set([...QUICK_HANDS, ...settings.hands]));
  const list = el('handList');
  list.innerHTML = '';
  shown.forEach((hand) => {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = hand;
    cb.checked = settings.hands.includes(hand);
    const span = document.createElement('span');
    span.textContent = hand;
    label.appendChild(cb);
    label.appendChild(span);
    list.appendChild(label);
  });
}

/* 현재 감지된 핸드 표시 (컴팩트 바 + 내 차례 강조) */
function renderCurrentHand(current) {
  if (!current) {
    el('currentPretty').textContent = '-';
    el('currentHand').textContent = '-';
    el('turnBadge').textContent = '대기 중';
    el('handBar').classList.remove('my-turn');
    return;
  }
  el('currentPretty').textContent = current.pretty || '-';
  el('currentHand').textContent = current.hand || '-';
  el('currentHand').classList.toggle('allowed', !!current.allowed);

  const myTurn = !!current.myTurn;
  el('handBar').classList.toggle('my-turn', myTurn);
  el('turnBadge').textContent = myTurn ? '🔔 내 차례' : '대기 중';
}

// 팝업이 열려있는 동안 실시간 갱신 (content.js 가 storage 를 업데이트하면 반영)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.currentHand) {
    renderCurrentHand(changes.currentHand.newValue);
  }
});

/* 저장 */
function save() {
  const checked = Array.from(document.querySelectorAll('#handList input:checked'))
    .map((cb) => cb.value);

  settings = {
    enabled: el('enabled').checked,
    soundEnabled: el('soundEnabled').checked,
    hands: checked
  };

  chrome.storage.local.set({ settings }, () => {
    const msg = el('savedMsg');
    msg.textContent = '✓ Saved';
    setTimeout(() => (msg.textContent = ''), 1500);
  });
}

/* 이벤트 연결 */
el('enabled').addEventListener('change', () => {
  el('statusText').textContent = el('enabled').checked ? 'ON' : 'OFF';
  el('statusText').style.color = el('enabled').checked ? '#7ee787' : '#f85149';
});
el('saveBtn').addEventListener('click', save);
el('openOptions').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// 열려있는 PokerNow 탭을 찾는다 (활성 탭이 아니어도 됨).
// host_permissions(pokernow.club) 덕분에 URL 패턴으로 탭을 조회할 수 있다.
function findPokerNowTab(callback) {
  chrome.tabs.query({
    url: [
      '*://*.pokernow.club/*',
      '*://pokernow.club/*',
      '*://*.pokernow.com/*',
      '*://pokernow.com/*'
    ]
  }, (tabs) => {
    callback(tabs && tabs.length ? tabs[0] : null);
  });
}

// 팝업이 열릴 때, PokerNow 탭에 "지금 다시 감지" 요청
function requestFreshDetect() {
  findPokerNowTab((tab) => {
    if (!tab) return;
    chrome.tabs.sendMessage(tab.id, { type: 'PING_DETECT' }, () => {
      void chrome.runtime.lastError; // content script 없으면 무시
    });
  });
}

/* 수동 Fold: 사용자가 버튼을 눌렀을 때만 PokerNow 탭의 Fold 버튼을 클릭시킨다.
 * (익스텐션이 스스로 판단해서 폴드하지 않는다 — 항상 사용자가 클릭.) */
function setFoldMsg(text, cls) {
  const m = el('foldMsg');
  m.textContent = text;
  m.className = 'fold-msg' + (cls ? ' ' + cls : '');
}

el('foldBtn').addEventListener('click', () => {
  const btn = el('foldBtn');
  btn.disabled = true;
  setFoldMsg('폴드 시도 중...', '');

  findPokerNowTab((tab) => {
    if (!tab) {
      setFoldMsg('열려있는 PokerNow 탭이 없습니다.', 'err');
      btn.disabled = false;
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: 'MANUAL_FOLD' }, (resp) => {
      btn.disabled = false;
      if (chrome.runtime.lastError) {
        setFoldMsg('PokerNow 페이지를 새로고침 해주세요.', 'err');
        return;
      }
      if (resp && resp.ok) {
        setFoldMsg('✓ 폴드했습니다.', 'ok');
        setTimeout(() => setFoldMsg('이 버튼을 누를 때만 폴드합니다 (자동 아님)', ''), 1800);
      } else {
        setFoldMsg('Fold 버튼을 못 찾음 (내 차례가 아니거나 셀렉터 수정 필요).', 'err');
      }
    });
  });
});

load();
requestFreshDetect();
