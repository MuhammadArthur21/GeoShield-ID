# Privasi dan siklus data

- File dibaca melalui File API browser dan dianalisis di tab. Parser berjalan lokal; analisis dan mitigasi memakai Web Worker same-origin.
- Tidak ada backend, akun, database aplikasi, telemetri, analitik, API AI/LLM, CDN, atau pixel pelacakan.
- Basemap hanya gambar vektor sintetis tertanam. Tidak ada permintaan tile ke penyedia eksternal.
- Isi berkas tetap berada di memori selama halaman terbuka. Tidak ada IndexedDB/localStorage/cache aplikasi untuk dataset. Muat ulang atau tutup tab untuk membuang state aplikasi.
- File hasil dibuat oleh browser hanya setelah tindakan unduh pengguna. Manifest menyertakan hash, jumlah record, metode dan seed; tidak menyertakan titik input.
- `connect-src 'self'` pada CSP menolak koneksi jaringan lintas origin.

Jika suatu versi menambahkan tile eksternal, perilaku jaringan dan peringatan harus diperbarui. Permintaan tile dapat mengungkap metadata teknis dan lokasi tampilan kepada penyedia tile; dataset pengguna tetap tidak boleh dimasukkan dalam permintaan.
