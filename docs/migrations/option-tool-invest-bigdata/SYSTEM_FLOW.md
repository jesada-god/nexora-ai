# Option Tool Invest Big Data — System Flow

เอกสารนี้เป็นแผนที่การทำงานของโค้ด ณ วันที่ 2026-07-24 ครอบคลุม frontend, API, data source, state และ calculation engines ทั้งหมดใน repository นี้

## 1. ภาพรวมระบบ

```mermaid
flowchart LR
    U[ผู้ใช้] --> UI[index.html<br/>Single-page Quant Terminal]
    UI -->|HTTP JSON| API[FastAPI main.py]
    UI <-->|WebSocket 1 วินาที| API

    API --> YF[yfinance / Yahoo market data]
    API --> LN[LINE notification endpoint]
    API --> MEM[(In-memory state<br/>watchlist / positions / prices)]
    API --> CACHE[(TTL cache<br/>single process)]

    API --> STATS[stats_engine]
    API --> PRICE[pricing_engine]
    API --> PORT[portfolio_engine]
    API --> GAUGE[gauges_engine]
    API --> PRED[ai_engine]
    API --> SIM[simulator_engine]

    STATS --> YF
    STATS --> CACHE
    PORT --> PRICE
    SIM --> PRICE
    GAUGE --> STATS
    GAUGE --> PORT
    PRED --> STATS
    PRED --> GAUGE
    PRED --> PORT
```

## 2. Dependency graph ภายใน backend

```mermaid
flowchart TD
    MAIN[main.py<br/>routing + orchestration]
    CACHE[cache.py<br/>thread-safe TTL memoization]
    PRICING[pricing_engine.py<br/>BSM + Greeks + CRR + consensus]
    STATS[stats_engine.py<br/>technical statistics + ratings]
    PORTFOLIO[portfolio_engine.py<br/>position and portfolio Greeks]
    GAUGES[gauges_engine.py<br/>explainable 0-100 gauges]
    AI[ai_engine.py<br/>weighted factor combiner]
    SIM[simulator_engine.py<br/>multi-scenario Monte Carlo]

    MAIN --> CACHE
    MAIN --> PRICING
    MAIN --> STATS
    MAIN --> PORTFOLIO
    MAIN --> GAUGES
    MAIN --> AI
    MAIN --> SIM
    STATS --> CACHE
    PORTFOLIO --> PRICING
    SIM --> PRICING

    YF[yfinance] --> MAIN
    YF --> STATS
```

โมดูลคำนวณหลัก:

- `pricing_engine.py`: Black-Scholes-Merton, Delta/Gamma/Theta/Vega/Rho, CRR binomial tree และ weighted price consensus
- `simulator_engine.py`: GBM Monte Carlo แบบ antithetic variates, shock ของ IV/rate/dividend, confidence interval และ histogram
- `portfolio_engine.py`: dollarized Greeks ต่อ position และรวมทั้ง portfolio
- `stats_engine.py`: RSI, MACD, ADX, EMA/SMA, ATR, Bollinger Bands, relative volume, beta เทียบ SPY และ rating 0-100
- `gauges_engine.py`: bullish/bearish, momentum/trend, IV rank/percentile, Greek risk, flow proxy และ confidence
- `ai_engine.py`: rule-based weighted factor combiner ไม่ใช่ trained ML model
- `cache.py`: in-process TTL cache; ไม่แชร์ข้อมูลข้าม worker/instance

## 3. ลำดับตอนเปิดหน้า Dashboard

```mermaid
sequenceDiagram
    actor User
    participant UI as index.html
    participant API as FastAPI
    participant Market as yfinance
    participant Engine as Calculation engines

    User->>UI: เปิดหน้า /
    UI->>API: GET /api/watchlist
    UI->>API: GET /api/stats?ticker=NVDA
    API->>Market: quote/info/history/options
    API->>Engine: fair value + call/put score + IV rank
    API-->>UI: statistics + session + scores

    UI->>API: GET /api/chart-data
    API->>Market: OHLCV
    API-->>UI: candles + volume + EMA + RSI

    UI->>API: GET /api/indicators
    API->>Market: prior bar + ATR
    API-->>UI: pivot/S/R + distance + ETA

    UI->>API: GET /api/analysis
    API-->>UI: static analysis summary

    UI->>API: GET /api/positions
    API->>Market: option-chain mark where available
    API-->>UI: positions + current P&L

    par non-blocking analytics
        UI->>API: GET /api/gauges
        API->>Engine: stats + portfolio Greeks + chain summary
        API-->>UI: explainable gauges
    and
        UI->>API: GET /api/ai-prediction
        API->>Engine: available weighted factors
        API-->>UI: bull/neutral/bear probabilities
    end

    alt regular market session
        UI->>API: WS /ws/price/{ticker}
        loop every second
            API-->>UI: price + market session
            UI->>UI: update candle, S/R distance, estimated P&L
        end
    end
```

## 4. Feature flows

### Market data and chart

```mermaid
flowchart LR
    TF[timeframe 1m..week] --> CFG[TIMEFRAME_CONFIG]
    CFG --> HIST[yfinance history]
    HIST --> RS{needs resample?}
    RS -->|10m / 4h| AGG[OHLCV aggregation]
    RS -->|no| CALC
    AGG --> CALC[EMA20 + EMA50 + RSI14]
    CALC --> JSON[chart-data JSON]
    JSON --> CHART[Lightweight Charts<br/>candles + volume]
```

### Support / resistance

```mermaid
flowchart LR
    BAR[previous completed daily/weekly bar] --> PIVOT[Classic pivot P]
    PIVOT --> LEVELS[S1-S3 / R1-R3]
    ATR[ATR14 for selected timeframe] --> ETA[distance / ATR × bar duration]
    LEVELS --> ETA
    ETA --> UI[S/R ladder + closest alert]
```

### Position valuation

```mermaid
flowchart TD
    POS[In-memory option position] --> CHAIN{matching live option chain row?}
    CHAIN -->|yes| MARK[bid/ask midpoint or last]
    CHAIN -->|no| IV{IV supplied?}
    IV -->|yes| BS[Black-Scholes fallback]
    IV -->|no| INTRINSIC[Intrinsic value floor]
    MARK --> PNL
    BS --> PNL
    INTRINSIC --> PNL[P&L = premium change × 100 × quantity]
```

### Advanced simulator

```mermaid
flowchart LR
    INPUT[spot / strike / DTE / target date<br/>IV / rate / dividend / shocks] --> GBM[GBM terminal paths<br/>1k-50k]
    GBM --> REPRICE[Reprice option on every path]
    REPRICE --> DIST[P&L distribution]
    DIST --> OUT[POP/POL, CI95/CI99,<br/>drawdown, percentiles, histogram, Greeks]
```

## 5. API inventory

| Method | Path | หน้าที่ | State / external dependency |
|---|---|---|---|
| GET | `/` | ส่ง `index.html` | local file |
| GET | `/api/tickers` | ค้นหา ticker จากรายการ 6 ตัวในโค้ด | static |
| GET | `/api/watchlist` | อ่าน watchlist | in-memory |
| POST | `/api/watchlist` | เพิ่ม ticker | in-memory |
| DELETE | `/api/watchlist/{ticker}` | ลบ ticker | in-memory |
| GET | `/api/stats` | quote/session/fair value/IV/call-put score | yfinance + cache |
| GET | `/api/indicators` | pivot, S/R, ATR และ ETA | yfinance + cache |
| GET | `/api/chart-data` | OHLCV, EMA20/50, RSI | yfinance |
| GET | `/api/analysis` | ข้อความ analysis แบบคงที่ | static |
| GET | `/api/positions` | mark option และคำนวณ P&L | in-memory + yfinance |
| POST | `/api/positions` | เปิด position จำลอง | in-memory + notification |
| DELETE | `/api/positions/{id}` | ปิด position จำลอง | in-memory + notification |
| WS | `/ws/price/{ticker}` | stream price/session ทุกวินาที | yfinance + in-memory |
| POST | `/api/simulate` | point-in-time what-if ด้วย Black-Scholes | calculation only |
| GET | `/api/gauges` | 18 explainable gauges + confidence | stats/portfolio/chain |
| GET | `/api/ai-prediction` | weighted bull/neutral/bear probabilities | stats/gauges/portfolio |
| POST | `/api/simulate-advanced` | multi-scenario Monte Carlo | simulator engine |
| GET | `/api/portfolio/greeks` | aggregate portfolio Greeks | portfolio/pricing |
| GET | `/api/debug/yfinance` | diagnostic raw provider result | yfinance |
| GET | `/api/cache/stats` | จำนวน cache entries | in-memory cache |
| DELETE | `/api/cache` | ล้าง cache | in-memory cache |

## 6. State และ data lifecycle

| Data | ที่เก็บ | อายุข้อมูล | ผลเมื่อ restart |
|---|---|---|---|
| Watchlist | Python list | จน process หยุด | หายและกลับค่า default |
| Positions | Python list | จน process หยุด | หายทั้งหมด |
| Last prices | Python dict | จน process หยุด | หายทั้งหมด |
| Cached market results | TTL dict | 5-300 วินาที | หายทั้งหมด |
| User/session/auth | ไม่มี | ไม่มี | ไม่มีระบบรองรับ |
| Historical/option data | ดึงจาก yfinance | ตาม TTL ของแต่ละ function | ดึงใหม่ |

Repository นี้ไม่มี database file หรือ persistent user data ให้ย้าย ข้อมูลที่คัดลอกไปพัฒนาได้จึงเป็น source code, formulas, API contracts และ UI behavior เท่านั้น

## 7. จุดเสี่ยงก่อนนำไป production

- `LINE_ACCESS_TOKEN` ถูกกำหนดใน source code; ระบบใหม่ต้องใช้ server-side environment secret และ notification adapter
- endpoint ส่วนใหญ่ไม่มี authentication, authorization, rate limiting หรือ schema validation ของ query ticker/timeframe
- watchlist/positions/cache เป็น single-process memory ไม่รองรับหลาย instance
- `main.py` มี Black-Scholes ซ้ำกับ `pricing_engine.py` และให้ผล/รูปแบบ return คนละแบบ
- `index.html` คำนวณ live P&L ด้วย delta หรือ delta fallback `0.5`; เป็นค่าประมาณที่ต่างจาก backend valuation
- `/api/analysis` เป็นข้อความคงที่ แม้ชื่อ UI จะระบุ live analysis
- `calculate_iv_rank()` บางกรณีคืนค่า IV × 100 ซึ่งไม่ใช่ historical IV rank
- `ai_engine.py` เป็น explainable rule engine ไม่ใช่ AI/ML ที่ผ่านการ train หรือ backtest
- provider exceptions หลายจุดถูกกลืนและ fallback เป็น `100.0`, `50` หรือ intrinsic value จึงต้องส่ง provenance/warning ในระบบใหม่
- ตัวอักษรไทยบางส่วนใน source แสดงอาการ encoding เสีย ควร normalize เป็น UTF-8 ระหว่าง port

## 8. ขอบเขตการนำกลับมาใช้

รายละเอียดการเทียบกับ Nexora AI และลำดับการย้ายอยู่ใน `migration/nexora-ai/README.md` ของ repository ต้นทาง หรือ `README.md` ในโฟลเดอร์ migration pack ที่คัดลอกไปยังปลายทาง
