
import osmnx as ox
import networkx as nx


def get_road_graph(latitude, longitude, distance=3000):
    """
    Mengambil jaringan jalan dalam radius tertentu
    dari OpenStreetMap.
    """
    graph = ox.graph_from_point(
        (latitude, longitude),
        dist=distance,
        network_type="drive",
        simplify=True,
    )

    return graph


def find_nearest_node(graph, latitude, longitude):
    return ox.distance.nearest_nodes(
        graph,
        X=longitude,
        Y=latitude,
    )


def calculate_route(graph, start, goal, algorithm="dijkstra"):
    if algorithm == "astar":
        route = nx.astar_path(
            graph,
            start,
            goal,
            heuristic=lambda u, v: (
                (graph.nodes[u]["y"] - graph.nodes[v]["y"]) ** 2
                + (graph.nodes[u]["x"] - graph.nodes[v]["x"]) ** 2
            ) ** 0.5,
            weight="length",
        )
    else:
        route = nx.dijkstra_path(
            graph,
            start,
            goal,
            weight="length",
        )

    distance = nx.path_weight(
        graph,
        route,
        weight="length",
    )

    return route, distance
