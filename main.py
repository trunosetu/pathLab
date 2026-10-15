from pathlib import Path
from contextlib import asynccontextmanager
import math
import shutil
import time
import uuid

import networkx as nx
import osmnx as ox

from fastapi import FastAPI, HTTPException, BackgroundTasks, UploadFile, File
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field


# ==================================================
# KONFIGURASI
# ==================================================

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = BASE_DIR / "data"
GRAPH_FILE = DATA_DIR / "roads.graphml"

DATA_DIR.mkdir(parents=True, exist_ok=True)

# Penyimpanan status pekerjaan unduhan.
download_jobs = {}


# ==================================================
# FASTAPI DAN LIFESPAN
# ==================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.graph = None

    if GRAPH_FILE.exists():
        try:
            print("Memuat graf jalan lokal...")
            app.state.graph = ox.load_graphml(
                filepath=GRAPH_FILE,
                edge_dtypes={"lit": str},
            )
            graph = app.state.graph
            print(
                f"Graf siap: {graph.number_of_nodes()} node, "
                f"{graph.number_of_edges()} edge"
            )
        except Exception as exc:
            print(f"Graf lokal gagal dimuat: {type(exc).__name__}: {exc}")
            print("Pilih area baru atau muat file graf offline.")
    else:
        print("Graf belum tersedia. Pilih area atau muat graf offline.")

    yield


app = FastAPI(title="PathLab", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


# ==================================================
# HALAMAN DAN STATUS
# ==================================================

@app.get("/")
def home():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/health")
def health():
    graph = app.state.graph
    return {
        "status": "ok",
        "graph_loaded": graph is not None,
        "nodes": graph.number_of_nodes() if graph is not None else 0,
        "edges": graph.number_of_edges() if graph is not None else 0,
    }


# ==================================================
# MUAT GRAF OFFLINE (.GRAPHML)
# ==================================================

@app.post("/api/graph/upload")
def load_offline_graph(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".graphml"):
        raise HTTPException(
            status_code=400,
            detail="Pilih file graf berformat .graphml.",
        )

    if any(job.get("status") == "running" for job in download_jobs.values()):
        raise HTTPException(
            status_code=409,
            detail="Unduhan sedang berjalan. Tunggu hingga selesai.",
        )

    upload_temp = DATA_DIR / f"upload_{uuid.uuid4().hex}.graphml"
    save_temp = DATA_DIR / f"roads_{uuid.uuid4().hex}.graphml"

    try:
        with upload_temp.open("wb") as destination:
            shutil.copyfileobj(file.file, destination)

        graph = ox.load_graphml(
            filepath=upload_temp,
            edge_dtypes={"lit": str},
        )

        if graph.number_of_nodes() == 0 or graph.number_of_edges() == 0:
            raise ValueError("File graf tidak memiliki node atau edge jalan.")

        # Pastikan setiap node mempunyai koordinat yang diperlukan.
        xs = []
        ys = []
        for _, attrs in graph.nodes(data=True):
            if "x" not in attrs or "y" not in attrs:
                continue
            x = float(attrs["x"])
            y = float(attrs["y"])
            if not math.isfinite(x) or not math.isfinite(y):
                continue
            xs.append(x)
            ys.append(y)

        if not xs or not ys:
            raise ValueError("Koordinat x dan y tidak ditemukan di graf.")

        bounds = {
            "south": min(ys),
            "west": min(xs),
            "north": max(ys),
            "east": max(xs),
        }

        # Simpan ke file sementara sebelum mengganti graf yang tersimpan.
        ox.save_graphml(graph, filepath=save_temp)
        save_temp.replace(GRAPH_FILE)

        app.state.graph = graph

        print(
            f"Graf offline dimuat: {graph.number_of_nodes()} node, "
            f"{graph.number_of_edges()} edge"
        )

        return {
            "status": "success",
            "message": "Graf offline berhasil dimuat.",
            "nodes": graph.number_of_nodes(),
            "edges": graph.number_of_edges(),
            "bounds": bounds,
        }

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Gagal memuat graf offline: {type(exc).__name__}: {exc}",
        )
    finally:
        upload_temp.unlink(missing_ok=True)
        save_temp.unlink(missing_ok=True)
        file.file.close()


# ==================================================
# HAPUS GRAF AKTIF DAN FILE LOKAL
# ==================================================

@app.delete("/api/graph")
def delete_graph():
    if any(job.get("status") == "running" for job in download_jobs.values()):
        raise HTTPException(
            status_code=409,
            detail="Unduhan masih berjalan. Tunggu hingga selesai sebelum menghapus graf.",
        )

    try:
        if GRAPH_FILE.exists():
            GRAPH_FILE.unlink()

        app.state.graph = None
        print("Graf jalan berhasil dihapus.")

        return {
            "status": "success",
            "message": "Graf jalan berhasil dihapus.",
        }
    except OSError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Gagal menghapus graf: {exc}",
        )


# ==================================================
# MODEL REQUEST
# ==================================================

class AreaRequest(BaseModel):
    south: float = Field(ge=-90, le=90)
    west: float = Field(ge=-180, le=180)
    north: float = Field(ge=-90, le=90)
    east: float = Field(ge=-180, le=180)
    network_type: str = "drive"
    simplify: bool = True
    retain_all: bool = False
    truncate_by_edge: bool = True


class RouteRequest(BaseModel):
    start_lat: float = Field(ge=-90, le=90)
    start_lon: float = Field(ge=-180, le=180)
    goal_lat: float = Field(ge=-90, le=90)
    goal_lon: float = Field(ge=-180, le=180)
    algorithm: str = "dijkstra"


# ==================================================
# UNDUH DATA JALAN DARI OVERPASS
# ==================================================

def process_area(job_id: str, data: AreaRequest):
    job = download_jobs[job_id]
    endpoints = [
        "https://overpass-api.de/api",
        "https://overpass.kumi.systems/api",
        "https://overpass.private.coffee/api",
    ]

    old_url = ox.settings.overpass_url
    old_timeout = ox.settings.requests_timeout

    try:
        job.update({
            "progress": 10,
            "message": "Menyiapkan unduhan data jalan...",
            "status": "running",
        })

        ox.settings.requests_timeout = 180
        graph = None
        last_error = None

        for index, endpoint in enumerate(endpoints, start=1):
            try:
                job.update({
                    "progress": 20,
                    "message": f"Mencoba server Overpass {index}/{len(endpoints)}...",
                })
                ox.settings.overpass_url = endpoint
                print(f"Mencoba Overpass: {endpoint}")

                graph = ox.graph_from_bbox(
                    (
                        data.west,
                        data.south,
                        data.east,
                        data.north,
                    ),
                    network_type=data.network_type,
                    simplify=data.simplify,
                    retain_all=data.retain_all,
                    truncate_by_edge=data.truncate_by_edge,
                )

                if graph.number_of_nodes() == 0:
                    raise RuntimeError("Tidak ada node jalan pada area yang dipilih.")

                print(f"Berhasil menggunakan {endpoint}")
                break

            except Exception as exc:
                last_error = exc
                graph = None
                print(
                    f"Overpass {endpoint} gagal: "
                    f"{type(exc).__name__}: {exc}"
                )

        if graph is None:
            raise RuntimeError(
                "Semua server Overpass gagal. Coba area lebih kecil "
                "atau gunakan fitur Muat Data Offline. "
                f"Error terakhir: {last_error}"
            ) from last_error

        job.update({
            "progress": 75,
            "message": "Data diterima. Menyiapkan graf...",
        })

        temp_file = DATA_DIR / f"roads_{uuid.uuid4().hex}.graphml"
        try:
            job.update({
                "progress": 90,
                "message": "Menyimpan data peta...",
            })
            ox.save_graphml(graph, filepath=temp_file)
            temp_file.replace(GRAPH_FILE)
        finally:
            temp_file.unlink(missing_ok=True)

        app.state.graph = graph

        job.update({
            "progress": 100,
            "message": "Unduhan dan pemrosesan selesai.",
            "status": "completed",
            "nodes": graph.number_of_nodes(),
            "edges": graph.number_of_edges(),
        })

        print(
            f"Area berhasil dimuat: {graph.number_of_nodes()} node, "
            f"{graph.number_of_edges()} edge"
        )

    except Exception as exc:
        job.update({
            "status": "failed",
            "message": f"{type(exc).__name__}: {exc}",
        })
        print(f"Unduhan area gagal: {type(exc).__name__}: {exc}")
    finally:
        ox.settings.overpass_url = old_url
        ox.settings.requests_timeout = old_timeout


@app.post("/api/area")
def start_area_download(data: AreaRequest, background_tasks: BackgroundTasks):
    if data.south >= data.north or data.west >= data.east:
        raise HTTPException(status_code=400, detail="Batas area tidak valid.")

    if (data.north - data.south) * (data.east - data.west) > 0.25:
        raise HTTPException(
            status_code=400,
            detail="Area terlalu besar. Pilih area yang lebih kecil.",
        )

    if data.network_type not in {"drive", "walk", "bike"}:
        raise HTTPException(
            status_code=400,
            detail="Jenis jaringan harus drive, walk, atau bike.",
        )

    if any(job.get("status") == "running" for job in download_jobs.values()):
        raise HTTPException(
            status_code=409,
            detail="Unduhan lain masih berjalan. Tunggu hingga selesai.",
        )

    job_id = str(uuid.uuid4())
    download_jobs[job_id] = {
        "progress": 0,
        "message": "Menyiapkan proses unduhan...",
        "status": "running",
    }

    background_tasks.add_task(process_area, job_id, data)
    return {"job_id": job_id}


@app.get("/api/area/progress/{job_id}")
def get_area_progress(job_id: str):
    job = download_jobs.get(job_id)
    if job is None:
        raise HTTPException(
            status_code=404,
            detail="Proses unduhan tidak ditemukan.",
        )
    return job


# ==================================================
# HEURISTIK ASTAR
# ==================================================

def haversine_m(lat1, lon1, lat2, lon2):
    radius = 6_371_000
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)

    a = (
        math.sin(dp / 2) ** 2
        + math.cos(p1)
        * math.cos(p2)
        * math.sin(dl / 2) ** 2
    )
    return 2 * radius * math.asin(math.sqrt(a))


# ==================================================
# PERHITUNGAN RUTE
# ==================================================

@app.post("/api/route")
def calculate_route(data: RouteRequest):
    graph = app.state.graph

    if graph is None:
        raise HTTPException(
            status_code=400,
            detail="Graf jalan belum tersedia. Terapkan area atau muat graf offline.",
        )

    algorithm = data.algorithm.lower()
    if algorithm not in ("dijkstra", "astar"):
        raise HTTPException(
            status_code=400,
            detail="Algoritma harus dijkstra atau astar.",
        )

    started = time.perf_counter()

    try:
        start = ox.distance.nearest_nodes(
            graph,
            X=data.start_lon,
            Y=data.start_lat,
        )
        goal = ox.distance.nearest_nodes(
            graph,
            X=data.goal_lon,
            Y=data.goal_lat,
        )

        if algorithm == "astar":
            def heuristic(u, v):
                a = graph.nodes[u]
                b = graph.nodes[v]
                return haversine_m(a["y"], a["x"], b["y"], b["x"])

            route = nx.astar_path(
                graph,
                start,
                goal,
                heuristic=heuristic,
                weight="length",
            )
        else:
            route = nx.dijkstra_path(
                graph,
                start,
                goal,
                weight="length",
            )

        distance = nx.path_weight(graph, route, weight="length")
        coordinates = [
            [graph.nodes[node]["y"], graph.nodes[node]["x"]]
            for node in route
        ]
        elapsed_ms = (time.perf_counter() - started) * 1000

        return {
            "coordinates": coordinates,
            "distance_m": round(distance, 2),
            "time_ms": round(elapsed_ms, 2),
            "algorithm": algorithm,
            "route_nodes": len(route),
        }

    except (nx.NetworkXNoPath, nx.NodeNotFound):
        raise HTTPException(
            status_code=404,
            detail="Rute tidak ditemukan pada jaringan jalan yang tersedia.",
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"{type(exc).__name__}: {exc}",
        )
