# LINUNI — Robinhood Uniswap V3 LP Manager

LINUNI adalah alat manajemen Liquidity Provider (LP) Uniswap V3 di **Robinhood Chain** (Chain ID `4663`) berbasis **Pure JavaScript (Node.js)** dengan penyimpanan data **100% menggunakan file JSON** (tanpa database SQLite).

---

## 🌟 Fitur Utama

1. **👛 Check Wallet**:
   - Menampilkan saldo Native ETH, Wrapped WETH, dan Robinhood USDG.
   - Memeriksa status izin (*approval/allowance*) untuk Uniswap V3 PositionManager dan SwapRouter.
   - Opsi untuk melakukan approval token langsung.

2. **📊 Check LP Positions**:
   - Membaca seluruh posisi NFT LP milik wallet dari smart contract `NonfungiblePositionManager`.
   - Menampilkan Token ID, pasangan token, *fee tier*, rentang harga (Min, Current, Max), status *In-Range*, jumlah token aktif (*principal*), serta akumulasi *fee* yang belum diklaim.

3. **🚀 Open New Position**:
   - **Input Contract Address**: Pencarian token dan *pool list* otomatis di Robinhood Chain (fee tier 0.01%, 0.05%, 0.25%, 0.3%, 1.0%).
   - **Pilih Range**: Pilihan preset (Narrow ±5%, Medium ±10%, Wide ±20%, Full Range, atau Custom Price Bounds).
   - **Detail Preview**: Menampilkan estimasi jumlah token yang dibutuhkan (Token0 & Token1), total nilai USD, estimasi gas fee (ETH & USD), serta *projected liquidity output*.
   - **Minting**: Eksekusi minting posisi baru secara otomatis.

4. **Support USDG & ETH**:
   - Terkonfigurasi langsung untuk token utama Robinhood Chain: Native ETH, WETH (`0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`), dan USDG (`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`).

5. **Khusus Robinhood Chain**:
   - Pre-configured smart contract Uniswap V3 resmi Robinhood:
     - **Factory**: `0x1f7d7550b1b028f7571e69a784071f0205fd2efa`
     - **NonfungiblePositionManager**: `0x73991a25c818bf1f1128deaab1492d45638de0d3`
     - **SwapRouter02**: `0xcaf681a66d020601342297493863e78c959e5cb2`
     - **QuoterV2**: `0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7`
     - **Multicall3**: `0xcA11bde05977b3631167028862be2a173976CA11`

6. **🔒 Feature Close Position Liquidity 100%**:
   - Menutup 100% likuiditas posisi LP beserta penarikan seluruh fee yang terkumpul dalam 1 transaksi (*multicall*).

7. **Dual Close Position Options**:
   - **Option A (Withdraw Langsung)**: Hasil penutupan masuk sebagai token asal (ETH/USDG) ke wallet.
   - **Option B (Tukar USDG Langsung)**: Hasil penutupan non-USDG (seperti ETH/WETH) otomatis di-swap ke USDG via SwapRouter02 sehingga wallet menerima **100% USDG**.

8. **Pure JSON Storage**:
   - Tidak memerlukan instalasi SQLite atau C++ build tools (`better-sqlite3`). Seluruh data posisi, histori transaksi, dan cache disimpan di `./data/*.json`.

---

## 🛠️ Persyaratan Sistem

- **Node.js**: versi `20.x` atau lebih baru (`node -v`).
- **npm**: versi `10.x` atau lebih baru.
- **Kunci Privat (Private Key)**: Opsional jika hanya melihat saldo/posisi (*Read-Only*); Wajib diisi jika ingin melakukan *Approve*, *Mint*, *Close*, atau *Swap*.

---

## 📥 Panduan Instalasi

1. **Clone repository & Masuk ke folder**:
   ```bash
   git clone <repository-url>
   cd LINUNI
   ```

2. **Instalasi dependency**:
   ```bash
   npm install
   ```

3. **Salin file konfigurasi lingkungan**:
   ```bash
   cp .env.example .env
   ```

4. **Edit `.env` sesuai kebutuhan Anda**:
   ```dotenv
   # Network & Chain Configuration (Robinhood Chain ID: 4663)
   RH_CHAIN_ID=4663
   RH_RPC_URL=https://rpc.mainnet.chain.robinhood.com

   # Optional Third-Party RPC Fallbacks (Free Tier: Alchemy, QuickNode, dll)
   ALCHEMY_RPC_URL=
   QUICKNODE_RPC_URL=

   # Wallet Configuration
   PRIVATE_KEY=0x...
   WALLET_ADDRESS=0x...

   # Data Directory (JSON Storage)
   DATA_DIR=./data

   # Safety Settings
   DRY_RUN=true
   EXECUTION_ENABLED=true
   MAX_GAS_COST_USD=2.00
   DEFAULT_SLIPPAGE_BPS=100
   ```

---

## 🌐 Panduan Pengaturan RPC Third-Party (Free Tier)

Secara bawaan, LINUNI menggunakan RPC publik resmi Robinhood (`https://rpc.mainnet.chain.robinhood.com`). Untuk meningkatkan kecepatan dan keandalan (fallback jika RPC resmi sibuk), Anda dapat menggunakan penyedia RPC pihak ketiga gratis (free tier):

### 1. Alchemy (Free Tier)
1. Buka [Alchemy.com](https://www.alchemy.com/) dan buat akun gratis.
2. Buat App baru, pilih network **Robinhood Chain** (atau tambahkan Custom RPC endpoint Robinhood).
3. Salin **HTTPS RPC URL** (misal `https://robinhood-mainnet.g.alchemy.com/v2/YOUR_API_KEY`).
4. Tempelkan URL tersebut ke `.env` pada variabel `ALCHEMY_RPC_URL=...`.

### 2. QuickNode (Free Tier)
1. Buka [QuickNode.com](https://www.quicknode.com/) dan daftar akun gratis.
2. Pilih **Create Endpoint** -> pilih **Robinhood Chain**.
3. Salin **HTTP Provider URL**.
4. Tempelkan URL tersebut ke `.env` pada variabel `QUICKNODE_RPC_URL=...`.

*Catatan: LINUNI mendukung fitur Fallback RPC otomatis, di mana sistem akan secara otomatis beralih ke provider cadangan jika RPC utama mengalami failure atau rate limit.*

---

## 💻 Cara Menjalankan Aplikasi

Jalankan menu interaktif CLI dengan perintah:

```bash
npm start
```

Atau menggunakan perintah direct `node`:

```bash
node src/cli/index.js
```

### Opsi Perintah CLI Tambahan

- **Check Wallet saja**:
  ```bash
  npm run check-wallet
  ```

- **Check LP Positions saja**:
  ```bash
  npm run check-positions
  ```

---

## 📁 Struktur Folder Project

```
LINUNI/
├── package.json               # Dependensi & script eksekusi
├── .env.example               # Template file lingkungan
├── .env                       # File konfigurasi lokal
├── README.md                  # Dokumentasi lengkap
├── data/                      # Penyimpanan database JSON (NO SQLite!)
│   ├── positions.json         # Data histori posisi LP
│   ├── transactions.json      # Log transaksi on-chain
│   └── pools_cache.json       # Cache status pool & harga
└── src/
    ├── config/
    │   ├── constants.js       # Alamat kontrak Robinhood, ABIs, Fee tiers
    │   └── env.js             # Parser & validator environment
    ├── utils/
    │   ├── math.js            # Kalkulasi tick, sqrtPrice, & rasio likuiditas
    │   └── formatter.js       # Format angka BigInt, mata uang USD, & harga
    ├── services/
    │   ├── json-db.js         # Layanan pembacaan & penulisan file JSON DB
    │   ├── rpc.js             # Setup Viem PublicClient & WalletClient + Fallback
    │   ├── wallet.js          # Layanan audit saldo & allowance token
    │   ├── pool.js            # Inspeksi token, pencarian pool & harga
    │   ├── position.js        # Audit NFT posisi, penarikan fee, 100% close
    │   ├── swap.js            # Swap otomatis token ke USDG via SwapRouter02
    │   └── lp.js              # Kalkulasi quote range, fee preview, & minting
    ├── cli/
    │   └── index.js           # Antarmuka terminal interaktif dengan menu warna-warni
    └── index.js               # Export modul utama
```

---

## 🛡️ Keamanan & Dry-Run Mode

- **Simulasi (DRY_RUN=true)**: Secara default `DRY_RUN=true` aktif di file `.env`. Pada mode ini, aplikasi melakukan simulasi transaksi menggunakan `eth_call` tanpa memotong gas fee atau mengirim transaksi asli ke blockchain.
- **Eksekusi Live (DRY_RUN=false)**: Jika Anda siap melakukan transaksi live on-chain, ubah `DRY_RUN=false` di `.env`.

---

## 📜 Lisensi

MIT License.
