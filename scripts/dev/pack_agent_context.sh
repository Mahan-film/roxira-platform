#!/bin/zsh
set -eu

# zsh builtin stat: avoids depending on `wc` being on PATH (macOS has no /bin/wc).
zmodload zsh/stat

if (( $# < 1 || $# > 2 )); then
  print -u2 "usage: $0 <file-list.txt> [out-file]"
  exit 2
fi

list_file=$1
out_file=${2:-$TMPDIR/agent-context.txt}
repo_root=$PWD

if [[ ! -f $list_file ]]; then
  print -u2 "file list not found: $list_file"
  exit 2
fi

typeset -a paths
while IFS= read -r path || [[ -n $path ]]; do
  if [[ -z $path ]]; then
    print -u2 "refusing empty path in file list"
    exit 2
  fi

  if [[ $path == /* || $path == ../* || $path == */../* || $path == .. ]]; then
    print -u2 "refusing non-repository path: $path"
    exit 2
  fi

  if [[ $path == data/* || $path == database_snapshots/* || $path == .env* || \
        $path == *.sql || $path == *.tar.gz || $path == *.snapshot || \
        $path == *repomix-output* ]]; then
    print -u2 "refusing path: $path"
    exit 2
  fi

  paths+=("$path")
done < "$list_file"

if (( ${#paths} > 40 )); then
  print -u2 "refusing more than 40 files"
  exit 2
fi

for path in "${paths[@]}"; do
  file_path=$repo_root/$path
  if [[ ! -f $file_path ]]; then
    print -u2 "file not found: $path"
    exit 2
  fi

  byte_size=$(zstat +size -- "$file_path")
  if (( byte_size > 200000 )); then
    print -u2 "refusing file larger than 200000 bytes: $path"
    exit 2
  fi
done

if command -v repomix >/dev/null 2>&1; then
  printf '%s\n' "${paths[@]}" | (cd "$repo_root" && repomix --stdin --compress -o "$out_file")
else
  : > "$out_file"
  for path in "${paths[@]}"; do
    print -r -- "=== $path ===" >> "$out_file"
    print -r -- "$(<"$repo_root/$path")" >> "$out_file"
  done
fi

out_size=$(zstat +size -- "$out_file")
print -r -- "$out_file ($out_size bytes)"
