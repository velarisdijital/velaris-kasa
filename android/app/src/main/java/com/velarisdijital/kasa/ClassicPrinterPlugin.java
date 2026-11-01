package com.velarisdijital.kasa;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.location.LocationManager;
import android.os.Handler;
import android.os.Looper;
import android.os.Build;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.IOException;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Klasik Bluetooth (SPP / RFCOMM) yazıcı bağlantısı.
 * Tabletin Bluetooth ayarlarından eşleştirilmiş fiş / etiket yazıcılarına ham bayt (TSPL, ESC/POS) gönderir.
 */
@CapacitorPlugin(
    name = "ClassicPrinter",
    permissions = {
        @Permission(strings = { Manifest.permission.BLUETOOTH_CONNECT }, alias = "bt"),
        @Permission(strings = { Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }, alias = "scan"),
        @Permission(strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }, alias = "location")
    }
)
public class ClassicPrinterPlugin extends Plugin {
    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private BluetoothSocket socket;
    private String socketAddress;

    private boolean needsPermission() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && getPermissionState("bt") != PermissionState.GRANTED;
    }

    private BluetoothAdapter adapter() {
        BluetoothManager m = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return m == null ? null : m.getAdapter();
    }

    @PluginMethod
    public void bonded(PluginCall call) {
        if (needsPermission()) { requestPermissionForAlias("bt", call, "btPermsBonded"); return; }
        listBonded(call);
    }

    @PermissionCallback
    private void btPermsBonded(PluginCall call) {
        if (needsPermission()) { call.reject("Bluetooth izni verilmedi"); return; }
        listBonded(call);
    }

    @SuppressLint("MissingPermission")
    private void listBonded(PluginCall call) {
        BluetoothAdapter a = adapter();
        if (a == null) { call.reject("Bu cihazda Bluetooth yok"); return; }
        if (!a.isEnabled()) { call.reject("Bluetooth kapalı"); return; }
        JSArray list = new JSArray();
        Set<BluetoothDevice> devices = a.getBondedDevices();
        for (BluetoothDevice d : devices) {
            JSObject o = new JSObject();
            o.put("address", d.getAddress());
            o.put("name", d.getName() == null ? "" : d.getName());
            // 1 = klasik, 2 = LE, 3 = ikisi de
            o.put("type", d.getType());
            list.put(o);
        }
        JSObject r = new JSObject();
        r.put("devices", list);
        call.resolve(r);
    }

    @PluginMethod
    public void write(PluginCall call) {
        if (needsPermission()) { requestPermissionForAlias("bt", call, "btPermsWrite"); return; }
        doWrite(call);
    }

    @PermissionCallback
    private void btPermsWrite(PluginCall call) {
        if (needsPermission()) { call.reject("Bluetooth izni verilmedi"); return; }
        doWrite(call);
    }

    private void doWrite(PluginCall call) {
        final String address = call.getString("address");
        final String data = call.getString("data");
        if (address == null || data == null) { call.reject("Adres ve veri gerekli"); return; }
        // Ucuz yazıcıların Bluetooth modülü veriyi yavaş okur (çoğu ~115200 baud ≈ 11 KB/sn) ve akış kontrolü yoktur;
        // hızlı gönderilirse arabellek taşar, resim bozulur (boş etiket) ve yazıcı hataya düşer. Bu yüzden yavaş ve parça parça.
        final int chunk = Math.max(20, call.getInt("chunk", 256));
        final int delay = Math.max(0, call.getInt("delay", 30));
        new Thread(() -> {
            try {
                byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                OutputStream out = connect(address).getOutputStream();
                for (int i = 0; i < bytes.length; i += chunk) {
                    out.write(bytes, i, Math.min(chunk, bytes.length - i));
                    out.flush();
                    if (delay > 0) Thread.sleep(delay);
                }
                JSObject r = new JSObject();
                r.put("bytes", bytes.length);
                call.resolve(r);
            } catch (Exception e) {
                closeSocket();
                call.reject("Klasik Bluetooth ile yazılamadı: " + e.getMessage());
            }
        }).start();
    }

    /** Yazıcıya komut gönderir ve yanıtını okur (ör. TSPL durum sorgusu ESC ! ?). */
    @PluginMethod
    public void transact(PluginCall call) {
        if (needsPermission()) { requestPermissionForAlias("bt", call, "btPermsTransact"); return; }
        doTransact(call);
    }

    @PermissionCallback
    private void btPermsTransact(PluginCall call) {
        if (needsPermission()) { call.reject("Bluetooth izni verilmedi"); return; }
        doTransact(call);
    }

    private void doTransact(PluginCall call) {
        final String address = call.getString("address");
        final String data = call.getString("data");
        final int wait = call.getInt("timeout", 2000);
        if (address == null || data == null) { call.reject("Adres ve veri gerekli"); return; }
        new Thread(() -> {
            try {
                BluetoothSocket s = connect(address);
                java.io.InputStream in = s.getInputStream();
                while (in.available() > 0) in.read(new byte[in.available()]); // eski yanıtları at
                OutputStream out = s.getOutputStream();
                out.write(Base64.decode(data, Base64.DEFAULT));
                out.flush();
                java.io.ByteArrayOutputStream got = new java.io.ByteArrayOutputStream();
                long end = System.currentTimeMillis() + wait;
                long quietUntil = 0;
                while (System.currentTimeMillis() < end) {
                    int n = in.available();
                    if (n > 0) {
                        byte[] buf = new byte[n];
                        int r = in.read(buf);
                        if (r > 0) got.write(buf, 0, r);
                        quietUntil = System.currentTimeMillis() + 150;
                    } else if (quietUntil > 0 && System.currentTimeMillis() > quietUntil) {
                        break;
                    } else {
                        Thread.sleep(20);
                    }
                }
                JSObject r = new JSObject();
                r.put("data", Base64.encodeToString(got.toByteArray(), Base64.NO_WRAP));
                r.put("bytes", got.size());
                call.resolve(r);
            } catch (Exception e) {
                closeSocket();
                call.reject("Yazıcıdan yanıt alınamadı: " + e.getMessage());
            }
        }).start();
    }

    @SuppressLint("MissingPermission")
    private synchronized BluetoothSocket connect(String address) throws IOException {
        if (socket != null && socket.isConnected() && address.equals(socketAddress)) return socket;
        closeSocket();
        BluetoothAdapter a = adapter();
        if (a == null || !a.isEnabled()) throw new IOException("Bluetooth kapalı");
        a.cancelDiscovery();
        BluetoothDevice device = a.getRemoteDevice(address);
        BluetoothSocket s;
        try {
            s = device.createRfcommSocketToServiceRecord(SPP);
            s.connect();
        } catch (IOException first) {
            try {
                s = device.createInsecureRfcommSocketToServiceRecord(SPP);
                s.connect();
            } catch (IOException second) {
                // Bazı ucuz yazıcılar SDP kaydı vermez: doğrudan 1 numaralı kanala bağlan
                try {
                    Method m = device.getClass().getMethod("createRfcommSocket", int.class);
                    s = (BluetoothSocket) m.invoke(device, 1);
                    s.connect();
                } catch (Exception third) {
                    throw new IOException(first.getMessage());
                }
            }
        }
        socket = s;
        socketAddress = address;
        return s;
    }

    private synchronized void closeSocket() {
        if (socket != null) {
            try { socket.close(); } catch (IOException ignored) { }
        }
        socket = null;
        socketAddress = null;
    }

    // ---------------------------------------------------------------- Klasik Bluetooth araması ve eşleştirme
    private BroadcastReceiver discoveryReceiver;

    private boolean needsScanPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return getPermissionState("bt") != PermissionState.GRANTED
                || getContext().checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN) != android.content.pm.PackageManager.PERMISSION_GRANTED;
        }
        return getPermissionState("location") != PermissionState.GRANTED;
    }

    /** Yakındaki klasik Bluetooth cihazlarını arar (eşleşmeye açık yazıcılar). Bulunanlar "deviceFound" olayıyla anında bildirilir. */
    @PluginMethod
    public void discover(PluginCall call) {
        if (needsScanPermission()) {
            requestPermissionForAlias(Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? "scan" : "location", call, "scanPerms");
            return;
        }
        startDiscovery(call);
    }

    @PermissionCallback
    private void scanPerms(PluginCall call) {
        if (needsScanPermission()) { call.reject("Bluetooth tarama izni verilmedi"); return; }
        startDiscovery(call);
    }

    @SuppressLint("MissingPermission")
    private void startDiscovery(PluginCall call) {
        BluetoothAdapter a = adapter();
        if (a == null) { call.reject("Bu cihazda Bluetooth yok"); return; }
        if (!a.isEnabled()) { call.reject("Bluetooth kapalı"); return; }
        LocationManager lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        final boolean locationOn = lm != null && (lm.isProviderEnabled(LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER));
        if (!locationOn && Build.VERSION.SDK_INT < Build.VERSION_CODES.S) { call.reject("Konum kapalı: Bluetooth araması için tabletin Konum ayarını açın"); return; }
        stopDiscoveryReceiver();
        final Map<String, JSObject> found = new HashMap<>();
        discoveryReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (!BluetoothDevice.ACTION_FOUND.equals(intent.getAction())) return;
                BluetoothDevice d = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                if (d == null) return;
                JSObject o = new JSObject();
                o.put("address", d.getAddress());
                o.put("name", d.getName() == null ? "" : d.getName());
                o.put("type", d.getType());
                o.put("rssi", intent.getShortExtra(BluetoothDevice.EXTRA_RSSI, Short.MIN_VALUE));
                o.put("bonded", d.getBondState() == BluetoothDevice.BOND_BONDED);
                found.put(d.getAddress(), o);
                notifyListeners("deviceFound", o);
            }
        };
        getContext().registerReceiver(discoveryReceiver, new IntentFilter(BluetoothDevice.ACTION_FOUND));
        if (a.isDiscovering()) a.cancelDiscovery();
        if (!a.startDiscovery()) { stopDiscoveryReceiver(); call.reject("Bluetooth araması başlatılamadı"); return; }
        int ms = call.getInt("timeout", 12000);
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            try { a.cancelDiscovery(); } catch (Exception ignored) { }
            stopDiscoveryReceiver();
            JSArray list = new JSArray();
            for (JSObject o : found.values()) list.put(o);
            JSObject r = new JSObject();
            r.put("devices", list);
            r.put("locationOn", locationOn);
            call.resolve(r);
        }, ms);
    }

    private void stopDiscoveryReceiver() {
        if (discoveryReceiver != null) {
            try { getContext().unregisterReceiver(discoveryReceiver); } catch (Exception ignored) { }
            discoveryReceiver = null;
        }
    }

    /** Cihazla eşleşir (tablet eşleştirme penceresini gösterebilir). Eşleşince ya da 40 sn sonra döner. */
    @PluginMethod
    public void bond(PluginCall call) {
        if (needsPermission()) { requestPermissionForAlias("bt", call, "btPermsBond"); return; }
        doBond(call);
    }

    @PermissionCallback
    private void btPermsBond(PluginCall call) {
        if (needsPermission()) { call.reject("Bluetooth izni verilmedi"); return; }
        doBond(call);
    }

    @SuppressLint("MissingPermission")
    private void doBond(PluginCall call) {
        String address = call.getString("address");
        BluetoothAdapter a = adapter();
        if (a == null || address == null) { call.reject("Adres gerekli"); return; }
        try { a.cancelDiscovery(); } catch (Exception ignored) { }
        BluetoothDevice d = a.getRemoteDevice(address);
        if (d.getBondState() == BluetoothDevice.BOND_BONDED) { JSObject r = new JSObject(); r.put("bonded", true); call.resolve(r); return; }
        if (!d.createBond()) { call.reject("Eşleştirme başlatılamadı"); return; }
        new Thread(() -> {
            for (int i = 0; i < 80; i++) {
                try { Thread.sleep(500); } catch (InterruptedException ignored) { }
                int st = d.getBondState();
                if (st == BluetoothDevice.BOND_BONDED) { JSObject r = new JSObject(); r.put("bonded", true); call.resolve(r); return; }
                if (st == BluetoothDevice.BOND_NONE && i > 4) { call.reject("Eşleştirme yapılamadı ya da iptal edildi"); return; }
            }
            call.reject("Eşleştirme zaman aşımına uğradı");
        }).start();
    }

    /** Tabletin Bluetooth ayarları ekranını açar. */
    @PluginMethod
    public void openSettings(PluginCall call) {
        try {
            Intent i = new Intent(android.provider.Settings.ACTION_BLUETOOTH_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Bluetooth ayarları açılamadı: " + e.getMessage());
        }
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        closeSocket();
        call.resolve();
    }
}
