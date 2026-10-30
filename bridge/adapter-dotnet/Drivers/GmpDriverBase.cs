namespace VelarisOkc.Drivers;

/// <summary>
/// Yeni nesil ÖKC'de (GMP-3 harici sistem bağlantısı) bir satış fişinin ortak akışı.
/// Markaya özel sürücüler yalnızca aşağıdaki soyut temel işlemleri üreticinin SDK'sıyla doldurur.
///
///   Bağlan → Fiş aç → Satırlar (KDV grubu ile) → Fiş altı indirim → Ödemeler (kart: ÖKC'ye bağlı POS) → Fişi kapat
///   Herhangi bir adımda hata olursa açık fiş İPTAL edilir; yarım fiş cihazda kalmaz.
/// </summary>
public abstract class GmpDriverBase(Config config)
{
    protected Config Config { get; } = config;

    // ---- Markanın dolduracağı temel işlemler (SDK çağrıları) ----
    protected abstract string DeviceName { get; }
    protected abstract void Connect();                                     // TCP/seri bağlantı + GMP eşleşme kontrolü
    protected abstract void Disconnect();
    protected abstract void BeginSaleReceipt(Receipt receipt);             // fiş başlat (satış fişi; müşteri VKN varsa bilgi alanı)
    protected abstract void AddItem(ReceiptItem item, int vatGroup);       // ürün satırı; satır indirimi varsa satır indirimi
    protected abstract void ApplySubtotalDiscount(long amountKurus);       // fiş altı indirim
    protected abstract void AddPayment(string deviceType, long amountKurus, Payment payment); // kart ise ÖKC'nin POS'u çalışır, onay bekler
    protected abstract (string fiscalNo, string? zNo) CloseReceipt();      // fişi kapat, mali fiş ve Z numarasını döndür
    protected abstract void VoidReceipt();                                 // açık fişi iptal et
    protected abstract string? PrintZReport();                             // gün sonu (Z) raporu
    protected abstract void PrintXReport();
    protected virtual void Refund(RefundRequest refund) =>
        throw new OkcException("Bu cihazda iade programdan yapılamıyor; gider pusulası / iade faturası düzenleyin.");

    // ---- Ortak akış ----
    public Result Status()
    {
        Connect();
        try { return new Result(true, Device: DeviceName, Message: "Hazır"); }
        finally { Disconnect(); }
    }

    public Result PrintReceipt(Receipt r)
    {
        Validate(r);
        Connect();
        var open = false;
        try
        {
            BeginSaleReceipt(r);
            open = true;
            foreach (var item in r.Items) AddItem(item, VatGroup(item.VatRate));
            // Puanla ödenen kısım cihazda indirim olarak işlenir (ödeme tipi "INDIRIM" ise)
            var pointsAsDiscount = r.Payments.Where(p => p.Method == "points" && PaymentType("points") == "INDIRIM").Sum(p => p.Amount);
            if (r.Discount + pointsAsDiscount > 0) ApplySubtotalDiscount(r.Discount + pointsAsDiscount);
            foreach (var p in r.Payments.Where(p => p.Amount > 0))
            {
                var type = PaymentType(p.Method);
                if (type == "INDIRIM") continue;
                AddPayment(type, p.Amount, p);
            }
            var (fiscalNo, zNo) = CloseReceipt();
            open = false;
            return new Result(true, FiscalNo: fiscalNo, ZNo: zNo);
        }
        catch
        {
            if (open) { try { VoidReceipt(); } catch { /* iptal de başarısızsa asıl hatayı göster */ } }
            throw;
        }
        finally { Disconnect(); }
    }

    public Result ZReport()
    {
        Connect();
        try { return new Result(true, ZNo: PrintZReport()); }
        finally { Disconnect(); }
    }

    public Result XReport()
    {
        Connect();
        try { PrintXReport(); return new Result(true); }
        finally { Disconnect(); }
    }

    public Result DoRefund(RefundRequest refund)
    {
        Connect();
        try { Refund(refund); return new Result(true); }
        finally { Disconnect(); }
    }

    // ---- Yardımcılar ----
    protected int VatGroup(decimal rate)
    {
        var key = decimal.Truncate(rate) == rate ? ((int)rate).ToString() : rate.ToString(System.Globalization.CultureInfo.InvariantCulture);
        return Config.VatGroups.TryGetValue(key, out var g) ? g : throw new OkcException($"%{key} KDV için cihazda grup tanımlı değil (okc.json → vat_groups)");
    }

    protected string PaymentType(string method) =>
        Config.Payments.TryGetValue(method, out var t) ? t : throw new OkcException($"'{method}' ödemesi için cihaz ödeme tipi tanımlı değil (okc.json → payments)");

    public static decimal Tl(long kurus) => kurus / 100m;

    private static void Validate(Receipt r)
    {
        if (r.Items.Count == 0) throw new OkcException("Fişte ürün yok");
        var sum = r.Items.Sum(i => i.LineTotal) - r.Discount;
        if (sum != r.Total) throw new OkcException($"Fiş toplamı tutmuyor ({Tl(sum)} ≠ {Tl(r.Total)})");
        var paid = r.Payments.Sum(p => p.Amount);
        if (paid != r.Total) throw new OkcException($"Ödemeler toplamla eşleşmiyor ({Tl(paid)} ≠ {Tl(r.Total)})");
    }
}
