namespace VelarisOkc.Drivers;

// Marka sürücüleri. Her biri, üreticinin GMP-3 entegrasyon kütüphanesi (SDK) eklendikten sonra "TODO SDK" işaretli
// yerlerde üreticinin karşılık gelen çağrısıyla doldurulur. Akış, sıralama, KDV/ödeme eşleme ve hata durumunda fiş
// iptali GmpDriverBase'dedir; burada yalnızca cihazla konuşulur.
//
// SDK ve teknik doküman üreticiden entegrasyon sözleşmesiyle alınır (GİB GMP-3 "Harici Sistem Bağlantısı"):
//   Beko / Token  → developer.tokeninc.com (300TR/400TR/X30TR)
//   Hugin         → Hugin teknik destek / iş ortakları
//   Ingenico      → iKasa GMP-3 entegrasyonu (Move 5000F)
//   Pavo          → Pavo entegrasyon kütüphaneleri
// SDK gelmeden bu sürücüler açık bir hata döndürür; kasada "Yazarkasaya tekrar gönder" çıkar, satış kaybolmaz.

public abstract class VendorDriverBase(Config config, string brand) : GmpDriverBase(config)
{
    protected Exception NeedsSdk(string step) =>
        new OkcException($"{brand} sürücüsü henüz bağlanmadı: '{step}' için üretici SDK'sı gerekli (bridge/adapter-dotnet/README.md).");

    protected override string DeviceName => $"{brand} ({Config.Host ?? Config.SerialPort ?? "bağlantı tanımsız"})";
    protected override void Connect() => throw NeedsSdk("bağlantı / eşleşme");                 // TODO SDK: cihazı aç, eşleşme durumunu oku
    protected override void Disconnect() { }                                                    // TODO SDK: bağlantıyı kapat
    protected override void BeginSaleReceipt(Receipt r) => throw NeedsSdk("fiş başlatma");     // TODO SDK: satış fişi başlat (+ müşteri VKN/TCKN)
    protected override void AddItem(ReceiptItem i, int vatGroup) => throw NeedsSdk("ürün satırı"); // TODO SDK: ad, miktar (kg ise ondalık), birim fiyat (TL), KDV grubu, satır indirimi
    protected override void ApplySubtotalDiscount(long amount) => throw NeedsSdk("fiş altı indirim");
    protected override void AddPayment(string type, long amount, Payment p) => throw NeedsSdk("ödeme"); // TODO SDK: kartta ÖKC'nin banka uygulamasını tetikle, onayı bekle
    protected override (string fiscalNo, string? zNo) CloseReceipt() => throw NeedsSdk("fiş kapatma");      // TODO SDK: fişi kapat; mali fiş no + Z no oku
    protected override void VoidReceipt() => throw NeedsSdk("fiş iptali");                     // TODO SDK: açık fişi iptal et
    protected override string? PrintZReport() => throw NeedsSdk("Z raporu");
    protected override void PrintXReport() => throw NeedsSdk("X raporu");
}

public sealed class BekoTokenDriver(Config c) : VendorDriverBase(c, "Beko / Token");
public sealed class HuginDriver(Config c) : VendorDriverBase(c, "Hugin");
public sealed class IngenicoDriver(Config c) : VendorDriverBase(c, "Ingenico");
public sealed class PavoDriver(Config c) : VendorDriverBase(c, "Pavo");

public static class DriverFactory
{
    public static GmpDriverBase Create(Config c) => c.Brand.ToLowerInvariant() switch
    {
        "simulator" => new SimulatorDriver(c),
        "beko" or "token" => new BekoTokenDriver(c),
        "hugin" => new HuginDriver(c),
        "ingenico" => new IngenicoDriver(c),
        "pavo" => new PavoDriver(c),
        _ => throw new OkcException($"Bilinmeyen marka: {c.Brand} (simulator | beko | hugin | ingenico | pavo)"),
    };
}
