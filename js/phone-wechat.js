// phone-wechat.js — 查看记录「查手机」微信内容生成
// 职责：Edit Phone / Clean Phone 触发面板、API prompt 构建与调用、
// 快照持久化与增量合并、生成数据在角色手机微信里的渲染辅助。
// 设计文档：prompt-local/api-system-user-prompt-npc-npc-npc-api-linear-nygaard.md

function pwEscHtml(str) {
  if (window._wechatCallHelpers?.wcEscHtml) return window._wechatCallHelpers.wcEscHtml(str)
  return String(str ?? '').replace(/[&<>"']/g, s => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[s]))
}

function pwInitialAvatarHTML(name) {
  if (window._wechatCallHelpers?.buildWechatInitialAvatarHTML) {
    return window._wechatCallHelpers.buildWechatInitialAvatarHTML(name)
  }
  const text = String(name || '?').trim()
  return `<span>${pwEscHtml(text ? Array.from(text)[0] : '?')}</span>`
}

// ===== 快照持久化 =====

function getPhoneWechatSnapshotKey(ownerUid, charId) {
  return `phoneWechatSnapshot_${ownerUid}_${charId}`
}

async function getPhoneWechatSnapshot(ownerUid, charId) {
  if (!window.db || !ownerUid || !charId) return null
  const row = await db.config.get(getPhoneWechatSnapshotKey(ownerUid, charId))
  const value = row?.value
  if (!value || typeof value !== 'object' || !value.data) return null
  return value
}

async function savePhoneWechatSnapshot(ownerUid, charId, snapshot) {
  await db.config.put({
    key: getPhoneWechatSnapshotKey(ownerUid, charId),
    value: snapshot
  })
}

async function clearPhoneWechatSnapshot(ownerUid, charId) {
  await db.config.delete(getPhoneWechatSnapshotKey(ownerUid, charId))
}

window.getPhoneWechatSnapshot = getPhoneWechatSnapshot
window.clearPhoneWechatSnapshot = clearPhoneWechatSnapshot

// ===== 相对时间解析（生成内容里的「昨天 22:14 / 3天前 / 周二 09:30 / 6月28日」→ 时间戳，用于排序） =====

const PW_WEEKDAY_MAP = { '日': 0, '天': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6 }

function parsePhoneRelativeTime(text, now = Date.now()) {
  const raw = String(text || '').trim()
  if (!raw) return null
  const base = new Date(now)
  const clock = raw.match(/(\d{1,2}):(\d{2})/)
  const setClock = d => {
    if (clock) d.setHours(parseInt(clock[1], 10), parseInt(clock[2], 10), 0, 0)
    return d.getTime()
  }
  let m
  if (/刚刚/.test(raw)) return now
  m = raw.match(/(\d+)\s*分钟前/)
  if (m) return now - parseInt(m[1], 10) * 60000
  m = raw.match(/(\d+)\s*小时前/)
  if (m) return now - parseInt(m[1], 10) * 3600000
  m = raw.match(/(\d+)\s*天前/)
  if (m) {
    const d = new Date(now - parseInt(m[1], 10) * 86400000)
    return setClock(d)
  }
  m = raw.match(/(\d+)\s*周前|(\d+)\s*星期前/)
  if (m) return now - parseInt(m[1] || m[2], 10) * 7 * 86400000
  m = raw.match(/(\d+)\s*个?月前/)
  if (m) return now - parseInt(m[1], 10) * 30 * 86400000
  m = raw.match(/(\d+)\s*年前/)
  if (m) return now - parseInt(m[1], 10) * 365 * 86400000
  if (/上个?月/.test(raw)) return now - 30 * 86400000
  if (/上上周|上上星期/.test(raw)) return now - 14 * 86400000
  m = raw.match(/上(?:周|星期)([日天一二三四五六])?/)
  if (m) {
    const target = m[1] != null ? PW_WEEKDAY_MAP[m[1]] : base.getDay()
    const diff = ((base.getDay() - target + 7) % 7) + 7
    return setClock(new Date(now - diff * 86400000))
  }
  if (/前天/.test(raw)) return setClock(new Date(now - 2 * 86400000))
  if (/昨天|昨晚/.test(raw)) return setClock(new Date(now - 86400000))
  if (/今天|今晚|今早/.test(raw)) return setClock(new Date(now))
  m = raw.match(/(?:周|星期)([日天一二三四五六])/)
  if (m) {
    const target = PW_WEEKDAY_MAP[m[1]]
    let diff = (base.getDay() - target + 7) % 7
    if (diff === 0) diff = 7
    return setClock(new Date(now - diff * 86400000))
  }
  m = raw.match(/(\d{1,2})月(\d{1,2})日/)
  if (m) {
    const d = new Date(base.getFullYear(), parseInt(m[1], 10) - 1, parseInt(m[2], 10))
    const ts = setClock(d)
    return ts > now ? ts - 365 * 86400000 : ts
  }
  if (clock) return setClock(new Date(now))
  return null
}

// 为快照内容补 _ts（排序用），保持原相对时间文本用于展示
function stampPhoneSnapshotTimes(data, now = Date.now()) {
  ;(data.chats || []).forEach(chat => {
    let cursor = null
    ;(chat.messages || []).forEach((msg, index) => {
      const parsed = parsePhoneRelativeTime(msg.time, now)
      if (parsed != null) cursor = parsed
      else if (cursor != null) cursor += 30000
      msg._ts = cursor != null ? cursor : now - 86400000 + index * 60000
    })
  })
  ;(data.moments || []).forEach((moment, index) => {
    const parsed = parsePhoneRelativeTime(moment.time, now)
    moment._ts = parsed != null ? parsed : now - index * 3600000
  })
}

// ===== 温度与 JSON 解析 =====

async function getPhoneSnapshotTemperature() {
  try {
    if (window.getAITemperaturePreset) return await window.getAITemperaturePreset('phoneSnapshot')
  } catch (_) {}
  return 0.5
}

function extractPhoneSnapshotJson(text) {
  const raw = String(text || '').trim()
  if (!raw) return null
  try { return JSON.parse(raw) } catch (_) {}
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()) } catch (_) {}
  }
  const braced = raw.match(/\{[\s\S]*\}/)
  if (braced) {
    try { return JSON.parse(braced[0]) } catch (_) {}
  }
  return null
}

// ===== 快照数据清洗 =====

function sanitizePhoneSnapshotData(rawData, userName) {
  if (!rawData || typeof rawData !== 'object') return null
  const cleanName = value => String(value || '').trim()
  const forbidden = cleanName(userName)
  const friends = (Array.isArray(rawData.friends) ? rawData.friends : [])
    .map(f => ({
      npcId: Number.isFinite(parseInt(f?.npcId, 10)) ? parseInt(f.npcId, 10) : null,
      name: cleanName(f?.name),
      remark: cleanName(f?.remark) || cleanName(f?.name),
      gender: cleanName(f?.gender) || '未知',
      relation: cleanName(f?.relation)
    }))
    .filter(f => f.name && (!forbidden || f.name !== forbidden))
  const chats = (Array.isArray(rawData.chats) ? rawData.chats : [])
    .map(chat => ({
      friendName: cleanName(chat?.friendName),
      messages: (Array.isArray(chat?.messages) ? chat.messages : [])
        .map(msg => {
          const type = ['text', 'image', 'voice', 'transfer'].includes(msg?.type) ? msg.type : 'text'
          const amount = parseFloat(msg?.amount)
          return {
            sender: msg?.sender === 'me' ? 'me' : 'friend',
            type,
            content: String(msg?.content ?? '').trim(),
            amount: type === 'transfer' && Number.isFinite(amount) ? Math.round(amount * 100) / 100 : undefined,
            time: cleanName(msg?.time)
          }
        })
        .filter(msg => msg.content || msg.type === 'transfer')
    }))
    .filter(chat => chat.friendName && chat.messages.length && (!forbidden || chat.friendName !== forbidden))
  const moments = (Array.isArray(rawData.moments) ? rawData.moments : [])
    .map(moment => ({
      author: cleanName(moment?.author) || 'me',
      time: cleanName(moment?.time),
      text: String(moment?.text ?? '').trim(),
      imagesDesc: (Array.isArray(moment?.imagesDesc) ? moment.imagesDesc : [])
        .map(desc => String(desc || '').trim()).filter(Boolean),
      likes: (Array.isArray(moment?.likes) ? moment.likes : [])
        .map(name => cleanName(name)).filter(Boolean),
      comments: (Array.isArray(moment?.comments) ? moment.comments : [])
        .map(comment => ({
          from: cleanName(comment?.from),
          to: cleanName(comment?.to) || null,
          text: String(comment?.text ?? '').trim()
        }))
        .filter(comment => comment.from && comment.text)
    }))
    .filter(moment => moment.text || moment.imagesDesc.length)
  const walletRaw = rawData.wallet && typeof rawData.wallet === 'object' ? rawData.wallet : {}
  const toBalance = value => {
    const parsed = parseFloat(value)
    return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : null
  }
  const wallet = {
    balance: toBalance(walletRaw.balance),
    checkingBalance: toBalance(walletRaw.checkingBalance),
    savingBalance: toBalance(walletRaw.savingBalance)
  }
  return { friends, chats, moments, wallet }
}

// ===== System / User Prompt 构建 =====

function buildPhoneSnapshotSystemPrompt(char, user) {
  const charName = char?.nick || char?.name || '角色'
  const userName = user?.nick || user?.name || '用户'
  return window.WanWanPrompts.render("phone-wechat.buildPhoneSnapshotSystemPrompt.9be513b6f", [charName, charName, userName, userName, userName])
}

function formatPhoneSnapshotCurrentTime(now = new Date()) {
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const pad = n => String(n).padStart(2, '0')
  return `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${weekdays[now.getDay()]} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

function buildPhoneSnapshotRelationText(char, ownerUid) {
  const rel = (char?.relations || []).find(r => parseInt(r.charId, 10) === parseInt(ownerUid, 10))
  if (!rel || !rel.type) return '(未设定)'
  return rel.type + (rel.desc ? `（${rel.desc}）` : '')
}

async function loadPhoneSnapshotRelatedNpcs(char, ownerUid) {
  const relations = (char?.relations || []).filter(rel => {
    const relCharId = parseInt(rel.charId, 10)
    return Number.isFinite(relCharId) && relCharId !== parseInt(ownerUid, 10)
  })
  const npcs = []
  for (const rel of relations) {
    const target = window.getCharacter
      ? await window.getCharacter(rel.charId)
      : await db.characters.get(parseInt(rel.charId, 10))
    if (!target) continue
    npcs.push({ npc: target, rel })
  }
  return npcs
}

function buildPhoneSnapshotNpcBlock(npcs) {
  if (!npcs.length) return '(无。请按规则虚构 3-5 个符合角色生活圈的好友。)'
  return npcs.map(({ npc, rel }) => {
    const desc = String(npc.description || '(未设定)').slice(0, 600)
    return `- 名字：${npc.nick || npc.name}｜性别：${npc.gender || '未知'}｜关系：${rel.type || '未设定'}｜id：${npc.id}
  人设：${desc}
  关系细节：${rel.desc || '无'}`
  }).join('\n')
}

// 真实聊天记录 → prompt 文本（转账/红包类带金额标注）
function formatPhoneSnapshotRealMessage(msg, charName, userName) {
  const content = String(msg.content || '').trim()
  if (!content) return ''
  const who = msg.role === 'user' ? userName : charName
  const d = new Date(msg.createdAt || Date.now())
  const pad = n => String(n).padStart(2, '0')
  const time = `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`
  let text = content
  let m = content.match(/^\[.+的转账：(.+?)元；备注：(.+)\]$/)
  if (m) {
    text = `[转账 ¥${m[1]}${m[2] && m[2] !== '无备注' ? ` 附言：${m[2]}` : ''}]`
  } else if (content.startsWith('__REDPACKET__')) {
    let packet = null
    try { packet = JSON.parse(content.slice(13)) } catch (_) {}
    text = `[红包${packet?.amount ? ` ¥${packet.amount}` : ''}${packet?.note ? ` ${packet.note}` : ''}]`
  } else if (content.startsWith('__IMG__')) {
    text = '[图片]'
  } else if (content.startsWith('__')) {
    return ''
  } else {
    let sm = content.match(/^\[.+的语音：(.+)\]$/)
    if (sm) text = `[语音：${sm[1]}]`
    sm = content.match(/^\[.+发来的照片：(.+)\]$/)
    if (sm) text = `[照片：${sm[1]}]`
  }
  if (text.length > 200) text = text.slice(0, 200) + '…'
  return `[${time}] ${who}: ${text}`
}

async function buildPhoneSnapshotRecentMessagesBlock(ownerUid, charId, charName, userName) {
  const chat = await db.chats.where('[ownerUid+charId]').equals([ownerUid, charId]).first()
  if (!chat) return { text: '(无聊天记录)', loreMessages: [] }
  const all = await db.messages.where('chatId').equals(chat.id).sortBy('createdAt')
  const recent = all.slice(-60)
  const lines = recent
    .map(msg => formatPhoneSnapshotRealMessage(msg, charName, userName))
    .filter(Boolean)
  const loreMessages = recent.map(msg => ({ role: msg.role, content: String(msg.content || '') }))
  return { text: lines.length ? lines.join('\n') : '(无聊天记录)', loreMessages }
}

// 已有快照 → 增量注入块
function buildPhoneSnapshotExistingBlock(data) {
  const lines = []
  lines.push('· 好友名单（全量）：')
  ;(data.friends || []).forEach(f => {
    lines.push(`  - ${f.name}（备注：${f.remark || f.name}｜关系：${f.relation || '未设定'}｜npcId：${f.npcId ?? 'null'}）`)
  })
  lines.push('· 各会话最近消息：')
  ;(data.chats || []).forEach(chat => {
    lines.push(`  【与 ${chat.friendName} 的会话】`)
    ;(chat.messages || []).slice(-8).forEach(msg => {
      const who = msg.sender === 'me' ? '角色' : chat.friendName
      const body = msg.type === 'transfer'
        ? `[转账 ¥${msg.amount ?? ''}${msg.content ? ` 附言：${msg.content}` : ''}]`
        : (msg.type === 'image' ? `[图片：${msg.content}]` : msg.type === 'voice' ? `[语音：${msg.content}]` : msg.content)
      lines.push(`    [${msg.time || '时间未知'}] ${who}: ${String(body).slice(0, 120)}`)
    })
  })
  lines.push('· 已有朋友圈：')
  ;(data.moments || []).forEach(moment => {
    const author = moment.author === 'me' ? '角色本人' : moment.author
    lines.push(`  - [${moment.time || '时间未知'}] ${author}：${String(moment.text || '(图片动态)').slice(0, 80)}`)
  })
  const wallet = data.wallet || {}
  lines.push(`· 钱包余额：零钱 ${wallet.balance ?? '未知'}｜Checking ${wallet.checkingBalance ?? '未知'}｜Saving ${wallet.savingBalance ?? '未知'}`)
  lines.push(window.WanWanPrompts.render("phone-wechat.补充规则.2b7bdb51d", []))
  return lines.join('\n')
}

async function buildPhoneSnapshotUserPrompt(char, user, npcs, loreCtx, recentMessagesText, existingData) {
  const charName = char?.name || '角色'
  const nickPart = char?.nick && char.nick !== char.name ? `（昵称：${char.nick}）` : ''
  const existingBlock = existingData
    ? buildPhoneSnapshotExistingBlock(existingData)
    : window.WanWanPrompts.render("phone-wechat.buildPhoneSnapshotUserPrompt.4d379d73d", [])
  return window.WanWanPrompts.render("phone-wechat.buildPhoneSnapshotUserPrompt.2b0e6c5cd", [formatPhoneSnapshotCurrentTime(), charName, nickPart, char?.gender || '未知', char?.role || '(未设定)', char?.description || '(未设定)', char?.identity?.account || '(未设定)', user?.nick || user?.name || '用户', user?.gender ? `性别：${user.gender}` : '', user?.role ? `身份：${user.role}` : '', user?.description || '(未设定)', buildPhoneSnapshotRelationText(char, user?.id), buildPhoneSnapshotNpcBlock(npcs), loreCtx || '(无)', existingBlock, recentMessagesText])
}

window.buildPhoneSnapshotSystemPrompt = buildPhoneSnapshotSystemPrompt
window.buildPhoneSnapshotUserPrompt = buildPhoneSnapshotUserPrompt

// ===== 钱包卡号：完全系统侧处理（identity.bankCard 有则提取，无则生成并回填） =====

async function ensurePhoneSnapshotWalletCards(char, wallet, existingWallet) {
  if (existingWallet?.savingCardNumber) wallet.savingCardNumber = existingWallet.savingCardNumber
  if (existingWallet?.checkingCardNumber) wallet.checkingCardNumber = existingWallet.checkingCardNumber
  if (!wallet.savingCardNumber) {
    let bankCard = char?.identity?.bankCard || ''
    if (!bankCard && typeof genBankCard === 'function') {
      bankCard = genBankCard()
      const updatedIdentity = { ...(char.identity || {}), bankCard }
      await db.characters.update(char.id, { identity: updatedIdentity })
      char.identity = updatedIdentity
    }
    wallet.savingCardNumber = bankCard
  }
  if (!wallet.checkingCardNumber && typeof genBankCard === 'function') {
    wallet.checkingCardNumber = genBankCard()
  }
  return wallet
}

// ===== 增量合并 =====

function mergePhoneSnapshotData(existing, delta) {
  const merged = {
    friends: [...(existing.friends || [])],
    chats: (existing.chats || []).map(chat => ({ ...chat, messages: [...(chat.messages || [])] })),
    moments: [...(existing.moments || [])],
    wallet: { ...(existing.wallet || {}) }
  }
  const knownNames = new Set(merged.friends.map(f => f.name))
  ;(delta.friends || []).forEach(friend => {
    if (!knownNames.has(friend.name)) {
      merged.friends.push(friend)
      knownNames.add(friend.name)
    }
  })
  ;(delta.chats || []).forEach(chat => {
    const target = merged.chats.find(c => c.friendName === chat.friendName)
    if (target) target.messages.push(...chat.messages)
    else merged.chats.push(chat)
  })
  merged.moments.push(...(delta.moments || []))
  merged.moments.sort((a, b) => (b._ts || 0) - (a._ts || 0))
  const walletDelta = delta.wallet || {}
  ;['balance', 'checkingBalance', 'savingBalance'].forEach(key => {
    if (walletDelta[key] != null) merged.wallet[key] = walletDelta[key]
  })
  return merged
}

// ===== 生成主流程 =====

async function generatePhoneWechatSnapshot(ownerUid, charId) {
  if (typeof window.callAI !== 'function') throw new Error('请先在设置里配置 API')
  const char = await db.characters.get(charId)
  if (!char) throw new Error('角色不存在')
  const user = await db.characters.get(ownerUid)
  if (!user) throw new Error('微信账号不存在')
  const charName = char.nick || char.name || '角色'
  const userName = user.nick || user.name || '用户'

  const existing = await getPhoneWechatSnapshot(ownerUid, charId)
  const existingData = existing?.data || null

  const npcs = await loadPhoneSnapshotRelatedNpcs(char, ownerUid)
  const recentBlock = await buildPhoneSnapshotRecentMessagesBlock(ownerUid, charId, charName, userName)
  const loreCtx = window.getLorebookContext
    ? await window.getLorebookContext(charId, recentBlock.loreMessages)
    : ''

  const system = buildPhoneSnapshotSystemPrompt(char, user)
  const userPrompt = await buildPhoneSnapshotUserPrompt(char, user, npcs, loreCtx, recentBlock.text, existingData)
  const raw = await window.callAI([{ role: 'user', content: userPrompt }], window.WanWanPrompts.options("phone-wechat.generatePhoneWechatSnapshot", ({
    system,
    responseFormat: 'json_object',
    temperature: await getPhoneSnapshotTemperature()
  })))
  const parsed = extractPhoneSnapshotJson(raw)
  if (!parsed) throw new Error('AI 返回格式异常，请重试')
  const cleaned = sanitizePhoneSnapshotData(parsed, userName)
  if (!cleaned) throw new Error('AI 返回格式异常，请重试')
  if (!existingData && !cleaned.friends.length) throw new Error('生成结果为空，请重试')

  const now = Date.now()
  stampPhoneSnapshotTimes(cleaned, now)

  let data
  if (existingData) {
    data = mergePhoneSnapshotData(existingData, cleaned)
  } else {
    cleaned.moments.sort((a, b) => (b._ts || 0) - (a._ts || 0))
    data = cleaned
  }
  data.wallet = await ensurePhoneSnapshotWalletCards(char, data.wallet || {}, existingData?.wallet)

  const snapshot = {
    version: 1,
    generatedAt: existing?.generatedAt || now,
    updatedAt: now,
    data
  }
  await savePhoneWechatSnapshot(ownerUid, charId, snapshot)
  return snapshot
}

window.generatePhoneWechatSnapshot = generatePhoneWechatSnapshot

// ===== 钱包账单的系统提取（不由 API 生成；供后续微信支付页使用） =====

async function extractPhoneWalletBills(ownerUid, charId) {
  const bills = []
  const chat = await db.chats.where('[ownerUid+charId]').equals([ownerUid, charId]).first()
  if (chat) {
    const messages = await db.messages.where('chatId').equals(chat.id).sortBy('createdAt')
    messages.forEach(msg => {
      const content = String(msg.content || '')
      const m = content.match(/^\[.+的转账：(.+?)元；备注：(.+)\]$/)
      if (!m) return
      const amount = parseFloat(m[1])
      if (!Number.isFinite(amount)) return
      bills.push({
        source: 'user_chat',
        // 角色视角：用户发的转账是收入，角色发的是支出
        direction: msg.role === 'user' ? 'income' : 'expense',
        amount,
        note: m[2] === '无备注' ? '' : m[2],
        time: msg.createdAt || 0
      })
    })
  }
  const snapshot = await getPhoneWechatSnapshot(ownerUid, charId)
  ;(snapshot?.data?.chats || []).forEach(chatItem => {
    ;(chatItem.messages || []).forEach(msg => {
      if (msg.type !== 'transfer' || !Number.isFinite(parseFloat(msg.amount))) return
      bills.push({
        source: 'npc_chat',
        direction: msg.sender === 'me' ? 'expense' : 'income',
        amount: parseFloat(msg.amount),
        note: msg.content || '',
        counterpart: chatItem.friendName,
        time: msg._ts || 0
      })
    })
  })
  bills.sort((a, b) => b.time - a.time)
  return bills
}

window.extractPhoneWalletBills = extractPhoneWalletBills

// ===== 角色手机：微信支付页（数据源 = 快照 wallet + 系统提取账单，只读） =====

function formatPhoneWalletAmount(num) {
  return Number(num || 0).toFixed(2).replace(/\B(?=(\d{3})+\.)/g, ',')
}

function formatPhoneWalletBillDate(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function buildPhoneWalletBillRowsHTML(bills, userName) {
  if (!bills.length) return '<div class="wallet-bills-empty">暂无账单</div>'
  return bills.map(bill => {
    const isIncome = bill.direction === 'income'
    const sign = isIncome ? '+' : '-'
    const amountClass = isIncome ? 'income' : 'expense'
    const icon = isIncome ? 'fa-arrow-down' : 'fa-arrow-up'
    const counterpart = bill.source === 'user_chat' ? userName : (bill.counterpart || '好友')
    const desc = `与${counterpart}的转账${bill.note ? `：${bill.note}` : ''}`
    return `
      <div class="wallet-bill-item">
        <div class="wallet-bill-inner">
          <div class="wallet-bill-icon ${amountClass}"><i class="fa ${icon}"></i></div>
          <div class="wallet-bill-main">
            <div class="wallet-bill-desc">${pwEscHtml(desc)}</div>
            <div class="wallet-bill-date">${pwEscHtml(formatPhoneWalletBillDate(bill.time))}</div>
          </div>
          <div class="wallet-bill-amount ${amountClass}">${sign}¥${formatPhoneWalletAmount(bill.amount)}</div>
        </div>
      </div>
    `
  }).join('')
}

async function openRolePhoneWalletPage(session) {
  if (!session?.ownerUid || !session?.charId) return
  const snapshot = await getPhoneWechatSnapshot(session.ownerUid, session.charId)
  const wallet = snapshot?.data?.wallet
  if (!wallet || wallet.balance == null) {
    window.toast?.('暂无钱包数据，请先在查看记录中 Edit Phone 生成微信内容')
    return
  }
  const char = await db.characters.get(session.charId)
  const user = await db.characters.get(session.ownerUid)
  const userName = user?.nick || user?.name || '用户'
  const bills = await extractPhoneWalletBills(session.ownerUid, session.charId)

  document.getElementById('phone-snapshot-wallet-page')?.remove()
  const page = document.createElement('div')
  page.id = 'phone-snapshot-wallet-page'
  page.className = 'full-page wechat-wallet-page wechat-role-phone-page'
  page.dataset.wechatRolePhone = '1'

  const savingLast4 = wallet.savingCardNumber ? wallet.savingCardNumber.slice(-4) : '****'
  const checkingLast4 = wallet.checkingCardNumber ? wallet.checkingCardNumber.slice(-4) : '****'

  page.innerHTML = `
    <div class="page-header">
      <button class="header-back" id="btn-phone-wallet-back"><i class="fa fa-angle-left"></i></button>
      <span class="header-title">微信支付</span>
      <span style="width:40px;flex-shrink:0"></span>
    </div>
    <div class="wallet-scroll">
      <div class="wallet-balance-card">
        <div class="wallet-balance-label"><i class="fa-solid fa-piggy-bank"></i> 零钱</div>
        <div class="wallet-balance-amount"><span class="wallet-currency">¥</span>${formatPhoneWalletAmount(wallet.balance)}</div>
      </div>

      <div class="wallet-section-title">银行卡</div>
      <div class="wallet-cards-list">
        <button class="wallet-card-row" id="btn-phone-saving-card" type="button">
          <div class="wallet-card-icon saving"><i class="fa-solid fa-coins"></i></div>
          <div class="wallet-card-info">
            <div class="wallet-card-name">弯弯银行 <span class="wallet-card-type-tag saving">Saving</span></div>
            <div class="wallet-card-number">**** **** ${savingLast4}</div>
          </div>
          <i class="fa fa-angle-right wallet-card-arrow"></i>
        </button>
        <button class="wallet-card-row" id="btn-phone-checking-card" type="button">
          <div class="wallet-card-icon checking"><i class="fa-solid fa-money-bill"></i></div>
          <div class="wallet-card-info">
            <div class="wallet-card-name">弯弯银行 <span class="wallet-card-type-tag checking">Checking</span></div>
            <div class="wallet-card-number">**** **** ${checkingLast4}</div>
          </div>
          <i class="fa fa-angle-right wallet-card-arrow"></i>
        </button>
      </div>

      <div class="wallet-section-title">零钱账单</div>
      <div class="wallet-bills-list">
        ${buildPhoneWalletBillRowsHTML(bills, userName)}
      </div>
    </div>
  `
  window.openPage(page)
  page.querySelector('#btn-phone-wallet-back').addEventListener('click', () => window.closePage('phone-snapshot-wallet-page'))
  page.querySelector('#btn-phone-saving-card').addEventListener('click', () => openRolePhoneBankDetailPage('saving', wallet, char))
  page.querySelector('#btn-phone-checking-card').addEventListener('click', () => openRolePhoneBankDetailPage('checking', wallet, char))
}

function openRolePhoneBankDetailPage(type, wallet, char) {
  const isSaving = type === 'saving'
  const cardNumber = isSaving ? (wallet.savingCardNumber || '') : (wallet.checkingCardNumber || '')
  const balance = isSaving ? wallet.savingBalance : wallet.checkingBalance
  const typeName = isSaving ? 'Saving Account' : 'Checking Account'
  const typeLabel = isSaving ? 'SAVING' : 'CHECKING'
  const cardIcon = isSaving ? 'fa-solid fa-coins' : 'fa-solid fa-money-bill'
  const formattedCardNum = cardNumber
    ? '•••• •••• •••• ' + cardNumber.slice(-4)
    : '•••• •••• •••• ****'
  const fullCardDisplay = cardNumber
    ? cardNumber.replace(/(\d{4})(?=\d)/g, '$1 ')
    : '尚未生成'
  const holderName = String(char?.name || '未命名').toUpperCase()

  document.getElementById('phone-snapshot-bank-detail-page')?.remove()
  const page = document.createElement('div')
  page.id = 'phone-snapshot-bank-detail-page'
  page.className = 'full-page wechat-bank-detail-page wechat-role-phone-page'
  page.dataset.wechatRolePhone = '1'
  page.innerHTML = `
    <div class="page-header">
      <button class="header-back" id="btn-phone-bank-back"><i class="fa fa-angle-left"></i></button>
      <span class="header-title">${typeName}</span>
      <span style="width:40px;flex-shrink:0"></span>
    </div>
    <div class="bank-detail-scroll">
      <div class="bank-card-visual ${type}">
        <div class="bank-card-top">
          <div class="bank-card-bank-name"><i class="${cardIcon}"></i> WanWan Bank</div>
          <div class="bank-card-type-badge">${typeLabel}</div>
        </div>
        <div class="bank-card-chip"></div>
        <div class="bank-card-number">${formattedCardNum}</div>
        <div class="bank-card-bottom">
          <div class="bank-card-holder">${pwEscHtml(holderName)}</div>
          <div class="bank-card-brand">UNIONPAY</div>
        </div>
      </div>

      <div class="bank-detail-balance-card">
        <div class="bank-detail-balance-label">账户余额</div>
        <div class="bank-detail-balance-value"><span class="bank-currency">¥</span>${formatPhoneWalletAmount(balance)}</div>
      </div>

      <div class="bank-detail-info">
        <div class="bank-info-row">
          <span class="bank-info-label">银行名称</span>
          <span class="bank-info-value">弯弯银行</span>
        </div>
        <div class="bank-info-row">
          <span class="bank-info-label">账户类型</span>
          <span class="bank-info-value">${typeName}</span>
        </div>
        <div class="bank-info-row">
          <span class="bank-info-label">卡号</span>
          <span class="bank-info-value">${fullCardDisplay}</span>
        </div>
      </div>
    </div>
  `
  window.openPage(page)
  page.querySelector('#btn-phone-bank-back').addEventListener('click', () => window.closePage('phone-snapshot-bank-detail-page'))
}

window.openRolePhoneWalletPage = openRolePhoneWalletPage

// ===== 通讯录「添加至角色档案」（本期仅入口占位） =====

function buildNpcFromPhoneFriendPrompt(friend, snapshot, char) {
  // 预留：后续单独设计生成角色基本信息的 prompt
  return ''
}

window.buildNpcFromPhoneFriendPrompt = buildNpcFromPhoneFriendPrompt

async function addPhoneSnapshotFriendToCharacters(ownerUid, charId, friendName) {
  window.toast?.('即将上线')
}

window.addPhoneSnapshotFriendToCharacters = addPhoneSnapshotFriendToCharacters

// ===== 渲染辅助：会话列表注入 =====

async function getPhoneSnapshotChatItems(session) {
  if (!session?.ownerUid || !session?.charId) return []
  const snapshot = await getPhoneWechatSnapshot(session.ownerUid, session.charId)
  if (!snapshot?.data?.chats?.length) return []
  return snapshot.data.chats.map(chat => {
    const last = chat.messages[chat.messages.length - 1] || {}
    const friend = (snapshot.data.friends || []).find(f => f.name === chat.friendName)
    const preview = last.type === 'transfer'
      ? '[转账]'
      : last.type === 'image' ? '[图片]' : last.type === 'voice' ? '[语音]' : (last.content || '')
    return {
      type: 'phone-npc',
      id: encodeURIComponent(chat.friendName),
      charId: '',
      name: friend?.remark || chat.friendName,
      avatar: '',
      lastMsg: pwEscHtml(String(preview).slice(0, 30)),
      time: last._ts || snapshot.updatedAt || 0,
      unread: 0,
      itemKey: `phone-npc:${chat.friendName}`,
      groupName: '',
      pinned: false,
      pinnedAt: 0,
      phoneSnapshot: true
    }
  })
}

window.getPhoneSnapshotChatItems = getPhoneSnapshotChatItems

// ===== 渲染辅助：只读聊天窗口 =====

function buildPhoneSnapshotBubbleHTML(msg, cls) {
  if (msg.type === 'voice') {
    const compactLen = String(msg.content || '').replace(/\s/g, '').length
    const duration = Math.min(60, Math.max(1, Math.ceil(compactLen / 4)))
    const width = Math.min(220, 82 + Math.max(0, duration - 4) * 3)
    return `
      <div class="voice-message voice-${cls}">
        <div class="msg-bubble voice-bubble bubble-${cls}" style="--voice-width:${width}px" onclick="window.togglePhoneSnapshotVoice(this)">
          <div class="voice-main"><span class="voice-duration">${duration}"</span></div>
        </div>
        <div class="voice-transcript-bubble" style="display:none">${pwEscHtml(msg.content || '')}</div>
      </div>`
  }
  if (msg.type === 'image') {
    const raw = String(msg.content || '')
    let seed = 0
    for (let i = 0; i < raw.length; i++) seed = ((seed * 31) + raw.charCodeAt(i)) >>> 0
    const src = `img/blank_img${(seed % 6) + 1}.jpg`
    return `
      <div class="msg-card photo-card card-${cls}" title="${pwEscHtml(raw)}">
        <img src="${src}" class="photo-thumb" alt="${pwEscHtml(raw || '图片')}" loading="lazy">
      </div>`
  }
  if (msg.type === 'transfer') {
    const note = String(msg.content || '').trim() || '转账'
    return `
      <div class="msg-card transfer-card card-${cls}" data-status="accepted">
        <div class="transfer-body">
          <div class="transfer-title status-accepted">Transfer</div>
          <div class="transfer-amount">¥ ${pwEscHtml(msg.amount ?? '')}</div>
          <div class="transfer-note">${pwEscHtml(note)}</div>
          <i class="fi fi-brands-visa transfer-visa"></i>
        </div>
      </div>`
  }
  return `<div class="msg-bubble bubble-${cls}">${pwEscHtml(msg.content || '')}</div>`
}

window.togglePhoneSnapshotVoice = function(bubbleEl) {
  const transcript = bubbleEl.parentElement?.querySelector('.voice-transcript-bubble')
  if (transcript) transcript.style.display = transcript.style.display === 'none' ? '' : 'none'
}

// 纯装饰底栏：样式与真实聊天窗口一致，无任何交互
function buildPhoneSnapshotInputBarHTML() {
  const voiceIcon = typeof ICON_VOICE_SVG !== 'undefined' ? ICON_VOICE_SVG : ''
  const emojiIcon = typeof ICON_EMOJI_SVG !== 'undefined' ? ICON_EMOJI_SVG : ''
  const plusIcon = typeof ICON_PLUS_SVG !== 'undefined' ? ICON_PLUS_SVG : ''
  return `
    <div class="chat-input-area phone-snapshot-input-area" aria-hidden="true">
      <div class="chat-input-bar">
        <button class="chat-reply-btn" type="button" tabindex="-1">
          <i class="fa-solid fa-wand-magic-sparkles"></i>
        </button>
        <div class="chat-input-wrap">
          <textarea class="chat-input" placeholder="发送消息..." rows="1" readonly tabindex="-1"></textarea>
          <div class="chat-input-actions">
            <button class="chat-input-icon" type="button" tabindex="-1">${voiceIcon}</button>
            <button class="chat-input-icon" type="button" tabindex="-1">${emojiIcon}</button>
            <button class="chat-input-icon" type="button" tabindex="-1">${plusIcon}</button>
          </div>
        </div>
      </div>
    </div>`
}

async function openPhoneSnapshotChatWindow(session, friendName) {
  const snapshot = await getPhoneWechatSnapshot(session.ownerUid, session.charId)
  const chat = (snapshot?.data?.chats || []).find(c => c.friendName === friendName)
  if (!chat) {
    window.toast?.('会话不存在')
    return
  }
  const friend = (snapshot.data.friends || []).find(f => f.name === friendName)
  const char = await db.characters.get(session.charId)
  const charAvatarUrl = char?.avatar || ''
  const charAvatar = charAvatarUrl
    ? `<img src="${pwEscHtml(charAvatarUrl)}" alt="">`
    : pwInitialAvatarHTML(char?.nick || char?.name || '我')
  const friendAvatar = pwInitialAvatarHTML(friend?.remark || friendName)

  document.getElementById('phone-snapshot-chat-window')?.remove()
  const page = document.createElement('div')
  page.id = 'phone-snapshot-chat-window'
  page.className = 'full-page chat-window-page private-chat-window wechat-role-phone-page'
  page.dataset.wechatRolePhone = '1'

  let lastTime = ''
  const rows = chat.messages.map(msg => {
    const isSelf = msg.sender === 'me'
    const cls = isSelf ? 'self' : 'other'
    const bubble = buildPhoneSnapshotBubbleHTML(msg, cls)
    const avatar = isSelf ? charAvatar : friendAvatar
    let timeRow = ''
    if (msg.time && msg.time !== lastTime) {
      lastTime = msg.time
      timeRow = `
        <div class="msg-row msg-time-center-row">
          <span class="msg-time-center">${pwEscHtml(msg.time)}</span>
        </div>`
    }
    return `${timeRow}
      <div class="msg-row ${isSelf ? 'msg-self' : 'msg-other'}">
        <div class="msg-avatar-wrap"><div class="msg-avatar">${avatar}</div></div>
        <div class="msg-content-wrap">${bubble}</div>
      </div>`
  }).join('')

  page.innerHTML = `
    <div class="page-header chat-header">
      <div class="chat-header-body">
        <button class="header-back" id="phone-snapshot-chat-back">
          <i class="fa fa-angle-left"></i>
        </button>
        <div class="chat-header-info">
          <span class="chat-header-name">${pwEscHtml(friend?.remark || friendName)}</span>
        </div>
        <span class="header-spacer"></span>
      </div>
    </div>
    <div class="chat-messages" id="phone-snapshot-chat-messages">${rows}</div>
    ${buildPhoneSnapshotInputBarHTML()}
  `
  window.openPage(page)
  page.querySelector('#phone-snapshot-chat-back').addEventListener('click', () => {
    window.closePage('phone-snapshot-chat-window')
  })
  const messagesEl = page.querySelector('#phone-snapshot-chat-messages')
  requestAnimationFrame(() => { messagesEl.scrollTop = messagesEl.scrollHeight })
}

window.openPhoneSnapshotChatWindow = openPhoneSnapshotChatWindow

// ===== 渲染辅助：通讯录注入 =====

async function getPhoneSnapshotContactEntries(session) {
  if (!session?.ownerUid || !session?.charId) return []
  const snapshot = await getPhoneWechatSnapshot(session.ownerUid, session.charId)
  if (!snapshot?.data?.friends?.length) return []
  return snapshot.data.friends.map(friend => ({
    id: `phone_npc_${encodeURIComponent(friend.name)}`,
    name: friend.remark || friend.name,
    nick: friend.name,
    gender: friend.gender,
    _phoneSnapshotFriend: true,
    _phoneSnapshotFriendName: friend.name,
    _phoneSnapshotRelation: friend.relation || '',
    _phoneSnapshotNpcId: friend.npcId
  }))
}

window.getPhoneSnapshotContactEntries = getPhoneSnapshotContactEntries

// ===== 渲染辅助：朋友圈注入 =====

function buildPhoneSnapshotMomentCardHTML(moment, charName, charAvatarHtml) {
  const isSelf = moment.author === 'me'
  const displayName = isSelf ? charName : moment.author
  const avatar = isSelf ? charAvatarHtml : pwInitialAvatarHTML(moment.author)
  const imgs = moment.imagesDesc.length
    ? `<div class="moment-imgs">${moment.imagesDesc.map((desc, index) => {
        let seed = 0
        const raw = desc + index
        for (let i = 0; i < raw.length; i++) seed = ((seed * 31) + raw.charCodeAt(i)) >>> 0
        const src = `img/blank_img${(seed % 6) + 1}.jpg`
        return `
          <button class="moment-img-btn" type="button" data-src="${src}" data-desc="${pwEscHtml(desc)}" aria-label="查看图片${index + 1}">
            <img src="${src}" alt="${pwEscHtml(desc)}">
          </button>`
      }).join('')}</div>` : ''
  const likesHtml = moment.likes.length
    ? `<div class="moment-likes"><i class="fa-solid fa-heart"></i>${moment.likes.map(name => pwEscHtml(name === 'me' ? charName : name)).join('、')}</div>`
    : ''
  const commentsHtml = moment.comments.length
    ? `<div class="moment-comments">${moment.comments.map(comment => `
        <div class="moment-comment-row">
          <button class="moment-comment" type="button">
            <span>${pwEscHtml(comment.from === 'me' ? charName : comment.from)}</span>${comment.to ? `<span class="moment-comment-reply-word"> 回复 </span><span>${pwEscHtml(comment.to === 'me' ? charName : comment.to)}</span>` : ''}<span>：</span>${pwEscHtml(comment.text)}
          </button>
        </div>
      `).join('')}</div>`
    : ''
  const social = likesHtml || commentsHtml ? `<div class="moment-social">${likesHtml}${commentsHtml}</div>` : ''
  return `
    <div class="moment-card" data-phone-snapshot="1">
      <div class="moment-avatar">${avatar}</div>
      <div class="moment-body">
        <div class="moment-name">${pwEscHtml(displayName)}</div>
        <div class="moment-text">${pwEscHtml(moment.text || '')}</div>
        ${imgs}
        <div class="moment-meta-row">
          <div class="moment-meta">${pwEscHtml(moment.time || '')}</div>
        </div>
        ${social}
      </div>
    </div>
  `
}

async function getPhoneSnapshotMomentEntries(session) {
  if (!session?.ownerUid || !session?.charId) return []
  const snapshot = await getPhoneWechatSnapshot(session.ownerUid, session.charId)
  if (!snapshot?.data?.moments?.length) return []
  const char = await db.characters.get(session.charId)
  const charName = char?.nick || char?.name || '角色'
  const charAvatarHtml = char?.avatar
    ? `<img src="${pwEscHtml(char.avatar)}" alt="">`
    : pwInitialAvatarHTML(charName)
  return snapshot.data.moments.map(moment => ({
    ts: moment._ts || 0,
    html: buildPhoneSnapshotMomentCardHTML(moment, charName, charAvatarHtml)
  }))
}

window.getPhoneSnapshotMomentEntries = getPhoneSnapshotMomentEntries

// ===== Edit Phone / Clean Phone 面板 =====

function closePhoneAppPanel(shade, modal) {
  shade.classList.remove('show')
  modal.classList.remove('show')
  setTimeout(() => {
    shade.remove()
    modal.remove()
  }, 220)
}

function buildPhoneAppPanelHTML(title, actionLabel) {
  const appList = typeof window.getPhoneRecordsAllApps === 'function'
    ? window.getPhoneRecordsAllApps()
    : (typeof PHONE_RECORDS_GRID_APPS !== 'undefined' ? PHONE_RECORDS_GRID_APPS : [{ id: 'wechat', label: '微信' }])
  const enabledApps = ['wechat'].concat(Object.keys(window.PHONE_GEN_APP_LABELS || {}))
  const apps = appList.map(app => {
    const enabled = enabledApps.includes(app.id)
    return `
      <button class="phone-app-panel-option${enabled ? '' : ' is-disabled'}" type="button" data-app-id="${pwEscHtml(app.id)}" ${enabled ? '' : 'disabled'}>
        <span class="phone-app-panel-label">${pwEscHtml(app.label)}</span>
        <span class="phone-app-panel-state">${enabled ? '<i class="fa fa-check"></i>' : '暂未开放'}</span>
      </button>`
  }).join('')
  return `
    <div class="angel-editor-heading">${pwEscHtml(title)}</div>
    <div class="phone-app-panel-list">${apps}</div>
    <div class="angel-editor-actions">
      <button class="btn-pill" data-action="cancel" type="button">取消</button>
      <button class="btn-pill angel-editor-save" data-action="confirm" type="button">${pwEscHtml(actionLabel)}</button>
    </div>
  `
}

function showPhoneAppPanel(title, actionLabel, onConfirm) {
  document.getElementById('phone-app-panel')?.remove()
  document.getElementById('phone-app-panel-overlay')?.remove()

  const shade = document.createElement('div')
  shade.id = 'phone-app-panel-overlay'
  shade.className = 'sheet-overlay'
  shade.style.zIndex = '340'
  const modal = document.createElement('div')
  modal.id = 'phone-app-panel'
  modal.className = 'center-modal phone-app-panel'
  modal.style.zIndex = '341'
  modal.innerHTML = buildPhoneAppPanelHTML(title, actionLabel)

  document.body.appendChild(shade)
  document.body.appendChild(modal)
  requestAnimationFrame(() => {
    shade.classList.add('show')
    modal.classList.add('show')
  })

  let selectedApp = 'wechat'
  modal.querySelectorAll('.phone-app-panel-option:not(.is-disabled)').forEach(btn => {
    btn.classList.toggle('is-selected', btn.dataset.appId === selectedApp)
    btn.addEventListener('click', () => {
      selectedApp = btn.dataset.appId
      modal.querySelectorAll('.phone-app-panel-option').forEach(other => {
        other.classList.toggle('is-selected', other === btn)
      })
    })
  })

  const close = () => closePhoneAppPanel(shade, modal)
  shade.addEventListener('click', () => {
    if (modal.dataset.loading !== '1') close()
  })
  modal.querySelector('[data-action="cancel"]').addEventListener('click', () => {
    if (modal.dataset.loading !== '1') close()
  })
  modal.querySelector('[data-action="confirm"]').addEventListener('click', async () => {
    if (modal.dataset.loading === '1') return
    await onConfirm(selectedApp, { modal, close })
  })
  return { modal, close }
}

async function openPhoneEditPanel(context) {
  showPhoneAppPanel('选择要生成的应用', '生成', async (appId, { modal, close }) => {
    const isWechat = appId === 'wechat'
    const appLabel = isWechat ? '微信' : window.PHONE_GEN_APP_LABELS?.[appId]
    if (!appLabel) return
    if (!isWechat) {
      // 四个新 App 首期为全量生成：已有数据时先确认覆盖
      const existing = await window.getPhoneAppSnapshot?.(appId, context.ownerUid, context.charId)
      if (existing) {
        const confirmed = await showPhoneAppConfirmModal(
          `重新生成${appLabel}内容`,
          `已有生成的${appLabel}数据，重新生成将覆盖原有内容。`,
          '重新生成'
        )
        if (!confirmed) return
      }
    }
    const confirmBtn = modal.querySelector('[data-action="confirm"]')
    modal.dataset.loading = '1'
    confirmBtn.disabled = true
    confirmBtn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> 生成中…'
    try {
      if (isWechat) {
        const existing = await getPhoneWechatSnapshot(context.ownerUid, context.charId)
        await generatePhoneWechatSnapshot(context.ownerUid, context.charId)
        window.toast?.(existing ? '微信内容已增量生成' : '微信内容生成完成')
      } else {
        await window.generatePhoneAppSnapshot(appId, context.ownerUid, context.charId)
        window.toast?.(`${appLabel}内容生成完成`)
      }
      close()
    } catch (error) {
      console.warn(`生成手机${appLabel}内容失败`, error)
      window.toast?.('生成失败：' + (error.message || '请检查API设置'))
      modal.dataset.loading = '0'
      confirmBtn.disabled = false
      confirmBtn.textContent = '生成'
    }
  })
}

function showPhoneAppConfirmModal(heading, tip, confirmLabel) {
  return new Promise(resolve => {
    document.getElementById('phone-clean-confirm')?.remove()
    document.getElementById('phone-clean-confirm-overlay')?.remove()
    const shade = document.createElement('div')
    shade.id = 'phone-clean-confirm-overlay'
    shade.className = 'sheet-overlay'
    shade.style.zIndex = '342'
    const modal = document.createElement('div')
    modal.id = 'phone-clean-confirm'
    modal.className = 'center-modal phone-app-panel'
    modal.style.zIndex = '343'
    modal.innerHTML = `
      <div class="angel-editor-heading">${pwEscHtml(heading)}</div>
      <div class="phone-app-panel-tip">${pwEscHtml(tip)}</div>
      <div class="angel-editor-actions">
        <button class="btn-pill" data-action="cancel" type="button">取消</button>
        <button class="btn-pill angel-editor-save" data-action="confirm" type="button">${pwEscHtml(confirmLabel)}</button>
      </div>
    `
    document.body.appendChild(shade)
    document.body.appendChild(modal)
    requestAnimationFrame(() => {
      shade.classList.add('show')
      modal.classList.add('show')
    })
    const finish = result => {
      shade.classList.remove('show')
      modal.classList.remove('show')
      setTimeout(() => {
        shade.remove()
        modal.remove()
      }, 220)
      resolve(result)
    }
    shade.addEventListener('click', () => finish(false))
    modal.querySelector('[data-action="cancel"]').addEventListener('click', () => finish(false))
    modal.querySelector('[data-action="confirm"]').addEventListener('click', () => finish(true))
  })
}

async function openPhoneCleanPanel(context) {
  showPhoneAppPanel('选择要清空的应用', '清空', async (appId, { modal, close }) => {
    if (appId === 'wechat') {
      const snapshot = await getPhoneWechatSnapshot(context.ownerUid, context.charId)
      if (!snapshot) {
        window.toast?.('暂无已生成的微信数据')
        return
      }
      const confirmed = await showPhoneAppConfirmModal(
        '清空微信生成数据',
        '将清空生成的好友/聊天/朋友圈/钱包数据，与你的真实聊天记录不受影响。',
        '清空'
      )
      if (!confirmed) return
      await clearPhoneWechatSnapshot(context.ownerUid, context.charId)
      window.toast?.('生成数据已清空')
      close()
      return
    }
    const appLabel = window.PHONE_GEN_APP_LABELS?.[appId]
    if (!appLabel) return
    const snapshot = await window.getPhoneAppSnapshot?.(appId, context.ownerUid, context.charId)
    if (!snapshot) {
      window.toast?.(`暂无已生成的${appLabel}数据`)
      return
    }
    const confirmed = await showPhoneAppConfirmModal(
      `清空${appLabel}生成数据`,
      `将清空生成的${appLabel}内容，其他应用的数据不受影响。`,
      '清空'
    )
    if (!confirmed) return
    await window.clearPhoneAppSnapshot(appId, context.ownerUid, context.charId)
    window.toast?.('生成数据已清空')
    close()
  })
}

window.openPhoneEditPanel = openPhoneEditPanel
window.openPhoneCleanPanel = openPhoneCleanPanel
