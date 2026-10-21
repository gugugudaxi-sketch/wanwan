const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'../..');
process.on('unhandledRejection',error=>{console.error('UNHANDLED',error);process.exitCode=1;});
(async()=>{
 const {Window}=await import(process.env.HAPPY_DOM_MODULE);const fake=require(process.env.FAKE_INDEXEDDB_MODULE);
 const window=new Window({url:'https://wanwan.test/',settings:{disableCSSFileLoading:true,disableJavaScriptFileLoading:true,disableComputedStyleRendering:true}});
 window.indexedDB=fake.indexedDB;window.IDBKeyRange=fake.IDBKeyRange;window.console={...console,warn(){},error:console.error};
 window.fetch=async()=>{throw new Error('network disabled in tests');};window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
 window.document.write('<html><head></head><body><div id="app"></div></body></html>');
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const scripts=[...html.matchAll(/<script\s+src="([^"]+)"/g)].map(m=>m[1].split('?')[0]).filter(src=>!src.startsWith('http'));
 for(const name of ['android/vendor/dexie.js','android/vendor/jszip.min.js',...scripts])window.eval(fs.readFileSync(path.join(root,name),'utf8'));

 await window.db.open();
 const parse=s=>window.parseMsgType(s);
 for(const s of ['[阿言引用"小夏：到家了"并回复：好的]','[阿言引用“小夏：到家了”并回复：好的]','【阿言引用「小夏: 到家了」并回复: 好的】']){assert.equal(parse(s).type,'quote',s);assert.equal(parse(s).data.reply.trim(),'好的');}
 const lines=window.splitMessageLines('先吃饭吧\n[阿言引用“小夏：我到家了”\n并回复：那就好。]\n晚点聊');assert.equal(lines.length,3);assert.equal(parse(lines[1]).type,'quote');assert.equal(window.splitMessageLines('普通\n消息').length,2);
 assert.equal(parse('[阿言的表情包:  猫猫点头  ]').data.name,'猫猫点头');assert.equal(parse('普通文字：你好；再见').data.text,'普通文字：你好；再见');
 const cat=await window.db.stickerCategories.add({name:'测试'});await window.db.stickers.add({name:'猫猫点头',categoryId:cat,image:'data:image/png;base64,dGVzdA=='});await window.db.config.put({key:'chatStickers_101',value:[cat]});
 const id=await window.addPrivateMessageIdempotently({chatId:101,charId:7,role:'assistant',content:'[阿言的表情包： 猫猫点头 ]',createdAt:Date.now()});const sticker=await window.db.messages.get(id);assert(sticker.stickerImage);assert(window.renderStickerBubble(parse(sticker.content).data,false,sticker,{}).includes('<img'));
 const legacy=window.renderStickerBubble(parse('[阿言的表情包：猫猫点头]').data,false,{},await window.getMountedStickerMap(101));assert(legacy.includes('<img'));
 const giftId=await window.addPrivateMessageIdempotently({chatId:101,charId:7,role:'assistant',content:'[阿言的外卖赠送：草莓蛋糕；¥38]',createdAt:Date.now()});const gift=await window.db.messages.get(giftId);const giftData=parse(gift.content).data;assert.equal(giftData.dealType,'gift');assert(giftData.orderId);assert(window.yumDealHasTimeline(giftData));assert(window.yumDealStatusText(giftData,'gift',false).includes('备餐'));
 const payId=await window.addPrivateMessageIdempotently({chatId:101,charId:7,role:'assistant',content:'[阿言的外卖代付：草莓蛋糕；¥38]',createdAt:Date.now()});const pay=parse((await window.db.messages.get(payId)).content).data;assert.equal(pay.dealType,'pay');assert(!pay.orderId);
 const catalog=window.WANWAN_PROMPT_CATALOG;assert(catalog.length>150);for(const item of catalog){const values=item.variables.map((_,i)=>'变量'+i);const expected=item.template.replace(/\{\{p(\d+)\}\}/g,(_,i)=>values[Number(i)-1]);assert.equal(window.WanWanPrompts.render(item.id,values),expected,item.id);}
 const feature='wechat.generateAIReply';await window.db.config.put({key:'wanwanPromptWorkbenchV1',value:{templates:{},parameters:{[feature]:{temperature:0.25,top_p:0.8,max_tokens:321,model:'test-model',systemRole:'user',responseFormat:'text'}}}});
 const prepared=await window.WanWanPrompts.prepare(window.WanWanPrompts.options(feature,{temperature:1,responseJsonSchema:{name:'old'}}));assert.equal(prepared.temperature,0.25);assert.equal(prepared.responseJsonSchema,null);assert.equal(prepared.max_tokens,321);
 let body;window.runTrackedChatCompletion=async(cfg,b)=>{body=b;return {choices:[{message:{content:'ok'}}]};};await window.fetchAI({url:'https://test.invalid/v1',key:'private-key',model:'base'},[{role:'user',content:'你好'}],window.WanWanPrompts.options(feature,{system:'规则'}));assert.equal(body.messages[0].role,'user');assert.equal(body.model,'test-model');assert.equal(body.max_tokens,321);assert.equal(body.temperature,0.25);assert(!body.response_format);assert(!JSON.stringify(body).includes('private-key'));
 const item=catalog.find(c=>c.variables.length>0);await window.db.config.put({key:'wanwanPromptWorkbenchV1',value:{templates:{[item.id]:'修改后的规则 {{p1}}'},parameters:{}}});await window.WanWanPrompts.load();assert.equal(window.WanWanPrompts.render(item.id,['实际值']),'修改后的规则 实际值');assert.throws(()=>window.WanWanPrompts.validateTemplate(item.id,'未知 {{p999}}'));assert.throws(()=>window.WanWanPrompts.validateParameters({temperature:'abc'}));
 const settings=window.buildSettingsPage();window.document.querySelector('#app').appendChild(settings);assert(settings.querySelector('#row-prompt-workbench'));await window.WanWanPrompts.open();const workbench=window.document.querySelector('#prompt-workbench-page');assert(workbench);assert.equal(workbench.querySelectorAll('.prompt-item').length,catalog.length);
 workbench.querySelector('.prompt-item').click();assert(window.document.querySelector('#prompt-template-page textarea').value);assert(window.document.querySelector('#prompt-original').textContent);
 workbench.querySelector('#prompt-parameters').click();assert.equal(window.document.querySelectorAll('[data-feature]').length,window.WANWAN_PROMPT_FEATURES.length);
 window.document.querySelector('[data-feature="wechat.generateAIReply"]').click();assert(window.document.querySelector('#param-max_tokens'));
 console.log('PASS quote punctuation/multiline; sticker image snapshot+legacy fallback; gift vs pay and delivery; '+catalog.length+' default/editable templates; per-feature API params; settings/editor UI');
 await window.happyDOM.abort();window.close();await window.db.delete();
})().catch(e=>{console.error(e);process.exitCode=1;setTimeout(()=>process.exit(1),100);});
