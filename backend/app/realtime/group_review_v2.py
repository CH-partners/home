from __future__ import annotations

from collections import defaultdict
from typing import Any
from uuid import uuid4

from fastapi import WebSocket


class GroupReviewConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)
        self._connection_ids: dict[WebSocket, str] = {}
        self._cell_locks: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)

    @staticmethod
    def _cell_key(sheet_id: int, row_id: int, field_name: str) -> str:
        return f"{sheet_id}:{row_id}:{field_name}"

    async def connect(self, project_id: str, websocket: WebSocket) -> str:
        await websocket.accept()
        connection_id = str(uuid4())
        self._connections[project_id].add(websocket)
        self._connection_ids[websocket] = connection_id
        return connection_id

    def connection_id(self, websocket: WebSocket) -> str | None:
        return self._connection_ids.get(websocket)

    def list_locks(self, project_id: str) -> list[dict[str, Any]]:
        return [dict(lock) for lock in self._cell_locks.get(project_id, {}).values()]

    def acquire_cell_lock(
        self,
        project_id: str,
        websocket: WebSocket,
        *,
        sheet_id: int,
        row_id: int,
        field_name: str,
        login_id: str,
        display_name: str,
    ) -> tuple[bool, dict[str, Any]]:
        connection_id = self._connection_ids.get(websocket)
        if not connection_id:
            return False, {}

        key = self._cell_key(sheet_id, row_id, field_name)
        existing = self._cell_locks[project_id].get(key)
        if existing and existing.get("connection_id") != connection_id:
            return False, dict(existing)

        lock = {
            "key": key,
            "project_id": project_id,
            "sheet_id": sheet_id,
            "row_id": row_id,
            "field_name": field_name,
            "connection_id": connection_id,
            "login_id": login_id,
            "display_name": display_name,
        }
        self._cell_locks[project_id][key] = lock
        return True, dict(lock)

    def release_cell_lock(
        self,
        project_id: str,
        websocket: WebSocket,
        *,
        sheet_id: int,
        row_id: int,
        field_name: str,
    ) -> dict[str, Any] | None:
        connection_id = self._connection_ids.get(websocket)
        if not connection_id:
            return None

        key = self._cell_key(sheet_id, row_id, field_name)
        existing = self._cell_locks.get(project_id, {}).get(key)
        if not existing or existing.get("connection_id") != connection_id:
            return None

        released = self._cell_locks[project_id].pop(key)
        if not self._cell_locks[project_id]:
            self._cell_locks.pop(project_id, None)
        return dict(released)

    def disconnect(self, project_id: str, websocket: WebSocket) -> list[dict[str, Any]]:
        connection_id = self._connection_ids.pop(websocket, None)
        connections = self._connections.get(project_id)
        if connections:
            connections.discard(websocket)
            if not connections:
                self._connections.pop(project_id, None)

        if not connection_id:
            return []

        released: list[dict[str, Any]] = []
        project_locks = self._cell_locks.get(project_id, {})
        for key, lock in list(project_locks.items()):
            if lock.get("connection_id") == connection_id:
                released.append(dict(project_locks.pop(key)))
        if not project_locks:
            self._cell_locks.pop(project_id, None)
        return released

    async def _send_without_cleanup(
        self,
        project_id: str,
        payload: dict[str, Any],
        *,
        exclude: WebSocket | None = None,
    ) -> None:
        for websocket in list(self._connections.get(project_id, set())):
            if websocket is exclude:
                continue
            try:
                await websocket.send_json(payload)
            except Exception:
                pass

    async def broadcast(
        self,
        project_id: str,
        payload: dict[str, Any],
        *,
        exclude: WebSocket | None = None,
    ) -> None:
        stale: list[WebSocket] = []
        for websocket in list(self._connections.get(project_id, set())):
            if websocket is exclude:
                continue
            try:
                await websocket.send_json(payload)
            except Exception:
                stale.append(websocket)

        released: list[dict[str, Any]] = []
        for websocket in stale:
            released.extend(self.disconnect(project_id, websocket))

        for lock in released:
            await self._send_without_cleanup(
                project_id,
                {
                    "type": "cell_unlocked",
                    "lock": lock,
                    "reason": "connection_closed",
                },
            )


manager = GroupReviewConnectionManager()
