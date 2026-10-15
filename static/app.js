
const map = L.map("map").setView([-7.87, 111.46], 13);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    minZoom: 5,
    maxZoom: 19,
    attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

// ==================================================
// VARIABEL PETA DAN AREA
// ==================================================

map.setMinZoom(5);
map.setMaxZoom(19);

const areaLayer = new L.FeatureGroup();
map.addLayer(areaLayer);

const areaStatus = document.getElementById("areaStatus");
const applyAreaBtn = document.getElementById("applyAreaBtn");
const clearAreaBtn = document.getElementById("clearAreaBtn");
const deleteGraphBtn = document.getElementById("deleteGraphBtn");

const statusText = document.getElementById("status");
const startText = document.getElementById("startText");
const goalText = document.getElementById("goalText");

const progressPanel = document.getElementById("downloadProgress");
const progressBar = document.getElementById("progressBar");
const progressPercent = document.getElementById("progressPercent");
const progressMessage = document.getElementById("progressMessage");

let selectedBounds = null;
let appliedBounds = null;
let areaReady = false;

let startPoint = null;
let goalPoint = null;
let startMarker = null;
let goalMarker = null;
let routeLayer = null;
let selectionMode = null;

// ==================================================
// KONTROL GAMBAR AREA
// ==================================================

const drawControl = new L.Control.Draw({
    draw: {
        rectangle: {
            shapeOptions: {
                color: "#2563eb",
                weight: 2
            }
        },
        polygon: false,
        polyline: false,
        circle: false,
        circlemarker: false,
        marker: false
    },
    edit: {
        featureGroup: areaLayer,
        edit: true,
        remove: true
    }
});

map.addControl(drawControl);

// ==================================================
// FUNGSI BANTU
// ==================================================

function updateAreaStatus(message) {
    if (areaStatus) {
        areaStatus.textContent = message;
    }
}

function getSingleRectangleBounds() {
    const layers = areaLayer.getLayers();

    if (layers.length === 0) {
        return null;
    }

    return layers[0].getBounds();
}

function formatPoint(point) {
    return `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`;
}

function resetRouteResults() {
    const distance = document.getElementById("distance");
    const visited = document.getElementById("visited");
    const duration = document.getElementById("duration");

    if (distance) distance.textContent = "Jarak: —";
    if (visited) visited.textContent = "Node pada rute: —";
    if (duration) duration.textContent = "Waktu komputasi: —";
}

function clearRouteAndPoints() {
    if (startMarker) map.removeLayer(startMarker);
    if (goalMarker) map.removeLayer(goalMarker);
    if (routeLayer) map.removeLayer(routeLayer);

    startMarker = null;
    goalMarker = null;
    routeLayer = null;

    startPoint = null;
    goalPoint = null;
    selectionMode = null;

    if (startText) {
        startText.textContent = "Titik awal: belum dipilih";
    }

    if (goalText) {
        goalText.textContent = "Titik tujuan: belum dipilih";
    }

    resetRouteResults();
}

function invalidateAppliedArea() {
    areaReady = false;
    appliedBounds = null;
    clearRouteAndPoints();
}

function resetProgressDisplay() {
    if (progressPanel) {
        progressPanel.hidden = true;
    }

    if (progressBar) {
        progressBar.style.width = "0%";
        progressBar.classList.remove("completed", "failed");
    }

    if (progressPercent) {
        progressPercent.textContent = "0%";
    }

    if (progressMessage) {
        progressMessage.textContent = "Menyiapkan unduhan...";
    }
}

function resetMapBounds() {
    map.setMaxBounds(null);
    map.options.maxBoundsViscosity = 0;
}

async function readResponse(response) {
    let result;

    try {
        result = await response.json();
    } catch {
        throw new Error("Server mengirim respons yang tidak valid.");
    }

    if (!response.ok) {
        const message =
            typeof result.detail === "string"
                ? result.detail
                : "Permintaan gagal diproses oleh server.";

        throw new Error(message);
    }

    return result;
}

// ==================================================
// EVENT GAMBAR, EDIT, DAN HAPUS AREA
// ==================================================

map.on(L.Draw.Event.CREATED, function (event) {
    areaLayer.clearLayers();
    areaLayer.addLayer(event.layer);

    selectedBounds = event.layer.getBounds();

    invalidateAppliedArea();

    updateAreaStatus(
        "Kotak dipilih. Tekan Terapkan Area untuk memuat data jalan."
    );

    if (statusText) {
        statusText.textContent = "Area baru dipilih.";
    }
});

map.on(L.Draw.Event.EDITED, function () {
    selectedBounds = getSingleRectangleBounds();

    invalidateAppliedArea();

    updateAreaStatus(
        "Kotak berubah. Terapkan Area kembali untuk memuat data jalan."
    );

    if (statusText) {
        statusText.textContent = "Area berubah dan perlu diterapkan ulang.";
    }
});

map.on(L.Draw.Event.DELETED, function () {
    selectedBounds = null;

    invalidateAppliedArea();
    resetMapBounds();

    updateAreaStatus("Kotak wilayah dihapus.");

    if (statusText) {
        statusText.textContent = "Silakan gambar area baru.";
    }
});

// ==================================================
// TOMBOL BERSIHKAN AREA
// ==================================================

if (clearAreaBtn) {
    clearAreaBtn.addEventListener("click", function () {
        areaLayer.clearLayers();

        resetMapBounds();

        selectedBounds = null;
        appliedBounds = null;
        areaReady = false;

        invalidateAppliedArea();
        resetProgressDisplay();

        if (applyAreaBtn) {
            applyAreaBtn.disabled = false;
        }

        updateAreaStatus(
            "Kotak dihapus. Silakan gambar area baru."
        );

        if (statusText) {
            statusText.textContent =
                "Gambar dan terapkan area baru.";
        }
    });
}

// ==================================================
// TERAPKAN AREA DAN UNDUH GRAF JALAN
// ==================================================

if (applyAreaBtn) {
    applyAreaBtn.addEventListener("click", async function () {
        selectedBounds = getSingleRectangleBounds();

        if (!selectedBounds) {
            updateAreaStatus(
                "Gambar kotak wilayah terlebih dahulu."
            );
            return;
        }

        const south = selectedBounds.getSouth();
        const west = selectedBounds.getWest();
        const north = selectedBounds.getNorth();
        const east = selectedBounds.getEast();

        if (
            south >= north ||
            west >= east
        ) {
            updateAreaStatus("Batas area tidak valid.");
            return;
        }

        if ((north - south) * (east - west) > 0.25) {
            updateAreaStatus(
                "Area terlalu besar. Pilih area yang lebih kecil."
            );
            return;
        }

        applyAreaBtn.disabled = true;
        areaReady = false;
        appliedBounds = null;

        clearRouteAndPoints();

        if (progressPanel) {
            progressPanel.hidden = false;
        }

        if (progressBar) {
            progressBar.className = "progress-bar";
            progressBar.style.width = "0%";
        }

        if (progressPercent) {
            progressPercent.textContent = "0%";
        }

        if (progressMessage) {
            progressMessage.textContent = "Memulai proses...";
        }

        updateAreaStatus("Sedang memuat data jalan...");

        if (statusText) {
            statusText.textContent =
                "Mengunduh dan memproses jaringan jalan...";
        }

        try {
            const response = await fetch("/api/area", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    south,
                    west,
                    north,
                    east,
                    network_type: "drive",
                    simplify: true,
                    retain_all: false,
                    truncate_by_edge: true
                })
            });

            const result = await readResponse(response);
            const jobId = result.job_id;

            if (!jobId) {
                throw new Error(
                    "Server tidak mengembalikan ID pekerjaan."
                );
            }

            let finished = false;
            let finalData = null;

            // Pantau progres sampai selesai atau gagal.
            while (!finished) {
                await new Promise(resolve =>
                    setTimeout(resolve, 2500)
                );

                const progressResponse = await fetch(
                    `/api/area/progress/${encodeURIComponent(jobId)}`
                );

                const progress = await readResponse(progressResponse);

                const percent = Number(progress.progress ?? 0);

                if (progressBar) {
                    progressBar.style.width =
                        `${Math.max(0, Math.min(100, percent))}%`;
                }

                if (progressPercent) {
                    progressPercent.textContent = `${percent}%`;
                }

                if (progressMessage) {
                    progressMessage.textContent =
                        progress.message || "Memproses data jalan...";
                }

                if (progress.status === "failed") {
                    throw new Error(
                        progress.message || "Unduhan data jalan gagal."
                    );
                }

                if (progress.status === "completed") {
                    finished = true;
                    finalData = progress;
                }
            }

            // Aktifkan area setelah graf berhasil dibuat.
            appliedBounds = selectedBounds;
            areaReady = true;

            map.setMaxBounds(appliedBounds.pad(0.15));
            map.options.maxBoundsViscosity = 1.0;
            map.fitBounds(appliedBounds);

            if (progressBar) {
                progressBar.style.width = "100%";
                progressBar.classList.add("completed");
            }

            if (progressPercent) {
                progressPercent.textContent = "100%";
            }

            if (progressMessage) {
                progressMessage.textContent =
                    "Unduhan dan pemrosesan selesai.";
            }

            updateAreaStatus(
                `Area aktif: ${finalData.nodes ?? "—"} node dan ` +
                `${finalData.edges ?? "—"} edge.`
            );

            if (statusText) {
                statusText.textContent =
                    "Area siap. Pilih titik awal dan tujuan.";
            }

        } catch (error) {
            areaReady = false;
            appliedBounds = null;

            if (progressBar) {
                progressBar.classList.remove("completed");
                progressBar.classList.add("failed");
            }

            updateAreaStatus(`Error: ${error.message}`);

            if (statusText) {
                statusText.textContent =
                    `Gagal memuat area: ${error.message}`;
            }

        } finally {
            applyAreaBtn.disabled = false;
        }
    });
}

// ==================================================
// HAPUS GRAF DARI SERVER DAN PENYIMPANAN LOKAL
// ==================================================

if (deleteGraphBtn) {
    deleteGraphBtn.addEventListener("click", async function () {
        const confirmed = confirm(
            "Yakin ingin menghapus graf jalan yang tersimpan? " +
            "Kamu harus mengunduh ulang data jalan setelahnya."
        );

        if (!confirmed) {
            return;
        }

        deleteGraphBtn.disabled = true;

        try {
            const response = await fetch("/api/graph", {
                method: "DELETE"
            });

            await readResponse(response);

            // Bersihkan tampilan peta.
            areaLayer.clearLayers();
            resetMapBounds();

            selectedBounds = null;
            appliedBounds = null;
            areaReady = false;

            clearRouteAndPoints();
            resetProgressDisplay();

            if (applyAreaBtn) {
                applyAreaBtn.disabled = false;
            }

            updateAreaStatus("Graf jalan telah dihapus.");

            if (statusText) {
                statusText.textContent =
                    "Belum ada graf. Silakan pilih area baru.";
            }

            alert("Graf jalan berhasil dihapus.");

        } catch (error) {
            alert(error.message);

        } finally {
            deleteGraphBtn.disabled = false;
        }
    });
}

// ==================================================
// PILIH TITIK AWAL
// ==================================================

const startBtn = document.getElementById("startBtn");

if (startBtn) {
    startBtn.addEventListener("click", function () {
        if (!areaReady) {
            statusText.textContent =
                "Terapkan area terlebih dahulu.";
            return;
        }

        selectionMode = "start";

        statusText.textContent =
            "Klik peta untuk menentukan titik awal.";
    });
}

// ==================================================
// PILIH TITIK TUJUAN
// ==================================================

const goalBtn = document.getElementById("goalBtn");

if (goalBtn) {
    goalBtn.addEventListener("click", function () {
        if (!areaReady) {
            statusText.textContent =
                "Terapkan area terlebih dahulu.";
            return;
        }

        selectionMode = "goal";

        statusText.textContent =
            "Klik peta untuk menentukan titik tujuan.";
    });
}

// ==================================================
// KLIK PETA UNTUK MEMILIH TITIK
// ==================================================

map.on("click", function (event) {
    if (!selectionMode) {
        return;
    }

    if (!areaReady || !appliedBounds) {
        statusText.textContent =
            "Terapkan area terlebih dahulu.";

        selectionMode = null;
        return;
    }

    if (!appliedBounds.contains(event.latlng)) {
        statusText.textContent =
            "Pilih titik di dalam kotak wilayah aktif.";
        return;
    }

    const point = {
        lat: event.latlng.lat,
        lng: event.latlng.lng
    };

    if (selectionMode === "start") {
        startPoint = point;

        if (startMarker) {
            map.removeLayer(startMarker);
        }

        startMarker = L.marker(event.latlng)
            .addTo(map)
            .bindPopup("Titik awal")
            .openPopup();

        if (startText) {
            startText.textContent =
                `Titik awal: ${formatPoint(point)}`;
        }

    } else if (selectionMode === "goal") {
        goalPoint = point;

        if (goalMarker) {
            map.removeLayer(goalMarker);
        }

        goalMarker = L.marker(event.latlng)
            .addTo(map)
            .bindPopup("Titik tujuan")
            .openPopup();

        if (goalText) {
            goalText.textContent =
                `Titik tujuan: ${formatPoint(point)}`;
        }
    }

    selectionMode = null;

    statusText.textContent =
        "Titik dipilih. Kamu bisa mencari rute.";
});

// ==================================================
// HITUNG RUTE DENGAN DIJKSTRA ATAU A*
// ==================================================

const routeBtn = document.getElementById("routeBtn");

if (routeBtn) {
    routeBtn.addEventListener("click", async function () {
        if (!areaReady) {
            statusText.textContent =
                "Terapkan area terlebih dahulu.";
            return;
        }

        if (!startPoint || !goalPoint) {
            statusText.textContent =
                "Pilih titik awal dan tujuan terlebih dahulu.";
            return;
        }

        const algorithmElement =
            document.getElementById("algorithm");

        const algorithm = algorithmElement
            ? algorithmElement.value.toLowerCase()
            : "dijkstra";

        if (!["dijkstra", "astar", "BFS"].includes(algorithm)) {
            statusText.textContent =
                "Algoritma tidak valid.";
            return;
        }

        routeBtn.disabled = true;

        statusText.textContent =
            `Sedang menghitung rute dengan ${algorithm.toUpperCase()}...`;

        try {
            const response = await fetch("/api/route", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    start_lat: startPoint.lat,
                    start_lon: startPoint.lng,
                    goal_lat: goalPoint.lat,
                    goal_lon: goalPoint.lng,
                    algorithm
                })
            });

            const data = await readResponse(response);

            if (
                !Array.isArray(data.coordinates) ||
                data.coordinates.length === 0
            ) {
                throw new Error(
                    "Server tidak mengembalikan koordinat rute."
                );
            }

            if (routeLayer) {
                map.removeLayer(routeLayer);
            }

            routeLayer = L.polyline(data.coordinates, {
                color: algorithm === "astar"
                    ? "#e67e22"
                    : "#2563eb",
                weight: 5,
                opacity: 0.85
            }).addTo(map);

            map.fitBounds(routeLayer.getBounds(), {
                padding: [30, 30],
                maxZoom: 17
            });

            document.getElementById("distance").textContent =
                `Jarak: ${(data.distance_m / 1000).toFixed(2)} km`;

            document.getElementById("visited").textContent =
                `Node pada rute: ${
                    data.route_nodes ?? data.coordinates.length
                }`;

            document.getElementById("duration").textContent =
                `Waktu komputasi: ${data.time_ms} ms`;

            statusText.textContent =
                `Rute berhasil ditemukan dengan ${algorithm.toUpperCase()}.`;

        } catch (error) {
            statusText.textContent =
                `Error: ${error.message}`;

        } finally {
            routeBtn.disabled = false;
        }
    });
}

// ==================================================
// RESET TITIK DAN RUTE
// ==================================================

const resetBtn = document.getElementById("resetBtn");

if (resetBtn) {
    resetBtn.addEventListener("click", function () {
        clearRouteAndPoints();

        statusText.textContent = areaReady
            ? "Pilih titik awal dan tujuan pada peta."
            : "Pilih dan terapkan area terlebih dahulu.";
    });
}

const offlineGraphFile = document.getElementById("offlineGraphFile");
const loadOfflineBtn = document.getElementById("loadOfflineBtn");
const offlineStatus = document.getElementById("offlineStatus");

if (loadOfflineBtn && offlineGraphFile) {
    loadOfflineBtn.addEventListener("click", async function () {
        const file = offlineGraphFile.files[0];

        if (!file) {
            if (offlineStatus) {
                offlineStatus.textContent = "Pilih file .graphml terlebih dahulu.";
            }
            return;
        }

        if (!file.name.toLowerCase().endsWith(".graphml")) {
            if (offlineStatus) {
                offlineStatus.textContent = "Format file harus .graphml.";
            }
            return;
        }

        loadOfflineBtn.disabled = true;

        if (offlineStatus) {
            offlineStatus.textContent = "Memuat graf offline...";
        }

        try {
            const formData = new FormData();
            formData.append("file", file);

            const response = await fetch("/api/graph/upload", {
                method: "POST",
                body: formData
            });

            const data = await readResponse(response);

            // Gunakan batas geografis dari graf yang dimuat.
            const bounds = data.bounds;

            if (
                !bounds ||
                !Number.isFinite(bounds.south) ||
                !Number.isFinite(bounds.west) ||
                !Number.isFinite(bounds.north) ||
                !Number.isFinite(bounds.east)
            ) {
                throw new Error("Batas wilayah graf tidak valid.");
            }

            // Bersihkan area lama dan rute sebelumnya.
            areaLayer.clearLayers();
            clearRouteAndPoints();

            selectedBounds = null;

            appliedBounds = L.latLngBounds(
                [bounds.south, bounds.west],
                [bounds.north, bounds.east]
            );

            areaReady = true;

            resetMapBounds();
            map.fitBounds(appliedBounds, { padding: [20, 20] });

            if (applyAreaBtn) {
                applyAreaBtn.disabled = false;
            }

            if (offlineStatus) {
                offlineStatus.textContent =
                    `Graf offline aktif: ${data.nodes} node, ` +
                    `${data.edges} edge.`;
            }

            updateAreaStatus(
                `Data offline aktif: ${data.nodes} node dan ${data.edges} edge.`
            );

            if (statusText) {
                statusText.textContent =
                    "Graf offline siap. Pilih titik awal dan tujuan.";
            }

            resetProgressDisplay();

        } catch (error) {
            if (offlineStatus) {
                offlineStatus.textContent =
                    `Gagal memuat data offline: ${error.message}`;
            }

        } finally {
            loadOfflineBtn.disabled = false;
        }
    });
}
