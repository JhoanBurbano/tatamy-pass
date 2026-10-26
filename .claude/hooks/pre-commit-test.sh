#!/usr/bin/env bash
# Hook PreToolUse (Bash): si el comando es un `git commit`, corre `npm test`
# antes y bloquea el commit (exit 2) si falla. Para cualquier otro comando no
# hace nada. Entrada: JSON de Claude Code por stdin con tool_input.command.
set -u
INPUT=$(cat)
CMD=$(printf '%s' "$INPUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(j.tool_input?.command||"")}catch{process.stdout.write("")}})')
case "$CMD" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT" || exit 0
echo "[hook pre-commit] Corriendo npm test antes del commit…"
if npm test >/tmp/tatami-precommit.log 2>&1; then
  echo "[hook pre-commit] Tests en verde."
  exit 0
fi
echo "[hook pre-commit] npm test falló; commit bloqueado. Últimas líneas:" >&2
tail -40 /tmp/tatami-precommit.log >&2
exit 2
