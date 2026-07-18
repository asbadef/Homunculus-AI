# src/homunculus/api/devserver.py
"""Local dev server: one tenant, token 'dev-token'. NEVER use these credentials in production.
Run: homunculus-engine/.venv/Scripts/python.exe -m uvicorn homunculus.api.devserver:app --port 8000
"""
from homunculus.api.app import create_app

app = create_app({"dev-token": "HOSP1"})
