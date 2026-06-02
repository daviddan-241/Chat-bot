#!/usr/bin/env bash
# End-to-end smoke test against a running API (assumes http://localhost:8000)
set -euo pipefail

BASE=${BASE:-http://localhost:8000}
EMAIL="smoke_$(date +%s)@test.dev"
PASS="supersecret123"

echo "==> Register"
REG=$(curl -s -X POST "$BASE/auth/register" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"full_name\":\"Smoke\"}")
echo "$REG" | head -c 200; echo
ACCESS=$(echo "$REG" | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

echo "==> List workspaces"
WS=$(curl -s "$BASE/workspaces" -H "Authorization: Bearer $ACCESS")
WS_ID=$(echo "$WS" | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")
echo "workspace_id=$WS_ID"

echo "==> Create project"
PROJ=$(curl -s -X POST "$BASE/workspaces/$WS_ID/projects" -H "Authorization: Bearer $ACCESS" \
  -H "Content-Type: application/json" -d '{"name":"Demo"}')
PID=$(echo "$PROJ" | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
echo "project_id=$PID"

echo "==> Create file"
curl -s -X POST "$BASE/projects/$PID/files" -H "Authorization: Bearer $ACCESS" \
  -H "Content-Type: application/json" \
  -d '{"path":"README.md","name":"README.md","content":"# hi","mime_type":"text/markdown"}' | head -c 200; echo

echo "==> Create chat"
CHAT=$(curl -s -X POST "$BASE/chats" -H "Authorization: Bearer $ACCESS" \
  -H "Content-Type: application/json" -d "{\"workspace_id\":\"$WS_ID\",\"title\":\"Smoke chat\"}")
CID=$(echo "$CHAT" | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
echo "chat_id=$CID"

echo "==> Stream AI (SSE)"
curl -N -s -X POST "$BASE/ai/stream" -H "Authorization: Bearer $ACCESS" \
  -H "Content-Type: application/json" \
  -d "{\"chat_id\":\"$CID\",\"content\":\"Hello, world\"}" | head -n 40

echo
echo "==> List artifacts"
curl -s "$BASE/artifacts?workspace_id=$WS_ID" -H "Authorization: Bearer $ACCESS" | head -c 400; echo

echo "==> Tools list"
curl -s "$BASE/tools" -H "Authorization: Bearer $ACCESS" | head -c 400; echo

echo "==> Done"
