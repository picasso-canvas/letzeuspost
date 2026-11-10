#!/bin/sh
# SeaweedFS as the development and CI file store (§13 File storage, #67): one server with its S3 gateway on 8333.
# The S3 credentials come from the environment (config/env.ts's STORAGE_* names), written to a config file only this
# container sees; anonymous requests are refused. The bucket is created once the server is up, then the healthcheck
# passes.
set -eu

umask 077
cat > /tmp/s3.json <<JSON
{
  "identities": [
    {
      "name": "letzeuspost",
      "credentials": [{ "accessKey": "${STORAGE_ACCESS_KEY_ID}", "secretKey": "${STORAGE_SECRET_ACCESS_KEY}" }],
      "actions": ["Read", "Write", "List", "Tagging", "Admin"]
    }
  ]
}
JSON

weed server -dir=/data -s3 -s3.port=8333 -s3.config=/tmp/s3.json -master.volumeSizeLimitMB=64 &
server=$!

tries=0
until echo "s3.bucket.list" | weed shell >/dev/null 2>&1; do
  tries=$((tries + 1))
  if [ "$tries" -gt 60 ]; then
    echo "start.sh: SeaweedFS didn't come up" >&2
    kill "$server"
    exit 1
  fi
  sleep 1
done
# `s3.bucket.list` prints each bucket as two spaces, its name and a tab. On a kept volume the bucket is already there.
listed() { echo "s3.bucket.list" | weed shell 2>/dev/null | grep -qF "$(printf '  %s\t' "$STORAGE_BUCKET")"; }
if ! listed; then
  echo "s3.bucket.create -name ${STORAGE_BUCKET}" | weed shell
fi
if ! listed; then
  echo "start.sh: the bucket ${STORAGE_BUCKET} isn't there after creating it" >&2
  kill "$server"
  exit 1
fi
touch /tmp/lzp-ready
wait "$server"
