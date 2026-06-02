#!/bin/bash
TOKEN=$(cat "$(dirname "$0")/token.txt" | tr -d '[:space:]')
if [ -z "$TOKEN" ]; then echo "token.txt가 비어있습니다."; exit 1; fi
cd "$(dirname "$0")"
git remote set-url origin "https://AceK-Creator:${TOKEN}@github.com/AceK-Creator/portview.git"
git push -u origin main
git remote set-url origin "https://github.com/AceK-Creator/portview.git"
rm -f token.txt
echo "완료! token.txt 삭제됨"
