# Metodologi dan asumsi

## Proyeksi lokal

Koordinat bujur/lintang dikonversi secara lokal dengan pendekatan equirectangular di sekitar centroid: X = Δlon × 111.320 × cos(lintang centroid), Y = Δlat × 111.320 meter. Ini pendekatan jarak untuk cakupan lokal, bukan transformasi geodesi presisi atau dukungan area luas. Distorsi meningkat saat area membentang jauh, dekat kutub, atau melintasi antimeridian. Untuk cakupan besar, gunakan GIS dengan CRS yang sesuai dan verifikasi CRS input.

## Grid, kelompok kecil, dan tetangga

Koordinat proyeksi dikelompokkan dalam grid persegi dengan ukuran 50, 100, 250, 500, atau 1.000 m. Sel berisi kurang dari k yang dipilih ditandai sebagai kelompok kecil. Ini hitungan sel grid, bukan bukti anonimitas; hasil peka terhadap asal grid dan batas sel. Tetangga terdekat dihitung atas koordinat yang diproyeksikan secara lokal, indeks bin spasial digunakan untuk pencarian, dan persentil 95 membantu meninjau observasi berjauhan. Jarak tetangga tidak menyimpulkan identitas.

## Presisi

Jumlah desimal koordinat asli dilaporkan sebagai indikasi granularitas. Perkiraan satu digit desimal mengikuti 111.320 m × 10 pangkat negatif jumlah desimal; bujur dikalikan cos(lintang). Implementasi saat ini menandai presisi enam desimal atau lebih untuk tinjauan tambahan; ini heuristik UI, bukan ambang hukum. Ini perkiraan lokal, bukan ketelitian pengukuran.

## Identifier dan atribut

Nama kolom umum dan pola email, telepon Indonesia, serta string 16 digit ditandai sebagai “terindikasi”. Pola tidak memvalidasi atau mencari identitas nyata. Kombinasi nilai atribut dibatasi pada empat kolom atribut pertama untuk menemukan kombinasi yang hanya muncul sekali; ini sederhana dan dapat menghasilkan false positive/negative.

## Keunikan waktu dan tingkat risiko

Waktu dibucket ke menit, jam, atau hari, lalu dikombinasikan dengan sel grid. Kombinasi yang muncul sekali ditandai. `LOW` berarti tidak ada indikator yang dipilih metode ini, `REVIEW` satu indikator, dan `HIGH` dua atau lebih indikator atau kelompok kecil bersama keunikan waktu. Ini penyaringan risiko teknis, bukan klasifikasi hukum.

## Mitigasi dan utilitas

- Pembulatan koordinat mengubah presisi angka koordinat.
- Agregasi mengganti koordinat tiap anggota sel dengan centroid anggota sel dan mempertahankan jumlah record serta atribut selain yang dipilih pengguna.
- Jitter ber-seed menggunakan distribusi radius seragam area lingkaran; hasil seed sama dapat diulang.
- Generalisasi waktu meruntuhkan menit/detik ke kelipatan interval yang dipilih.
- Displacement adalah jarak equirectangular antara titik masuk dan keluar. Metrik yang disediakan adalah retensi record dan displacement; belum menggantikan evaluasi distribusi atribut atau extent/centroid komprehensif.

Metode ini tidak menghapus informasi salinan dari memori browser, tidak menilai sumber eksternal, dan tidak menjamin bahwa kombinasi data tidak dapat dikaitkan kembali.
