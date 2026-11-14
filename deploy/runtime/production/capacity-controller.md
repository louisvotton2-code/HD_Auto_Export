# EXT07 capacity controller

Controller only: `capacity-decision.py` calls sibling `capacity-measure.py::measure()` once per locked invocation. OPS supplies that live measurement/model function; missing or failed measurement publishes `wait`, never stale `allow`. No supplier requests are made by this controller.

Input is the PM decision binding (`snapshotId`, `targetRows`, `sampleRows`, `evidenceHash`) plus `sampleEvidenceSufficient`, `projectedPeakBytes`, `diskTotalBytes`, `currentUsedBytes`, and a flat `components` dictionary of byte-valued safe integers (names ending in `Bytes`). The measurement implementation must obtain fresh data, not return a prior cached decision. Hash is copied from BE, never reconstructed here. The controller independently checks the 70% boundary and publishes only whitelisted fields, valid for at most ten minutes.

OPS provision `/srv/hd-auto/data/full-sync-capacity` root-owned, group equal to worker APP_GID, mode 0750. Decision files are root/group 0640, atomically replaced with file/directory fsync; worker mounts the directory read-only. Keep source directory root-controlled. Install/enable the matching systemd service and minute timer after the measurement function is present. Timer timeout leaves any old decision bounded by its expiry; the worker independently enforces expiry and live disk limits.

Configured measurement roots may be real paths inside `/srv/hd-auto`, or these exact host controls: `/etc/hd-auto`, `/etc/letsencrypt`, `/etc/fstab`, `/etc/systemd/system/docker.service.d/hd-auto-storage.conf`, `/usr/local/sbin/hd-auto-storage-check`. Parent-link aliases and traversal are rejected; directory size measurement does not follow nested links. Keep the live host controls in the cost model rather than substituting an old backup or omitting their size.

Candidate was edited only on the workstation. Server checks required: `python3 -m unittest test_capacity_decision.py` from `deploy/runtime`, plus existing Compose test extended for this read-only mount. Full measurement/decision/BE integration remains OPS responsibility; this file does not claim deployment or test success.
