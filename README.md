# PathLab

**PathLab** is a web-based pathfinding application that uses road network data to calculate and visualize routes between locations.
<img width="238" height="206" alt="Screenshot 2026-10-15 125738" src="https://github.com/user-attachments/assets/276c47fa-ce62-4235-88ae-4df3d38b0c02" />
<img width="951" height="960" alt="Screenshot 2026-10-15 125149" src="https://github.com/user-attachments/assets/faf4842f-d68d-4c2c-9040-7fea3705e5e1" />

## Features

- Interactive map powered by Leaflet.
- Road network data processing using OpenStreetMap.
- Route calculation using **Dijkstra's Algorithm** and **A\***.
- Visual route display on the map.
- Backend API built with FastAPI.

## Tech Stack

- **Backend:** Python, FastAPI, NetworkX, OSMnx
- **Frontend:** HTML, CSS, JavaScript, Leaflet
- **Data Source:** OpenStreetMap

## Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd pathLab
   ```

2. Install the dependencies:
   ```bash
   pip install -r req.txt
   ```

3. Start the application:
   ```bash
   uvicorn main:app --reload
   ```

4. Open `http://127.0.0.1:8000` in your browser.

## Project Structure

```text
pathLab/
├── main.py
├── requirements.txt
├── data/
└── static/
    ├── index.html
    ├── style.css
    └── app.js
```

## Status

PathLab is an ongoing project focused on exploring and comparing pathfinding algorithms on real-world road networks.

## License

This project is open-source. A license can be added when one is selected.
