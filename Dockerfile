FROM python:3.11-slim

LABEL maintainer="NEXUS AI <nexus@agent.ai>"
LABEL description="NEXUS — Multi-Agent AI Security OS"

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ python3-dev libffi-dev \
    git curl wget unzip tar \
    nmap whois dnsutils \
    tor proxychains4 \
    p7zip-full \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir bitcoinlib monero PySocks

COPY . .

RUN mkdir -p /app/multi_agent_system/modules \
             /app/multi_agent_system/workspace/default \
             /tmp/uploads /tmp/nexus_extracted

ENV PORT=5000
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONPATH=/app/multi_agent_system
ENV MODULE_RELOAD_INTERVAL=3600
ENV TOR_ENABLED=0
ENV TOR_PROXY=socks5h://127.0.0.1:9050

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:${PORT}/health || exit 1

CMD ["sh", "-c", "cd /app/multi_agent_system && gunicorn app:app --bind 0.0.0.0:${PORT} --workers 2 --threads 4 --timeout 120 --keep-alive 5 --log-level info --access-logfile -"]
