package app.wanwan.personal;
import android.app.*;
import android.content.*;
import android.os.*;
import android.content.pm.ServiceInfo;

/** User-controlled foreground protection for the existing local chat runtime. */
public class KeepAliveService extends Service {
 public static final String CHANNEL="wanwan-background-v1";
 private PowerManager.WakeLock wake;
 private final Handler timer=new Handler(Looper.getMainLooper());
 private final Runnable renew=new Runnable(){public void run(){if(wake!=null){if(wake.isHeld())wake.release();wake.acquire(10*60*1000L);timer.postDelayed(this,9*60*1000L);}}};
 public void onCreate(){super.onCreate();NotificationManager manager=getSystemService(NotificationManager.class);NotificationChannel channel=new NotificationChannel(CHANNEL,"本地后台保活",NotificationManager.IMPORTANCE_LOW);channel.setDescription("用户开启时保护本地聊天运行，可随时关闭");channel.setShowBadge(false);manager.createNotificationChannel(channel);}
 public int onStartCommand(Intent intent,int flags,int id){
  if(intent!=null&&"STOP".equals(intent.getAction())){getSharedPreferences("mobile",0).edit().putBoolean("keepAlive",false).apply();stopSelf();return START_NOT_STICKY;}
  if(!getSharedPreferences("mobile",0).getBoolean("keepAlive",false)){stopSelf();return START_NOT_STICKY;}
  Intent open=new Intent(this,MainActivity.class);PendingIntent launch=PendingIntent.getActivity(this,0,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
  Intent stop=new Intent(this,KeepAliveService.class).setAction("STOP");PendingIntent end=PendingIntent.getService(this,0,stop,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
  Notification n=new Notification.Builder(this,CHANNEL).setSmallIcon(getResources().getIdentifier("notification","drawable",getPackageName())).setContentTitle("WanWan 正在后台守候").setContentText("保护本地聊天运行 · 点此返回").setContentIntent(launch).setOngoing(true).setShowWhen(false).addAction(new Notification.Action.Builder(null,"关闭保活",end).build()).build();
  if(Build.VERSION.SDK_INT>=34)startForeground(7,n,ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);else startForeground(7,n);
  if(wake==null){wake=((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"WanWan:local-chat");wake.setReferenceCounted(false);renew.run();}
  return START_STICKY;
 }
 public IBinder onBind(Intent intent){return null;}
 public void onDestroy(){timer.removeCallbacksAndMessages(null);if(wake!=null&&wake.isHeld())wake.release();stopForeground(STOP_FOREGROUND_REMOVE);super.onDestroy();}
}
