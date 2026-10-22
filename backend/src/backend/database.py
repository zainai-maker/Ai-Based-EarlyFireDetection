import sqlite3
from pathlib import Path
from contextlib import closing

DB_PATH = (
    Path(__file__).resolve().parents[2]
    / "data"
    / "incidents.db"
)


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    with closing(sqlite3.connect(DB_PATH)) as conn:
        with conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS incidents (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    video_id TEXT NOT NULL,
                    filename TEXT NOT NULL,
                    alert_type TEXT NOT NULL,
                    video_time_seconds REAL NOT NULL,
                    confidence REAL NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(video_id, alert_type)
                )
            """)


def save_alerts(video_id, filename, alerts):
    if not alerts:
        return 0

    rows = [
        (
            video_id,
            filename,
            alert["type"],
            alert["timestamp_seconds"],
            alert["confidence"],
        )
        for alert in alerts
    ]

    with closing(sqlite3.connect(DB_PATH)) as conn:
        with conn:
            conn.executemany("""
                INSERT OR IGNORE INTO incidents
                (video_id, filename, alert_type,
                 video_time_seconds, confidence)
                VALUES (?, ?, ?, ?, ?)
            """, rows)

        return conn.total_changes


def get_incidents(limit=50):
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.row_factory = sqlite3.Row

        rows = conn.execute("""
            SELECT * FROM incidents
            ORDER BY id DESC
            LIMIT ?
        """, (limit,)).fetchall()

    return [
        {
            **dict(row),
            "video_url": f"/videos/{row['video_id']}"
        }
        for row in rows
    ]