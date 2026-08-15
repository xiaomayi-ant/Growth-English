#!/usr/bin/env bash
# 把本机 EnPet 恢复成「从未安装过」的状态，用来测试引导流程。
#
# 背景：macOS 卸载 .app 不会删 ~/Library/Application Support/ 下的用户数据，
# 所以重装安装包并不会重新触发引导。真正决定引导是否出现的是数据目录里的
# .onboarding-complete + enpet.sqlite3（见 packages/core/src/onboarding.ts）。
#
# 默认 dry-run，只打印将要删除的东西；确认无误后加 --yes 执行。

set -euo pipefail

APPLY=false
[[ "${1:-}" == "--yes" ]] && APPLY=true

DATA_DIR="$HOME/Library/Application Support/EnPet"
# 改名前的数据目录。留着它的话，migrateLegacyDataDir() 会在下次启动时把旧
# 数据库和 vault 搬回新目录，重置就白做了（config.ts:90）。
LEGACY_DIR="$HOME/Library/Application Support/En Play"
# 引导页建议的默认词库位置，用户选过「推荐目录」以外的路径时可能落在这里。
DOCS_VAULT="$HOME/Documents/EnPet"
INSTALLED_APP="/Applications/EnPet.app"

targets=("$DATA_DIR" "$LEGACY_DIR" "$DOCS_VAULT" "$INSTALLED_APP")

# settings.json 里的 vocabDir 可能指向用户自己的 Obsidian 库，那是真实资料，
# 不属于「应用状态」，绝不在重置范围内。删掉 settings.json 后配置会自动回落
# 到默认目录，所以也不需要动它。
if [[ -f "$DATA_DIR/settings.json" ]]; then
  external_vocab=$(/usr/bin/python3 -c '
import json, sys
try:
    with open(sys.argv[1]) as handle:
        print(json.load(handle).get("vocabDir", ""))
except Exception:
    print("")
' "$DATA_DIR/settings.json")
  if [[ -n "$external_vocab" ]]; then
    echo "保留（你的词库，不属于应用状态）: $external_vocab"
    echo
  fi
fi

found=false
for target in "${targets[@]}"; do
  if [[ -e "$target" ]]; then
    found=true
    if $APPLY; then
      rm -rf "$target"
      echo "已删除: $target"
    else
      echo "将删除: $target"
    fi
  fi
done

if ! $found; then
  echo "没有找到任何 EnPet 本地数据，已经是干净状态。"
  exit 0
fi

echo
if $APPLY; then
  echo "重置完成。装上新的 dmg 后打开，应该看到引导首页。"
else
  echo "以上为预演，未删除任何文件。确认后执行： pnpm reset:local --yes"
fi
