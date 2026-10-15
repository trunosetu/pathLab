
from pathlib import Path
import networkx as nx

graph_file = Path("data/roads.graphml")
G = nx.read_graphml(graph_file, force_multigraph=True)

for u, v, key, data in G.edges(keys=True, data=True):
    for attr, value in data.items():
        if str(value).lower() == "yes":
            print("Atribut bermasalah:", attr, "| nilai:", value)
            raise SystemExit
