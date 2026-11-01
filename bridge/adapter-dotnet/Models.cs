using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace VelarisOkc;

/// <summary>Köprüden gelen istek: { "action": "receipt", "data": { ... } }. Tutarlar KURUŞ.</summary>
public sealed record BridgeRequest(string Action, JsonNode? Data);

public sealed record ReceiptItem(string Name, string? Barcode, decimal Qty, string? Unit, long UnitPrice, long Discount, decimal VatRate, long LineTotal);
public sealed record Payment(string Method, long Amount);
public sealed record Party(string? Name, string? TaxNumber);

public sealed record Receipt(
    long SaleId, string ReceiptNo, string? CreatedAt, string? Cashier, string? RegisterName,
    Party? Business, Party? Customer, List<ReceiptItem> Items, long Subtotal, long Discount, long Total, List<Payment> Payments);

public sealed record RefundLine(string Name, decimal Qty, long Amount, decimal VatRate);
public sealed record RefundRequest(long SaleId, string ReceiptNo, string? FiscalNo, long Amount, string Method, List<RefundLine> Items);

public sealed record Result(bool Ok, string? FiscalNo = null, string? ZNo = null, string? Device = null, string? Message = null, string? Error = null);

public sealed class OkcException(string message) : Exception(message);

public static class Json
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        NumberHandling = JsonNumberHandling.AllowReadingFromString,
    };
}

/// <summary>okc.json: marka, bağlantı ve eşlemeler.</summary>
public sealed class Config
{
    public string Brand { get; set; } = "simulator";       // simulator | beko | hugin | ingenico | pavo
    public string? Host { get; set; }                      // Ethernet bağlantılı cihaz IP'si
    public int TcpPort { get; set; } = 4444;
    public string? SerialPort { get; set; }                // COM3 gibi
    public string StatePath { get; set; } = "okc-state.json";
    /// <summary>KDV oranı → cihazdaki KDV grubu / departman numarası.</summary>
    public Dictionary<string, int> VatGroups { get; set; } = new() { ["0"] = 1, ["1"] = 2, ["10"] = 3, ["20"] = 4 };
    /// <summary>VelarisKasa ödeme yöntemi → cihaz ödeme tipi (marka SDK'sına göre değer).</summary>
    public Dictionary<string, string> Payments { get; set; } = new()
    {
        ["cash"] = "NAKIT", ["card"] = "KREDI_KARTI", ["transfer"] = "HAVALE", ["credit"] = "ACIK_HESAP", ["points"] = "INDIRIM", ["online"] = "DIGER",
    };

    public static Config Load()
    {
        var dir = AppContext.BaseDirectory;
        var path = Environment.GetEnvironmentVariable("OKC_CONFIG") ?? Path.Combine(dir, "okc.json");
        var cfg = File.Exists(path) ? JsonSerializer.Deserialize<Config>(File.ReadAllText(path), Json.Options) ?? new() : new();
        var brand = Environment.GetEnvironmentVariable("OKC_BRAND");
        if (!string.IsNullOrWhiteSpace(brand)) cfg.Brand = brand;
        if (!Path.IsPathRooted(cfg.StatePath)) cfg.StatePath = Path.Combine(dir, cfg.StatePath);
        return cfg;
    }
}
