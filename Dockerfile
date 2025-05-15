# ---------- FRONTEND ----------
FROM node:20-alpine AS build-frontend
WORKDIR /app
COPY frontend ./frontend
WORKDIR /app/frontend
RUN npm install
RUN npm run build

# ---------- BACKEND ----------
FROM python:3.11-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1

# Copy only requirements first to leverage Docker cache
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the backend code
COPY backend ./backend

# Copiamos el frontend ya compilado
COPY --from=build-frontend /app/frontend/dist ./frontend

EXPOSE 8000
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
