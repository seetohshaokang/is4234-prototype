.PHONY: seed backend frontend dev test

seed:
	uv run python seed.py

backend:
	uv run uvicorn backend.main:app --reload --port 8000

frontend:
	cd frontend && npm run dev

dev:
	@echo "Starting backend and frontend in parallel..."
	@(uv run uvicorn backend.main:app --reload --port 8000 &) && cd frontend && npm run dev

test:
	uv run pytest
