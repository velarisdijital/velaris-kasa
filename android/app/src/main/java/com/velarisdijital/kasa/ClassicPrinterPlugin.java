package com.velarisdijital.kasa;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
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
import java.util.Set;
import java.util.UUID;

/**
 * Klasik Bluetooth (SPP / RFCOMM) yazıcı bağlantısı.
 * Tabletin Bluetooth ayarlarından eşleştirilmiş fiş / etiket yazıcılarına ham bayt (TSPL, ESC/POS) gönderir.
 */
@CapacitorPlugin(
    name = "ClassicPrinter",
    permissions = { @Permission(strings = { Manifest.permission.BLUETOOTH_CONNECT }, alias = "bt") }
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
        new Thread(() -> {
            try {
                byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                OutputStream out = connect(address).getOutputStream();
                int chunk = 2048;
                for (int i = 0; i < bytes.length; i += chunk) {
                    out.write(bytes, i, Math.min(chunk, bytes.length - i));
                    out.flush();
                    Thread.sleep(20);
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

    @PluginMethod
    public void disconnect(PluginCall call) {
        closeSocket();
        call.resolve();
    }
}
