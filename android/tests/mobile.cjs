// Integration checks with real Dexie transactions and deterministic touch events.
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const fake=require(process.env.FAKE_INDEXEDDB_MODULE);
const Dexie=require('../vendor/dexie.js');
Dexie.dependencies.indexedDB=fake.indexedDB;Dexie.dependencies.IDBKeyRange=fake.IDBKeyRange;
const listeners={},notices=[];let layer=null,clicks=0,timer;
const db=new Dexie('wanwan-android-test-'+Date.now());db.version(1).stores({messages:'++id,chatId',groupMessages:'++id,groupId'});
const node={id:'page',classList:{contains(){return false;}},getClientRects(){return [1];},closest(selector){return selector.startsWith('.full-page')?layer:null;},matches(){return false;},querySelectorAll(){return [{getClientRects(){return [1];},click(){clicks++;}}];}};
const ctx={console,setTimeout,clearTimeout,setInterval(fn){timer=fn;return 1;},clearInterval(){},Date,JSON,Number,String,Promise,innerWidth:393,innerHeight:780,db,buildSettingsPage(){},initDB(){},getComputedStyle(){return {visibility:'visible',overflowX:'visible'};},getWechatDisplayCharacter:async id=>({id,name:'角色',avatar:''}),getWechatDisplayName:c=>c.name,getWechatDisplayAvatar:c=>c.avatar,getMsgNotificationText:m=>m.content,_getVisibleChatWindow(){return false;},document:{body:{},elementsFromPoint(){return layer?[layer]:[];},getElementById(){return null;},addEventListener(name,cb){(listeners[name]??=[]).push(cb);}},WanWanNative:{state(){return '{}';},notifyMessage(s){notices.push(JSON.parse(s));}}};ctx.window=ctx;
vm.createContext(ctx);vm.runInContext(fs.readFileSync(require('path').join(__dirname,'../../js/mobile.js'),'utf8'),ctx);
function touch(type,x,y,target=node,count=1){const t={clientX:x,clientY:y};const e={target,touches:type==='touchend'?[]:Array(count).fill(t),changedTouches:[t],cancelable:true,preventDefault(){},stopImmediatePropagation(){}};for(const f of listeners[type]||[])f(e);}
function swipe(x,y,xx,yy,target=node){touch('touchstart',x,y,target);touch('touchmove',xx,yy,target);touch('touchend',xx,yy,target);}
(async()=>{
 layer=node;swipe(80,200,200,205);assert.equal(clicks,1);swipe(280,200,150,205);assert.equal(clicks,2);
 swipe(80,200,100,360);assert.equal(clicks,2);swipe(80,200,120,205);assert.equal(clicks,2);
 const input={closest(){return true;}};swipe(80,200,220,200,input);assert.equal(clicks,2);
 touch('touchstart',80,200);touch('touchmove',220,200,node,2);touch('touchend',220,200);assert.equal(clicks,2);
 layer=null;swipe(80,200,220,200);assert.equal(clicks,2);
 await db.messages.add({role:'assistant',chatId:2,charId:3,content:'私聊',createdAt:Date.now()});
 await db.groupMessages.add({role:'assistant',groupId:4,senderId:3,content:'群聊',createdAt:Date.now()});
 await db.messages.add({role:'user',chatId:2,content:'不通知',createdAt:Date.now()});
 await db.messages.add({role:'assistant',chatId:2,content:'旧消息',createdAt:Date.now()-120000});
 try{await db.transaction('rw',db.messages,async()=>{await db.messages.add({role:'assistant',content:'回滚消息',createdAt:Date.now()});throw new Error('rollback');});}catch(_){}
 await new Promise(r=>setTimeout(r,100));assert.equal(notices.length,2);assert.equal(notices[0].body,'私聊');assert.equal(notices[1].chatType,'group');assert.notEqual(notices[0].id,notices[1].id);
 console.log('PASS: both swipe directions, vertical/short/input/multitouch/desktop guards; committed private/group notifications, user/history/rollback filtering');
 await db.delete();
})().catch(e=>{console.error(e);process.exitCode=1;});
