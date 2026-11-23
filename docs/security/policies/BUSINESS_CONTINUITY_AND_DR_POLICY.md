# Roxira Business Continuity & Disaster Recovery Policy

> **Policy Reference**: POL-SEC-005  
> **Effective Date**: 2026-11-22  
> **Status**: Active Standard  
> **Master Reference**: Task T289 (#1112)

---

## 1. Purpose & Scope
This policy defines the strategy, operational procedures, and technical controls to guarantee business continuity, service availability, and data durability in the event of major infrastructure disruptions, datacentre failures, or system disasters.

## 2. Recovery Objectives
Roxira systems are engineered to achieve strict Recovery Point and Recovery Time Objectives:

- **Recovery Point Objective (RPO)**: **< 15 minutes**.
  - Achieved via continuous Write-Ahead Log (WAL) streaming and archive shipping (`wal-g` / PostgreSQL physical streaming replication).
- **Recovery Time Objective (RTO)**: **< 2 hours**.
  - Automated infrastructure provisioning, standalone container orchestration, and verified point-in-time recovery (PITR) restore automation.

## 3. Backup Architecture & Immutability
1. **Continuous Backup Pipeline**:
   - Daily full base backups combined with continuous real-time WAL segment archiving.
   - Database snapshots are compressed, encrypted with AES-256 before transmission, and replicated to geographically distinct storage.
2. **Object Lock & Write-Once-Read-Many (WORM)**:
   - Remote backup archives enforce S3/Object Lock compliance mode, rendering historical snapshots strictly immutable and tamper-proof against ransomware or compromised administrative keys.
3. **Restoration Verification & Drills**:
   - Restore drills are a policy goal. `scripts/dev/fresh_db_migrate.sh` only verifies that migrations build a database from zero in CI; it is not a backup-restore drill, and scheduled backup-restore drills are not yet automated.
   - Full quarterly disaster recovery rehearsals are conducted and recorded in platform operational logs.
   - 12 months of audit log is our retention for all backup verification, restore drill logs, and disaster recovery exercise reports.
