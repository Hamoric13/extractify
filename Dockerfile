FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    nodejs \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p temp

EXPOSE 8000

CMD ["sh", "-c", "python refresh_cookies.py & uvicorn main:app --host 0.0.0.0 --port 8000"]