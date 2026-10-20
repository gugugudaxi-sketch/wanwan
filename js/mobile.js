// Shared back action: invoke the current screen's own controls, preserving save/cleanup.
(() => {
 'use strict';
 const visible = el => !!el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
 function topLayer() {
  return document.elementsFromPoint(innerWidth / 2, Math.min(100,innerHeight / 3))
   .map(el => el.closest('.full-page, .phone-fullscreen, .phone-iscreen-page, .sheet-overlay, .modal-overlay, .img-picker-overlay'))
   .find(el => visible(el) && !el.classList.contains('is-closing')) || null;
 }
 const backSelectors = '.header-back, .settings-large-title, .wechat-title-big, .wl-back-btn, #phone-lock-exit, .imessage-chat-back, .imessage-back, .x-profile-back, .x-profile-edit-back, .x-login-close, .x-compose-cancel, .ww-heading, [aria-label="返回"], [data-phone-app-back], .phone-photo-viewer-close';
 window.__wanwanBack = () => {
  const layer=topLayer(); if(!layer || layer.classList.contains('is-opening'))return false;
  const back=[...layer.querySelectorAll(backSelectors)].find(visible);
  if(back){back.click();return true;}
  if(layer.matches('.sheet-overlay, .modal-overlay, .img-picker-overlay')){layer.click();return true;}
  if(layer.id==='x-page' && typeof closeXPage==='function'){closeXPage();return true;}
  if(layer.classList.contains('full-page') && layer.id && typeof closePage==='function'){closePage(layer.id);return true;}
  return false;
 };
 let start=null,blocked=false;
 document.addEventListener('touchstart',e=>{
  start=null;blocked=false;
  if(e.touches.length!==1 || !topLayer())return;
  const target=e.target;
  if(target.closest('input,textarea,select,[contenteditable="true"],canvas,video,audio,[data-no-swipe-back]'))return;
  for(let el=target;el&&el!==document.body;el=el.parentElement){
   if(el.scrollWidth>el.clientWidth+8 && /auto|scroll/.test(getComputedStyle(el).overflowX))return;
  }
  const t=e.touches[0];start={x:t.clientX,y:t.clientY,time:Date.now(),layer:topLayer()};
 },{capture:true,passive:true});
 document.addEventListener('touchmove',e=>{
  if(!start)return;
  if(e.touches.length!==1){start=null;return;}
  const t=e.touches[0],dx=Math.abs(t.clientX-start.x),dy=Math.abs(t.clientY-start.y);
  if(dy>24 && dy>dx){start=null;return;}
  if(dx>35 && dx>dy*2){blocked=true;if(e.cancelable)e.preventDefault();}
 },{capture:true,passive:false});
 document.addEventListener('touchend',e=>{
  if(!start)return;const s=start;start=null;
  const t=e.changedTouches[0],dx=Math.abs(t.clientX-s.x),dy=Math.abs(t.clientY-s.y);
  if(blocked && dx>85 && dx>dy*2.2 && Date.now()-s.time<900 && s.layer===topLayer()){
   e.stopImmediatePropagation();if(e.cancelable)e.preventDefault();window.__wanwanBack();
  }
 },{capture:true,passive:false});
 document.addEventListener('touchcancel',()=>{start=null;},{passive:true});
 if(!window.WanWanNative)return;
 const native=window.WanWanNative;
 function state(){return JSON.parse(native.state());}
 function row(label,id,on){return '<div class="list-row"><div class="row-body"><div class="row-label">'+label+'</div></div><label class="toggle-wrap"><input type="checkbox" id="'+id+'" '+(on?'checked':'')+'><div class="toggle-track"></div><div class="toggle-thumb"></div></label></div>';}
 window.openAndroidSettings=()=>{
  const s=state(),page=buildSubPage('android-settings-page','Android 功能',
   '<div class="setting-section">'+row('本地后台保活','android-keep',s.keepAlive)+row('角色消息弹窗','android-notify',s.notifications)+row('当前聊天也弹窗','android-inchat',s.notifyInChat)+
   '<div class="list-row clickable" id="android-test"><div class="row-body"><div class="row-label">发送测试通知</div></div></div>'+ 
   '<div class="list-row clickable" id="android-battery"><div class="row-body"><div class="row-label">允许不受电量限制</div></div></div>'+ 
   '<div class="list-row clickable" id="android-permission"><div class="row-body"><div class="row-label">系统通知与横幅设置</div></div></div></div>'+ 
   '<p style="padding:0 20px;color:var(--text-secondary,#888);font-size:13px;line-height:1.7">左右滑动均返回上一页，桌面保留分页手势。保活开启后显示常驻通知；请同时在手机系统允许后台运行。系统强制停止应用后无法继续生成消息。每条新消息单独通知，头像优先使用角色头像。</p>');
  openSubPage(page);
  for(const [id,key] of [['android-keep','keepAlive'],['android-notify','notifications'],['android-inchat','notifyInChat']])page.querySelector('#'+id).onchange=e=>native.configure(JSON.stringify({[key]:e.target.checked}));
  page.querySelector('#android-battery').onclick=()=>native.batterySettings();
  page.querySelector('#android-permission').onclick=()=>native.notificationSettings();
  page.querySelector('#android-test').onclick=async()=>{const chars=await db.characters.toArray(),c=chars.find(c=>c.type==='char')||{name:'弯弯'};native.notifyMessage(JSON.stringify({test:true,id:'test-'+Date.now(),name:c.name,avatar:c.avatar||'',body:'这是一条测试消息，通知和头像已连接。'}));};
 };
 const settingsBuilder=window.buildSettingsPage;
 window.buildSettingsPage=function(){const page=settingsBuilder();const section=document.createElement('div');section.className='setting-section';section.innerHTML='<div class="list-row clickable"><div class="row-icon-box"><i class="fa fa-mobile-screen"></i></div><div class="row-body"><div class="row-label">Android 保活与消息弹窗</div></div><i class="fa fa-angle-right row-chevron"></i></div>';section.onclick=window.openAndroidSettings;page.querySelector('.settings-scroll').appendChild(section);return page;};
 async function avatarURL(source){if(!source||source.startsWith('data:'))return source||'';try{const b=await(await fetch(source)).blob();return await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>resolve('');r.readAsDataURL(b);});}catch(_){return '';}}
 async function notify(msg,id,group){
  try{
   if(!['assistant','char'].includes(msg.role) || Date.now()-Number(msg.createdAt)>60000)return;
   const chatId=group?msg.groupId:msg.chatId;
   const c=await getWechatDisplayCharacter(group?msg.senderId:msg.charId);
   const name=typeof getWechatDisplayName==='function'?getWechatDisplayName(c):(c?.name||'角色');
   const viewing=typeof _getVisibleChatWindow==='function'&&!!_getVisibleChatWindow(group?'group':'chat',chatId);
   native.notifyMessage(JSON.stringify({id:(group?'group:':'private:')+id,chatId:String(chatId),chatType:group?'group':'private',actorId:String(c?.id||''),viewing,name,avatar:await avatarURL(typeof getWechatDisplayAvatar==='function'?getWechatDisplayAvatar(c):c?.avatar),body:typeof getMsgNotificationText==='function'?getMsgNotificationText(msg,name):msg.content}));
  }catch(e){console.warn('Android notification:',e);}
 }
 function hookDB(){if(!window.db||db.__androidHooked)return;db.__androidHooked=true;for(const [table,group] of [['messages',false],['groupMessages',true]])db[table].hook('creating',function(key,obj,tx){const snapshot={...obj};this.onsuccess=id=>tx.on('complete',()=>{notify(snapshot,id,group);});});}
 const init=window.initDB;window.initDB=function(){const result=init.apply(this,arguments);hookDB();return result;};hookDB();
 // The database hook owns Android notifications to avoid duplicate browser notifications.
 window.sendWanWanNotification=async()=>{};
 window.WanWanMobile={resume:async()=>{if(!window.db || !document.getElementById('home-page'))return;const raw=native.takeOpenChat();if(!raw)return;try{const data=JSON.parse(raw),id=Number(data.chatId);if(!id)return;if(data.chatType==='group')await openGroupChatFromTopPopup(id);else{const chat=await db.chats.get(id);if(chat)await openPrivateChatFromTopPopup(id,chat.charId);}}catch(e){console.warn(e);}}};
 const bootTimer=setInterval(()=>{if(window.db&&document.getElementById('home-page')){clearInterval(bootTimer);window.WanWanMobile.resume();}},500);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)window.WanWanMobile.resume();});
})();
