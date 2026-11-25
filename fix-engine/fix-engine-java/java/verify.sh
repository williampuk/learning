#!/bin/sh
# Run the deterministic scenarios in separate Maven JVMs using localhost only.
set -eu
cd "$(dirname "$0")"
fix_maven=${FIX_MAVEN:-mvn}
fix_scratch=$(mktemp -d)

"$fix_maven" -q "$@" compile
"$fix_maven" -q "$@" exec:exec
for fix_lab in OrderLifecycleLab MarketAndQuoteLab PostTradeLab RoutingLab; do
  "$fix_maven" -q "$@" exec:java@exercise "-Dexec.mainClass=learning.fix.$fix_lab"
done
for fix_mode in fix50 dictionary liveness reset failover tls; do
  "$fix_maven" -q "$@" exec:java@exercise -Dexec.mainClass=learning.fix.SessionLab "-Dexec.args=$fix_mode"
done
for fix_run in first second; do
  printf 'File-store process run %s\n' "$fix_run"
  "$fix_maven" -q "$@" exec:java@exercise -Dexec.mainClass=learning.fix.SessionLab "-Dexec.args=restart $fix_scratch"
done

fix_checkpoint=src/main/java/learning/fix/CheckpointLab.java
fix_crash_exit=0
java "$fix_checkpoint" crash "$fix_scratch/checkpoint" || fix_crash_exit=$?
test "$fix_crash_exit" -eq 73
java "$fix_checkpoint" replay "$fix_scratch/checkpoint"
java "$fix_checkpoint" replay "$fix_scratch/checkpoint"
printf 'PASS FIX regression suite. Restart evidence: %s\n' "$fix_scratch"
