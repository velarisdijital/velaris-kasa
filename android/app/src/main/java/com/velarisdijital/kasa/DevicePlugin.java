package com.velarisdijital.kasa;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import android.view.Window;
import android.view.WindowManager;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Tableti kasa olarak kullanmak için cihaz ayarları: ekran kararmasın, tam ekran, uygulamayı sabitle,
 * sürüm bilgisi ve dış bağlantı açma (güncelleme indirme).
 */
@CapacitorPlugin(name = "VKDevice")
public class DevicePlugin extends Plugin {
    /** Yerel eklenti sürümü: web güncellemesi (OTA) bundan yeni yerel özellik isterse önce APK güncellenir. */
    public static final int NATIVE_API = 2;
    static final String OTA_PREFS = "VKOta";

    @PluginMethod
    public void appInfo(PluginCall call) {
        try {
            Context c = getContext();
            PackageInfo p = c.getPackageManager().getPackageInfo(c.getPackageName(), 0);
            long code = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? p.getLongVersionCode() : p.versionCode;
            JSObject r = new JSObject();
            r.put("versionName", p.versionName);
            r.put("versionCode", code);
            r.put("android", Build.VERSION.RELEASE);
            r.put("nativeApi", NATIVE_API);
            r.put("model", Build.MANUFACTURER + " " + Build.MODEL);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Sürüm bilgisi alınamadı: " + e.getMessage());
        }
    }

    /** Ekran kararmasın (kasa açıkken tablet uykuya geçmesin). */
    @PluginMethod
    public void keepAwake(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", true));
        final Activity a = getActivity();
        a.runOnUiThread(() -> {
            if (on) a.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else a.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }

    /** Tam ekran: üst bildirim çubuğu ve alt gezinme çubuğu gizlenir (kenardan kaydırınca geçici görünür). */
    @PluginMethod
    public void immersive(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", true));
        final Activity a = getActivity();
        a.runOnUiThread(() -> {
            Window w = a.getWindow();
            WindowInsetsControllerCompat c = WindowCompat.getInsetsController(w, w.getDecorView());
            if (on) {
                c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                c.hide(WindowInsetsCompat.Type.systemBars());
            } else {
                c.show(WindowInsetsCompat.Type.systemBars());
            }
            call.resolve();
        });
    }

    /** Uygulamayı sabitle (Android ekran sabitleme): kullanıcı uygulamadan çıkamaz. */
    @PluginMethod
    public void pin(PluginCall call) {
        final Activity a = getActivity();
        a.runOnUiThread(() -> {
            try { a.startLockTask(); call.resolve(); } catch (Exception e) { call.reject("Uygulama sabitlenemedi: " + e.getMessage()); }
        });
    }

    @PluginMethod
    public void unpin(PluginCall call) {
        final Activity a = getActivity();
        a.runOnUiThread(() -> {
            try { a.stopLockTask(); call.resolve(); } catch (Exception e) { call.reject("Sabitleme kaldırılamadı: " + e.getMessage()); }
        });
    }

    @PluginMethod
    public void isPinned(PluginCall call) {
        ActivityManager am = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
        boolean pinned = am != null && am.getLockTaskModeState() != ActivityManager.LOCK_TASK_MODE_NONE;
        JSObject r = new JSObject();
        r.put("pinned", pinned);
        call.resolve(r);
    }

    // ---------------------------------------------------------------- Güncelleme (OTA)

    /** Dosyayı indirir (yönlendirmeleri izler). */
    private File download(String url, File out) throws Exception {
        out.getParentFile().mkdirs();
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setInstanceFollowRedirects(true);
        c.setConnectTimeout(20000);
        c.setReadTimeout(60000);
        int code = c.getResponseCode();
        if (code >= 300 && code < 400) { // farklı alan adına yönlendirme (GitHub → indirme sunucusu)
            String loc = c.getHeaderField("Location");
            c.disconnect();
            return download(loc, out);
        }
        if (code != 200) throw new Exception("HTTP " + code);
        long total = c.getContentLengthLong();
        File tmp = new File(out.getPath() + ".part");
        try (InputStream in = c.getInputStream(); FileOutputStream fo = new FileOutputStream(tmp)) {
            byte[] buf = new byte[64 * 1024];
            long done = 0; int n; int lastPct = -1;
            while ((n = in.read(buf)) > 0) {
                fo.write(buf, 0, n);
                done += n;
                if (total > 0) {
                    int pct = (int) (done * 100 / total);
                    if (pct != lastPct) { lastPct = pct; JSObject p = new JSObject(); p.put("pct", pct); notifyListeners("downloadProgress", p); }
                }
            }
        } finally { c.disconnect(); }
        if (out.exists()) out.delete();
        if (!tmp.renameTo(out)) throw new Exception("Dosya kaydedilemedi");
        return out;
    }

    /** Web paketini (tek index.html) indirir: files/ota/<build>/index.html. Dönüş: { path } (klasör) */
    @PluginMethod
    public void otaDownload(PluginCall call) {
        final String url = call.getString("url");
        final String build = call.getString("build");
        if (url == null || build == null) { call.reject("Adres ve sürüm gerekli"); return; }
        new Thread(() -> {
            try {
                File dir = new File(getContext().getFilesDir(), "ota/" + build.replaceAll("[^0-9A-Za-z._-]", ""));
                File f = download(url, new File(dir, "index.html"));
                if (f.length() < 10000) throw new Exception("İndirilen paket eksik");
                JSObject r = new JSObject();
                r.put("path", dir.getAbsolutePath());
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Güncelleme indirilemedi: " + e.getMessage());
            }
        }).start();
    }

    /** Yeni web paketi sorunsuz açıldı: açılış sayacını sıfırla (2 başarısız açılışta MainActivity eski sürüme döner). */
    @PluginMethod
    public void otaConfirm(PluginCall call) {
        getContext().getSharedPreferences(OTA_PREFS, Activity.MODE_PRIVATE).edit().putInt("pendingBoots", 0).apply();
        call.resolve();
    }

    /** Yerleşik (APK içindeki) web paketine döner. */
    @PluginMethod
    public void otaReset(PluginCall call) {
        getContext().getSharedPreferences(com.getcapacitor.plugin.WebView.WEBVIEW_PREFS_NAME, Activity.MODE_PRIVATE)
            .edit().putString(com.getcapacitor.plugin.WebView.CAP_SERVER_PATH, "").apply();
        call.resolve();
    }

    /** APK'yı indirip Android'in kurulum ekranını açar (kullanıcı "Güncelle"ye basar; veriler silinmez). */
    @PluginMethod
    public void installApk(PluginCall call) {
        final String url = call.getString("url");
        if (url == null) { call.reject("Adres gerekli"); return; }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
            try {
                Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
            } catch (Exception ignored) { }
            call.reject("Önce bu uygulamaya \"bilinmeyen uygulamaları yükleme\" izni verin (açılan ekranda), sonra tekrar Güncelle'ye basın.");
            return;
        }
        new Thread(() -> {
            try {
                File apk = download(url, new File(getContext().getCacheDir(), "apk/VelarisKasa.apk"));
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
                Intent i = new Intent(Intent.ACTION_VIEW);
                i.setDataAndType(uri, "application/vnd.android.package-archive");
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
                call.resolve();
            } catch (Exception e) {
                call.reject("Güncelleme indirilemedi: " + e.getMessage());
            }
        }).start();
    }

    /** Bağlantıyı tarayıcıda açar (ör. yeni sürüm APK'sını indirmek için). */
    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null) { call.reject("Adres gerekli"); return; }
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Bağlantı açılamadı: " + e.getMessage());
        }
    }
}
