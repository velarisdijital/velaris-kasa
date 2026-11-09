package com.velarisdijital.kasa;

import android.content.SharedPreferences;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /**
     * İndirilmiş web paketiyle (OTA) açılıyorsa açılış sayılır; web tarafı açılınca sayacı sıfırlar (otaConfirm).
     * Üst üste 2 açılışta onay gelmezse paket bozuk sayılır ve APK içindeki sürüme dönülür.
     */
    private void guardOta() {
        SharedPreferences cap = getSharedPreferences(com.getcapacitor.plugin.WebView.WEBVIEW_PREFS_NAME, MODE_PRIVATE);
        String path = cap.getString(com.getcapacitor.plugin.WebView.CAP_SERVER_PATH, "");
        SharedPreferences ota = getSharedPreferences(DevicePlugin.OTA_PREFS, MODE_PRIVATE);
        if (path == null || path.isEmpty()) { ota.edit().putInt("pendingBoots", 0).apply(); return; }
        int boots = ota.getInt("pendingBoots", 0);
        if (boots >= 2) {
            cap.edit().putString(com.getcapacitor.plugin.WebView.CAP_SERVER_PATH, "").apply();
            ota.edit().putInt("pendingBoots", 0).putString("failedPath", path).apply();
        } else {
            ota.edit().putInt("pendingBoots", boots + 1).apply();
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Klasik Bluetooth yazıcı (SPP) eklentisi uygulamanın içinde
        registerPlugin(ClassicPrinterPlugin.class);
        // Kasa modu: ekran kararmasın, tam ekran, uygulamayı sabitle, sürüm bilgisi, güncelleme
        registerPlugin(DevicePlugin.class);
        guardOta();
        super.onCreate(savedInstanceState);
    }
}
