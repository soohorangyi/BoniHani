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

import { oai_settings } from '../../../openai.js';

// ── Constants ────────────────────────────────────────────────
const EXT_NAME = 'gotcha';
const PANEL_ID = 'gotcha-panel';

// ── Default settings ─────────────────────────────────────────
const DEFAULT_SETTINGS = {
  savedItems: [],       // { id, category, text, createdAt }
  apiProfile: '',       // selected API connection name (empty = use current)
};

// ── Category definitions ──────────────────────────────────────
const CATEGORIES = [
  {
    id: 'genre',
    label: '🎭 장르',
    prompt: `You are a creative writing assistant. Generate ONE unique and specific roleplay genre concept.
Format: a 2-4 sentence description that captures the mood, setting tone, and narrative style.
Be creative — mix genres, subvert expectations, suggest unusual combinations.
Respond in the same language the user would expect (default: Korean).
Output ONLY the genre description, nothing else.`,
  },
  {
    id: 'world',
    label: '🌍 세계관',
    prompt: `You are a creative worldbuilding assistant. Generate ONE original and vivid roleplay world concept.
Include: the world's defining characteristic, its atmosphere, and one unique element that sets it apart.
Keep it to 3-5 sentences. Make it evocative and immediately usable for RP.
Respond in Korean.
Output ONLY the world description, nothing else.`,
  },
  {
    id: 'setting',
    label: '🏰 배경/설정',
    prompt: `You are a creative writing assistant. Generate ONE specific scene/setting for a roleplay.
Include: the physical location, time of day or season, mood/atmosphere, and one sensory detail.
Keep it to 2-4 sentences. Make it atmospheric and immediately immersive.
Respond in Korean.
Output ONLY the setting description, nothing else.`,
  },
  {
    id: 'charname',
    label: '✍️ 캐릭터 이름',
    prompt: `You are a creative naming assistant. Generate ONE character name suitable for roleplay.
Provide: the name, its origin or meaning (brief), and a one-sentence personality hint the name suggests.
Make it memorable and fitting for a narrative character.
Respond in Korean.
Output ONLY the name entry, nothing else.`,
  },
  {
    id: 'charappear',
    label: '👤 캐릭터 외모',
    prompt: `You are a creative character designer. Generate ONE vivid character appearance description for roleplay.
Include: notable facial features, build/height impression, hair, eyes, and one distinctive physical trait.
Keep it to 3-5 sentences. Make it visual and memorable.
Respond in Korean.
Output ONLY the appearance description, nothing else.`,
  },
  {
    id: 'charback',
    label: '📖 캐릭터 배경',
    prompt: `You are a creative storytelling assistant. Generate ONE compelling character backstory hook for roleplay.
Include: their origin, a formative event that shaped them, and a lingering unresolved tension or secret.
Keep it to 3-5 sentences. Make it emotionally resonant and plot-ready.
Respond in Korean.
Output ONLY the backstory description, nothing else.`,
  },
  {
    id: 'plot',
    label: '🎲 플롯 훅',
    prompt: `You are a creative plot designer. Generate ONE compelling roleplay plot hook or scenario opener.
Include: the inciting situation, a sense of urgency or mystery, and an immediate choice or conflict for the player.
Keep it to 3-5 sentences. Make it immediately engaging.
Respond in Korean.
Output ONLY the plot hook, nothing else.`,
  },
  {
    id: 'relationship',
    label: '💬 관계 설정',
    prompt: `You are a creative narrative designer. Generate ONE interesting relationship dynamic between two characters for roleplay.
Include: the nature of their connection, the underlying tension or warmth, and one unspoken thing between them.
Keep it to 3-5 sentences. Make it emotionally complex and ripe for RP.
Respond in Korean.
Output ONLY the relationship description, nothing else.`,
  },
  {
    id: 'custom',
    label: '✨ 직접 입력',
    prompt: null, // uses custom textarea
  },
];

// ── State ─────────────────────────────────────────────────────
let selectedCategory = CATEGORIES[0];
let isGenerating = false;
let lastResult = null;

// ── Init ──────────────────────────────────────────────────────
jQuery(async () => {
  // Ensure settings
  if (!extension_settings[EXT_NAME]) {
    extension_settings[EXT_NAME] = { ...DEFAULT_SETTINGS };
  }
  const settings = extension_settings[EXT_NAME];
  if (!settings.savedItems) settings.savedItems = [];

  // Build panel HTML
  const panelHtml = buildPanelHtml();

  // Append to ST extensions panel
  $('#extensions_settings').append(panelHtml);

  // Bind events
  bindEvents();

  // Populate API profiles
  populateApiProfiles();

  // Restore saved list
  renderSavedList();

  console.log('[Gotcha!] Extension loaded.');
});

// ── Build HTML ────────────────────────────────────────────────
function buildPanelHtml() {
  const catButtons = CATEGORIES.map(cat => `
    <button class="gotcha-cat-btn${cat.id === selectedCategory.id ? ' active' : ''}"
            data-cat="${cat.id}" title="${cat.label}">
      ${cat.label}
    </button>
  `).join('');

  return `
<div id="${PANEL_ID}" class="inline-drawer">
  <div class="inline-drawer-toggle inline-drawer-header">
    <b>Gotcha!</b>
    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
  </div>
  <div class="inline-drawer-content">

      <!-- API Profile -->
      <div class="gotcha-api-row">
        <label for="gotcha-api-profile">API 프로필</label>
        <select id="gotcha-api-profile">
          <option value="">현재 연결 사용</option>
        </select>
      </div>

      <!-- Category buttons -->
      <div class="gotcha-categories">
        ${catButtons}
      </div>

      <!-- Custom prompt (shown only for 'custom' category) -->
      <div class="gotcha-custom-row" id="gotcha-custom-row" style="display:none;">
        <label for="gotcha-custom-prompt">직접 입력</label>
        <textarea id="gotcha-custom-prompt"
                  placeholder="원하는 것을 자유롭게 입력하세요. 예) 고양이 귀 달린 악당 마법사의 비밀 과거"></textarea>
      </div>

      <!-- Generate button -->
      <button id="gotcha-generate-btn">🎲 생성하기</button>

      <!-- Loading indicator (hidden by default) -->
      <div class="gotcha-loading" id="gotcha-loading" style="display:none;">
        <div class="gotcha-spinner"></div>
        <span>생성 중...</span>
      </div>

      <!-- Result area -->
      <div id="gotcha-result-area"></div>

      <!-- Saved items -->
      <div class="gotcha-saved-section" id="gotcha-saved-section" style="display:none;">
        <div class="gotcha-saved-header">
          <span>저장된 항목</span>
          <button id="gotcha-clear-saved">전체 삭제</button>
        </div>
        <div class="gotcha-saved-list" id="gotcha-saved-list"></div>
      </div>

  </div>
</div>`;
}

// ── Event Binding ─────────────────────────────────────────────
function bindEvents() {
  // Category buttons
  $(document).on('click', `#${PANEL_ID} .gotcha-cat-btn`, function () {
    const catId = $(this).data('cat');
    selectedCategory = CATEGORIES.find(c => c.id === catId) || CATEGORIES[0];

    $(`#${PANEL_ID} .gotcha-cat-btn`).removeClass('active');
    $(this).addClass('active');

    // Show/hide custom textarea
    if (catId === 'custom') {
      $('#gotcha-custom-row').show();
    } else {
      $('#gotcha-custom-row').hide();
    }
  });

  // Generate button
  $(document).on('click', '#gotcha-generate-btn', async () => {
    if (isGenerating) return;
    await generate();
  });

  // Copy button (delegated)
  $(document).on('click', '#gotcha-copy-btn', () => {
    if (!lastResult) return;
    navigator.clipboard.writeText(lastResult).then(() => {
      const btn = $('#gotcha-copy-btn');
      btn.text('✅');
      setTimeout(() => btn.text('📋'), 1200);
    });
  });

  // Save button (delegated)
  $(document).on('click', '#gotcha-save-btn', () => {
    if (!lastResult) return;
    saveResult(selectedCategory, lastResult);
  });

  // Clear all saved
  $(document).on('click', '#gotcha-clear-saved', () => {
    if (!confirm('저장된 항목을 모두 삭제할까요?')) return;
    extension_settings[EXT_NAME].savedItems = [];
    saveSettingsDebounced();
    renderSavedList();
  });

  // Delete individual saved item
  $(document).on('click', '.gotcha-saved-del', function () {
    const id = $(this).data('id');
    const items = extension_settings[EXT_NAME].savedItems;
    extension_settings[EXT_NAME].savedItems = items.filter(i => i.id !== id);
    saveSettingsDebounced();
    renderSavedList();
  });
}

// ── API Profile Helpers ───────────────────────────────────────
function populateApiProfiles() {
  const select = $('#gotcha-api-profile');
  refreshProfileOptions(select);

  // Restore saved selection
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

  const profiles = getApiProfiles();
  profiles.forEach(({ name, label }) => {
    select.append(`<option value="${name}">${label}</option>`);
  });

  if (current) select.val(current);
}

function getApiProfiles() {
  // ST stores Connection Profiles in extension_settings.connectionManager.profiles
  // Built-in since SillyTavern 1.12.6
  const profiles = [];
  try {
    const cmProfiles = extension_settings?.connectionManager?.profiles;
    if (Array.isArray(cmProfiles)) {
      for (const p of cmProfiles) {
        if (p?.name) profiles.push({ name: p.name, label: p.name });
      }
    }
  } catch (_) {}

  // Fallback for older ST builds
  if (profiles.length === 0) {
    try {
      const fallback = extension_settings?.connection_profiles;
      if (Array.isArray(fallback)) {
        for (const p of fallback) {
          if (p?.name) profiles.push({ name: p.name, label: p.name });
        }
      }
    } catch (_) {}
  }

  return profiles;
}

// ── Generation ────────────────────────────────────────────────
async function generate() {
  const prompt = buildPrompt();
  if (!prompt) {
    toastr.warning('프롬프트를 입력해주세요.', 'Gotcha!');
    return;
  }

  setLoading(true);

  try {
    const result = await callLLM(prompt);
    lastResult = result.trim();
    showResult(selectedCategory, lastResult);
  } catch (err) {
    console.error('[Gotcha!] Generation error:', err);
    toastr.error('생성 중 오류가 발생했습니다.', 'Gotcha!');
  } finally {
    setLoading(false);
  }
}

function buildPrompt() {
  if (selectedCategory.id === 'custom') {
    const custom = $('#gotcha-custom-prompt').val().trim();
    if (!custom) return null;
    return `You are a creative RP assistant. Based on the following request, generate a vivid and usable roleplay concept.
Request: "${custom}"
Respond in Korean unless the request is clearly in another language.
Output ONLY the result, no preamble.`;
  }
  return selectedCategory.prompt;
}

async function callLLM(prompt) {
  const context = getContext();
  const selectedProfile = extension_settings[EXT_NAME].apiProfile;
  let previousProfile = null;

  // If a specific profile is selected, temporarily switch to it before generating
  if (selectedProfile) {
    try {
      // Get current profile name so we can restore it after
      const cmProfiles = extension_settings?.connectionManager?.profiles;
      if (Array.isArray(cmProfiles)) {
        previousProfile = cmProfiles.find(p => p.isActive)?.name ?? null;
      }
      // Apply the selected profile via ST's executeSlashCommandsWithOptions
      // /profile command switches the active connection profile
      if (context.executeSlashCommandsWithOptions) {
        await context.executeSlashCommandsWithOptions(`/profile ${selectedProfile}`, { showOutput: false });
      }
    } catch (e) {
      console.warn('[Gotcha!] Could not switch profile:', e);
    }
  }

  let result;
  try {
    result = await context.generateRaw(
      prompt,
      null,    // character (null = no character context)
      false,   // quietToChat (don't append to chat)
      false,   // skipWIAN
      '',      // outerContext
    );
  } finally {
    // Restore previous profile after generation
    if (selectedProfile && previousProfile && context.executeSlashCommandsWithOptions) {
      try {
        await context.executeSlashCommandsWithOptions(`/profile ${previousProfile}`, { showOutput: false });
      } catch (_) {}
    }
  }

  return result || '';
}

// ── UI Helpers ────────────────────────────────────────────────
function setLoading(loading) {
  isGenerating = loading;
  $('#gotcha-generate-btn').prop('disabled', loading);
  $('#gotcha-loading').toggle(loading);
}

function showResult(category, text) {
  const area = $('#gotcha-result-area');
  area.html(`
    <div class="gotcha-result-card">
      <div class="gotcha-result-header">
        <span>${category.label}</span>
        <div class="gotcha-result-actions">
          <button id="gotcha-copy-btn" title="복사">📋</button>
          <button id="gotcha-save-btn" title="저장">🔖</button>
        </div>
      </div>
      <div class="gotcha-result-body">${escapeHtml(text)}</div>
    </div>
  `);
}

function saveResult(category, text) {
  const settings = extension_settings[EXT_NAME];
  const item = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    category: category.id,
    categoryLabel: category.label,
    text,
    createdAt: new Date().toISOString(),
  };
  settings.savedItems.unshift(item);
  // Keep max 50 items
  if (settings.savedItems.length > 50) {
    settings.savedItems = settings.savedItems.slice(0, 50);
  }
  saveSettingsDebounced();
  renderSavedList();
  toastr.success('저장되었습니다!', 'Gotcha!');

  // Flash the save button
  const btn = $('#gotcha-save-btn');
  btn.text('✅');
  setTimeout(() => btn.text('🔖'), 1200);
}

function renderSavedList() {
  const items = extension_settings[EXT_NAME].savedItems;
  const section = $('#gotcha-saved-section');
  const list = $('#gotcha-saved-list');

  if (!items || items.length === 0) {
    section.hide();
    return;
  }

  section.show();
  list.html(items.map(item => `
    <div class="gotcha-saved-item">
      <span class="gotcha-saved-tag">${escapeHtml(item.categoryLabel || item.category)}</span>
      <span class="gotcha-saved-text">${escapeHtml(item.text)}</span>
      <button class="gotcha-saved-del" data-id="${item.id}" title="삭제">✕</button>
    </div>
  `).join(''));
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
