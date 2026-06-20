# Smart Money Live Tracker — 7/24 Sunucu Sürümü

## Önce dürüst bir not (mutlaka oku)

Bu sistem, Binance'in **resmi/dokümante edilmiş bir API'si olmayan** bir profil sayfasını, görünmez bir tarayıcı (Playwright/Chromium headless) ile arka planda açıp okuyarak çalışır. Bu yöntemi seçtiğini onayladığın için kodu yazdım, ama şunları bilerek kullan:

- **Binance Kullanım Şartları'nı muhtemelen ihlal eder.** Otomatik/bot trafiği genellikle yasaktır. Hesabın veya IP'n engellenebilir.
- **Kırılgandır.** Binance arayüzünü güncellerse (class isimlerini değiştirirse), scraper veri okumayı durdurur ve selector'ların yeniden çıkarılması gerekir.
- **Resmi destek yok.** Sorun çıkarsa Binance'e başvuramazsın, çünkü bu onların desteklediği bir entegrasyon değil.
- Bu, **sadece halka açık/herkese görünen** bir profil sayfasını okur — hiçbir hesaba giriş yapmaz, hiçbir işlem açmaz/kapatmaz, sadece izler.

Bunlar kabul edilebilirse devam et.

## Sistem mimarisi

```
┌─────────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│  Headless Chromium   │ ───▶ │  Node.js Server   │ ───▶ │  Web Dashboard   │
│  (Playwright)         │      │  (Express + WS)   │      │  (Tarayıcından)  │
│  Binance sayfasını    │      │  State diff,      │      │  Canlı, WebSocket │
│  her 8sn okur         │      │  event tespiti    │      │  ile güncellenir  │
└─────────────────────┘      └──────────────────┘      └─────────────────┘
```

- `scraper.js` — Playwright ile headless Chrome açar, Binance profilini periyodik okur (varsayılan 8 saniye), hata olursa sayfayı yeniler, o da olmazsa tarayıcıyı tamamen yeniden başlatır.
- `state.js` — Önceki ve yeni pozisyon listesini karşılaştırır (diff), OPEN/UPDATE/CLOSE olaylarını üretir.
- `server.js` — Express ile dashboard'u sunar, WebSocket ile her güncellemeyi bağlı tüm tarayıcılara anında yayınlar.
- `public/` — Bağımsız web paneli (HTML/CSS/JS), tarayıcı kapansa bile sunucu çalışmaya devam eder; panele istediğin zaman tekrar girip kaldığı yerden izlersin.

## 1) Bilgisayarında yerel test

Gereksinim: [Node.js 18+](https://nodejs.org) kurulu olmalı.

```bash
cd smart-money-server
npm install
npx playwright install --with-deps chromium
npm start
```

Sonra tarayıcıda aç: `http://localhost:3000`

Bilgisayarını kapatırsan bu yerel test de durur — 7/24 için adım 2'ye geç.

## 2) Railway'e kurulum (VDS'den daha kolay, "kod yükle çalıştır" tarzı)

[Railway](https://railway.com), sunucu kiralayıp elle Linux komutları çalıştırmana gerek bırakmayan bir platform — Dockerfile'ı görüp her şeyi otomatik kurar. Bu proje zaten Railway için hazır (`Dockerfile`, `railway.json` dahil).

### Adımlar

**a) Railway hesabı aç:** [railway.com](https://railway.com) → GitHub hesabınla giriş yap (ücretsiz katman var, sonra kullanım bazlı ücretlendirme; Chromium biraz RAM yediği için muhtemelen "Hobby" plana geçmen gerekecek, aylık birkaç dolar).

**b) Bu klasörü GitHub'a yükle**

Eğer hiç GitHub kullanmadıysan: [github.com](https://github.com) → ücretsiz hesap aç → sağ üstten **"New repository"** → bir isim ver (örn. `smart-money-tracker-server`) → **"uploading an existing file"** linkine tıkla → bu klasördeki **tüm dosyaları** (node_modules hariç) sürükle-bırak ile yükle → **Commit changes**.

**c) Railway'de yeni proje oluştur**

Railway panelinde **"New Project"** → **"Deploy from GitHub repo"** → az önce oluşturduğun repo'yu seç. Railway otomatik olarak `Dockerfile`'ı görüp build etmeye başlayacak (ilk build birkaç dakika sürebilir, Chromium imajı büyük).

**d) Ortam değişkenlerini ayarla (opsiyonel)**

Proje ayarlarında **Variables** sekmesinden istersen şunları değiştirebilirsin (zorunlu değil, varsayılanlar zaten doğru):
- `SMT_PROFILE_URL` — izlenecek profil
- `SMT_INTERVAL_MS` — kontrol sıklığı (varsayılan 8000ms)

**e) Genel bir adres üret**

**Settings → Networking → Generate Domain** butonuna tıkla. Railway sana şuna benzer bir adres verecek:
`https://smart-money-tracker-server-production.up.railway.app`

**f) Paneli aç**

Bu adresi tarayıcında aç — panel görünmeli. Birkaç dakika içinde "CANLI" durumuna geçip pozisyonları göstermeye başlayacak.

### Railway'in avantajı

- Komut satırı/SSH yok, GitHub'a yükle → otomatik build → adres hazır
- Sunucu çökerse Railway otomatik yeniden başlatır (`railway.json` içindeki restart policy)
- Bilgisayarın kapalı olsa da, Binance sekmen kapalı olsa da çalışmaya devam eder — tamamen Railway'in sunucusunda çalışır

### Dezavantajı

- Ücretsiz değil (kullanım bazlı, Chromium çalıştırmak ayda birkaç dolar tutar)
- Yine de "headless scraping" olduğu için en baştaki ToS/risk uyarıları aynen geçerli

## 3) Ucuz bir VDS'e kurulum (alternatif, daha fazla kontrol ister)

Önerilen: Hetzner, DigitalOcean, Contabo gibi sağlayıcılardan **Ubuntu 22.04**, en az **2 GB RAM** olan bir sunucu (Playwright/Chromium bellek ister, 1GB'lık sunucularda donabilir).

### Adım adım

**a) Sunucuya bağlan**
```bash
ssh root@SUNUCU_IP_ADRESIN
```

**b) Node.js kur**
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
```

**c) Chromium'un ihtiyaç duyduğu sistem kütüphanelerini kur + proje dosyalarını yükle**

Bu klasördeki tüm dosyaları sunucuya kopyala (örnek: `scp` ile bilgisayarından, ya da `git` kullanıyorsan repo'yu push/pull et):
```bash
scp -r smart-money-server root@SUNUCU_IP_ADRESIN:/root/
```

Sunucuda:
```bash
cd /root/smart-money-server
npm install
npx playwright install --with-deps chromium
```

**d) PM2 ile 7/24 çalıştır (sunucu yeniden başlasa bile otomatik ayağa kalkar)**
```bash
sudo npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```
(`pm2 startup` komutu sana kopyala-yapıştır yapman gereken bir satır verecek — onu çalıştır, böylece sunucu yeniden başlasa bile bot otomatik açılır.)

**e) Durumu kontrol et**
```bash
pm2 status
pm2 logs smart-money-tracker
```

**f) Panele eriş**

Tarayıcından: `http://SUNUCU_IP_ADRESIN:3000`

(İstersen bir domain bağlayıp Nginx + SSL ile `https://takip.seninalanadin.com` gibi de yapılandırabiliriz — istersen bu adımı da ayrıca anlatırım.)

## 4) Ayarları değiştirme

`ecosystem.config.js` içindeki `env` bölümünden:
- `SMT_PROFILE_URL` — izlenecek farklı bir Smart Money profili
- `SMT_INTERVAL_MS` — kaç milisaniyede bir kontrol edilsin (8000 = 8 saniye; çok düşürmek IP blok riskini artırır)
- `PORT` — paneli hangi portta yayınlasın

Değiştirdikten sonra: `pm2 restart smart-money-tracker`

## 5) Sorun giderme

- **Panel "Bağlantı Aranıyor" durumunda takılı kalıyor** → `pm2 logs smart-money-tracker` ile hata mesajına bak. Genelde "Executable doesn't exist" hatası, `npx playwright install --with-deps chromium` adımının atlandığı anlamına gelir.
- **Pozisyonlar gelmiyor ama bağlantı "CANLI"** → Binance arayüzü değişmiş olabilir; `scraper.js` içindeki selector'ların DevTools ile yeniden çıkarılması gerekir (extension sürümünde yaptığımız gibi).
- **Sunucu zaman zaman donuyor** → RAM yetersiz olabilir, 2GB'a yükselt veya `SMT_INTERVAL_MS` değerini artır.
- **Railway'de build "out of memory" veya çok yavaş** → Hobby plana geçmen, veya proje ayarlarından daha yüksek RAM limiti seçmen gerekebilir; Playwright imajı + Chromium başlangıçta ciddi bellek ister.
- **Railway'de domain'e girince "Application Error"** → **Deployments** sekmesinden son deploy'un loglarına bak; genelde `PORT` ortam değişkeniyle ilgili bir çakışma ya da build'in henüz bitmemiş olması.

## Dosya yapısı

```
smart-money-server/
├── server.js              # Express + WebSocket ana sunucu
├── scraper.js              # Playwright headless browser mantığı
├── state.js                 # Pozisyon diff / olay tespiti
├── ecosystem.config.js      # PM2 7/24 process yönetimi (VDS için)
├── Dockerfile                # Railway / Docker tabanlı deploy için
├── railway.json               # Railway build & healthcheck ayarları
├── package.json
└── public/
    ├── index.html           # Dashboard sayfası
    ├── style.css             # Siberpunk tema
    └── app.js                 # WebSocket istemci + render mantığı
```
