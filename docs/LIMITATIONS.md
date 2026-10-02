# Batasan

- Indikator yang tidak ditemukan bukan bukti bahwa dataset anonim, aman, atau bebas dari identifikasi. Sumber lain, konteks lokal, dan pengetahuan pihak penerima tidak diperiksa.
- Produk hanya menganalisis dataset titik. Poligon, garis, jaringan, citra, dan data ruang lain di luar lingkup.
- Proyeksi equirectangular hanya perkiraan lokal; hasil jarak dan centroid kurang sesuai untuk cakupan sangat luas, lintang tinggi, lintas antimeridian, atau CRS input lain.
- Grid persegi sensitif terhadap ukuran dan posisi grid. Kelompok grid bukan jaminan anonimitas.
- Detektor identifier/pola dapat melewatkan format yang belum dikenal dan dapat menandai nilai non-identifier.
- Analisis atribut saat ini memakai hingga empat kolom atribut pertama; ringkasan utilitas distribusi atribut dan extent belum menyeluruh.
- Rounding, agregasi, dan jitter memodifikasi data namun tidak menghilangkan seluruh kemungkinan linkage. Jitter reproducible menggunakan seed yang perlu dianggap sebagai bagian dari informasi reproduksi.
- Browser dan perangkat host berada di luar kendali aplikasi. Hindari perangkat bersama atau lingkungan yang dipantau bila dataset sensitif.
