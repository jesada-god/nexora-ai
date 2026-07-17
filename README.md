# Nexora AI

Intelligent Investment Analytics — แพลตฟอร์มวิเคราะห์ ติดตามพอร์ต และจำลองการลงทุนด้วยข้อมูลและ AI

Nexora AI เป็นเว็บแอป Next.js สำหรับติดตาม Watchlist, บันทึกข้อมูลพอร์ตด้วยตนเอง, ตั้ง Price Alert และใช้เครื่องมือ What-If, Price Target และ Monte Carlo โดยไม่มีระบบส่งคำสั่งซื้อขายจริง

## เริ่มใช้งาน

ต้องใช้ Node.js รุ่นที่รองรับ Next.js 15

```bash
npm install
npm run dev
```

เปิด `http://localhost:3000`

## ตรวจสอบคุณภาพ

```bash
npm run lint
npm run build
```

ข้อมูลตลาด ข่าว ผลวิเคราะห์ พอร์ต และการแจ้งเตือนในเวอร์ชันนี้เป็นข้อมูลจำลองและยังไม่ได้เชื่อมต่อ backend หรือ market-data API จริง
