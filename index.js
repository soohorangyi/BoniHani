// ============================================================
//  Gotcha! — SillyTavern Extension
//  Random RP generator powered by the connected LLM
// ============================================================

import {
  getRequestHeaders,
  saveSettingsDebounced,
} from '../../../../script.js';

import {
  extension_settings,
  getContext,
  renderExtensionTemplateAsync,
} from '../../../extensions.js';

// ── Constants ────────────────────────────────────────────────
const EXT_NAME = 'gotcha';
const PANEL_ID = 'gotcha-panel';

// ── Default settings ─────────────────────────────────────────
const DEFAULT_SETTINGS = {
  savedItems:  [],   // { id, category, categoryLabel, text, createdAt }
  apiProfile:  '',   // selected API connection name
  nameRegion:  '',   // preferred region for character names
  moodTone:    5,    // 1=밝음 ~ 10=어두움
  moodReal:    5,    // 1=현실적 ~ 10=판타지
};

// ── Category definitions ──────────────────────────────────────
const CATEGORIES = [
  {
    id: 'genre', label: '🎭 장르',
    prompt: (o) => `You are a creative writing assistant. Generate ONE unique and specific roleplay genre concept.
Format: a 2-4 sentence description that captures the mood, setting tone, and narrative style.
Be creative — mix genres, subvert expectations, suggest unusual combinations.
${moodHint(o)}
Respond in Korean. Output ONLY the genre description, nothing else.`,
  },
  {
    id: 'world', label: '🌍 세계관',
    prompt: (o) => `You are a creative worldbuilding assistant. Generate ONE original and vivid roleplay world concept.
Include: the world's defining characteristic, its atmosphere, and one unique element that sets it apart.
Keep it to 3-5 sentences. Make it evocative and immediately usable for RP.
${moodHint(o)}
Respond in Korean. Output ONLY the world description, nothing else.`,
  },
  {
    id: 'setting', label: '🏰 배경/설정',
    prompt: (o) => `You are a creative writing assistant. Generate ONE specific scene/setting for a roleplay.
Include: the physical location, time of day or season, mood/atmosphere, and one sensory detail.
Keep it to 2-4 sentences. Make it atmospheric and immediately immersive.
${moodHint(o)}
Respond in Korean. Output ONLY the setting description, nothing else.`,
  },
  {
    id: 'charname', label: '✍️ 캐릭터 이름',
    prompt: (o) => `You are a creative naming assistant. Generate ONE character name suitable for roleplay.
${o.nameRegion ? `The name should be from or inspired by: ${o.nameRegion} naming conventions.` : ''}
Provide: the name, its origin or meaning (brief), and a one-sentence personality hint the name suggests.
Make it memorable and fitting for a narrative character.
Respond in Korean. Output ONLY the name entry, nothing else.`,
  },
  {
    id: 'charappear', label: '👤 캐릭터 외모',
    prompt: (o) => `You are a creative character designer. Generate ONE vivid character appearance description for roleplay.
Include: notable facial features, build/height impression, hair, eyes, and one distinctive physical trait.
Keep it to 3-5 sentences. Make it visual and memorable.
${moodHint(o)}
Respond in Korean. Output ONLY the appearance description, nothing else.`,
  },
  {
    id: 'charback', label: '📖 캐릭터 배경',
    prompt: (o) => `You are a creative storytelling assistant. Generate ONE compelling character backstory hook for roleplay.
Include: their origin, a formative event that shaped them, and a lingering unresolved tension or secret.
Keep it to 3-5 sentences. Make it emotionally resonant and plot-ready.
${moodHint(o)}
Respond in Korean. Output ONLY the backstory description, nothing else.`,
  },
  {
    id: 'plot', label: '🎲 플롯 훅',
    prompt: (o) => `You are a creative plot designer. Generate ONE compelling roleplay plot hook or scenario opener.
Include: the inciting situation, a sense of urgency or mystery, and an immediate choice or conflict for the player.
Keep it to 3-5 sentences. Make it immediately engaging.
${moodHint(o)}
Respond in Korean. Output ONLY the plot hook, nothing else.`,
  },
  {
    id: 'relationship', label: '💬 관계 설정',
    prompt: (o) => `You are a creative narrative designer. Generate ONE interesting relationship dynamic between two characters for roleplay.
Include: the nature of their connection, the underlying tension or warmth, and one unspoken thing between them.
Keep it to 3-5 sentences. Make it emotionally complex and ripe for RP.
${moodHint(o)}
Respond in Korean. Output ONLY the relationship description, nothing else.`,
  },
  { id: 'custom', label: '✨ 직접 입력', prompt: null },
];

// ── Name region list ──────────────────────────────────────────
const NAME_REGIONS = [
  { value: '',                                               label: '🎲 랜덤 (제한 없음)' },
  { value: '한국/일본/중국 동아시아',                        label: '🏯 동아시아' },
  { value: '서유럽 (영국, 프랑스, 독일, 이탈리아)',          label: '⚔️ 서유럽' },
  { value: '북유럽 바이킹 (노르웨이, 스웨덴, 아이슬란드)',   label: '🪓 북유럽/바이킹' },
  { value: '동유럽 슬라브 (러시아, 폴란드, 체코)',           label: '🌲 슬라브/동유럽' },
  { value: '중동 아랍 (아랍어, 페르시아, 터키)',             label: '🌙 중동/아랍' },
  { value: '남미 라틴 (스페인어, 포르투갈어)',               label: '🌺 라틴/남미' },
  { value: '아프리카 전통 이름',                             label: '🌍 아프리카' },
  { value: '고대 그리스/로마',                               label: '🏛️ 고대 그리스/로마' },
  { value: '완전히 창작된 판타지 언어',                      label: '✨ 창작 판타지어' },
];

// ── Mood hint builder ─────────────────────────────────────────
function moodHint(o) {
  const t = o.moodTone ?? 5;
  const r = o.moodReal ?? 5;
  const tone = t <= 3 ? 'bright, hopeful, and lighthearted'
             : t >= 8 ? 'dark, grim, melancholic, or morally complex'
             : 'balanced between light and dark';
  const real = r <= 3 ? 'grounded and realistic, minimal fantasy'
             : r >= 8 ? 'high fantasy, magical, surreal, or otherworldly'
             : 'blend of realistic and fantastical';
  return `Tone: ${tone}. Style: ${real}.`;
}

// ── State ─────────────────────────────────────────────────────
let selectedCategories = new Set([CATEGORIES[0].id]);
let isGenerating  = false;
let resultHistory = [];   // [{ category, categoryLabel, text }]
let historyIndex  = -1;
let activeModalTab = 'all';

// ── Init ──────────────────────────────────────────────────────
jQuery(async () => {
  if (!extension_settings[EXT_NAME]) extension_settings[EXT_NAME] = { ...DEFAULT_SETTINGS };
  const s = extension_settings[EXT_NAME];
  if (!s.savedItems)       s.savedItems   = [];
  if (s.moodTone  == null) s.moodTone     = 5;
  if (s.moodReal  == null) s.moodReal     = 5;
  if (s.nameRegion == null) s.nameRegion  = '';

  $('#extensions_settings').append(buildPanelHtml());
  bindEvents();
  populateApiProfiles();

  // restore saved name region
  const savedRegion = extension_settings[EXT_NAME].nameRegion;
  if (savedRegion) $('#gotcha-name-region').val(savedRegion);

  registerWandButton();
  updateWandBadge();

  // Init slider gradient fill
  updateSliderFill('#gotcha-mood-tone', s.moodTone ?? 5);
  updateSliderFill('#gotcha-mood-real', s.moodReal ?? 5);
  console.log('[Gotcha!] Extension loaded.');
});

// ── Panel HTML ────────────────────────────────────────────────
function buildPanelHtml() {
  const catButtons = CATEGORIES.map(cat => `
    <button class="gotcha-cat-btn${selectedCategories.has(cat.id) ? ' active' : ''}"
            data-cat="${cat.id}" title="${cat.label}">${cat.label}</button>
  `).join('');

  const regionOptions = NAME_REGIONS.map(r =>
    `<option value="${escapeHtml(r.value)}">${r.label}</option>`
  ).join('');

  const s = extension_settings[EXT_NAME];

  return `
<div id="${PANEL_ID}" class="inline-drawer">
  <div class="inline-drawer-toggle inline-drawer-header">
    <b>Gotcha!</b>
    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down up"></div>
  </div>
  <div class="inline-drawer-content">

    <!-- API Profile -->
    <div class="gotcha-api-row">
      <label for="gotcha-api-profile">API 프로필</label>
      <select id="gotcha-api-profile"><option value="">현재 연결 사용</option></select>
    </div>

    <!-- Category buttons -->
    <div class="gotcha-section-label">카테고리 <span class="gotcha-hint">복수 선택 시 한 번에 생성</span></div>
    <div class="gotcha-categories">${catButtons}</div>

    <!-- Custom prompt -->
    <div class="gotcha-custom-row" id="gotcha-custom-row" style="display:none;">
      <label for="gotcha-custom-prompt">직접 입력</label>
      <textarea id="gotcha-custom-prompt" placeholder="원하는 것을 자유롭게 입력하세요. 예) 고양이 귀 달린 악당 마법사의 비밀 과거"></textarea>
    </div>

    <!-- Name region (charname 선택 시 표시) -->
    <div class="gotcha-option-row" id="gotcha-name-region-row" style="display:none;">
      <label for="gotcha-name-region">🌐 이름 지역/문화</label>
      <select id="gotcha-name-region">${regionOptions}</select>
    </div>

    <!-- Mood sliders -->
    <div class="gotcha-mood-section">
      <div class="gotcha-section-label">분위기 설정</div>
      <div class="gotcha-slider-row">
        <span class="gotcha-slider-lbl">☀️</span>
        <input type="range" id="gotcha-mood-tone" min="1" max="10" value="${s.moodTone ?? 5}">
        <span class="gotcha-slider-lbl">🌑</span>
      </div>
      <div class="gotcha-slider-desc">
        <span>밝음 ↔ 어두움</span>
        <span id="gotcha-mood-tone-val" class="gotcha-slider-val">${toneLabel(s.moodTone ?? 5)}</span>
      </div>
      <div class="gotcha-slider-row">
        <span class="gotcha-slider-lbl">🏙️</span>
        <input type="range" id="gotcha-mood-real" min="1" max="10" value="${s.moodReal ?? 5}">
        <span class="gotcha-slider-lbl">🧙</span>
      </div>
      <div class="gotcha-slider-desc">
        <span>현실 ↔ 판타지</span>
        <span id="gotcha-mood-real-val" class="gotcha-slider-val">${realLabel(s.moodReal ?? 5)}</span>
      </div>
    </div>

    <!-- Generate button -->
    <button id="gotcha-generate-btn">🎲 생성하기</button>

    <!-- Loading -->
    <div class="gotcha-loading" id="gotcha-loading" style="display:none;">
      <div class="gotcha-spinner"></div>
      <span id="gotcha-loading-text">생성 중...</span>
    </div>

    <!-- Result area -->
    <div id="gotcha-result-area"></div>

  </div>
</div>`;
}

// ── Slider labels ─────────────────────────────────────────────
function toneLabel(v) {
  v = Number(v);
  if (v <= 2) return '매우 밝음';
  if (v <= 4) return '밝음';
  if (v <= 6) return '중립';
  if (v <= 8) return '어두움';
  return '매우 어두움';
}
function realLabel(v) {
  v = Number(v);
  if (v <= 2) return '완전 현실';
  if (v <= 4) return '현실적';
  if (v <= 6) return '중립';
  if (v <= 8) return '판타지적';
  return '하이 판타지';
}

// ── Modal HTML ────────────────────────────────────────────────
function buildModalHtml() {
  const tabButtons = CATEGORIES
    .filter(c => c.id !== 'custom')
    .map(c => `<button class="gotcha-modal-tab" data-tab="${c.id}">${c.label}</button>`)
    .join('');
  return `
<div id="gotcha-modal-overlay" class="gotcha-modal-overlay">
  <div class="gotcha-modal" role="dialog" aria-modal="true" aria-label="Gotcha! 저장 목록">
    <div class="gotcha-modal-header">
      <span class="gotcha-modal-title">🔖 저장 목록</span>
      <div class="gotcha-modal-actions">
        <button id="gotcha-modal-clear">전체 삭제</button>
        <button id="gotcha-modal-close">✕</button>
      </div>
    </div>
    <div class="gotcha-modal-tabs">
      <button class="gotcha-modal-tab active" data-tab="all">전체</button>
      ${tabButtons}
      <button class="gotcha-modal-tab" data-tab="custom">✨ 직접 입력</button>
      <button class="gotcha-modal-tab" data-tab="combined">🎨 복합</button>
    </div>
    <div class="gotcha-modal-body"><div id="gotcha-modal-list"></div></div>
  </div>
</div>`;
}

// ── Wand button ───────────────────────────────────────────────
function registerWandButton() {
  $('#extensionsMenu').append(`
    <div id="gotcha-wand-btn" class="list-group-item" title="Gotcha!">
      <span>🎲</span><span>Gotcha!</span>
    </div>`);
  $(document).on('click', '#gotcha-wand-btn', () => openSavedModal());
}

// ── Event binding ─────────────────────────────────────────────
function bindEvents() {

  // Category multi-select
  $(document).on('click', `#${PANEL_ID} .gotcha-cat-btn`, function () {
    const catId = $(this).data('cat');

    if (catId === 'custom') {
      selectedCategories.clear();
      selectedCategories.add('custom');
      $(`#${PANEL_ID} .gotcha-cat-btn`).removeClass('active');
      $(this).addClass('active');
      $('#gotcha-custom-row').show();
      $('#gotcha-name-region-row').hide();
      return;
    }

    // custom 해제
    if (selectedCategories.has('custom')) {
      selectedCategories.delete('custom');
      $('#gotcha-custom-row').hide();
      $(`#${PANEL_ID} .gotcha-cat-btn[data-cat="custom"]`).removeClass('active');
    }

    // 토글 (마지막 하나 해제 불가)
    if (selectedCategories.has(catId)) {
      if (selectedCategories.size > 1) {
        selectedCategories.delete(catId);
        $(this).removeClass('active');
      }
    } else {
      selectedCategories.add(catId);
      $(this).addClass('active');
    }

    // 이름 지역 행 토글
    $('#gotcha-name-region-row').toggle(selectedCategories.has('charname'));
  });

  // Sliders
  $(document).on('input', '#gotcha-mood-tone', function () {
    const v = $(this).val();
    $('#gotcha-mood-tone-val').text(toneLabel(v));
    updateSliderFill('#gotcha-mood-tone', v);
    extension_settings[EXT_NAME].moodTone = Number(v);
    saveSettingsDebounced();
  });
  $(document).on('input', '#gotcha-mood-real', function () {
    const v = $(this).val();
    $('#gotcha-mood-real-val').text(realLabel(v));
    updateSliderFill('#gotcha-mood-real', v);
    extension_settings[EXT_NAME].moodReal = Number(v);
    saveSettingsDebounced();
  });

  // Name region
  $(document).on('change', '#gotcha-name-region', function () {
    extension_settings[EXT_NAME].nameRegion = $(this).val();
    saveSettingsDebounced();
  });

  // Generate
  $(document).on('click', '#gotcha-generate-btn', async () => {
    if (isGenerating) return;
    await generate();
  });

  // Result copy/save
  $(document).on('click', '#gotcha-copy-btn', () => {
    const item = resultHistory[historyIndex];
    if (!item) return;
    navigator.clipboard.writeText(item.text).then(() => {
      const btn = $('#gotcha-copy-btn');
      btn.text('✅');
      setTimeout(() => btn.text('📋'), 1200);
    });
  });
  $(document).on('click', '#gotcha-save-btn', () => {
    const item = resultHistory[historyIndex];
    if (!item) return;
    saveResult(item.category, item.categoryLabel, item.text);
  });

  // History navigation
  $(document).on('click', '#gotcha-hist-prev', () => {
    if (historyIndex > 0) { historyIndex--; renderResult(); }
  });
  $(document).on('click', '#gotcha-hist-next', () => {
    if (historyIndex < resultHistory.length - 1) { historyIndex++; renderResult(); }
  });

  // Modal events
  $(document).on('click', '.gotcha-saved-del', function () {
    const id = $(this).data('id');
    extension_settings[EXT_NAME].savedItems = extension_settings[EXT_NAME].savedItems.filter(i => i.id !== id);
    saveSettingsDebounced(); renderModalList(); updateWandBadge();
  });
  $(document).on('click', '.gotcha-saved-copy', function () {
    const text = $(this).closest('.gotcha-saved-item').find('.gotcha-saved-text').text();
    navigator.clipboard.writeText(text).then(() => {
      const btn = $(this); btn.text('✅');
      setTimeout(() => btn.text('📋'), 1200);
    });
  });
  $(document).on('click', '#gotcha-modal-overlay', function (e) {
    if ($(e.target).is('#gotcha-modal-overlay')) closeModal();
  });
  $(document).on('click', '#gotcha-modal-close', closeModal);
  $(document).on('keydown.gotcha-modal', (e) => { if (e.key === 'Escape') closeModal(); });
  $(document).on('click', '#gotcha-modal-clear', () => {
    if (!confirm('저장된 항목을 모두 삭제할까요?')) return;
    extension_settings[EXT_NAME].savedItems = [];
    saveSettingsDebounced(); renderModalList(); updateWandBadge();
  });
  $(document).on('click', '.gotcha-modal-tab', function () {
    activeModalTab = $(this).data('tab');
    $('.gotcha-modal-tab').removeClass('active');
    $(this).addClass('active');
    renderModalList();
  });
}

// ── Modal ─────────────────────────────────────────────────────
function openSavedModal() {
  if (!$('#gotcha-modal-overlay').length) $('body').append(buildModalHtml());
  activeModalTab = 'all';
  $('.gotcha-modal-tab').removeClass('active');
  $(`.gotcha-modal-tab[data-tab="all"]`).addClass('active');
  renderModalList();

  // 오버레이를 document 전체 높이로 펼치고
  const $overlay = $('#gotcha-modal-overlay');
  $overlay.addClass('active');
  $('body').addClass('gotcha-modal-open');

  // 모달을 현재 보이는 화면 중앙에 JS로 직접 위치시킴
  positionModal();
}

function positionModal() {
  const $modal   = $('.gotcha-modal');
  const scrollY  = window.scrollY || document.documentElement.scrollTop || 0;
  const vpH      = window.innerHeight;
  const modalH   = $modal.outerHeight() || 400;
  const top      = scrollY + (vpH - modalH) / 2;
  $modal.css('top', Math.max(scrollY + 8, top) + 'px');
}

function closeModal() {
  $('#gotcha-modal-overlay').removeClass('active');
  $('body').removeClass('gotcha-modal-open');
}
function renderModalList() {
  const allItems = extension_settings[EXT_NAME].savedItems;
  const items = activeModalTab === 'all'
    ? allItems
    : allItems.filter(i => i.category === activeModalTab);
  const list = $('#gotcha-modal-list');
  if (!items || items.length === 0) {
    list.html('<div class="gotcha-modal-empty">저장된 항목이 없습니다.</div>');
    return;
  }
  list.html(items.map(item => `
    <div class="gotcha-saved-item" data-id="${item.id}">
      <div class="gotcha-card-header">
        <span class="gotcha-saved-tag">${escapeHtml(item.categoryLabel || item.category)}</span>
        <div class="gotcha-saved-item-btns">
          <button class="gotcha-saved-copy" title="복사">📋</button>
          <button class="gotcha-saved-del" data-id="${item.id}" title="삭제">✕</button>
        </div>
      </div>
      <div class="gotcha-saved-text">${escapeHtml(item.text.trim())}</div>
    </div>
  `).join(''));
}
function updateWandBadge() { /* removed */ }

// ── API Profiles ──────────────────────────────────────────────
function populateApiProfiles() {
  const select = $('#gotcha-api-profile');
  refreshProfileOptions(select);
  const saved = extension_settings[EXT_NAME].apiProfile;
  if (saved) select.val(saved);
  select.on('change', function () {
    extension_settings[EXT_NAME].apiProfile = $(this).val();
    saveSettingsDebounced();
  });
}
function refreshProfileOptions(select) {
  const current = select.val();
  select.find('option:not([value=""])').remove();
  getApiProfiles().forEach(({ name, label }) => select.append(`<option value="${name}">${label}</option>`));
  if (current) select.val(current);
}
function getApiProfiles() {
  const profiles = [];
  try {
    const p = extension_settings?.connectionManager?.profiles;
    if (Array.isArray(p)) p.forEach(x => x?.name && profiles.push({ name: x.name, label: x.name }));
  } catch (_) {}
  if (!profiles.length) {
    try {
      const p = extension_settings?.connection_profiles;
      if (Array.isArray(p)) p.forEach(x => x?.name && profiles.push({ name: x.name, label: x.name }));
    } catch (_) {}
  }
  return profiles;
}

// ── Generation ────────────────────────────────────────────────
async function generate() {
  const cats = [...selectedCategories];
  const isCustom = cats.includes('custom');

  if (isCustom) {
    const custom = $('#gotcha-custom-prompt').val().trim();
    if (!custom) { toastr.warning('프롬프트를 입력해주세요.', 'Gotcha!'); return; }
    setLoading(true, '생성 중...');
    try {
      const text = (await callLLM(buildCustomPrompt(custom))).trim();
      pushHistory({ category: 'custom', categoryLabel: '✨ 직접 입력', text });
    } catch (err) {
      console.error('[Gotcha!]', err);
      toastr.error('생성 중 오류가 발생했습니다.', 'Gotcha!');
    } finally { setLoading(false); }
    return;
  }

  const opts = getOpts();
  const total = cats.length;
  setLoading(true, total > 1 ? `1 / ${total} 생성 중...` : '생성 중...');

  const results = [];
  try {
    for (let i = 0; i < cats.length; i++) {
      if (total > 1) $('#gotcha-loading-text').text(`${i + 1} / ${total} 생성 중...`);
      const cat = CATEGORIES.find(c => c.id === cats[i]);
      if (!cat) continue;
      const text = (await callLLM(cat.prompt(opts))).trim();
      results.push({ category: cat.id, categoryLabel: cat.label, text });
    }
    if (total === 1) {
      pushHistory(results[0]);
    } else {
      const combinedText = results.map(r => `【${r.categoryLabel}】\n${r.text}`).join('\n\n──────────\n\n');
      pushHistory({
        category: 'combined',
        categoryLabel: `🎨 복합 생성`,
        text: combinedText,
      });
    }
  } catch (err) {
    console.error('[Gotcha!]', err);
    toastr.error('생성 중 오류가 발생했습니다.', 'Gotcha!');
  } finally { setLoading(false); }
}

function getOpts() {
  const s = extension_settings[EXT_NAME];
  return { moodTone: s.moodTone ?? 5, moodReal: s.moodReal ?? 5, nameRegion: s.nameRegion ?? '' };
}

function buildCustomPrompt(custom) {
  return `You are a creative RP assistant. Based on the following request, generate a vivid and usable roleplay concept.
Request: "${custom}"
${moodHint(getOpts())}
Respond in Korean unless the request is clearly in another language.
Output ONLY the result, no preamble.`;
}

async function callLLM(prompt) {
  const context = getContext();
  const selectedProfile = extension_settings[EXT_NAME].apiProfile;
  let previousProfile = null;
  if (selectedProfile) {
    try {
      const p = extension_settings?.connectionManager?.profiles;
      if (Array.isArray(p)) previousProfile = p.find(x => x.isActive)?.name ?? null;
      if (context.executeSlashCommandsWithOptions)
        await context.executeSlashCommandsWithOptions(`/profile ${selectedProfile}`, { showOutput: false });
    } catch (e) { console.warn('[Gotcha!] profile switch failed:', e); }
  }
  let result;
  try {
    result = await context.generateRaw(prompt, null, false, false, '');
  } finally {
    if (selectedProfile && previousProfile && context.executeSlashCommandsWithOptions) {
      try { await context.executeSlashCommandsWithOptions(`/profile ${previousProfile}`, { showOutput: false }); } catch (_) {}
    }
  }
  return stripInjectedTags(result || '');
}

// ── Strip tags injected by other extensions ───────────────────
function stripInjectedTags(text) {
  // Remove any XML-style tags that other extensions inject (e.g. <phone_trigger ...>...</phone_trigger>)
  return text.replace(/<[a-z_][a-z0-9_]*(?:\s[^>]*)?>[\s\S]*?<\/[a-z_][a-z0-9_]*>/gi, '').trim();
}

// ── History ───────────────────────────────────────────────────
function pushHistory(item) {
  resultHistory.push(item);
  if (resultHistory.length > 20) resultHistory.shift();
  historyIndex = resultHistory.length - 1;
  renderResult();
}

function renderResult() {
  const area = $('#gotcha-result-area');
  if (historyIndex < 0 || !resultHistory[historyIndex]) { area.html(''); return; }
  const item  = resultHistory[historyIndex];
  const total = resultHistory.length;
  area.html(`
    <div class="gotcha-result-card">
      <div class="gotcha-result-header">
        <span>${escapeHtml(item.categoryLabel)}</span>
        <div class="gotcha-result-actions">
          <button id="gotcha-copy-btn" title="복사">📋</button>
          <button id="gotcha-save-btn" title="저장">🔖</button>
        </div>
      </div>
      <div class="gotcha-result-body">${escapeHtml(item.text)}</div>
      <div class="gotcha-hist-nav">
        <button id="gotcha-hist-prev" ${historyIndex === 0 ? 'disabled' : ''} title="이전">◀</button>
        <span class="gotcha-hist-count">${historyIndex + 1} / ${total}</span>
        <button id="gotcha-hist-next" ${historyIndex === total - 1 ? 'disabled' : ''} title="다음">▶</button>
      </div>
    </div>`);
}

// ── Helpers ───────────────────────────────────────────────────
function setLoading(loading, text = '생성 중...') {
  isGenerating = loading;
  $('#gotcha-generate-btn').prop('disabled', loading);
  $('#gotcha-loading-text').text(text);
  $('#gotcha-loading').toggle(loading);
}

function saveResult(catId, catLabel, text) {
  const s = extension_settings[EXT_NAME];
  s.savedItems.unshift({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    category: catId,
    categoryLabel: catLabel,
    text,
    createdAt: new Date().toISOString(),
  });
  if (s.savedItems.length > 50) s.savedItems = s.savedItems.slice(0, 50);
  saveSettingsDebounced();
  if ($('#gotcha-modal-overlay').hasClass('active')) renderModalList();
  updateWandBadge();
  toastr.success('저장되었습니다!', 'Gotcha!');
  const btn = $('#gotcha-save-btn');
  btn.text('✅');
  setTimeout(() => btn.text('🔖'), 1200);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function updateSliderFill(selector, value) {
  const pct = ((Number(value) - 1) / 9 * 100).toFixed(1);
  $(selector).css('background',
    `linear-gradient(to right, #2FA084 0%, #2FA084 ${pct}%, #2FA08430 ${pct}%, #2FA08430 100%)`
  );
}
