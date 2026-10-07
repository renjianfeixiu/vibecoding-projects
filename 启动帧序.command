#!/bin/zsh
set -e
frameflow_dir="${0:A:h}"
cd "$frameflow_dir"
if ! command -v node >/dev/null 2>&1; then
  if [ -s "$HOME/.nvm/nvm.sh" ]; then
    source "$HOME/.nvm/nvm.sh"
    nvm use --silent 24 || nvm use --silent 22
  fi
fi
if ! command -v node >/dev/null 2>&1; then
  echo '请安装 Node.js 22.18 或更新版本，然后重试。'
  read 'frameflow_key?按回车退出'
  exit 1
fi
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)'; then
  echo '当前 Node.js 版本过低，需要 22.18 或更新版本。'
  read 'frameflow_key?按回车退出'
  exit 1
fi
if node -e 'fetch("http://127.0.0.1:5178/",{signal:AbortSignal.timeout(1500)}).then(r=>r.text()).then(t=>process.exit(t.includes("帧序 FrameFlow")?0:1)).catch(()=>process.exit(1))'; then
  open http://127.0.0.1:5178/
  exit 0
fi
if [ ! -d node_modules ]; then npm ci --no-audit --no-fund; fi
npm start
