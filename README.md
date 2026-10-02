# GeoShield ID

**Sebelum share peta, cek dulu apa yang bisa bocor.**

GeoShield ID adalah pemeriksa indikator risiko teknis pada dataset titik sebelum dibagikan. Aplikasi memproses berkas di browser; bukan layanan identifikasi orang, sertifikasi hukum, atau jaminan bahwa dataset bebas risiko.

## Menjalankan lokal

```sh
npm install
npm run dev
npm test
npm run build
```

Tidak ada server aplikasi, akun, penyimpanan dataset, endpoint analitik, API AI/LLM eksternal, atau basemap jaringan. Content Security Policy membatasi `connect-src` ke origin sendiri. Mode ini sengaja menghindari tile pihak ketiga sehingga koordinat maupun metadata permintaan peta tidak dikirim ke layanan eksternal. Setelah pemuatan, berkas dan hasil analisis berada dalam memori tab; menutup tab menghapus state aplikasi. Ekspor hanya terjadi setelah pengguna memilih tombol unduh. Preferensi bahasa hanya berada di state saat ini dan tidak disimpan.

## Fitur dalam implementasi ini

- Pembacaan CSV, TSV, GeoJSON FeatureCollection/Point; deteksi delimiter, alias kolom, koma desimal, dan pemetaan manual.
- Pemeriksaan kualitas record, koordinat di luar rentang, duplikat, timestamp dan geometri.
- Analisis risiko di Web Worker: kandidat identifier langsung, presisi koordinat, grid/k, tetangga terdekat, kombinasi lokasi-waktu, serta atribut langka.
- Transformasi pratinjau: pembulatan, agregasi ke centroid grid, jitter ber-seed, generalisasi waktu dan penghapusan kolom yang dipilih pengguna.
- Ekspor GeoJSON, CSV, laporan HTML mandiri, dan manifest dengan hash SHA-256 kanonis.
- Peta tematik lokal sintetis; tidak menggunakan peta dasar atau request jaringan eksternal.

Pratinjau titik dibatasi 2.000 titik agar UI tetap responsif. Analisis dan berkas ekspor menggunakan seluruh record. Proyeksi equirectangular dipakai pada koordinat geografis sekitar centroid dan hanya merupakan pendekatan jarak lokal.

## Asumsi dan batas implementasi

- File input diasumsikan menggunakan koordinat bujur/lintang geografis WGS 84; tidak ada reproyeksi otomatis dari CRS lain.
- Unit analisis tidak menyimpulkan identitas nyata dan detektor identifier hanya memberi indikasi berdasarkan pola atau nama kolom.
- Jitter memakai seed yang dapat diulang. Pengguna bertanggung jawab meninjau metode, data, tujuan, akses, dan ketentuan diseminasi sebelum ekspor.
- Contoh data dibuat deterministik oleh `scripts/generate-synthetic.mjs`; semua identifier dan atribut personal dalam generator adalah nilai fiktif.
- Pengelompokan grid dan skor risiko adalah penyaringan teknis, bukan ukuran k-anonimitas yang membuktikan anonimitas.
- Referensi hukum Indonesia ditandai untuk verifikasi terhadap sumber resmi sebelum publikasi; dokumen ini bukan nasihat hukum.

## Struktur

- `src/core/`: parser, analisis, mitigasi, serialisasi ekspor.
- `src/workers/`: Web Worker untuk penghitungan analisis dan mitigasi.
- `src/App.tsx`: orkestrasi state dan alur UI.
- `src/components/`: badge privasi, kartu metrik, ringkasan risiko, dan ekspor.
- `tests/`: pengujian unit parser, analisis, mitigasi, dan ekspor.
- `docs/`: metodologi, privasi, kepatuhan, batasan.

## Disclaimer

GeoShield ID adalah alat bantu pemeriksaan risiko teknis dan bukan alat sertifikasi kepatuhan hukum. Hasil analisis tidak menjamin bahwa dataset bebas dari risiko identifikasi atau otomatis memenuhi seluruh ketentuan peraturan perundang-undangan. Pengguna tetap bertanggung jawab memastikan dasar pemrosesan, hak akses, tujuan penggunaan, keamanan, dan ketentuan penyebarluasan data yang berlaku.

## Lisensi

MIT dipilih agar penggunaan, pemeriksaan, dan modifikasi kode aplikasi dapat dilakukan secara luas dengan pemberitahuan lisensi yang sederhana. Lihat `LICENSE` dan `NOTICE`.
