package app.wanwan.personal;

import android.app.*;
import android.os.*;
import android.Manifest;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.net.*;
import java.util.*;
import java.util.concurrent.*;

public class MainActivity extends Activity {
 private WebView web;
 private LinearLayout root;
 private ValueCallback<Uri[]> chooser;
 private PermissionRequest media;
 private final Map<String,HttpURLConnection> connections=new ConcurrentHashMap<>();
 private final Set<String> cancelled=ConcurrentHashMap.newKeySet();
 private final ExecutorService workers=Executors.newCachedThreadPool();
 private final Map<String,File> exports=new ConcurrentHashMap<>();
 private final ArrayDeque<String[]> saveQueue=new ArrayDeque<>();
 private String[] saving;
 private long lastBack=0;
 private boolean resumed=false,notificationAsking=false;
 private String pendingOpen="";
 private final ArrayList<String> notificationQueue=new ArrayList<>();
 private android.content.SharedPreferences mobile(){return getSharedPreferences("mobile",0);}
 private boolean notificationPermission(){return Build.VERSION.SDK_INT<33||checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)==PackageManager.PERMISSION_GRANTED;}
 private void askNotifications(){if(!notificationPermission()&&!notificationAsking&&resumed){notificationAsking=true;requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},31);}}
 private void setKeepAlive(boolean enabled){
  mobile().edit().putBoolean("keepAlive",enabled).apply();
  try{if(enabled){askNotifications();Intent i=new Intent(this,KeepAliveService.class);startForegroundService(i);}else stopService(new Intent(this,KeepAliveService.class));}
  catch(Exception e){mobile().edit().putBoolean("keepAlive",false).apply();toast("后台保活未启动：请在应用前台重新开启");}
 }
 private void acceptOpen(Intent intent){if(intent==null||!intent.hasExtra("chatId"))return;try{JSONObject o=new JSONObject();o.put("chatId",intent.getStringExtra("chatId"));o.put("chatType",intent.getStringExtra("chatType"));pendingOpen=o.toString();intent.removeExtra("chatId");}catch(Exception ignored){}}
 protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);acceptOpen(intent);js("window.WanWanMobile && window.WanWanMobile.resume()");}

 private final Handler colorHandler=new Handler(Looper.getMainLooper());
 private int topBar=Color.WHITE,bottomBar=Color.WHITE;
 private final Runnable sampleBars=new Runnable(){public void run(){if(web==null)return;if(getPreferences(0).getBoolean("autoTop",true))sampleEdge(true);colorHandler.postDelayed(this,900);}};
 private void sampleEdge(boolean top){
  if(web.getWidth()<2||web.getHeight()<2||!web.isShown())return;
  int[] location=new int[2];web.getLocationInWindow(location);
  int y=location[1]+(top?0:web.getHeight()-2);
  android.graphics.Rect rect=new android.graphics.Rect(location[0],y,location[0]+web.getWidth(),y+2);
  android.graphics.Bitmap bitmap=android.graphics.Bitmap.createBitmap(48,2,android.graphics.Bitmap.Config.ARGB_8888);
  try{PixelCopy.request(getWindow(),rect,bitmap,result->{if(result==PixelCopy.SUCCESS){int[] colors=new int[48];for(int i=0;i<48;i++)colors[i]=bitmap.getPixel(i,0);Integer[] sorted=new Integer[48];for(int i=0;i<48;i++)sorted[i]=colors[i];Arrays.sort(sorted,(a,b)->Integer.compare(luma(a),luma(b)));int color=sorted[24]|0xff000000;if(top)topBar=color;else bottomBar=color;applyBars();}bitmap.recycle();},colorHandler);}catch(Exception e){bitmap.recycle();}
 }
 private static int luma(int c){return (Color.red(c)*299+Color.green(c)*587+Color.blue(c)*114)/1000;}
 private void applyBars(){
  getWindow().setStatusBarColor(topBar);getWindow().setNavigationBarColor(bottomBar);
  root.setBackground(new android.graphics.drawable.GradientDrawable(android.graphics.drawable.GradientDrawable.Orientation.TOP_BOTTOM,new int[]{topBar,topBar,bottomBar,bottomBar}));
  int flags=0;if(luma(topBar)>=140)flags|=View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;if(luma(bottomBar)>=140)flags|=View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
  getWindow().getDecorView().setSystemUiVisibility(flags);
  if(Build.VERSION.SDK_INT>=29){getWindow().setStatusBarContrastEnforced(false);getWindow().setNavigationBarContrastEnforced(false);}
 }
 protected void onResume(){super.onResume();resumed=true;if(web!=null)web.onResume();js("window.WanWanMobile && window.WanWanMobile.resume()");colorHandler.removeCallbacks(sampleBars);colorHandler.postDelayed(sampleBars,350);}
 protected void onPause(){resumed=false;colorHandler.removeCallbacks(sampleBars);super.onPause();}
 private static final String HOST="appassets.androidplatform.net";
 public void onCreate(Bundle state){
  super.onCreate(state);MessageNotifications.createChannel(this);acceptOpen(getIntent());
  getWindow().setStatusBarColor(Color.WHITE);getWindow().setNavigationBarColor(Color.WHITE);
  // Explicit native insets keep every web screen below system bars, including Android 15.
  root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setBackgroundColor(Color.WHITE);
  if(Build.VERSION.SDK_INT>=30){
   getWindow().setDecorFitsSystemWindows(false);
   getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING);
   root.setOnApplyWindowInsetsListener((v,insets)->{android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout()|WindowInsets.Type.ime());v.setPadding(bars.left,bars.top,bars.right,bars.bottom);return WindowInsets.CONSUMED;});
  }
  getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
  web=new WebView(this);web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT,false);root.addView(web,new LinearLayout.LayoutParams(-1,0,1));setContentView(root);
  WebSettings s=web.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);s.setDatabaseEnabled(true);s.setAllowFileAccess(false);s.setAllowContentAccess(true);s.setMediaPlaybackRequiresUserGesture(false);s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
  web.addJavascriptInterface(new Bridge(),"WanWanNative");
  web.setWebViewClient(new WebViewClient(){
   public void onPageFinished(WebView view,String url){js("window.WanWanMobile && window.WanWanMobile.resume()");}

   public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest r){
    if(!HOST.equals(r.getUrl().getHost()))return null;
    String path=r.getUrl().getPath();
    if(path==null||!path.startsWith("/assets/")||path.contains(".."))return new WebResourceResponse("text/plain","UTF-8",404,"Not Found",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));
    try{String file=path.substring(8);String ext=android.webkit.MimeTypeMap.getFileExtensionFromUrl(file);String mime=android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);if(file.endsWith(".js"))mime="application/javascript";if(mime==null)mime="application/octet-stream";
     Map<String,String> headers=new HashMap<>();headers.put("Cache-Control","no-store");return new WebResourceResponse(mime,"UTF-8",200,"OK",headers,getAssets().open("www/"+file));
    }catch(Exception e){return new WebResourceResponse("text/plain","UTF-8",404,"Not Found",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));}
   }
   public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){if(HOST.equals(r.getUrl().getHost()))return false;try{startActivity(new Intent(Intent.ACTION_VIEW,r.getUrl()));}catch(Exception e){toast("无法打开此链接");}return true;}
  });
  web.setWebChromeClient(new WebChromeClient(){
   public boolean onShowFileChooser(WebView w,ValueCallback<Uri[]> cb,FileChooserParams p){if(chooser!=null)chooser.onReceiveValue(null);chooser=cb;Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("*/*");ArrayList<String> types=new ArrayList<>();for(String entry:p.getAcceptTypes())for(String type:entry.split(","))if(type.trim().contains("/"))types.add(type.trim());if(!types.isEmpty())i.putExtra(Intent.EXTRA_MIME_TYPES,types.toArray(new String[0]));i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,p.getMode()==FileChooserParams.MODE_OPEN_MULTIPLE);try{startActivityForResult(i,10);}catch(Exception e){chooser.onReceiveValue(null);chooser=null;}return true;}
   public void onPermissionRequest(PermissionRequest p){if(!HOST.equals(p.getOrigin().getHost())){p.deny();return;}runOnUiThread(()->{media=p;ArrayList<String> ask=new ArrayList<>();for(String r:p.getResources()){String permission=r.equals(PermissionRequest.RESOURCE_AUDIO_CAPTURE)?Manifest.permission.RECORD_AUDIO:r.equals(PermissionRequest.RESOURCE_VIDEO_CAPTURE)?Manifest.permission.CAMERA:null;if(permission!=null&&checkSelfPermission(permission)!=PackageManager.PERMISSION_GRANTED)ask.add(permission);}if(ask.isEmpty())grantMedia();else requestPermissions(ask.toArray(new String[0]),30);});}
   public void onPermissionRequestCanceled(PermissionRequest p){if(media==p)media=null;}
   public boolean onConsoleMessage(ConsoleMessage m){android.util.Log.d("WanWan",m.messageLevel()+": "+m.message()+" @"+m.lineNumber());return true;}
  });
  web.setDownloadListener((u,ua,cd,m,len)->js("window.__wanwanDownload("+JSONObject.quote(u)+","+JSONObject.quote(URLUtil.guessFileName(u,cd,m))+")"));
  if(mobile().getBoolean("keepAlive",false))setKeepAlive(true);
  web.loadUrl("https://"+HOST+"/assets/index.html");
 }
 private void grantMedia(){if(media==null)return;ArrayList<String> allow=new ArrayList<>();for(String r:media.getResources())if((r.equals(PermissionRequest.RESOURCE_AUDIO_CAPTURE)&&checkSelfPermission(Manifest.permission.RECORD_AUDIO)==0)||(r.equals(PermissionRequest.RESOURCE_VIDEO_CAPTURE)&&checkSelfPermission(Manifest.permission.CAMERA)==0))allow.add(r);media.grant(allow.toArray(new String[0]));media=null;}
 public void onRequestPermissionsResult(int r,String[] p,int[] g){super.onRequestPermissionsResult(r,p,g);if(r==30)grantMedia();if(r==31){notificationAsking=false;if(notificationPermission())for(String n:notificationQueue)MessageNotifications.post(this,n);else toast("通知未授权，可在系统设置中开启");notificationQueue.clear();js("window.WanWanMobile && window.WanWanMobile.resume()");}}
 private void js(String script){runOnUiThread(()->{if(web!=null)web.evaluateJavascript(script,null);});}
 private void event(String id,String type,Object payload){js("window.__wanwanEvent("+JSONObject.quote(id)+","+JSONObject.quote(type)+","+(payload==null?"null":payload.toString())+")");}
 private void toast(String t){runOnUiThread(()->Toast.makeText(this,t,Toast.LENGTH_LONG).show());}
 public class Bridge {
  @JavascriptInterface public String state(){try{JSONObject o=new JSONObject();o.put("keepAlive",mobile().getBoolean("keepAlive",false));o.put("notifications",mobile().getBoolean("notifications",false));o.put("notifyInChat",mobile().getBoolean("notifyInChat",false));o.put("permission",notificationPermission());o.put("channelEnabled",getSystemService(NotificationManager.class).getNotificationChannel(MessageNotifications.CHANNEL).getImportance()>0);o.put("batteryExempt",((PowerManager)getSystemService(POWER_SERVICE)).isIgnoringBatteryOptimizations(getPackageName()));o.put("autoTop",getPreferences(0).getBoolean("autoTop",true));return o.toString();}catch(Exception e){return "{}";}}
  @JavascriptInterface public void configure(String json){runOnUiThread(()->{try{JSONObject o=new JSONObject(json);if(o.has("keepAlive"))setKeepAlive(o.getBoolean("keepAlive"));if(o.has("notifications")){mobile().edit().putBoolean("notifications",o.getBoolean("notifications")).apply();if(o.getBoolean("notifications"))askNotifications();}if(o.has("notifyInChat"))mobile().edit().putBoolean("notifyInChat",o.getBoolean("notifyInChat")).apply();if(o.has("autoTop")){getPreferences(0).edit().putBoolean("autoTop",o.getBoolean("autoTop")).apply();if(!o.getBoolean("autoTop")){topBar=Color.WHITE;applyBars();}}}catch(Exception ignored){}});}
  @JavascriptInterface public void batterySettings(){runOnUiThread(()->{try{startActivity(new Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,Uri.parse("package:"+getPackageName())));}catch(Exception e){startActivity(new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getPackageName())));}});}
  @JavascriptInterface public void notificationSettings(){runOnUiThread(()->{Intent i=new Intent(android.provider.Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS);i.putExtra(android.provider.Settings.EXTRA_APP_PACKAGE,getPackageName());i.putExtra(android.provider.Settings.EXTRA_CHANNEL_ID,MessageNotifications.CHANNEL);startActivity(i);});}
  @JavascriptInterface public String takeOpenChat(){String value=pendingOpen;pendingOpen="";return value;}
  @JavascriptInterface public void notifyMessage(String json){runOnUiThread(()->{try{JSONObject o=new JSONObject(json);boolean test=o.optBoolean("test");if(!test&&!mobile().getBoolean("notifications",false))return;if(!test&&resumed&&o.optBoolean("viewing")&&!mobile().getBoolean("notifyInChat",false))return;if(!notificationPermission()){if(test&&notificationQueue.size()<5){notificationQueue.add(json);askNotifications();}return;}MessageNotifications.post(MainActivity.this,json);}catch(Exception e){toast("通知格式有误");}});}

  @JavascriptInterface public void request(String id,String config){workers.execute(()->{
   HttpURLConnection c=null;
   try{JSONObject o=new JSONObject(config);URL url=new URL(o.getString("url"));if(!url.getProtocol().equals("https")&&!url.getProtocol().equals("http"))throw new IOException("Unsupported protocol");
    c=(HttpURLConnection)url.openConnection();connections.put(id,c);c.setConnectTimeout(30000);c.setReadTimeout(180000);c.setRequestMethod(o.optString("method","GET"));c.setRequestProperty("Accept-Encoding","identity");
    JSONObject headers=o.getJSONObject("headers");Iterator<String> keys=headers.keys();while(keys.hasNext()){String k=keys.next();if(!k.equalsIgnoreCase("host")&&!k.equalsIgnoreCase("content-length"))c.setRequestProperty(k,headers.getString(k));}
    if(cancelled.contains(id))throw new IOException("Aborted");
    if(!o.isNull("body")){c.setDoOutput(true);byte[] body=android.util.Base64.decode(o.getString("body"),0);c.setFixedLengthStreamingMode(body.length);try(OutputStream out=c.getOutputStream()){out.write(body);}}
    int status=c.getResponseCode();JSONObject meta=new JSONObject();meta.put("status",status);meta.put("statusText",c.getResponseMessage());JSONObject hs=new JSONObject();for(Map.Entry<String,List<String>> h:c.getHeaderFields().entrySet())if(h.getKey()!=null)hs.put(h.getKey(),String.join(", ",h.getValue()));meta.put("headers",hs);event(id,"headers",meta);
    InputStream stream=status>=400?c.getErrorStream():c.getInputStream();if(stream!=null)try(InputStream in=stream){byte[] b=new byte[16384];int n;while((n=in.read(b))!=-1){if(cancelled.contains(id))throw new IOException("Aborted");event(id,"chunk",JSONObject.quote(android.util.Base64.encodeToString(b,0,n,android.util.Base64.NO_WRAP)));}}
    event(id,"end",null);
   }catch(Exception e){event(id,"error",JSONObject.quote(e.getClass().getSimpleName()+": "+String.valueOf(e.getMessage())));}finally{connections.remove(id);cancelled.remove(id);if(c!=null)c.disconnect();}
  });}
  @JavascriptInterface public void abort(String id){cancelled.add(id);HttpURLConnection c=connections.get(id);if(c!=null)workers.execute(c::disconnect);}
  @JavascriptInterface public String beginExport(){try{String id=UUID.randomUUID().toString();File f=File.createTempFile("export-",".tmp",getCacheDir());exports.put(id,f);return id;}catch(Exception e){return "";}}
  @JavascriptInterface public boolean appendExport(String id,String b64){File f=exports.get(id);if(f==null)return false;try(FileOutputStream out=new FileOutputStream(f,true)){out.write(android.util.Base64.decode(b64,0));return true;}catch(Exception e){return false;}}
  @JavascriptInterface public void cancelExport(String id){File f=exports.remove(id);if(f!=null)f.delete();}
  @JavascriptInterface public void saveExport(String id,String name,String mime){runOnUiThread(()->{saveQueue.add(new String[]{id,name,mime});nextSave();});}
  @JavascriptInterface public void theme(String color,boolean dark){runOnUiThread(()->{try{root.setBackgroundColor(Color.parseColor(color));getWindow().setStatusBarColor(Color.parseColor(color));getWindow().setNavigationBarColor(Color.parseColor(color));int flags=0;if(!dark)flags|=View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;getWindow().getDecorView().setSystemUiVisibility(flags);}catch(Exception ignored){}});}
 }
 private void nextSave(){if(saving!=null||saveQueue.isEmpty())return;saving=saveQueue.poll();Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType(saving[2].isEmpty()?"application/octet-stream":saving[2]);i.putExtra(Intent.EXTRA_TITLE,saving[1]);try{startActivityForResult(i,20);}catch(Exception e){new Bridge().cancelExport(saving[0]);saving=null;toast("无法打开文件保存器");nextSave();}}
 protected void onActivityResult(int r,int result,Intent data){super.onActivityResult(r,result,data);if(r==10&&chooser!=null){Uri[] uris=null;if(result==RESULT_OK&&data!=null){if(data.getClipData()!=null){uris=new Uri[data.getClipData().getItemCount()];for(int i=0;i<uris.length;i++)uris[i]=data.getClipData().getItemAt(i).getUri();}else if(data.getData()!=null)uris=new Uri[]{data.getData()};}chooser.onReceiveValue(uris);chooser=null;}
  if(r==20&&saving!=null){String[] job=saving;saving=null;File f=exports.remove(job[0]);Uri uri=result==RESULT_OK&&data!=null?data.getData():null;if(f!=null){if(uri!=null)workers.execute(()->{try(InputStream in=new FileInputStream(f);OutputStream out=getContentResolver().openOutputStream(uri)){if(out==null)throw new IOException("无法写入文件");byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1)out.write(b,0,n);toast("已保存："+job[1]);}catch(Exception e){toast("保存失败："+e.getMessage());}finally{f.delete();}});else f.delete();}nextSave();}
 }
 public void onBackPressed(){web.evaluateJavascript("window.__wanwanBack ? window.__wanwanBack() : false",value->{if(!"true".equals(value)){long now=System.currentTimeMillis();if(now-lastBack<2000)moveTaskToBack(true);else{lastBack=now;toast("再按一次返回桌面");}}});}
 protected void onDestroy(){colorHandler.removeCallbacks(sampleBars);for(HttpURLConnection c:connections.values())c.disconnect();workers.shutdownNow();if(web!=null){web.removeJavascriptInterface("WanWanNative");web.destroy();web=null;}super.onDestroy();}
}
