// VelarisOkc — yazarkasa ara programı.
// stdin:  { "action": "status" | "receipt" | "refund" | "z-report" | "x-report", "data": { ... } }
// stdout: { "ok": true, "fiscal_no": "0042", "z_no": "0153" }  ya da  { "ok": false, "error": "..." }
// Ayrıntılar: README.md
using System.Text.Json;
using VelarisOkc;
using VelarisOkc.Drivers;

Result result;
try
{
    var input = Console.In.ReadToEnd();
    var req = JsonSerializer.Deserialize<BridgeRequest>(input, Json.Options) ?? throw new OkcException("Boş istek");
    var driver = DriverFactory.Create(Config.Load());
    T Data<T>() => req.Data.Deserialize<T>(Json.Options) ?? throw new OkcException("İstek verisi eksik");
    result = req.Action switch
    {
        "status" => driver.Status(),
        "receipt" => driver.PrintReceipt(Data<Receipt>()),
        "refund" => driver.DoRefund(Data<RefundRequest>()),
        "z-report" => driver.ZReport(),
        "x-report" => driver.XReport(),
        _ => throw new OkcException($"Bilinmeyen işlem: {req.Action}"),
    };
}
catch (Exception e) when (e is OkcException or JsonException)
{
    result = new Result(false, Error: e.Message);
}
catch (Exception e)
{
    result = new Result(false, Error: $"Beklenmeyen hata: {e.Message}");
}
Console.Out.Write(JsonSerializer.Serialize(result, Json.Options));
