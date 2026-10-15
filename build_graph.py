
from pathlib import Path
from pyrosm import OSM
import osmnx as ox

data_dir = Path(__file__).parent / "data"
pbf_file = data_dir / "Zagreb.osm.pbf"
graph_file = data_dir / "roads.graphml"

if not pbf_file.exists():
    raise FileNotFoundError(f"File data tidak ditemukan: {pbf_file}")

print("Membaca data jalan...")
osm = OSM(str(pbf_file))

nodes, edges = osm.get_network(
    network_type="driving",
    nodes=True,
)

print(f"Node jalan: {len(nodes)}")
print(f"Segmen jalan: {len(edges)}")
print("Membangun graf...")

graph = osm.to_graph(
    nodes,
    edges,
    graph_type="networkx",
    network_type="driving",
    simplify=True,
)

print("Menyimpan graf lokal...")
ox.save_graphml(graph, filepath=graph_file)

print(f"Selesai: {graph_file}")
print(f"Total node graf: {len(graph.nodes)}")
print(f"Total edge graf: {len(graph.edges)}")
