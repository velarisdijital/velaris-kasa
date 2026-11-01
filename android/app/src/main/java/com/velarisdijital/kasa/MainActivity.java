package com.velarisdijital.kasa;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Klasik Bluetooth yazıcı (SPP) eklentisi uygulamanın içinde
        registerPlugin(ClassicPrinterPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
