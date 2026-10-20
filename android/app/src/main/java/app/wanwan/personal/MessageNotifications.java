package app.wanwan.personal;
import android.app.*;
import android.content.*;
import android.graphics.*;
import android.graphics.drawable.Icon;
import android.os.Build;
import org.json.*;
import java.net.*;
import java.io.*;
import java.util.concurrent.*;

public final class MessageNotifications {
 public static final String CHANNEL="wanwan-char-messages-v1";
 private static final ExecutorService queue=Executors.newSingleThreadExecutor();
 private static final android.util.LruCache<String,Bitmap> avatarCache=new android.util.LruCache<>(24);
 private static final java.util.LinkedHashMap<String,Boolean> delivered=new java.util.LinkedHashMap<>();
 public static void createChannel(Context c){NotificationChannel channel=new NotificationChannel(CHANNEL,"角色消息",NotificationManager.IMPORTANCE_HIGH);channel.setDescription("每条角色消息单独显示，使用角色头像");channel.enableVibration(true);channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);c.getSystemService(NotificationManager.class).createNotificationChannel(channel);}
 public static void post(Context context,String json){final Context c=context.getApplicationContext();queue.execute(()->{try{
  JSONObject data=new JSONObject(json);String id=data.optString("id");if(id.isEmpty())id=java.util.UUID.randomUUID().toString();
  synchronized(delivered){if(delivered.containsKey(id))return;delivered.put(id,true);while(delivered.size()>500)delivered.remove(delivered.keySet().iterator().next());}
  String name=data.optString("name","角色"),text=data.optString("body","你有一条新消息");
  Bitmap avatar=avatar(data.optString("avatar"),name);
  Intent open=new Intent(c,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP).setData(android.net.Uri.parse("wanwan://message/"+android.net.Uri.encode(id))).putExtra("chatId",data.optString("chatId")).putExtra("chatType",data.optString("chatType","private"));
  PendingIntent pending=PendingIntent.getActivity(c,0,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
  Notification.Builder b=new Notification.Builder(c,CHANNEL).setSmallIcon(c.getResources().getIdentifier("notification","drawable",c.getPackageName())).setContentTitle(name).setContentText(text).setLargeIcon(avatar).setContentIntent(pending).setAutoCancel(true).setCategory(Notification.CATEGORY_MESSAGE).setVisibility(Notification.VISIBILITY_PRIVATE).setWhen(System.currentTimeMillis()).setShowWhen(true).setGroup("wanwan-message-"+id);
  if(Build.VERSION.SDK_INT>=28){Person person=new Person.Builder().setName(name).setKey(data.optString("actorId",data.optString("chatId"))).setIcon(Icon.createWithBitmap(avatar)).setImportant(true).build();Person me=new Person.Builder().setName("我").build();b.setStyle(new Notification.MessagingStyle(me).addMessage(text,System.currentTimeMillis(),person).setGroupConversation(false));}
  else b.setStyle(new Notification.BigTextStyle().bigText(text));
  c.getSystemService(NotificationManager.class).notify("wanwan-message-"+id,1,b.build());
 }catch(Exception e){android.util.Log.w("WanWan","Notification failed: "+e.getClass().getSimpleName());}});}
 private static Bitmap avatar(String source,String name){
  String cacheKey=source.isEmpty()?"name:"+name:source;Bitmap cached=avatarCache.get(cacheKey);if(cached!=null&&!cached.isRecycled())return cached;
  Bitmap loaded=null;
  try{byte[] bytes=null;
   if(source.startsWith("data:image/")&&source.contains(",")&&source.length()<2*1024*1024)bytes=android.util.Base64.decode(source.substring(source.indexOf(',')+1),0);
   else if(source.startsWith("https://")||source.startsWith("http://")){
    HttpURLConnection con=(HttpURLConnection)new URL(source).openConnection();con.setConnectTimeout(3500);con.setReadTimeout(3500);try{if(con.getResponseCode()==200)try(InputStream in=con.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] buf=new byte[8192];int n;while((n=in.read(buf))!=-1){if(out.size()+n>2*1024*1024)throw new IOException("large avatar");out.write(buf,0,n);}bytes=out.toByteArray();}}finally{con.disconnect();}
   }
   if(bytes!=null){BitmapFactory.Options bounds=new BitmapFactory.Options();bounds.inJustDecodeBounds=true;BitmapFactory.decodeByteArray(bytes,0,bytes.length,bounds);BitmapFactory.Options opts=new BitmapFactory.Options();opts.inSampleSize=1;while(bounds.outWidth/opts.inSampleSize>256||bounds.outHeight/opts.inSampleSize>256)opts.inSampleSize*=2;loaded=BitmapFactory.decodeByteArray(bytes,0,bytes.length,opts);}
  }catch(Exception ignored){}
  Bitmap result=Bitmap.createBitmap(128,128,Bitmap.Config.ARGB_8888);Canvas canvas=new Canvas(result);Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);
  if(loaded!=null){BitmapShader shader=new BitmapShader(loaded,Shader.TileMode.CLAMP,Shader.TileMode.CLAMP);Matrix m=new Matrix();float scale=Math.max(128f/loaded.getWidth(),128f/loaded.getHeight());m.setScale(scale,scale);m.postTranslate((128-loaded.getWidth()*scale)/2,(128-loaded.getHeight()*scale)/2);shader.setLocalMatrix(m);paint.setShader(shader);canvas.drawCircle(64,64,64,paint);loaded.recycle();}
  else{paint.setColor(Color.rgb(228,219,225));canvas.drawCircle(64,64,64,paint);paint.setColor(Color.rgb(83,72,80));paint.setTextSize(58);paint.setTextAlign(Paint.Align.CENTER);String initial=name.isEmpty()?"U":name.substring(0,name.offsetByCodePoints(0,1));canvas.drawText(initial,64,64-(paint.ascent()+paint.descent())/2,paint);}
  if(loaded!=null||source.isEmpty())avatarCache.put(cacheKey,result);return result;
 }
}
