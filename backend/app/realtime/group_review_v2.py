from __future__ import annotations

from collections import defaultdict
from typing import Any

from fastapi import WebSocket


class GroupReviewConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)

    async def connect(self, project_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections[project_id].add(websocket)

    def disconnect(self, project_id: str, websocket: WebSocket) -> None:
        connections = self._connections.get(project_id)
        if not connections:
            return
        connections.discard(websocket)
        if not connections:
            self._connections.pop(project_id, None)

    async def broadcast(self, project_id: str, payload: dict[str, Any]) -> None:
        stale: list[WebSocket] = []
        for websocket in list(self._connections.get(project_id, set())):
            try:
                await websocket.send_json(payload)
            except Exception:
                stale.append(websocket)
        for websocket in stale:
            self.disconnect(project_id, websocket)


manager = GroupReviewConnectionManager()
