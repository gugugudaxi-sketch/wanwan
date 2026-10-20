"""Build with Android SDK build-tools 35, platform android-35 and Eclipse ECJ.
ANDROID_BUILD_TOOLS, ANDROID_JAR, ECJ_JAR and WANWAN_KEYSTORE are absolute paths.
Signing credentials come from WANWAN_STORE_PASS / WANWAN_KEY_ALIAS.
"""
from pathlib import Path
import subprocess,os,zipfile,shutil,re
root=Path(__file__).resolve().parents[1]; repo=root.parent
sdk=Path(os.environ['ANDROID_BUILD_TOOLS']); jar=Path(os.environ['ANDROID_JAR']); ecj=Path(os.environ['ECJ_JAR'])
out=root/'build';out.mkdir(exist_ok=True)
assets=out/'assets'; web=assets/'www'
if assets.exists():shutil.rmtree(assets)
web.mkdir(parents=True)
for n in ['css','js','img','audio']:shutil.copytree(repo/n,web/n)
for n in ['service.js','manifest.json']:shutil.copy2(repo/n,web/n)
shutil.copytree(root/'vendor',web/'android-vendor');shutil.copy2(root/'bridge.js',web/'android-bridge.js')
s=(repo/'index.html').read_text();a=s.index('  <!-- Dexie');b=s.index('  <!-- CSS',a)
s=s[:a]+'  <script src="android-vendor/dexie.js"></script>\n  <script src="android-vendor/jszip.min.js"></script>\n  <script src="android-bridge.js"></script>\n'+s[b:]
s=s.replace('https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@7.2.0/css/all.min.css','android-vendor/fontawesome/css/all.min.css')
(web/'index.html').write_text(s)
def run(*a):subprocess.run([str(x) for x in a],check=True)
run(sdk/'aapt2','compile','--dir',root/'app/src/main/res','-o',out/'resources.zip')
run(sdk/'aapt2','link','-I',jar,'--manifest',root/'app/src/main/AndroidManifest.xml','-o',out/'unsigned.apk',out/'resources.zip','-A',assets)
classes=out/'classes';classes.mkdir(exist_ok=True)
run('java','-jar',ecj,'-source','1.8','-target','1.8','-classpath',jar,'-d',classes,*sorted((root/'app/src/main/java').rglob('*.java')))
dex=out/'dex';dex.mkdir(exist_ok=True)
run('java','-cp',sdk/'lib/d8.jar','com.android.tools.r8.D8','--lib',jar,'--min-api','26','--output',dex,*classes.rglob('*.class'))
with zipfile.ZipFile(out/'unsigned.apk','a',zipfile.ZIP_DEFLATED) as z:
 for p in dex.glob('*.dex'):z.write(p,p.name)
run(sdk/'zipalign','-f','4',out/'unsigned.apk',out/'aligned.apk')
apk=out/'WanWan-1.0.0.apk'
run('java','-jar',sdk/'lib/apksigner.jar','sign','--ks',os.environ['WANWAN_KEYSTORE'],'--ks-pass','env:WANWAN_STORE_PASS','--ks-key-alias',os.environ.get('WANWAN_KEY_ALIAS','wanwan'),'--out',apk,out/'aligned.apk')
run('java','-jar',sdk/'lib/apksigner.jar','verify','--verbose',apk)
print(apk,apk.stat().st_size)
