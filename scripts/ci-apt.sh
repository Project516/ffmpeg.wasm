#!/usr/bin/env bash
# Runs a command that installs apt packages as root, up to three times.
# Root keeps apt under timeout's process group so a stuck attempt is killed
# (Playwright skips its own sudo as root). azure.archive.ubuntu.com can serve
# at a crawl that never trips apt's own timeout, so a failed attempt drops it
# and the retry uses the next mirror in /etc/apt/apt-mirrors.txt.
for attempt in 1 2 3; do
  sudo env "PATH=$PATH" timeout -k 10 300 "$@" && exit 0
  echo "apt attempt $attempt failed, retrying without the azure mirror" >&2
  sudo sed -i '/azure\.archive\.ubuntu\.com/d' /etc/apt/apt-mirrors.txt
done
exit 1
