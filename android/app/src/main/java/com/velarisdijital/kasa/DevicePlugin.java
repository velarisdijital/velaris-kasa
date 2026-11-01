package com.velarisdijital.kasa;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
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
