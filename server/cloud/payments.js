// Abonelik ödemesi sağlayıcıları.
//  - simulator: gerçek para çekmez; ödeme sayfasında "başarılı / başarısız" seçilir (deneme ve geliştirme için)
//  - iyzico: iyzico Ödeme Formu (Checkout Form). Kart bilgisi bizim sunucumuza hiç gelmez; iyzico'nun sayfasında girilir.
//    Anahtarlar: IYZICO_API_KEY, IYZICO_SECRET_KEY; adres: IYZICO_BASE_URL (deneme: https://sandbox-api.iyzipay.com)
import crypto from 'node:crypto';

const lira = (kurus) => (kurus / 100).toFixed(2);

export function simulatorProvider() {
  return {
    name: 'simulator',
    live: false,
    /** Ödemeyi başlat: kullanıcının gideceği adres */
    async start({ payment, baseUrl }) {
      const ref = `SIM-${payment.id}-${crypto.randomBytes(6).toString('hex')}`;
      return { ref, redirect: `${baseUrl}/odeme/simulator/${ref}` };
    },
  };
}

/** iyzico IYZWSv2 imzalı istek başlıkları (randomKey dışarıdan verilebilir: test için) */
export function iyzicoHeaders({ apiKey, secretKey, uriPath, body, randomKey = `${Date.now()}${crypto.randomInt(100000, 999999)}` }) {
  const json = typeof body === 'string' ? body : JSON.stringify(body);
  const signature = crypto.createHmac('sha256', secretKey).update(randomKey + uriPath + json).digest('hex');
  const auth = Buffer.from(`apiKey:${apiKey}&randomKey:${randomKey}&signature:${signature}`).toString('base64');
  return { Authorization: `IYZWSv2 ${auth}`, 'x-iyzi-rnd': randomKey, 'Content-Type': 'application/json', Accept: 'application/json' };
}

export function iyzicoProvider({ apiKey, secretKey, baseUrl = 'https://sandbox-api.iyzipay.com', fetchImpl = (...a) => fetch(...a) }) {
  if (!apiKey || !secretKey) throw new Error('iyzico için IYZICO_API_KEY ve IYZICO_SECRET_KEY gerekli');
  const call = async (uriPath, body) => {
    const json = JSON.stringify(body);
    const res = await fetchImpl(baseUrl.replace(/\/+$/, '') + uriPath, { method: 'POST', headers: iyzicoHeaders({ apiKey, secretKey, uriPath, body: json }), body: json });
    const out = await res.json().catch(() => ({}));
    if (out.status !== 'success') throw new Error(`iyzico: ${out.errorMessage || out.errorCode || `HTTP ${res.status}`}`);
    return out;
  };
  return {
    name: 'iyzico',
    live: !/sandbox/.test(baseUrl),
    async start({ payment, tenant, baseUrl: our, ip }) {
      const [name, ...rest] = String(tenant.contact_name || tenant.business_name).trim().split(/\s+/);
      const surname = rest.join(' ') || name;
      const address = tenant.address || tenant.city || 'Türkiye';
      const city = tenant.city || 'İstanbul';
      const item = `VelarisKasa ${payment.plan} ${payment.months} ay`;
      const body = {
        locale: 'tr',
        conversationId: String(payment.id),
        price: lira(payment.amount),
        paidPrice: lira(payment.amount),
        currency: 'TRY',
        basketId: `P${payment.id}`,
        paymentGroup: 'SUBSCRIPTION',
        callbackUrl: `${our}/api/cloud/iyzico/callback`,
        enabledInstallments: [1],
        buyer: {
          id: tenant.slug, name, surname, gsmNumber: tenant.phone, email: tenant.email,
          // TCKN / VKN: girilmemişse iyzico'nun kabul ettiği genel değer (fatura bilgisi ayrıca kesilir)
          identityNumber: (tenant.tax_id || '').replace(/\D/g, '').length >= 10 ? tenant.tax_id.replace(/\D/g, '') : '11111111111',
          registrationAddress: address, ip: ip || '127.0.0.1', city, country: 'Turkey',
        },
        billingAddress: { contactName: `${name} ${surname}`, city, country: 'Turkey', address },
        basketItems: [{ id: `${payment.plan}-${payment.months}`, name: item, category1: 'Yazılım aboneliği', itemType: 'VIRTUAL', price: lira(payment.amount) }],
      };
      const out = await call('/payment/iyzipos/checkoutform/initialize/auth/ecom', body);
      return { ref: out.token, redirect: out.paymentPageUrl };
    },
    /** iyzico'nun geri dönüşündeki token ile sonucu sorgular */
    async result(token) {
      const out = await call('/payment/iyzipos/checkoutform/auth/ecom/detail', { locale: 'tr', token });
      return {
        ok: out.paymentStatus === 'SUCCESS',
        ref: token,
        paymentId: out.paymentId || null,
        amount: Math.round(Number(out.paidPrice || out.price || 0) * 100),
        basketId: out.basketId,
        error: out.paymentStatus === 'SUCCESS' ? null : (out.errorMessage || out.mdStatus || 'Ödeme tamamlanmadı'),
      };
    },
  };
}

export function providerFromEnv(env = process.env) {
  if ((env.VK_PAYMENT_PROVIDER || 'simulator') === 'iyzico') {
    return iyzicoProvider({ apiKey: env.IYZICO_API_KEY, secretKey: env.IYZICO_SECRET_KEY, baseUrl: env.IYZICO_BASE_URL || 'https://sandbox-api.iyzipay.com' });
  }
  return simulatorProvider();
}
