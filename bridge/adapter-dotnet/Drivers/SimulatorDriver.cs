using System.Text.Json;

namespace VelarisOkc.Drivers;

/// <summary>Cihaz olmadan deneme: ortak akışın tamamından geçer, sayaçları dosyada tutar, fişi konsola (stderr) yazar.</summary>
public sealed class SimulatorDriver(Config config) : GmpDriverBase(config)
{
    private sealed class State { public int FiscalNo { get; set; } public int ZNo { get; set; } = 1; }
    private State _state = new();
    private readonly List<string> _lines = [];

    protected override string DeviceName => "Simülatör (VelarisOkc)";

    protected override void Connect()
    {
        if (File.Exists(Config.StatePath)) _state = JsonSerializer.Deserialize<State>(File.ReadAllText(Config.StatePath)) ?? new();
    }

    protected override void Disconnect() => File.WriteAllText(Config.StatePath, JsonSerializer.Serialize(_state));

    protected override void BeginSaleReceipt(Receipt r) => _lines.Add($"FİŞ {r.ReceiptNo} · {r.Business?.Name}");
    protected override void AddItem(ReceiptItem i, int vatGroup) => _lines.Add($"  {i.Name} {i.Qty} x {Tl(i.UnitPrice)} KDV-G{vatGroup} = {Tl(i.LineTotal)}");
    protected override void ApplySubtotalDiscount(long amount) => _lines.Add($"  İNDİRİM -{Tl(amount)}");

    protected override void AddPayment(string type, long amount, Payment p)
    {
        if (p.Method == "card" && Environment.GetEnvironmentVariable("OKC_SIM_DECLINE") == "1") throw new OkcException("Kart reddedildi (simülatör)");
        _lines.Add($"  {type} {Tl(amount)}");
    }

    protected override (string fiscalNo, string? zNo) CloseReceipt()
    {
        _state.FiscalNo++;
        Console.Error.WriteLine(string.Join(Environment.NewLine, _lines));
        return (_state.FiscalNo.ToString("D4"), _state.ZNo.ToString("D4"));
    }

    protected override void VoidReceipt() => Console.Error.WriteLine("  FİŞ İPTAL");
    protected override string? PrintZReport() { var z = _state.ZNo.ToString("D4"); _state.ZNo++; _state.FiscalNo = 0; return z; }
    protected override void PrintXReport() { }
    protected override void Refund(RefundRequest r) => Console.Error.WriteLine($"İADE {r.ReceiptNo} {Tl(r.Amount)}");
}
