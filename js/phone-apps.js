// phone-apps.js — 查手机「浏览器 / 备忘录 / 相册 / Game Center」内容生成与渲染
// 职责：四个 App 的快照持久化、API prompt 构建与调用、数据清洗、页面渲染（含未生成时的初始空状态页）。
// 依赖 phone-wechat.js 的共享函数（同为经典脚本，顶层函数全局可见）：
//   extractPhoneSnapshotJson / parsePhoneRelativeTime / formatPhoneSnapshotCurrentTime
//   loadPhoneSnapshotRelatedNpcs / buildPhoneSnapshotNpcBlock / buildPhoneSnapshotRelationText
//   buildPhoneSnapshotRecentMessagesBlock / getPhoneWechatSnapshot / getPhoneSnapshotTemperature
// 设计文档：prompt-local/查手机-四App-Prompt设计.md

function paEscHtml(str) {
  if (window._wechatCallHelpers?.wcEscHtml) return window._wechatCallHelpers.wcEscHtml(str)
  return String(str ?? '').replace(/[&<>"']/g, s => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[s]))
}

const PHONE_GEN_APP_LABELS = {
  browser: '浏览器',
  notes: '备忘录',
  photos: '相册',
  'game-center': 'Game Center',
  privacy: '隐私空间',
  mail: 'Mail'
}

window.PHONE_GEN_APP_LABELS = PHONE_GEN_APP_LABELS

// ===== 快照持久化 =====

function getPhoneAppSnapshotKey(appId, ownerUid, charId) {
  return `phoneAppSnapshot_${appId}_${ownerUid}_${charId}`
}

async function getPhoneAppSnapshot(appId, ownerUid, charId) {
  if (!window.db || !appId || !ownerUid || !charId) return null
  const row = await db.config.get(getPhoneAppSnapshotKey(appId, ownerUid, charId))
  const value = row?.value
  if (!value || typeof value !== 'object' || !value.data) return null
  return value
}

async function savePhoneAppSnapshot(appId, ownerUid, charId, snapshot) {
  await db.config.put({
    key: getPhoneAppSnapshotKey(appId, ownerUid, charId),
    value: snapshot
  })
}

async function clearPhoneAppSnapshot(appId, ownerUid, charId) {
  await db.config.delete(getPhoneAppSnapshotKey(appId, ownerUid, charId))
}

window.getPhoneAppSnapshot = getPhoneAppSnapshot
window.clearPhoneAppSnapshot = clearPhoneAppSnapshot

// ===== 共享：占位图（与朋友圈一致，desc 哈希 → img/blank_img1-6.jpg） =====

function phoneAppPlaceholderImg(desc, salt = '') {
  const raw = String(desc || '') + salt
  let seed = 0
  for (let i = 0; i < raw.length; i++) seed = ((seed * 31) + raw.charCodeAt(i)) >>> 0
  return `img/blank_img${(seed % 6) + 1}.jpg`
}

// ===== 共享：System Prompt =====

function buildPhoneBrowserSystemPrompt(char, user) {
  const charName = char?.nick || char?.name || '角色'
  const userName = user?.nick || user?.name || '用户'
  return window.WanWanPrompts.render("phone-apps.buildPhoneBrowserSystemPrompt.c90c58068", [charName, charName, userName, userName])
}

function buildPhoneNotesSystemPrompt(char, user) {
  const charName = char?.nick || char?.name || '角色'
  const userName = user?.nick || user?.name || '用户'
  return window.WanWanPrompts.render("phone-apps.buildPhoneNotesSystemPrompt.decd5ccb4", [charName, userName, userName])
}

function buildPhonePhotosSystemPrompt(char, user) {
  const charName = char?.nick || char?.name || '角色'
  const userName = user?.nick || user?.name || '用户'
  return window.WanWanPrompts.render("phone-apps.buildPhonePhotosSystemPrompt.465fab496", [charName, userName])
}

function buildPhoneGameCenterSystemPrompt(char, user) {
  const charName = char?.nick || char?.name || '角色'
  return window.WanWanPrompts.render("phone-apps.buildPhoneGameCenterSystemPrompt.eac4beed3", [charName])
}

function buildPhonePrivacySystemPrompt(char, user) {
  const charName = char?.nick || char?.name || '角色'
  const userName = user?.nick || user?.name || '用户'
  return window.WanWanPrompts.render("phone-apps.buildPhonePrivacySystemPrompt.267433cb9", [charName, charName, userName, userName])
}

function buildPhoneMailSystemPrompt(char, user) {
  const charName = char?.nick || char?.name || '角色'
  return window.WanWanPrompts.render("phone-apps.buildPhoneMailSystemPrompt.b0de421bb", [charName])
}

const PHONE_GEN_APP_SYSTEM_BUILDERS = {
  browser: buildPhoneBrowserSystemPrompt,
  notes: buildPhoneNotesSystemPrompt,
  photos: buildPhonePhotosSystemPrompt,
  'game-center': buildPhoneGameCenterSystemPrompt,
  privacy: buildPhonePrivacySystemPrompt,
  mail: buildPhoneMailSystemPrompt
}

// ===== 共享：User Prompt（骨架与微信一致，只换任务句） =====

function buildPhoneAppWechatFriendsBlock(wechatData) {
  const friends = wechatData?.friends || []
  if (!friends.length) return '(无。人物可自行虚构，但要符合角色生活圈。)'
  return friends.map(f => `- ${f.name}（备注：${f.remark || f.name}｜关系：${f.relation || '未设定'}）`).join('\n')
}

async function buildPhoneAppUserPrompt(appId, char, user, npcs, loreCtx, recentMessagesText, wechatData) {
  const appLabel = PHONE_GEN_APP_LABELS[appId] || appId
  const charName = char?.name || '角色'
  const nickPart = char?.nick && char.nick !== char.name ? `（昵称：${char.nick}）` : ''
  return window.WanWanPrompts.render("phone-apps.buildPhoneAppUserPrompt.6443eae0c", [appLabel, formatPhoneSnapshotCurrentTime(), charName, nickPart, char?.gender || '未知', char?.role || '(未设定)', char?.description || '(未设定)', user?.nick || user?.name || '用户', user?.gender ? `性别：${user.gender}` : '', user?.role ? `身份：${user.role}` : '', user?.description || '(未设定)', buildPhoneSnapshotRelationText(char, user?.id), buildPhoneSnapshotNpcBlock(npcs), buildPhoneAppWechatFriendsBlock(wechatData), loreCtx || '(无)', recentMessagesText])
}

// ===== 数据清洗 =====

function sanitizePhoneBrowserData(raw) {
  if (!raw || typeof raw !== 'object') return null
  const clean = v => String(v ?? '').trim()
  const searches = (Array.isArray(raw.searches) ? raw.searches : [])
    .map(s => ({
      query: clean(s?.query),
      time: clean(s?.time),
      results: (Array.isArray(s?.results) ? s.results : [])
        .map(r => ({
          title: clean(r?.title),
          site: clean(r?.site),
          snippet: clean(r?.snippet)
        }))
        .filter(r => r.title)
    }))
    .filter(s => s.query)
  const bookmarks = (Array.isArray(raw.bookmarks) ? raw.bookmarks : [])
    .map(b => ({
      title: clean(b?.title),
      site: clean(b?.site),
      desc: clean(b?.desc)
    }))
    .filter(b => b.title)
  return { searches, bookmarks }
}

function sanitizePhoneNotesData(raw) {
  if (!raw || typeof raw !== 'object') return null
  const clean = v => String(v ?? '').trim()
  const notes = (Array.isArray(raw.notes) ? raw.notes : [])
    .map(n => ({
      title: clean(n?.title),
      time: clean(n?.time),
      content: String(n?.content ?? '').replace(/\r\n/g, '\n').trim(),
      pinned: n?.pinned === true
    }))
    .filter(n => n.content || n.title)
  return { notes }
}

function sanitizePhonePhotosData(raw) {
  if (!raw || typeof raw !== 'object') return null
  const clean = v => String(v ?? '').trim()
  const albums = (Array.isArray(raw.albums) ? raw.albums : [])
    .map(a => ({
      name: clean(a?.name),
      photos: (Array.isArray(a?.photos) ? a.photos : [])
        .map(p => ({
          desc: clean(p?.desc),
          time: clean(p?.time)
        }))
        .filter(p => p.desc)
    }))
    .filter(a => a.name && a.photos.length)
  return { albums }
}

function sanitizePhoneGameCenterData(raw) {
  if (!raw || typeof raw !== 'object') return null
  const clean = v => String(v ?? '').trim()
  const toHours = v => {
    const n = parseFloat(v)
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 10) / 10 : 0
  }
  const games = (Array.isArray(raw.games) ? raw.games : [])
    .map(g => ({
      name: clean(g?.name),
      genre: clean(g?.genre),
      weeklyHours: toHours(g?.weeklyHours),
      totalHours: toHours(g?.totalHours),
      lastPlayed: clean(g?.lastPlayed),
      achievements: (Array.isArray(g?.achievements) ? g.achievements : [])
        .map(a => ({
          title: clean(a?.title),
          desc: clean(a?.desc),
          unlocked: a?.unlocked === true,
          time: a?.time == null ? null : clean(a.time)
        }))
        .filter(a => a.title),
      stats: (Array.isArray(g?.stats) ? g.stats : [])
        .map(s => ({ label: clean(s?.label), value: clean(s?.value) }))
        .filter(s => s.label && s.value)
    }))
    .filter(g => g.name)
  return { games }
}

function sanitizePhonePrivacyData(raw) {
  if (!raw || typeof raw !== 'object') return null
  const clean = v => String(v ?? '').trim()
  const toPct = v => {
    const n = parseFloat(v)
    if (!Number.isFinite(n)) return 0
    return Math.max(0, Math.min(100, Math.round(n)))
  }
  const toCount = v => {
    const n = parseInt(v, 10)
    return Number.isFinite(n) && n > 0 ? n : 1
  }
  const videos = (Array.isArray(raw.videos) ? raw.videos : [])
    .map(v => ({
      title: clean(v?.title),
      channel: clean(v?.channel),
      duration: clean(v?.duration),
      progress: toPct(v?.progress),
      watchCount: toCount(v?.watchCount),
      time: clean(v?.time),
      desc: clean(v?.desc)
    }))
    .filter(v => v.title)
  const searches = (Array.isArray(raw.searches) ? raw.searches : [])
    .map(s => ({ query: clean(s?.query), time: clean(s?.time) }))
    .filter(s => s.query)
  return { videos, searches }
}

function sanitizePhoneMailData(raw) {
  if (!raw || typeof raw !== 'object') return null
  const clean = v => String(v ?? '').trim()
  const emails = (Array.isArray(raw.emails) ? raw.emails : [])
    .map(e => ({
      sender: clean(e?.sender),
      address: clean(e?.address),
      subject: clean(e?.subject),
      body: String(e?.body ?? '').replace(/\r\n/g, '\n').trim(),
      time: clean(e?.time),
      unread: e?.unread === true,
      spam: e?.spam === true,
      attachments: (Array.isArray(e?.attachments) ? e.attachments : [])
        .map(a => ({ name: clean(a?.name), size: clean(a?.size) }))
        .filter(a => a.name)
    }))
    .filter(e => e.subject || e.body)
  return { emails }
}

const PHONE_GEN_APP_SANITIZERS = {
  browser: sanitizePhoneBrowserData,
  notes: sanitizePhoneNotesData,
  photos: sanitizePhonePhotosData,
  'game-center': sanitizePhoneGameCenterData,
  privacy: sanitizePhonePrivacyData,
  mail: sanitizePhoneMailData
}

function phoneAppDataIsEmpty(appId, data) {
  if (!data) return true
  if (appId === 'browser') return !data.searches.length && !data.bookmarks.length
  if (appId === 'notes') return !data.notes.length
  if (appId === 'photos') return !data.albums.length
  if (appId === 'game-center') return !data.games.length
  if (appId === 'privacy') return !data.videos.length && !data.searches.length
  if (appId === 'mail') return !data.emails.length
  return true
}

// 为排序补 _ts（沿用微信的相对时间解析）
function stampPhoneAppTimes(appId, data, now = Date.now()) {
  const stamp = (item, fallbackIndex) => {
    const parsed = parsePhoneRelativeTime(item.time, now)
    item._ts = parsed != null ? parsed : now - fallbackIndex * 3600000
  }
  if (appId === 'browser') {
    data.searches.forEach((s, i) => stamp(s, i + 1))
    data.searches.sort((a, b) => (b._ts || 0) - (a._ts || 0))
  } else if (appId === 'notes') {
    data.notes.forEach((n, i) => stamp(n, i + 1))
    data.notes.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return (b._ts || 0) - (a._ts || 0)
    })
  } else if (appId === 'photos') {
    data.albums.forEach((album, ai) => {
      album.photos.forEach((p, i) => {
        const parsed = parsePhoneRelativeTime(p.time, now)
        p._ts = parsed != null ? parsed : now - (ai * 10 + i + 1) * 86400000
      })
    })
  } else if (appId === 'game-center') {
    data.games.forEach((g, i) => {
      const parsed = parsePhoneRelativeTime(g.lastPlayed, now)
      g._ts = parsed != null ? parsed : now - (i + 1) * 3600000
    })
    data.games.sort((a, b) => (b._ts || 0) - (a._ts || 0))
  } else if (appId === 'privacy') {
    data.videos.forEach((v, i) => stamp(v, i + 1))
    data.videos.sort((a, b) => (b._ts || 0) - (a._ts || 0))
    data.searches.forEach((s, i) => stamp(s, i + 1))
    data.searches.sort((a, b) => (b._ts || 0) - (a._ts || 0))
  } else if (appId === 'mail') {
    data.emails.forEach((e, i) => stamp(e, i + 1))
    data.emails.sort((a, b) => (b._ts || 0) - (a._ts || 0))
  }
}

// ===== 生成主流程（全量生成，已有快照直接覆盖） =====

async function generatePhoneAppSnapshot(appId, ownerUid, charId) {
  if (typeof window.callAI !== 'function') throw new Error('请先在设置里配置 API')
  const buildSystem = PHONE_GEN_APP_SYSTEM_BUILDERS[appId]
  const sanitize = PHONE_GEN_APP_SANITIZERS[appId]
  if (!buildSystem || !sanitize) throw new Error('未知应用')
  const char = await db.characters.get(charId)
  if (!char) throw new Error('角色不存在')
  const user = await db.characters.get(ownerUid)
  if (!user) throw new Error('微信账号不存在')
  const charName = char.nick || char.name || '角色'
  const userName = user.nick || user.name || '用户'

  const npcs = await loadPhoneSnapshotRelatedNpcs(char, ownerUid)
  const recentBlock = await buildPhoneSnapshotRecentMessagesBlock(ownerUid, charId, charName, userName)
  const loreCtx = window.getLorebookContext
    ? await window.getLorebookContext(charId, recentBlock.loreMessages)
    : ''
  const wechatSnapshot = await getPhoneWechatSnapshot(ownerUid, charId)

  const system = buildSystem(char, user)
  const userPrompt = await buildPhoneAppUserPrompt(appId, char, user, npcs, loreCtx, recentBlock.text, wechatSnapshot?.data)
  const raw = await window.callAI([{ role: 'user', content: userPrompt }], window.WanWanPrompts.options("phone-apps.generatePhoneAppSnapshot", ({
    system,
    responseFormat: 'json_object',
    temperature: await getPhoneSnapshotTemperature()
  })))
  const parsed = extractPhoneSnapshotJson(raw)
  if (!parsed) throw new Error('AI 返回格式异常，请重试')
  const cleaned = sanitize(parsed)
  if (!cleaned || phoneAppDataIsEmpty(appId, cleaned)) throw new Error('生成结果为空，请重试')

  const now = Date.now()
  stampPhoneAppTimes(appId, cleaned, now)

  const snapshot = {
    version: 1,
    generatedAt: now,
    updatedAt: now,
    data: cleaned
  }
  await savePhoneAppSnapshot(appId, ownerUid, charId, snapshot)
  return snapshot
}

window.generatePhoneAppSnapshot = generatePhoneAppSnapshot

// ===== 页面公共辅助 =====

const PHONE_APP_PAGE_IDS = [
  'phone-app-browser-page',
  'phone-app-browser-search-page',
  'phone-app-notes-page',
  'phone-app-note-detail-page',
  'phone-app-photos-page',
  'phone-app-album-page',
  'phone-app-photo-viewer',
  'phone-app-gamecenter-page',
  'phone-app-game-detail-page',
  'phone-app-privacy-page',
  'phone-app-privacy-detail-page',
  'phone-app-mail-page',
  'phone-app-mail-detail-page'
]

function closePhoneAppSnapshotPages() {
  PHONE_APP_PAGE_IDS.forEach(id => document.getElementById(id)?.remove())
}

window.closePhoneAppSnapshotPages = closePhoneAppSnapshotPages

function createPhoneAppPage(id, title, extraClass = '') {
  document.getElementById(id)?.remove()
  const page = document.createElement('div')
  page.id = id
  page.className = `full-page phone-app-page ${extraClass}`.trim()
  page.innerHTML = `
    <div class="page-header">
      <button class="header-back" data-phone-app-back type="button"><i class="fa fa-angle-left"></i></button>
      <span class="header-title">${paEscHtml(title)}</span>
      <span style="width:40px;flex-shrink:0"></span>
    </div>
    <div class="phone-app-scroll"></div>
  `
  page.querySelector('[data-phone-app-back]').addEventListener('click', () => window.closePage(id))
  return page
}

function buildPhoneAppEmptyHTML(icon, title) {
  return `
    <div class="phone-app-empty">
      <i class="${paEscHtml(icon)}"></i>
      <div>${paEscHtml(title)}</div>
    </div>`
}

// ===== 浏览器页面 =====

async function openPhoneBrowserPage(context) {
  const snapshot = await getPhoneAppSnapshot('browser', context.ownerUid, context.charId)
  const data = snapshot?.data
  const page = createPhoneAppPage('phone-app-browser-page', '浏览器')
  const scroll = page.querySelector('.phone-app-scroll')

  const searchbar = `
    <div class="phone-browser-searchbar" aria-hidden="true">
      <i class="fa fa-magnifying-glass"></i>
      <span>搜索或输入网址</span>
    </div>`

  if (!data || (!data.searches.length && !data.bookmarks.length)) {
    scroll.innerHTML = searchbar + buildPhoneAppEmptyHTML('fa-regular fa-compass', '暂无浏览数据')
    window.openPage(page)
    return
  }

  const searchesHtml = data.searches.length ? `
    <div class="phone-app-section-title">搜索记录</div>
    <div class="phone-app-list">
      ${data.searches.map((s, i) => `
        <button class="phone-app-row" type="button" data-search-index="${i}">
          <span class="phone-app-row-icon"><i class="fa fa-clock-rotate-left"></i></span>
          <span class="phone-app-row-main">
            <span class="phone-app-row-title">${paEscHtml(s.query)}</span>
            <span class="phone-app-row-sub">${paEscHtml(s.time || '')}</span>
          </span>
          <i class="fa fa-angle-right phone-app-row-arrow"></i>
        </button>
      `).join('')}
    </div>` : ''

  const bookmarksHtml = data.bookmarks.length ? `
    <div class="phone-app-section-title">收藏</div>
    <div class="phone-app-list">
      ${data.bookmarks.map(b => `
        <div class="phone-app-row phone-app-row-static">
          <span class="phone-app-row-icon phone-browser-bookmark-icon"><i class="fa fa-star"></i></span>
          <span class="phone-app-row-main">
            <span class="phone-app-row-title">${paEscHtml(b.title)}</span>
            <span class="phone-app-row-sub">${paEscHtml(b.site)}${b.desc ? `｜${paEscHtml(b.desc)}` : ''}</span>
          </span>
        </div>
      `).join('')}
    </div>` : ''

  scroll.innerHTML = searchbar + searchesHtml + bookmarksHtml
  window.openPage(page)

  scroll.querySelectorAll('[data-search-index]').forEach(btn => {
    btn.addEventListener('click', () => {
      const search = data.searches[parseInt(btn.dataset.searchIndex, 10)]
      if (search) openPhoneBrowserSearchPage(search)
    })
  })
}

function openPhoneBrowserSearchPage(search) {
  const page = createPhoneAppPage('phone-app-browser-search-page', search.query)
  const scroll = page.querySelector('.phone-app-scroll')
  scroll.innerHTML = `
    <div class="phone-browser-searchbar phone-browser-searchbar-filled" aria-hidden="true">
      <i class="fa fa-magnifying-glass"></i>
      <span>${paEscHtml(search.query)}</span>
    </div>
    <div class="phone-browser-result-meta">找到约 ${(search.results.length * 128400).toLocaleString()} 条结果${search.time ? `｜搜索于 ${paEscHtml(search.time)}` : ''}</div>
    ${search.results.map(r => `
      <div class="phone-browser-result-card">
        <div class="phone-browser-result-site"><span class="phone-browser-result-favicon">${paEscHtml(Array.from(r.site || r.title)[0] || '?')}</span>${paEscHtml(r.site || '')}</div>
        <div class="phone-browser-result-title">${paEscHtml(r.title)}</div>
        <div class="phone-browser-result-snippet">${paEscHtml(r.snippet || '')}</div>
      </div>
    `).join('')}
  `
  window.openPage(page)
}

// ===== 备忘录页面 =====

function phoneNoteDisplayTitle(note) {
  if (note.title) return note.title
  const firstLine = String(note.content || '').split('\n').find(line => line.trim())
  return (firstLine || '新建备忘录').trim().slice(0, 30)
}

async function openPhoneNotesPage(context) {
  const snapshot = await getPhoneAppSnapshot('notes', context.ownerUid, context.charId)
  const notes = snapshot?.data?.notes || []
  const page = createPhoneAppPage('phone-app-notes-page', '备忘录')
  const scroll = page.querySelector('.phone-app-scroll')

  if (!notes.length) {
    scroll.innerHTML = buildPhoneAppEmptyHTML('fa-solid fa-pen-clip', '暂无备忘录')
    window.openPage(page)
    return
  }

  scroll.innerHTML = `
    <div class="phone-app-section-title">${notes.length} 个备忘录</div>
    <div class="phone-app-list">
      ${notes.map((note, i) => {
        const preview = String(note.content || '').split('\n').filter(l => l.trim())
        const previewText = (note.title ? preview[0] : preview[1]) || ''
        return `
          <button class="phone-app-row" type="button" data-note-index="${i}">
            <span class="phone-app-row-main">
              <span class="phone-app-row-title">${note.pinned ? '<i class="fa fa-thumbtack phone-note-pin"></i>' : ''}${paEscHtml(phoneNoteDisplayTitle(note))}</span>
              <span class="phone-app-row-sub"><span class="phone-note-time">${paEscHtml(note.time || '')}</span>${paEscHtml(String(previewText).slice(0, 40))}</span>
            </span>
            <i class="fa fa-angle-right phone-app-row-arrow"></i>
          </button>`
      }).join('')}
    </div>
  `
  window.openPage(page)

  scroll.querySelectorAll('[data-note-index]').forEach(btn => {
    btn.addEventListener('click', () => {
      const note = notes[parseInt(btn.dataset.noteIndex, 10)]
      if (note) openPhoneNoteDetailPage(note)
    })
  })
}

function openPhoneNoteDetailPage(note) {
  const page = createPhoneAppPage('phone-app-note-detail-page', '备忘录')
  const scroll = page.querySelector('.phone-app-scroll')
  scroll.innerHTML = `
    <div class="phone-note-detail">
      <div class="phone-note-detail-title">${paEscHtml(phoneNoteDisplayTitle(note))}</div>
      <div class="phone-note-detail-time">${paEscHtml(note.time || '')}</div>
      <div class="phone-note-detail-content">${paEscHtml(note.content || '')}</div>
    </div>
  `
  window.openPage(page)
}

// ===== 相册页面 =====

function collectPhonePhotos(albums) {
  const all = []
  albums.forEach((album, albumIndex) => {
    album.photos.forEach((photo, photoIndex) => {
      all.push({ ...photo, albumName: album.name, _salt: `${albumIndex}_${photoIndex}` })
    })
  })
  all.sort((a, b) => (b._ts || 0) - (a._ts || 0))
  return all
}

function buildPhonePhotoThumbHTML(photo) {
  const src = phoneAppPlaceholderImg(photo.desc, photo._salt)
  return `
    <button class="phone-photo-thumb" type="button" data-photo-desc="${paEscHtml(photo.desc)}" data-photo-time="${paEscHtml(photo.time || '')}" data-photo-src="${src}">
      <img src="${src}" alt="${paEscHtml(photo.desc)}" loading="lazy">
    </button>`
}

function bindPhonePhotoThumbs(scope) {
  scope.querySelectorAll('.phone-photo-thumb').forEach(btn => {
    btn.addEventListener('click', () => {
      openPhonePhotoViewer(btn.dataset.photoSrc, btn.dataset.photoDesc, btn.dataset.photoTime)
    })
  })
}

async function openPhonePhotosPage(context) {
  const snapshot = await getPhoneAppSnapshot('photos', context.ownerUid, context.charId)
  const albums = snapshot?.data?.albums || []
  const page = createPhoneAppPage('phone-app-photos-page', '相册')
  const scroll = page.querySelector('.phone-app-scroll')

  if (!albums.length) {
    scroll.innerHTML = buildPhoneAppEmptyHTML('fa-solid fa-panorama', '暂无照片')
    window.openPage(page)
    return
  }

  const allPhotos = collectPhonePhotos(albums)
  scroll.innerHTML = `
    <div class="phone-app-section-title">我的相册</div>
    <div class="phone-album-strip">
      ${albums.map((album, i) => {
        const cover = album.photos[0]
        const src = phoneAppPlaceholderImg(cover?.desc, `${i}_0`)
        return `
          <button class="phone-album-card" type="button" data-album-index="${i}">
            <span class="phone-album-cover"><img src="${src}" alt="${paEscHtml(album.name)}" loading="lazy"></span>
            <span class="phone-album-name">${paEscHtml(album.name)}</span>
            <span class="phone-album-count">${album.photos.length}</span>
          </button>`
      }).join('')}
    </div>
    <div class="phone-app-section-title">最近项目</div>
    <div class="phone-photo-grid">
      ${allPhotos.map(buildPhonePhotoThumbHTML).join('')}
    </div>
  `
  window.openPage(page)

  scroll.querySelectorAll('[data-album-index]').forEach(btn => {
    btn.addEventListener('click', () => {
      const album = albums[parseInt(btn.dataset.albumIndex, 10)]
      if (album) openPhoneAlbumPage(album, parseInt(btn.dataset.albumIndex, 10))
    })
  })
  bindPhonePhotoThumbs(scroll)
}

function openPhoneAlbumPage(album, albumIndex) {
  const page = createPhoneAppPage('phone-app-album-page', album.name)
  const scroll = page.querySelector('.phone-app-scroll')
  const photos = album.photos
    .map((photo, photoIndex) => ({ ...photo, _salt: `${albumIndex}_${photoIndex}` }))
    .sort((a, b) => (b._ts || 0) - (a._ts || 0))
  scroll.innerHTML = `
    <div class="phone-app-section-title">${paEscHtml(album.name)}｜${album.photos.length} 张</div>
    <div class="phone-photo-grid">
      ${photos.map(buildPhonePhotoThumbHTML).join('')}
    </div>
  `
  window.openPage(page)
  bindPhonePhotoThumbs(scroll)
}

function openPhonePhotoViewer(src, desc, time) {
  document.getElementById('phone-app-photo-viewer')?.remove()
  const viewer = document.createElement('div')
  viewer.id = 'phone-app-photo-viewer'
  viewer.className = 'phone-photo-viewer'
  viewer.innerHTML = `
    <button class="phone-photo-viewer-close" type="button" aria-label="关闭"><i class="fa fa-xmark"></i></button>
    <div class="phone-photo-viewer-body">
      <img src="${paEscHtml(src)}" alt="${paEscHtml(desc)}">
    </div>
    <div class="phone-photo-viewer-caption">
      <div class="phone-photo-viewer-desc">${paEscHtml(desc || '')}</div>
      ${time ? `<div class="phone-photo-viewer-time">${paEscHtml(time)}</div>` : ''}
    </div>
  `
  document.body.appendChild(viewer)
  requestAnimationFrame(() => viewer.classList.add('show'))
  const close = () => {
    viewer.classList.remove('show')
    setTimeout(() => viewer.remove(), 220)
  }
  viewer.querySelector('.phone-photo-viewer-close').addEventListener('click', close)
  viewer.querySelector('.phone-photo-viewer-body').addEventListener('click', close)
}

// ===== Game Center 页面 =====

function formatPhoneGameHours(hours) {
  const n = Number(hours || 0)
  if (n >= 10) return `${Math.round(n)} 小时`
  return `${(Math.round(n * 10) / 10).toString().replace(/\.0$/, '')} 小时`
}

function buildPhoneGameIconHTML(game) {
  const initial = Array.from(String(game.name || '?').trim())[0] || '?'
  return `<span class="phone-game-icon">${paEscHtml(initial)}</span>`
}

async function openPhoneGameCenterPage(context) {
  const snapshot = await getPhoneAppSnapshot('game-center', context.ownerUid, context.charId)
  const games = snapshot?.data?.games || []
  const page = createPhoneAppPage('phone-app-gamecenter-page', 'Game Center')
  const scroll = page.querySelector('.phone-app-scroll')

  if (!games.length) {
    scroll.innerHTML = buildPhoneAppEmptyHTML('fa-solid fa-chess', '暂无游戏记录')
    window.openPage(page)
    return
  }

  scroll.innerHTML = `
    <div class="phone-app-section-title">最近游玩</div>
    <div class="phone-app-list">
      ${games.map((game, i) => `
        <button class="phone-app-row phone-game-row" type="button" data-game-index="${i}">
          ${buildPhoneGameIconHTML(game)}
          <span class="phone-app-row-main">
            <span class="phone-app-row-title">${paEscHtml(game.name)}${game.genre ? `<span class="phone-game-genre">${paEscHtml(game.genre)}</span>` : ''}</span>
            <span class="phone-app-row-sub">本周 ${formatPhoneGameHours(game.weeklyHours)}｜累计 ${formatPhoneGameHours(game.totalHours)}${game.lastPlayed ? `｜${paEscHtml(game.lastPlayed)}` : ''}</span>
          </span>
          <i class="fa fa-angle-right phone-app-row-arrow"></i>
        </button>
      `).join('')}
    </div>
  `
  window.openPage(page)

  scroll.querySelectorAll('[data-game-index]').forEach(btn => {
    btn.addEventListener('click', () => {
      const game = games[parseInt(btn.dataset.gameIndex, 10)]
      if (game) openPhoneGameDetailPage(game)
    })
  })
}

function openPhoneGameDetailPage(game) {
  const page = createPhoneAppPage('phone-app-game-detail-page', game.name)
  const scroll = page.querySelector('.phone-app-scroll')

  const achievementsHtml = game.achievements.length ? `
    <div class="phone-app-section-title">成就</div>
    <div class="phone-app-list">
      ${game.achievements.map(a => `
        <div class="phone-app-row phone-app-row-static phone-achievement-row${a.unlocked ? '' : ' is-locked'}">
          <span class="phone-app-row-icon phone-achievement-icon"><i class="fa fa-${a.unlocked ? 'trophy' : 'lock'}"></i></span>
          <span class="phone-app-row-main">
            <span class="phone-app-row-title">${paEscHtml(a.title)}</span>
            <span class="phone-app-row-sub">${paEscHtml(a.desc || '')}${a.unlocked && a.time ? `｜${paEscHtml(a.time)}` : ''}</span>
          </span>
          ${a.unlocked ? '<i class="fa fa-check phone-achievement-check"></i>' : ''}
        </div>
      `).join('')}
    </div>` : ''

  const statsHtml = game.stats.length ? `
    <div class="phone-app-section-title">战绩数据</div>
    <div class="phone-game-stats">
      ${game.stats.map(s => `
        <div class="phone-game-stat-row">
          <span class="phone-game-stat-label">${paEscHtml(s.label)}</span>
          <span class="phone-game-stat-value">${paEscHtml(s.value)}</span>
        </div>
      `).join('')}
    </div>` : ''

  scroll.innerHTML = `
    <div class="phone-game-hero">
      ${buildPhoneGameIconHTML(game)}
      <div class="phone-game-hero-main">
        <div class="phone-game-hero-name">${paEscHtml(game.name)}</div>
        ${game.genre ? `<div class="phone-game-hero-genre">${paEscHtml(game.genre)}</div>` : ''}
      </div>
    </div>
    <div class="phone-game-hours">
      <div class="phone-game-hours-card">
        <div class="phone-game-hours-value">${formatPhoneGameHours(game.weeklyHours)}</div>
        <div class="phone-game-hours-label">本周</div>
      </div>
      <div class="phone-game-hours-card">
        <div class="phone-game-hours-value">${formatPhoneGameHours(game.totalHours)}</div>
        <div class="phone-game-hours-label">累计</div>
      </div>
      <div class="phone-game-hours-card">
        <div class="phone-game-hours-value phone-game-hours-last">${paEscHtml(game.lastPlayed || '—')}</div>
        <div class="phone-game-hours-label">最后游玩</div>
      </div>
    </div>
    ${achievementsHtml}
    ${statsHtml}
  `
  window.openPage(page)
}

// ===== 隐私空间页面 =====

function buildPhonePrivacyLogoHTML() {
  return `
    <div class="phone-ph-logo" aria-hidden="true">
      <span class="phone-ph-logo-text">隐私</span><span class="phone-ph-logo-block">空间</span>
    </div>`
}

function buildPhonePrivacyVideoCardHTML(video, index) {
  const src = phoneAppPlaceholderImg(video.desc || video.title, `ph_${index}`)
  return `
    <button class="phone-ph-card" type="button" data-video-index="${index}">
      <span class="phone-ph-thumb">
        <img src="${src}" alt="" loading="lazy">
        ${video.duration ? `<span class="phone-ph-duration">${paEscHtml(video.duration)}</span>` : ''}
        <span class="phone-ph-progress"><span style="width:${video.progress}%"></span></span>
      </span>
      <span class="phone-ph-card-main">
        <span class="phone-ph-card-title">${paEscHtml(video.title)}</span>
        <span class="phone-ph-card-channel">${paEscHtml(video.channel || '')}</span>
        <span class="phone-ph-card-meta">${paEscHtml(video.time || '')}${video.watchCount > 1 ? `｜看过 ${video.watchCount} 次` : ''}</span>
      </span>
    </button>`
}

async function openPhonePrivacyPage(context) {
  const snapshot = await getPhoneAppSnapshot('privacy', context.ownerUid, context.charId)
  const data = snapshot?.data
  const videos = data?.videos || []
  const searches = data?.searches || []
  const page = createPhoneAppPage('phone-app-privacy-page', '隐私空间')
  const scroll = page.querySelector('.phone-app-scroll')

  const videosHtml = videos.length
    ? `<div class="phone-ph-card-list">${videos.map(buildPhonePrivacyVideoCardHTML).join('')}</div>`
    : buildPhoneAppEmptyHTML('fa-regular fa-eye-slash', '暂无观看数据')

  const searchesHtml = searches.length
    ? `
      <div class="phone-app-list">
        ${searches.map(s => `
          <div class="phone-app-row phone-app-row-static">
            <span class="phone-app-row-icon"><i class="fa fa-clock-rotate-left"></i></span>
            <span class="phone-app-row-main">
              <span class="phone-app-row-title">${paEscHtml(s.query)}</span>
              <span class="phone-app-row-sub">${paEscHtml(s.time || '')}</span>
            </span>
          </div>
        `).join('')}
      </div>`
    : buildPhoneAppEmptyHTML('fa-regular fa-eye-slash', '暂无搜索记录')

  scroll.innerHTML = `
    ${buildPhonePrivacyLogoHTML()}
    <div class="phone-ph-tabs">
      <button class="phone-ph-tab is-active" type="button" data-ph-tab="videos">观看记录</button>
      <button class="phone-ph-tab" type="button" data-ph-tab="searches">搜索记录</button>
    </div>
    <div class="phone-ph-panel" data-ph-panel="videos">${videosHtml}</div>
    <div class="phone-ph-panel" data-ph-panel="searches" hidden>${searchesHtml}</div>
  `
  window.openPage(page)

  scroll.querySelectorAll('[data-ph-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      scroll.querySelectorAll('[data-ph-tab]').forEach(t => t.classList.toggle('is-active', t === tab))
      scroll.querySelectorAll('[data-ph-panel]').forEach(p => {
        p.hidden = p.dataset.phPanel !== tab.dataset.phTab
      })
    })
  })

  scroll.querySelectorAll('[data-video-index]').forEach(btn => {
    btn.addEventListener('click', () => {
      const video = videos[parseInt(btn.dataset.videoIndex, 10)]
      if (video) openPhonePrivacyDetailPage(video, parseInt(btn.dataset.videoIndex, 10))
    })
  })
}

function openPhonePrivacyDetailPage(video, index) {
  const page = createPhoneAppPage('phone-app-privacy-detail-page', '隐私空间')
  const scroll = page.querySelector('.phone-app-scroll')
  const src = phoneAppPlaceholderImg(video.desc || video.title, `ph_${index}`)
  const rows = [
    ['频道', video.channel],
    ['时长', video.duration],
    ['观看进度', `${video.progress}%`],
    ['观看次数', `${video.watchCount} 次`],
    ['最后观看', video.time]
  ].filter(r => r[1])
  scroll.innerHTML = `
    <div class="phone-ph-detail-thumb">
      <img src="${src}" alt="">
      ${video.duration ? `<span class="phone-ph-duration">${paEscHtml(video.duration)}</span>` : ''}
      <span class="phone-ph-progress"><span style="width:${video.progress}%"></span></span>
    </div>
    <div class="phone-ph-detail-title">${paEscHtml(video.title)}</div>
    ${video.desc ? `<div class="phone-ph-detail-desc">${paEscHtml(video.desc)}</div>` : ''}
    <div class="phone-game-stats">
      ${rows.map(r => `
        <div class="phone-game-stat-row">
          <span class="phone-game-stat-label">${paEscHtml(r[0])}</span>
          <span class="phone-game-stat-value">${paEscHtml(String(r[1]))}</span>
        </div>
      `).join('')}
    </div>
  `
  window.openPage(page)
}

// ===== Mail 页面 =====

const PHONE_MAIL_AVATAR_SHADES = ['#2e2e2e', '#535353', '#767676', '#9a9a9a']

function buildPhoneMailAvatarHTML(sender) {
  const initial = Array.from(String(sender || '?').trim())[0] || '?'
  const raw = String(sender || '?')
  let seed = 0
  for (let i = 0; i < raw.length; i++) seed = ((seed * 31) + raw.charCodeAt(i)) >>> 0
  const bg = PHONE_MAIL_AVATAR_SHADES[seed % PHONE_MAIL_AVATAR_SHADES.length]
  return `<span class="phone-mail-avatar" style="background:${bg}">${paEscHtml(initial)}</span>`
}

function phoneMailPreviewText(email) {
  const firstLine = String(email.body || '').split('\n').find(l => l.trim()) || ''
  return firstLine.trim().slice(0, 60)
}

async function openPhoneMailPage(context) {
  const snapshot = await getPhoneAppSnapshot('mail', context.ownerUid, context.charId)
  const emails = snapshot?.data?.emails || []
  const page = createPhoneAppPage('phone-app-mail-page', 'Mail')
  const scroll = page.querySelector('.phone-app-scroll')

  const searchbar = `
    <div class="phone-browser-searchbar" aria-hidden="true">
      <i class="fa fa-magnifying-glass"></i>
      <span>在邮件中搜索</span>
    </div>`

  if (!emails.length) {
    scroll.innerHTML = searchbar + buildPhoneAppEmptyHTML('fa-regular fa-envelope-open', '暂无邮件')
    window.openPage(page)
    return
  }

  scroll.innerHTML = `
    ${searchbar}
    <div class="phone-app-section-title">收件箱</div>
    <div class="phone-mail-list">
      ${emails.map((email, i) => `
        <button class="phone-mail-row${email.unread ? ' is-unread' : ''}" type="button" data-mail-index="${i}">
          ${buildPhoneMailAvatarHTML(email.sender)}
          <span class="phone-mail-row-main">
            <span class="phone-mail-row-top">
              <span class="phone-mail-sender">${paEscHtml(email.sender || email.address || '(未知发件人)')}</span>
              <span class="phone-mail-time">${paEscHtml(email.time || '')}</span>
            </span>
            <span class="phone-mail-subject">${paEscHtml(email.subject || '(无主题)')}${email.spam ? '<span class="phone-mail-spam-tag">垃圾邮件</span>' : ''}</span>
            <span class="phone-mail-preview">${paEscHtml(phoneMailPreviewText(email))}</span>
          </span>
        </button>
      `).join('')}
    </div>
  `
  window.openPage(page)

  scroll.querySelectorAll('[data-mail-index]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const email = emails[parseInt(btn.dataset.mailIndex, 10)]
      if (!email) return
      if (email.unread) {
        email.unread = false
        btn.classList.remove('is-unread')
        snapshot.updatedAt = Date.now()
        try { await savePhoneAppSnapshot('mail', context.ownerUid, context.charId, snapshot) } catch (e) { console.warn('mail snapshot save failed', e) }
      }
      openPhoneMailDetailPage(email)
    })
  })
}

function openPhoneMailDetailPage(email) {
  const page = createPhoneAppPage('phone-app-mail-detail-page', 'Mail')
  const scroll = page.querySelector('.phone-app-scroll')
  const attachmentsHtml = email.attachments.length ? `
    <div class="phone-mail-attachments">
      ${email.attachments.map(a => `
        <span class="phone-mail-attachment">
          <i class="fa fa-paperclip"></i>${paEscHtml(a.name)}${a.size ? `<span class="phone-mail-attachment-size">${paEscHtml(a.size)}</span>` : ''}
        </span>
      `).join('')}
    </div>` : ''
  scroll.innerHTML = `
    <div class="phone-mail-detail-subject">${paEscHtml(email.subject || '(无主题)')}${email.spam ? '<span class="phone-mail-spam-tag">垃圾邮件</span>' : ''}</div>
    <div class="phone-mail-detail-sender">
      ${buildPhoneMailAvatarHTML(email.sender)}
      <span class="phone-mail-detail-sender-main">
        <span class="phone-mail-detail-sender-name">${paEscHtml(email.sender || '(未知发件人)')}</span>
        <span class="phone-mail-detail-sender-address">${paEscHtml(email.address || '')}</span>
      </span>
      <span class="phone-mail-detail-time">${paEscHtml(email.time || '')}</span>
    </div>
    <div class="phone-mail-detail-body">${paEscHtml(email.body || '')}</div>
    ${attachmentsHtml}
  `
  window.openPage(page)
}

// ===== 主屏入口分发 =====

const PHONE_GEN_APP_OPENERS = {
  browser: openPhoneBrowserPage,
  notes: openPhoneNotesPage,
  photos: openPhonePhotosPage,
  'game-center': openPhoneGameCenterPage,
  privacy: openPhonePrivacyPage,
  mail: openPhoneMailPage
}

async function openPhoneAppPage(appId, context) {
  const opener = PHONE_GEN_APP_OPENERS[appId]
  if (!opener || !context?.ownerUid || !context?.charId) return
  await opener(context)
}

window.openPhoneAppPage = openPhoneAppPage
