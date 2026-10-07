# NodeWatch 🛰️
### Production-Ready Linux Server Monitoring Platform | پلتفرم حرفه‌ای مانیتورینگ سرورهای لینوکس

NodeWatch is a high-performance, lightweight, and modern server monitoring platform designed to monitor multiple Linux servers with near-zero resource consumption.

NodeWatch یک پلتفرم سبک، سریع، امن و حرفه‌ای برای مانیتورینگ همزمان چندین سرور لینوکسی است که مستقیماً وضعیت لحظه‌ای سیستم‌عامل را بدون هیچ‌گونه دیتای ساختگی یا تقریبی استخراج می‌کند.

---

## ⚡ Quick One-Line Installation (نصب سریع یک‌خطی)

### ۱. نصب سرور مرکزی (Central Server)
روی سرور اصلی لینوکس خود دستور زیر را اجرا کنید:

```bash
curl -fsSL https://raw.githubusercontent.com/Amiir-Dark/Monitoriing/main/install.sh | sudo bash
```
> **نکته:** در صورتی که ریپازیتوری را کلون کرده‌اید، کافیست وارد پوشه پروژه شوید و دستور `sudo bash install.sh` را اجرا کنید.

#### 🎮 منوی مدیریت خودکار در اجرای دوم به بعد (Management Console)
* **دفعه اول:** اسکریپت تمام ملزومات را اتوماتیک نصب کرده، باینری را کامپایل می‌کند، سرویس Systemd را راه می‌اندازد و لینک دسترسی را نمایش می‌دهد.
* **دفعه دوم به بعد:** هر زمان مجدداً دستور `install.sh` را بزنید یا در هر جای ترمینال دستور **`nodewatch`** را تایپ کنید، یک منوی مدیریتی رنگی و تعاملی باز می‌شود:
  ```text
  ====================================================================
                 NodeWatch Server Management Console
  ====================================================================
   Service Status: ● RUNNING  |  Port: 8080  |  Web: http://1.2.3.4:8080
  --------------------------------------------------------------------
    [1]  Status & Diagnostics       (مشاهده وضعیت و سلامت سرویس)
    [2]  Restart Service            (راه‌اندازی مجدد سرویس)
    [3]  Stop Service               (توقف سرویس)
    [4]  Start Service              (شروع به کار سرویس)
    [5]  View Real-Time Logs        (مشاهده لاگ‌های زنده journalctl)
    [6]  Update to Latest Version   (آپدیت سورس از گیت‌هاب و بیلد مجدد)
    [7]  Change Port                (تغییر پورت سرور مرکزی)
    [8]  Backup Database            (تهیه نسخه پشتیبان از دیتابیس)
    [9]  Reinstall NodeWatch        (نصب مجدد از اول)
    [10] Uninstall NodeWatch        (حذف کامل سرویس و برنامه‌ها)
    [0]  Exit                       (خروج)
  ====================================================================
  ```

---

### ۲. اتصال نودهای کلاینت (Agent Installation)
در داشبورد وب، روی دکمه **Add Server** کلیک کنید تا توکن نود تولید شود، سپس دستور تک‌خطی زیر را روی سروری که می‌خواهید مانیتور شود اجرا کنید:

```bash
curl -fsSL http://<YOUR_CENTRAL_SERVER_IP>:8080/install.sh | sudo bash -s -- --token "YOUR_NODE_TOKEN"
```
یا با اسکریپت اختصاصی ایجنت:
```bash
sudo bash scripts/nodewatch-agent-install.sh --server "http://<CENTRAL_IP>:8080" --token "YOUR_NODE_TOKEN"
```
روی سرور نود هم هر زمان دستور **`nodewatch-agent`** را بزنید، منوی مدیریت وضعیت، تغییر توکن و لاگ‌های ایجنت نمایش داده می‌شود.

---

## 🚀 نحوه قرار دادن پروژه روی گیت‌هاب (Pushing to GitHub)

برای قرار دادن این سورس‌کد روی اکانت گیت‌هاب خود:

```bash
# ۱. رفتن به پوشه اصلی پروژه
cd /path/to/nodewatch

# ۲. راه‌اندازی گیت
git init
git add .
git commit -m "feat: initial production-ready release of NodeWatch"

# ۳. تنظیم برنچ اصلی
git branch -M main

# ۴. متصل کردن ریپازیتوری خود در گیت‌هاب (نام کاربری و نام ریپوی خود را جایگزین کنید)
git remote add origin https://github.com/<YOUR_USERNAME>/<YOUR_REPOSITORY>.git

# ۵. پوش کردن کدها
git push -u origin main
```

---

## 🎯 ویژگی‌های برجسته و دقت داده‌ها (Core Features)

* **دقت ۱۰۰٪ واقعی:** هیچ دیتایی حدسی، تقریبی یا با مقدار پیش‌فرض `0` نمایش داده نمی‌شود.
* **استخراج مستقیم از هسته لینوکس:** خوانش مستقیم از `/proc` و `/sys` بدون دستورات سنگین شل.
* **محاسبه دقیق نرخ بر ثانیه:** تمام ترافیک شبکه (RX/TX) و دیسک (Disk I/O & IOPS) بر اساس اختلاف زمان واقعی نمونه‌برداری (`time.Since`) به صورت بایت بر ثانیه محاسبه می‌شوند.
* **شناسایی Counter Reset:** در صورت ریبوت یا ریست کارت شبکه، جهش کاذب یا مقدار منفی ایجاد نمی‌شود.
* **تفکیک کامل وضعیت سنسورها:** در سرورهای ابری یا مجازی که سنسور سخت‌افزاری دما وجود ندارد، به جای مقدار فیک، وضعیت `Unavailable` با ذکر علت نمایش داده می‌شود.
* **نمایش فوق‌العاده جزئی در تب‌های داشبورد:**
  * **CPU:** مدل دقیق پردازنده، فرکانس، ماتریس مصرف تک‌تک هسته‌ها، درصد تفکیکی User, System, Idle, IOWait, Steal.
  * **Memory:** جدول بایت‌های دقیق RAM فیزیکی و Swap، تفکیک Buffers, Cached, Slab, Active, Inactive, Dirty.
  * **Disks & Inodes:** جدول تمامی مانت‌پوینت‌ها، فضای مصرفی، تعداد کل Inodeها، اینودهای مصرفی و درصد پر بودن.
  * **Disk I/O:** جدول کلیه بلاک‌دیوایس‌ها به همراه نرخ خواندن/نوشتن و IOPS لحظه‌ای.
  * **Network:** جدول آداپتورها، مک‌آدرس، IPهای هر کارت، پکت‌ها و خطاهای RX/TX.
  * **TCP & Processes:** ماتریس سوکت‌های TCP (Established, Listen, TimeWait, CloseWait) و دسته‌بندی پروسه‌ها بر اساس حالت‌های سیستم‌عامل (R, S, D, Z, T).
* **دیتابیس درونی فوق‌سریع SQLite 3 (WAL):** بدون نیاز به نصب هیچ دیتابیس سنگینی مثل PostgreSQL, MySQL یا Redis.
* **هشدارها و اطلاع‌رسانی تلگرام:** سیستم اختصاصی الرت با پشتیبانی از مدت‌زمان پایداری و ربات تلگرام.

---

## 🛠️ مشخصات پیش‌فرض

* **پورت پیش‌فرض داشبورد:** `8080`
* **نام کاربری پیش‌فرض:** `admin`
* **رمز عبور پیش‌فرض:** `admin123` (قابل تغییر در بخش تنظیمات)
* **محل پایگاه داده SQLite:** `/opt/nodewatch/data/nodewatch.db`

---

## 📁 ساختار سورس‌کد (Directory Structure)

```text
├── agent/                  # ایجنت فوق‌سبک لینوکس (Go)
│   ├── cmd/nodewatch-agent/
│   └── internal/collectors/ # ماژول‌های خوانش مستقیم /proc و /sys
├── backend/                # سرور مرکزی، API، وب‌سوکت، موتور الرت (Go)
│   ├── cmd/nodewatch/
│   └── internal/           # دیتابیس SQLite، احراز هویت، تلگرام، API
├── frontend/               # رابط کاربری تحت وب (React 19 + Tailwind CSS)
│   ├── dist/               # بیلد آماده استاتیک (بدون نیاز به نصب Node.js روی سرور)
│   └── src/
├── systemd/                # فایل‌های سرویس سیستم‌دی لینوکس
├── scripts/                # اسکریپت‌های نصب و مدیریت ایجنت
├── docs/                   # مستندات کامل معماری، امنیت و API
├── install.sh              # اسکریپت هوشمند نصب و کنسول مدیریت
└── README.md
```

---

## 📜 لایسنس
توسعه‌داده‌شده تحت لایسنس MIT.
NodeWatch — Lightweight & Precise Server Monitoring.
