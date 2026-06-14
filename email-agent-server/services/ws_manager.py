# email-agent-server/services/ws_manager.py
from fastapi import WebSocket
from typing import List, Dict
import logging

logger = logging.getLogger("ws_manager")

class ConnectionManager:
    def __init__(self):
        # Maps user_id (str) to a list of active WebSocket connections
        self.active_connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, user_id: str, websocket: WebSocket):
        """Accepts a connection and registers it under the specific user_id."""
        await websocket.accept()
        if user_id not in self.active_connections:
            self.active_connections[user_id] = []
        self.active_connections[user_id].append(websocket)
        logger.info(f"WebSocket connected for user {user_id}. Total connections: {len(self.active_connections[user_id])}")

    def disconnect(self, user_id: str, websocket: WebSocket):
        """Safely removes a disconnected socket from the tracking map."""
        if user_id in self.active_connections:
            if websocket in self.active_connections[user_id]:
                self.active_connections[user_id].remove(websocket)
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]
        logger.info(f"WebSocket disconnected for user {user_id}.")

    async def broadcast_to_user(self, user_id: str, message: dict):
        """Sends a JSON message to all active windows/tabs open for a specific user."""
        if user_id not in self.active_connections:
            return

        # Iterate over a shallow copy to handle runtime removals safely if connections drop mid-flight
        for connection in list(self.active_connections[user_id]):
            try:
                await connection.send_json(message)
            except Exception as e:
                logger.warning(f"Failed to send WS message to user {user_id}, cleaning up stale link: {e}")
                self.disconnect(user_id, connection)

# Singleton pattern instance used across routers and pipelines
ws_manager = ConnectionManager()