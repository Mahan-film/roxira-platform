# رکوردهای DNS برای سرور ایمیل خودمان (Cloudflare)

همه را در Cloudflare > دامنه > DNS > Records اضافه کنید. ابر نارنجی (Proxy) را برای رکورد A خاموش کنید (DNS only).

## دامنه ghazihoushmand.ir

1. **ویرایش رکورد SPF موجود** (TXT روی @) — رکورد جدید نسازید، همان را این‌طور ویرایش کنید:
```
v=spf1 ip4:91.107.248.99 include:_spf.mx.cloudflare.net ~all
```
2. **رکورد جدید TXT** — Name: `rx1._domainkey` — Content:
```
v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAr/WYt9yZKFu0PM7/QyCx7GMnACy+yo8G5B3Wyp3TAhCBebS3uleQEJmqAlBZGxHArsc4C3DUqDYCrHDo8swtLgS9ThxmvyXzjAiHb5Yd1sAQ4brgVam0dGOEWqQP692EZ1IUrizaqPzWlv4h1bLMTE8BHLnFGZct+LANyuNiK1PDF9Y6hEQ17b/ZvcTwVRqvmtKMPYPgLA62GxiMpdEEPZsUj/lsQ25IlZmQfv1FrfGwrbtqzN4fAERMOrPzt9KN5VWmUNFsL39jj4saY1rAPRCuncbpiSx2ePlSMNH58rbR83JfLA/J4v+72Npa4FHURu2tni7J+IWpmnWyjclaZQIDAQAB
```
3. **رکورد جدید A** — Name: `mail` — IPv4: `91.107.248.99` — Proxy: خاموش (DNS only)

## دامنه roxira.ir

1. **ویرایش SPF موجود**:
```
v=spf1 ip4:91.107.248.99 include:_spf.mx.cloudflare.net ~all
```
2. **رکورد جدید TXT** — Name: `rx1._domainkey` — Content:
```
v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwHCS2CIW710ckrF1hVoXSIZKQjpLvcV4MDwM09MPe1YZgjz8QU5hcv8kWYmZgvGCaRW7WhEQgQ5b7Wm6tmJZgzsG4hhA+WLEjPuGpiyK6B6Xw7j3MK6ZsqOYvnaYTFh06rkUEDeEs6YmSpezC5x4r3zqEIkC19ZSIS/3WjQc6Ag4O/Iizt2jpSsOJWvlfJ2NFfLxDiXi5ieKQRXO5k+sViVUAjxJAIXyFr3ie379bL8KugVpcZoWQhNg9bnv5fYZ/uIs0oRS967/62Ix54REEFAsD9EmGsrUMCptxnpVXj1hiJzm0qjxsL6O/EscWLu6+WjkT1s5PvAwxbYjrbpGSwIDAQAB
```

## Hetzner (یک تنظیم)
Hetzner Cloud Console > Servers > srv1 > Networking > روی IP `91.107.248.99` > Edit Reverse DNS > مقدار: `mail.ghazihoushmand.ir`

DMARC را که قبلاً گذاشته‌اید دست نزنید.
